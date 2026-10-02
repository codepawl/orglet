import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { MarketPublishing } from '../../apps/desktop/src/core/market/publishing';
import { projectPublishingSource } from '../../apps/desktop/src/core/market/projection';
import { commands, type Worker, type Skill, type Team, type Command } from '../../apps/desktop/src/shared/contracts';
import { PublishingResult, type PublishingContext, type PublishingRelay } from '../../apps/desktop/src/shared/market-desktop';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';

let store: Store;
beforeEach(() => {
  store = new Store(':memory:');
});
afterEach(() => store.close());

const metadata = { name: 'Research friend', summary: 'Evidence-based research', tags: ['research'], language: 'en', license: 'CC-BY-4.0', changelog: 'First version' } as const;
const context: PublishingContext = {
  accountKey: 'fixture-account', generation: 1, status: 'available',
  summaries: { publishingEnabled: true, listings: [], allowance: { listingLimit: 10, listingCount: 0, submissionsInHour: 0, submissionLimit: 5 } },
};

function setup(now?: () => number) {
  const worker = store.all<Worker>('workers')[0];
  const sent: PublishingRelay[] = [];
  const request = vi.fn(async (input: PublishingRelay): Promise<unknown> => {
    if (input.action === 'context') return context;
    sent.push(input);
    return { state: 'unknown' };
  });
  const publisher = new MarketPublishing(store, { request, now });
  const preview = async () => {
    const result = await publisher.execute({ action: 'preview', source: { kind: 'orglet', entityId: worker.id }, metadata, target: null });
    if (result.kind !== 'preview') throw new Error('Fixture preview failed');
    return result.preview;
  };
  return { worker, publisher, request, sent, preview };
}

it('rechecks account-version visibility before a new install despite legacy cached metadata and bytes', async () => {
  const seed = (await seedCatalog()).listings.find(listing => listing.listingId === 'research-friend')!;
  const listing = { ...seed, listingId: 'fixture-owned', author: { displayName: 'Fixture publisher' }, reviewDigest: 'b'.repeat(64) };
  const body = MARKET_SEED_BODIES['research-friend:1'];
  store.setSetting('marketCatalog', { catalog: { listings: [listing] }, fetchedAt: new Date().toISOString() });
  store.setSetting(`marketBody:${listing.listingId}:${listing.version}:${listing.sha256}`, body);
  let visible = true;
  const fetcher = vi.fn(async () => visible ? new Response(body) : new Response(null, { status: 404 }));
  const marketplace = new Marketplace(store, () => {}, { fetch: fetcher });
  const installed = await marketplace.add(listing.listingId, listing.version);
  const before = store.workspace();
  visible = false;
  await expect(marketplace.add(listing.listingId, listing.version)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(store.workspace()).toEqual(before);
  expect(marketplace.installations()).toHaveLength(1);
  expect(store.get<Worker>('workers', installed.entityId).name).toBe(seed.name);
});

it('requires a fresh withdrawal confirmation and preserves an installed account template and its backup payload', async () => {
  const seed = (await seedCatalog()).listings.find(listing => listing.listingId === 'research-friend')!;
  const listing = { ...seed, listingId: 'fixture-owned', author: { displayName: 'Fixture publisher' }, reviewDigest: 'b'.repeat(64) };
  store.setSetting('marketCatalog', { catalog: { listings: [listing] }, fetchedAt: new Date().toISOString() });
  store.setSetting(`marketBody:${listing.listingId}:${listing.version}:${listing.sha256}`, MARKET_SEED_BODIES['research-friend:1']);
  const installed = await new Marketplace(store, () => {}, { fetch: async () => new Response(MARKET_SEED_BODIES['research-friend:1']) }).add(listing.listingId, listing.version);
  const backup = () => JSON.parse(new Backups(store, () => false, () => {}).export()).payload;
  const before = backup();
  const sent: PublishingRelay[] = [];
  const ownerContext: PublishingContext = {
    ...context,
    summaries: {
      publishingEnabled: true,
      listings: [{ listingId: listing.listingId, kind: 'orglet', latest: { listing, state: 'approved' }, published: listing, publicationEpoch: 0 }],
      allowance: { listingLimit: 10, listingCount: 1, submissionsInHour: 0, submissionLimit: 5 },
    },
  };
  const publisher = new MarketPublishing(store, { request: async request => {
    if (request.action === 'context') return ownerContext;
    sent.push(request);
    return { state: 'accepted', receipt: { operation: 'unpublish', listingId: listing.listingId, publicationEpoch: 1 } };
  } });
  await expect(publisher.execute({ action: 'unpublish', listingId: listing.listingId, confirmation: '0'.repeat(64) })).rejects.toThrow('Xem trước lại');
  expect(sent).toEqual([]);
  const own = await publisher.execute({ action: 'listOwn' });
  if (own.kind !== 'own') throw new Error('Fixture owner view failed');
  const result = await publisher.execute({ action: 'unpublish', listingId: listing.listingId, confirmation: own.view.confirmations[listing.listingId] });
  if (result.kind !== 'operation') throw new Error('Fixture withdrawal failed');
  expect(result.operation.state).toBe('unpublished');
  expect(sent).toHaveLength(1);
  expect(backup()).toEqual(before);
  expect(store.get<Worker>('workers', installed.entityId)).toEqual(before.workers.find((worker: Worker) => worker.id === installed.entityId));
});

it('validates public replies and refuses internal authority or journal fields at the renderer boundary', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  expect(PublishingResult.parse({ kind: 'preview', preview })).toEqual({ kind: 'preview', preview });
  for (const field of ['accountKey', 'generation', 'key', 'fingerprint']) {
    expect(PublishingResult.safeParse({ kind: 'preview', preview: { ...preview, [field]: 'private-fixture' } }).success).toBe(false);
  }
  const own = await fixture.publisher.execute({ action: 'listOwn' });
  expect(PublishingResult.safeParse(own).success).toBe(true);
  if (own.kind !== 'own') throw new Error('Fixture own view failed');
  expect(PublishingResult.safeParse({ kind: 'own', view: { ...own.view, capability: { status: 'available', accountKey: 'private-fixture' } } }).success).toBe(false);
  const operation = await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  expect(PublishingResult.safeParse(operation).success).toBe(true);
  if (operation.kind !== 'operation') throw new Error('Fixture operation failed');
  expect(PublishingResult.safeParse({ ...operation, operation: { ...operation.operation, requestText: preview.requestText } }).success).toBe(false);
  const saved = await fixture.publisher.execute({ action: 'inspect', operationId: operation.operation.id });
  expect(PublishingResult.safeParse(saved).success).toBe(true);
  expect(PublishingResult.safeParse({ kind: 'blocked', diagnostics: [{ path: 'name', line: 1, rule: 'credential', message: 'private-fixture' }] }).success).toBe(false);
});

