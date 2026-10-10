import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { MarketAutoUpdates } from '../../apps/desktop/src/core/market/auto-update';
import { CoreService } from '../../apps/desktop/src/core/service';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import type { CliAppState, CliDependencies } from '../../apps/desktop/src/main/cli-turns';
import { parseArguments } from '../../apps/desktop/src/cli/arguments';
import { formatPreferences, formatUpdateCheck } from '../../apps/desktop/src/cli/output';
import { COMMAND_PARITY } from '../../apps/desktop/src/cli/parity';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';
import { automaticUpdateBlock, MarketUpdateRecords, type MarketListing } from '../../apps/desktop/src/shared/market';
import { commands, type Skill, type Team, type Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => store.close());

function sha256(text: string) { return createHash('sha256').update(text).digest('hex'); }

/** A marketplace service that serves one curated listing and lets a test publish new versions of it. */
async function remote(kind: 'orglet' | 'crew' = 'orglet') {
  const seed = (await seedCatalog()).listings.find(item => item.kind === kind)!;
  let body = MARKET_SEED_BODIES[`${seed.listingId}:1`];
  let listing: MarketListing = { ...seed };
  let servedBody: string | undefined;
  let offline = false;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (offline) throw new Error('offline');
    const path = new URL(String(input)).pathname;
    if (path === '/v2/catalog') return new Response(null, { status: 404 });
    return new Response(path === '/v1/catalog' ? JSON.stringify({ listings: [listing] }) : servedBody ?? body);
  }) as unknown as typeof fetch;
  const market = new Marketplace(store, () => {}, { fetch: fetcher, connected: async () => false, defaultModel: async () => ({ provider: 'codex' }) });
  await market.catalog(true);
  const updates = new MarketAutoUpdates(store, market, () => {}, () => new Date());
  return {
    market, updates, fetcher, listingId: seed.listingId,
    publish: async (change: (template: any) => void, version = listing.version + 1) => {
      const template = JSON.parse(body);
      change(template);
      body = JSON.stringify(template);
      listing = { ...listing, version, sha256: sha256(body), changelog: `Changes for version ${version}` };
      return market.catalog(true);
    },
    serve: (text: string | undefined) => { servedBody = text; },
    offline: () => { offline = true; },
  };
}

function turnOn() { store.setSetting('marketAutoUpdate', true); }

describe('the preference', () => {
  it('is off by default, saved through settings, and refuses anything but a boolean', async () => {
    expect(store.workspace().marketAutoUpdate).toBe(false);
    expect(commands.settings.safeParse({ theme: 'system', connectionLimitMicros: 1, marketAutoUpdate: 'yes' }).success).toBe(false);
    const core = new CoreService(store, () => {}, async () => { throw new Error('no model'); });
    await core.command('settings', { theme: 'system', connectionLimitMicros: store.workspace().connectionLimitMicros, marketAutoUpdate: true });
    expect(store.workspace().marketAutoUpdate).toBe(true);
    await core.command('settings', { theme: 'system', connectionLimitMicros: store.workspace().connectionLimitMicros });
    expect(store.workspace().marketAutoUpdate).toBe(true);
    await core.command('settings', { theme: 'system', connectionLimitMicros: store.workspace().connectionLimitMicros, marketAutoUpdate: false });
    expect(store.workspace().marketAutoUpdate).toBe(false);
  });
});