it('projects only public fields and excludes local IDs, privileges and package approval', () => {
  const worker = store.all<Worker>('workers')[0];
  store.versionRows([{ table: 'workers', value: { ...worker, revision: 2, autoApplyProposals: true, mcpServerIds: [] } }]);
  const projected = projectPublishingSource(store, { kind: 'orglet', entityId: worker.id });
  expect(projected.template).toHaveProperty('worker.name', worker.name);
  expect(JSON.stringify(projected.template)).not.toContain(worker.id);
  expect(JSON.stringify(projected.template)).not.toMatch(/autoApplyProposals|mcpServerIds|reviewedHash/);
});

it('projects ordered crew reference closure with shared skills and only approved non-memory team notes', () => {
  const member = store.all<Worker>('workers')[0];
  const lead: Worker = { ...member, id: id(), name: 'Outside lead' };
  const team: Team = { id: id(), revision: 1, name: 'Fixture crew', instructions: 'Read evidence.', workflow: 'sequential', monthlyBudgetMicros: 1000, memberIds: [member.id], synthesizerId: lead.id };
  store.versionRows([{ table: 'workers', value: lead }, { table: 'teams', value: team }]);
  for (const fields of [
    { title: 'Approved note', status: 'approved', scope: { type: 'team', id: team.id } },
    { title: 'Proposed note', status: 'proposed', scope: { type: 'team', id: team.id } },
    { title: 'Private memory', status: 'approved', scope: { type: 'team', id: team.id }, kind: 'memory' },
    { title: 'Workspace note', status: 'approved', scope: { type: 'workspace' } },
  ] as const) {
    const note: Knowledge = { id: id(), revision: 1, content: 'Fixture guidance', tags: [], pinned: false, hash: 'a'.repeat(64), provenance: { kind: 'user' }, createdAt: new Date().toISOString(), ...fields };
    store.put('knowledge', note);
  }
  const result = projectPublishingSource(store, { kind: 'crew', entityId: team.id });
  if (!('workers' in result.template)) throw new Error('Expected crew projection');
  expect(result.template.workers.map(worker => worker.name)).toEqual([member.name, lead.name]);
  expect(result.template.skills).toHaveLength(1);
  expect(result.template.workers.map(worker => worker.skillKey)).toEqual(['skill-1', 'skill-1']);
  expect(result.template.team.memberKeys).toEqual(['worker-1']);
  expect(result.template.team.synthesizerKey).toBe('worker-2');
  expect(result.template.knowledge?.map(note => note.title)).toEqual(['Approved note']);
  expect(JSON.stringify(result.template)).not.toMatch(/Private memory|Workspace note|Proposed note|channel/);
});