describe('automatic marketplace updates', () => {
  it('apply nothing while the preference is off, and show the update as available', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    await server.updates.run();
    expect(store.get<Worker>('workers', added.entityId).instructions).not.toBe('Updated instructions');
    expect(server.market.installations()[0]).toMatchObject({ version: 1, updateAvailable: true, latestVersion: 2 });
    expect(server.updates.records()).toEqual([]);
  });

  it('apply an untouched copy through a new revision and record what changed', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    const before = store.get<Worker>('workers', added.entityId);
    turnOn();
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    await server.updates.run();
    const after = store.get<Worker>('workers', added.entityId);
    expect(after).toMatchObject({ instructions: 'Updated instructions', revision: before.revision + 1 });
    expect(server.market.installations()[0]).toMatchObject({ version: 2, updateAvailable: false });
    const [record] = server.updates.records();
    expect(record).toMatchObject({ entityId: added.entityId, status: 'applied', fromVersion: 1, toVersion: 2, changelog: 'Changes for version 2' });
    expect(record.changed.length).toBeGreaterThan(0);
    expect(MarketUpdateRecords.safeParse([record]).success).toBe(true);
    const savedRevision = store.db.prepare('SELECT data FROM revisions WHERE entity_id=? AND revision=?').get(before.id, before.revision)!;
    expect(JSON.parse(String(savedRevision.data))).toEqual(before);
  });

  it('leave a copy the person edited for the person', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    const core = new CoreService(store, () => {}, async () => { throw new Error('no model'); });
    await core.command('saveWorker', { ...store.get<Worker>('workers', added.entityId), instructions: 'My own instructions' });
    turnOn();
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    await server.updates.run();
    expect(store.get<Worker>('workers', added.entityId).instructions).toBe('My own instructions');
    expect(server.updates.records()[0]).toMatchObject({ status: 'needs-review', block: 'customized', toVersion: 2 });
    const preview = await server.market.previewUpdate(added.entityId);
    await expect(server.market.applyUpdate(added.entityId, preview.token, { automatic: true })).rejects.toThrow(/xem trước/);
    expect(store.get<Worker>('workers', added.entityId).instructions).toBe('My own instructions');
  });

  it('leave an update that raises a spending limit for the person, and apply one that lowers it', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    turnOn();
    await server.publish(template => { template.worker.taskBudgetMicros = 2_000_000; });
    await server.updates.run();
    expect(store.get<Worker>('workers', added.entityId).taskBudgetMicros).toBe(2_000_000);
    await server.publish(template => { template.worker.taskBudgetMicros = 9_000_000; });
    await server.updates.run();
    expect(store.get<Worker>('workers', added.entityId).taskBudgetMicros).toBe(2_000_000);
    expect(server.updates.records()[0]).toMatchObject({ status: 'needs-review', block: 'widening', widening: [{ kind: 'task-budget' }] });
    expect(automaticUpdateBlock(await server.market.previewUpdate(added.entityId))).toBe('widening');
  });

  it('leave a channel update that adds an orglet or raises the monthly budget for the person', async () => {
    const server = await remote('crew');
    const added = await server.market.add('research-review', 1);
    const team = store.get<Team>('teams', added.entityId);
    turnOn();
    await server.publish(template => {
      template.team.monthlyBudgetMicros = team.monthlyBudgetMicros + 1_000_000;
      template.team.memberKeys.push('extra');
      template.workers.push({ ...template.workers[0], key: 'extra', name: 'Extra helper' });
    });
    await server.updates.run();
    expect(store.get<Team>('teams', added.entityId).memberIds).toHaveLength(team.memberIds.length);
    const [record] = server.updates.records();
    expect(record).toMatchObject({ status: 'needs-review', block: 'widening' });
    expect(record.widening?.map(item => item.kind).sort()).toEqual(['monthly-budget', 'new-orglet']);
  });

  it('record a failure with its reason once and do not try again until a newer version appears', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    turnOn();
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    server.serve('{"tampered":true}');
    await server.updates.run();
    const [failed] = server.updates.records();
    expect(failed).toMatchObject({ status: 'failed', toVersion: 2 });
    expect(failed.reason).toMatch(/SHA-256/);
    const calls = vi.mocked(server.fetcher).mock.calls.length;
    await server.updates.run();
    await server.updates.run();
    expect(vi.mocked(server.fetcher).mock.calls.length).toBe(calls);
    expect(store.get<Worker>('workers', added.entityId).instructions).not.toBe('Updated instructions');
    server.serve(undefined);
    await server.publish(template => { template.worker.instructions = 'Third instructions'; });
    await server.updates.run();
    expect(store.get<Worker>('workers', added.entityId).instructions).toBe('Third instructions');
    expect(server.updates.records()[0]).toMatchObject({ status: 'applied', toVersion: 3 });
  });

  it('do not look at the catalog or apply anything while offline or when the fetch failed', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    turnOn();
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    store.clearSetting('marketCatalog');
    await server.market.catalog(true);
    server.offline();
    const calls = vi.mocked(server.fetcher).mock.calls.length;
    await server.updates.checkWhenDue(true);
    expect(vi.mocked(server.fetcher).mock.calls.length).toBeGreaterThan(calls);
    expect(store.get<Worker>('workers', added.entityId).instructions).not.toBe('Updated instructions');
    expect(server.updates.records()).toEqual([]);
  });

  it('look at the catalog by themselves only when due, and only while on', async () => {
    const server = await remote();
    await server.market.add('research-friend', 1);
    const calls = () => vi.mocked(server.fetcher).mock.calls.length;
    const initial = calls();
    await server.updates.checkWhenDue();
    expect(calls()).toBe(initial);
    turnOn();
    await server.updates.checkWhenDue();
    const afterFirst = calls();
    expect(afterFirst).toBeGreaterThan(initial);
    await server.updates.checkWhenDue();
    expect(calls()).toBe(afterFirst);
  });

  it('forget their record when the person updates by hand', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    turnOn();
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    server.serve('{"tampered":true}');
    await server.updates.run();
    expect(server.updates.records()).toHaveLength(1);
    server.updates.forget(added.entityId);
    expect(server.updates.records()).toEqual([]);
  });
});

describe('the terminal', () => {
  const token = 'a'.repeat(64);
  const signal = new AbortController().signal;

  it('reads and shows the preference', () => {
    expect(parseArguments(['preferences', '--market-auto-update', 'on'])).toMatchObject({ kind: 'preferences', marketAutoUpdate: true });
    expect(parseArguments(['preferences', '--market-auto-update', 'off'])).toMatchObject({ marketAutoUpdate: false });
    expect(() => parseArguments(['preferences', '--market-auto-update', 'maybe'])).toThrow('needs on or off');
    expect(formatPreferences({ language: 'en', theme: 'system', marketAutoUpdate: false })).toContain('off');
    expect(COMMAND_PARITY.marketUpdateRecords).toBeDefined();
  });

  it('lists what has an update and what the automatic path did beside the app update', async () => {
    const app: CliAppState = {
      connections: async () => ({} as never), changelog: async () => ({ releases: [], fetchedAt: null, stale: false }),
      updateState: () => ({ status: 'idle' }), checkForUpdates: () => ({ status: 'checking' }),
    };
    const answers: Record<string, unknown> = {
      marketInstallations: [
        { entityId: 'a', kind: 'orglet', listingId: 'research-friend', version: 1, name: 'Research friend', updateAvailable: true, latestVersion: 2 },
        { entityId: 'b', kind: 'crew', listingId: 'research-review', version: 3, name: 'Review crew', updateAvailable: false },
      ],
      marketUpdateRecords: [
        { name: 'Review crew', status: 'applied', toVersion: 3, changed: ['Review crew'] },
        { name: 'Research friend', status: 'needs-review', toVersion: 2, block: 'customized', changed: [] },
      ],
    };
    const dependencies: CliDependencies = { version: () => 'test', open: () => undefined, translate: text => text, app, request: async command => answers[command] as never };
    const value = await new CliOperations(dependencies).run({ op: 'update-check', token }, signal) as { market: { available: unknown[]; records: unknown[] } };
    expect(value.market.available).toEqual([{ id: 'research-friend', name: 'Research friend', kind: 'orglet', version: 1, latestVersion: 2 }]);
    const text = formatUpdateCheck(value as never);
    expect(text).toContain('Research friend (v1 -> v2)');
    expect(text).toContain('Review crew');
    expect(text).toContain('you edited this copy');
  });

  it('says so in one line when nothing has an update', () => {
    expect(formatUpdateCheck({ status: 'up-to-date', market: { available: [], records: [] } })).toContain('no updates');
  });
});

describe('unrelated edits stay out of the rows an update replaces', () => {
  it('keeps the connection and skill choices of an installed copy', async () => {
    const server = await remote();
    const added = await server.market.add('research-friend', 1);
    const before = store.get<Worker>('workers', added.entityId);
    turnOn();
    await server.publish(template => { template.skill.content = 'Updated skill'; });
    await server.updates.run();
    const after = store.get<Worker>('workers', added.entityId);
    expect(after.provider).toBe(before.provider);
    expect(after.mcpServerIds).toBeUndefined();
    expect(store.get<Skill>('skills', after.skillId).content).toBe('Updated skill');
  });
});