it('uses an explicit public model suggestion without exporting private connection IDs or changing local choice', () => {
  const worker = store.all<Worker>('workers')[0];
  const privateWorker: Worker = { ...worker, revision: 2, provider: `custom:${id()}`, modelId: 'private-model' };
  store.versionRows([{ table: 'workers', value: privateWorker }]);
  expect(() => projectPublishingSource(store, { kind: 'orglet', entityId: worker.id })).toThrow('Chọn một kết nối gợi ý');
  const projected = projectPublishingSource(store, { kind: 'orglet', entityId: worker.id }, { provider: 'codex' });
  expect(JSON.stringify(projected.template)).not.toMatch(/custom:|private-model/);
  expect(projected.template).toHaveProperty('worker.provider', 'codex');
  expect(store.get<Worker>('workers', worker.id)).toEqual(privateWorker);
});

it('publishing is absent from generic core, agent and CLI command authority', async () => {
  expect(Object.hasOwn(commands, 'marketPublishing')).toBe(false);
  const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected provider execution'); });
  await expect(core.command('marketPublishing' as Command, { action: 'submit', previewId: id() })).rejects.toThrow();
});

it('reports a closed write gate without claiming a wrong account or invalid withdrawal preview', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  const result = await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  if (result.kind !== 'operation') throw new Error('Fixture operation failed');
  const saved = store.setting('marketPublishingOperations', []);
  fixture.request.mockResolvedValue({ ...context, status: 'unavailable' });
  await expect(fixture.publisher.execute({ action: 'retry', operationId: result.operation.id })).rejects.toThrow('Marketplace chưa sẵn sàng');
  await expect(fixture.publisher.execute({ action: 'unpublish', listingId: 'fixture-listing', confirmation: 'a'.repeat(64) })).rejects.toThrow('Marketplace chưa sẵn sàng');
  expect(store.setting('marketPublishingOperations', [])).toEqual(saved);
  expect(fixture.sent).toHaveLength(1);
});

it('blocks authored credentials before requesting account authority', async () => {
  const fixture = setup();
  store.versionRows([{ table: 'workers', value: { ...fixture.worker, revision: 2, instructions: 'Bearer fixtureCredential123' } }]);
  const result = await fixture.publisher.execute({ action: 'preview', source: { kind: 'orglet', entityId: fixture.worker.id }, metadata, target: null });
  expect(result.kind).toBe('blocked');
  expect(fixture.request).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('fixtureCredential123');
});

it('persists immutable request and key before dispatch and retries them after local edits/new publisher instance', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  fixture.request.mockImplementation(async input => {
    if (input.action === 'context') return context;
    expect(store.setting<any[]>('marketPublishingOperations', [])[0].state).toBe('unknown');
    fixture.sent.push(input);
    return { state: 'unknown' };
  });
  const result = await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  if (result.kind !== 'operation') throw new Error('Fixture submit failed');
  store.versionRows([{ table: 'workers', value: { ...fixture.worker, instructions: 'Later local edit', revision: 2 } }]);
  const restarted = new MarketPublishing(store, { request: fixture.request });
  expect(fixture.sent).toHaveLength(1);
  await restarted.execute({ action: 'retry', operationId: result.operation.id });
  expect(fixture.sent).toHaveLength(2);
  expect(fixture.sent[1]).toEqual(fixture.sent[0]);
  expect(JSON.stringify(result)).not.toMatch(/fixture-account|requestText|"key"/);
});

it.each([{ state: 'notSent', code: 'account_unavailable' }, { state: 'rejected', code: 'invalid_token' }, { state: 'rejected', code: 'email_unverified' }])('preserves original unknown and bytes when retry cannot resolve its outcome', async outcome => {
  const fixture = setup();
  const preview = await fixture.preview();
  const result = await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  if (result.kind !== 'operation') throw new Error('Fixture submit failed');
  fixture.request.mockImplementation(async input => input.action === 'context' ? context : outcome);
  const retry = await fixture.publisher.execute({ action: 'retry', operationId: result.operation.id });
  expect(retry).toMatchObject({ kind: 'operation', operation: { state: 'unknown' } });
  expect(store.setting<any[]>('marketPublishingOperations', [])[0].requestText).toBe(preview.requestText);
});

it('keeps device journal through real SQLite close/reopen, never autosends, and excludes backup/restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-publishing-'));
  let persistent: Store | undefined;
  try {
    persistent = new Store(join(directory, 'fixture.sqlite'));
    const worker = persistent.all<Worker>('workers')[0];
    const requests: PublishingRelay[] = [];
    const request = async (input: PublishingRelay) => {
      requests.push(input);
      return input.action === 'context' ? context : { state: 'unknown' };
    };
    const publisher = new MarketPublishing(persistent, { request });
    const preview = await publisher.execute({ action: 'preview', source: { kind: 'orglet', entityId: worker.id }, metadata, target: null });
    if (preview.kind !== 'preview') throw new Error('Fixture preview failed');
    const sent = await publisher.execute({ action: 'submit', previewId: preview.preview.previewId });
    if (sent.kind !== 'operation') throw new Error('Fixture submit failed');
    const saved = persistent.setting('marketPublishingOperations', []);
    const backup = new Backups(persistent, () => false, () => {}).export();
    expect(backup).not.toContain('marketPublishingOperations');
    persistent.close();
    persistent = new Store(join(directory, 'fixture.sqlite'));
    expect(persistent.setting('marketPublishingOperations', [])).toEqual(saved);
    const reopened = new MarketPublishing(persistent, { request });
    await reopened.execute({ action: 'listOwn' });
    expect(requests.filter(input => input.action === 'send')).toHaveLength(1);
    await reopened.execute({ action: 'retry', operationId: sent.operation.id });
    const sends = requests.filter(input => input.action === 'send');
    expect(sends[1]).toEqual(sends[0]);
    const hostile = JSON.parse(backup);
    hostile.payload.settings.marketPublishingOperations = saved;
    hostile.checksum = createHash('sha256').update(JSON.stringify(hostile.payload)).digest('hex');
    expect(() => new Backups(store, () => false, () => {}).preview(JSON.stringify(hostile))).toThrow();
    const restore = new Backups(store, () => false, () => {});
    restore.restore(restore.preview(backup).token);
    expect(store.setting('marketPublishingOperations', [])).toEqual([]);
  } finally {
    persistent?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects stale source after awaited capability refresh without dispatch', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  fixture.request.mockImplementation(async input => {
    if (input.action !== 'context') throw new Error('Unexpected send');
    const skill = store.all<Skill>('skills')[0];
    store.versionRows([{ table: 'skills', value: { ...skill, revision: 2, content: 'Changed after review' } }]);
    return context;
  });
  await expect(fixture.publisher.execute({ action: 'submit', previewId: preview.previewId })).rejects.toThrow('Xem trước lại');
  expect(store.setting('marketPublishingOperations', [])).toEqual([]);
});

it('one preview permits only one explicit submit even with concurrent clicks', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  const results = await Promise.allSettled([
    fixture.publisher.execute({ action: 'submit', previewId: preview.previewId }),
    fixture.publisher.execute({ action: 'submit', previewId: preview.previewId }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(fixture.sent).toHaveLength(1);
});

it('never sends unknown operations automatically on construction or owner list', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  const restarted = new MarketPublishing(store, { request: fixture.request });
  await restarted.execute({ action: 'listOwn' });
  expect(fixture.sent).toHaveLength(1);
});

it('rechecks preview expiry after awaited context at the durable boundary', async () => {
  let clock = 0;
  const fixture = setup(() => clock);
  const preview = await fixture.preview();
  fixture.request.mockImplementation(async input => {
    if (input.action !== 'context') throw new Error('Unexpected send');
    clock = 600_000;
    return context;
  });
  await expect(fixture.publisher.execute({ action: 'submit', previewId: preview.previewId })).rejects.toThrow('Xem trước lại');
  expect(store.setting('marketPublishingOperations', [])).toEqual([]);
});

it('retains immutable bytes on mismatched receipt and prevents retry under another account', async () => {
  const fixture = setup();
  const preview = await fixture.preview();
  fixture.request.mockImplementation(async input => input.action === 'context' ? context : {
    state: 'accepted', receipt: { operation: 'unpublish', listingId: 'wrong-listing', publicationEpoch: 1 },
  });
  const result = await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  if (result.kind !== 'operation') throw new Error('Fixture submit failed');
  expect(result.operation.state).toBe('unknown');
  expect(store.setting<any[]>('marketPublishingOperations', [])[0].requestText).toBe(preview.requestText);
  fixture.request.mockResolvedValue({ ...context, accountKey: 'other-account', generation: 2 });
  await expect(fixture.publisher.execute({ action: 'retry', operationId: result.operation.id })).rejects.toThrow('đúng tài khoản');
});

it('refuses capacity before dispatch without evicting any unresolved immutable operation', async () => {
  const fixture = setup();
  for (let index = 0; index < 10; index += 1) {
    const preview = await fixture.preview();
    await fixture.publisher.execute({ action: 'submit', previewId: preview.previewId });
  }
  const saved = store.setting('marketPublishingOperations', []);
  const preview = await fixture.preview();
  await expect(fixture.publisher.execute({ action: 'submit', previewId: preview.previewId })).rejects.toThrow('chưa rõ kết quả');
  expect(fixture.sent).toHaveLength(10);
  expect(store.setting('marketPublishingOperations', [])).toEqual(saved);
});
