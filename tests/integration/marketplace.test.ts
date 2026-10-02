import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { CoreService } from '../../apps/desktop/src/core/service';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';
import type { MarketListing } from '../../apps/desktop/src/shared/market';
import type { Worker, Skill, Team } from '../../apps/desktop/src/shared/contracts';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import marketWorker from '../../services/market/src/index';
import { adoptCrews, emptyChannels } from '../../apps/desktop/src/core/storage/channels';
import { Backups } from '../../apps/desktop/src/core/storage/backup';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => store.close());

function sha256(text: string) { return createHash('sha256').update(text).digest('hex'); }
async function remote(kind: 'orglet' | 'crew' = 'orglet') {
  const seed = (await seedCatalog()).listings.find(item => item.kind === kind)!;
  let body = MARKET_SEED_BODIES[`${seed.listingId}:1`];
  let listing: MarketListing = { ...seed };
  let servedBody: string | undefined;
  let offline = false;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (offline) throw new Error('offline');
    const path = new URL(String(input)).pathname;
    return new Response(path === '/v1/catalog' ? JSON.stringify({ listings: [listing] }) : servedBody ?? body);
  }) as unknown as typeof fetch;
  const connected = vi.fn(async () => false);
  const market = new Marketplace(store, () => {}, { fetch: fetcher, connected, defaultModel: async () => ({ provider: 'codex' }) });
  await market.catalog(true);
  return {
    market, fetcher, connected,
    latest: () => listing,
    publish: async (change: (template: any) => void, version = listing.version + 1) => {
      const template = JSON.parse(body);
      change(template);
      body = JSON.stringify(template);
      listing = { ...listing, version, sha256: sha256(body), changelog: `Changes for version ${version}` };
      return market.catalog(true);
    },
    serve: (text: string) => { servedBody = text; },
    offline: () => { offline = true; },
  };
}

it('serves public metadata and immutable hashed orglet and crew bodies; mutations have no route', async () => {
  const response = await marketWorker.fetch(new Request('https://market.orglet.codepawl.com/v1/catalog'));
  const catalog = await response.json() as { listings: MarketListing[] };
  expect(catalog.listings.map(item => item.kind)).toEqual(['orglet', 'crew']);
  for (const listing of catalog.listings) {
    const url = `https://market.orglet.codepawl.com/v1/listings/${listing.listingId}/versions/${listing.version}`;
    const body = await marketWorker.fetch(new Request(url));
    expect(sha256(await body.text())).toBe(listing.sha256);
    expect(body.headers.get('cache-control')).toContain('immutable');
    expect((await marketWorker.fetch(new Request(url, { headers: { 'if-none-match': `"${listing.sha256}"` } }))).status).toBe(304);
  }
  expect((await marketWorker.fetch(new Request('https://market.orglet.codepawl.com/v1/catalog', { method: 'POST' }))).status).toBe(405);
  expect((await marketWorker.fetch(new Request('https://market.orglet.codepawl.com/v1/listings/missing/versions/1'))).status).toBe(404);
});

it.each(['GET', 'HEAD'])('revalidates immutable bodies with weak, listed and wildcard validators for %s', async method => {
  const catalogResponse = await marketWorker.fetch(new Request('https://market.orglet.codepawl.com/v1/catalog'));
  const catalog = await catalogResponse.json() as { listings: MarketListing[] };
  const listing = catalog.listings[0];
  const url = `https://market.orglet.codepawl.com/v1/listings/${listing.listingId}/versions/${listing.version}`;
  const validators: [string, number][] = [
    [`W/"${listing.sha256}"`, 304],
    [`"other", W/"${listing.sha256}"`, 304],
    [` "${listing.sha256}" , "other" `, 304],
    ['*', 304],
    ['W/"other"', 200],
  ];
  for (const [validator, status] of validators) {
    const response = await marketWorker.fetch(new Request(url, { method, headers: { 'If-None-Match': validator } }));
    expect(response.status).toBe(status);
    expect(response.headers.get('etag')).toBe(`"${listing.sha256}"`);
    if (status === 304 || method === 'HEAD') expect(await response.text()).toBe('');
  }
});

it('opens from the bundled catalog and reports failed refresh honestly; validates cached metadata', async () => {
  const market = new Marketplace(store, () => {}, { fetch: async () => { throw new Error('offline'); } });
  expect((await market.catalog()).source).toBe('bundled');
  const failed = await market.catalog(true);
  expect(failed.source).toBe('bundled');
  expect(failed.error).toBeTruthy();
  expect(failed.fetchedAt).toBeNull();
  store.setSetting('marketCatalog', { catalog: { listings: [{ sha256: 'bad' }] }, fetchedAt: 'bad' });
  expect((await market.catalog()).source).toBe('bundled');
});

it('adds an offline orglet with separate persisted origin and a connection fallback, without privileges or chats', async () => {
  const server = await remote();
  const added = await server.market.add('research-friend', 1);
  const worker = store.get<Worker>('workers', added.entityId);
  expect(worker.provider).toBe('codex');
  expect(worker.modelId).toBeUndefined();
  expect(worker.revision).toBe(1);
  expect(worker.mcpServerIds).toBeUndefined();
  expect(worker.autoApplyProposals).toBeUndefined();
  expect(added.fallbackNames).toEqual(['Research friend']);
  expect(store.all('tasks')).toEqual([]);
  expect(store.all('workspace_grants')).toEqual([]);
  const core = new CoreService(store, () => {}, async () => { throw new Error('no provider call'); });
  await core.command('saveWorker', { ...worker, name: 'My research friend', instructions: 'My instructions' });
  const restarted = new Marketplace(store, () => {});
  expect(restarted.installations()[0]).toMatchObject({ listingId: 'research-friend', version: 1, name: 'My research friend' });
});

it('applies a model suggestion only for a verified connection', async () => {
  const market = new Marketplace(store, () => {}, { connected: async provider => provider === 'openai', defaultModel: async () => ({ provider: 'codex' }) });
  const added = await market.add('research-friend', 1);
  expect(store.get<Worker>('workers', added.entityId).provider).toBe('openai');
  expect(store.get<Worker>('workers', added.entityId).modelId).toBeUndefined();
  expect(added.fallbackNames).toEqual([]);
});

it('imports a complete crew atomically with proposed notes and shared skill references', async () => {
  const server = await remote('crew');
  await server.publish(template => { template.knowledge = [{ title: 'Evidence policy', content: 'Check each source.', tags: [], pinned: false }]; });
  const added = await server.market.add('research-review', 2);
  const team = store.get<Team>('teams', added.entityId);
  expect(team.memberIds).toEqual(added.workerIds);
  expect(team.synthesizerId).toBe(added.workerIds[1]);
  expect(new Set(added.workerIds.map(workerId => store.get<Worker>('workers', workerId).skillId)).size).toBe(1);
  const notes = store.all<Knowledge>('knowledge');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ status: 'proposed', scope: { type: 'team', id: team.id } });
  expect(store.all('tasks')).toHaveLength(0);
  expect(store.all('mcp_servers')).toHaveLength(0);
});

it('rejects tampered bodies, unknown privileges, bad references and oversized downloads without entity writes', async () => {
  const server = await remote('crew');
  await server.publish(template => { template.team.instructions += ' New evidence rule.'; });
  const before = store.workspace();
  server.serve('{}');
  await expect(server.market.add('research-review', 2)).rejects.toThrow(/SHA-256/);
  expect(store.workspace()).toEqual(before);
  server.serve('x'.repeat(2 * 1024 * 1024 + 1));
  await expect(server.market.add('research-review', 2)).rejects.toThrow(/2 MB/);
  expect(store.workspace()).toEqual(before);
  store.clearSetting('marketCatalog');
  const bad = await remote('crew');
  await bad.publish(template => { template.workers[0].mcpServerIds = []; });
  await expect(bad.market.add('research-review', 2)).rejects.toThrow();
  expect(store.workspace()).toEqual(before);
  store.clearSetting('marketCatalog');
  const refs = await remote('crew');
  await refs.publish(template => { template.team.memberKeys = ['missing']; });
  await expect(refs.market.add('research-review', 2)).rejects.toThrow(/key/);
  expect(store.workspace()).toEqual(before);
  expect(store.setting('marketOrigins', [])).toEqual([]);
});

it('rolls back all imported rows when a write fails partway through', async () => {
  const market = new Marketplace(store, () => {});
  const before = store.workspace();
  const original = store.versionRows.bind(store);
  vi.spyOn(store, 'versionRows').mockImplementation(rows => { original(rows.slice(0, 1)); throw new Error('disk full'); });
  await expect(market.add('research-review', 1)).rejects.toThrow('disk full');
  expect(store.workspace()).toEqual(before);
  expect(store.setting('marketOrigins', [])).toEqual([]);
});

it('caches validated downloaded bodies for offline adds and recovers a corrupt body cache', async () => {
  const server = await remote();
  await server.publish(template => { template.worker.instructions += ' Keep uncertainty visible.'; });
  await server.market.add('research-friend', 2);
  const listing = server.latest();
  const key = `marketBody:${listing.listingId}:${listing.version}:${listing.sha256}`;
  store.setSetting(key, 'tampered cache');
  await server.market.add('research-friend', 2);
  expect(store.setting(key, '')).not.toBe('tampered cache');
  server.offline();
  const catalog = await server.market.catalog(true);
  expect(catalog.source).toBe('cache');
  expect(catalog.error).toBeTruthy();
  expect(catalog.listings[0].version).toBe(2);
  await expect(server.market.add('research-friend', 2)).resolves.toMatchObject({ kind: 'orglet' });
});

it('rejects catalog rollback and a changed hash for an existing version', async () => {
  const server = await remote();
  await server.publish(template => { template.worker.instructions += ' Update.'; });
  expect((await server.publish(template => { template.worker.instructions += ' Tamper.'; }, 2)).source).toBe('cache');
  expect((await server.publish(template => { template.worker.instructions += ' Rollback.'; }, 1)).error).toBeTruthy();
  expect((await server.market.catalog()).listings[0].version).toBe(2);
});

it('reviews customization, rejects stale cards and creates new revisions while keeping old snapshots and local choices', async () => {
  const server = await remote();
  const added = await server.market.add('research-friend', 1);
  const original = store.get<Worker>('workers', added.entityId);
  const originalSkill = store.get<Skill>('skills', original.skillId);
  const core = new CoreService(store, () => {}, async () => { throw new Error('no provider call'); });
  await core.command('saveWorker', { ...original, instructions: 'My customized instructions', autoApplyProposals: true });
  await server.publish(template => { template.worker.instructions = 'Updated instructions'; template.skill.content = 'Updated skill'; });
  const preview = await server.market.previewUpdate(added.entityId);
  expect(preview.customized).toBe(true);
  expect(preview.changes[0].before).toContain('My customized instructions');
  expect(preview.changes[0].after).toContain('Updated instructions');
  const edited = store.get<Worker>('workers', added.entityId);
  await core.command('saveWorker', { ...edited, instructions: 'Edited while reviewing' });
  await expect(server.market.applyUpdate(added.entityId, preview.token)).rejects.toThrow(/so sánh/);
  const fresh = await server.market.previewUpdate(added.entityId);
  await server.market.applyUpdate(added.entityId, fresh.token);
  const updated = store.get<Worker>('workers', added.entityId);
  expect(updated).toMatchObject({ revision: 4, instructions: 'Updated instructions', provider: 'codex', autoApplyProposals: true });
  expect(updated.skillId).not.toBe(original.skillId);
  expect(store.get<Skill>('skills', original.skillId)).toEqual(originalSkill);
  const savedRevision = store.db.prepare('SELECT data FROM revisions WHERE entity_id=? AND revision=1').get(original.id)!;
  expect(JSON.parse(String(savedRevision.data))).toEqual(original);
  expect(server.market.installations()[0]).toMatchObject({ version: 2, updateAvailable: false });
});

it('updates a crew and its existing channel, retaining friends removed from the crew', async () => {
  const server = await remote('crew');
  const added = await server.market.add('research-review', 1);
  const core = new CoreService(store, () => {}, async () => { throw new Error('no provider call'); });
  adoptCrews(store, () => new Date().toISOString());
  const channels = core.channels;
  const market = new Marketplace(store, () => {}, { fetch: server.fetcher, defaultModel: async () => ({ provider: 'demo' }), followCrew: team => channels.followCrew(team) });
  await server.publish(template => { template.team.name = 'Updated review crew'; template.team.memberKeys = ['reviewer']; template.workers = [template.workers[1]]; });
  const preview = await market.previewUpdate(added.entityId);
  expect(preview.changes[0].before).toContain('Research friend');
  expect(preview.changes[0].after).not.toContain('Research friend');
  await market.applyUpdate(added.entityId, preview.token);
  expect(store.get<Team>('teams', added.entityId)).toMatchObject({ name: 'Updated review crew', revision: 2, memberIds: [added.workerIds[1]] });
  expect(store.get<Worker>('workers', added.workerIds[0]).name).toBe('Research friend');
  expect(emptyChannels(store).find(channel => channel.crewId === added.entityId)?.name).toBe('Updated review crew');
});

it.each(['archivedAt', 'deletedAt'] as const)('rejects an update when %s changes during asynchronous preparation', async stateField => {
  const server = await remote();
  const added = await server.market.add('research-friend', 1);
  await server.publish(template => { template.worker.instructions = 'New instructions'; });
  let release!: () => void;
  let preparing!: () => void;
  const started = new Promise<void>(resolve => { preparing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const market = new Marketplace(store, () => {}, { fetch: server.fetcher, defaultModel: async () => {
    preparing();
    await gate;
    return { provider: 'demo' };
  } });
  const preview = await market.previewUpdate(added.entityId);
  const pending = market.applyUpdate(added.entityId, preview.token);
  await started;
  const state = store.entityState();
  state.workers[added.entityId] = { [stateField]: new Date().toISOString() };
  store.setSetting('entityState', state);
  const original = store.get<Worker>('workers', added.entityId);
  const skills = store.all<Skill>('skills');
  release();
  await expect(pending).rejects.toThrow(/lưu trữ hoặc xóa/);
  expect(store.get<Worker>('workers', added.entityId)).toEqual(original);
  expect(store.all<Skill>('skills')).toEqual(skills);
  expect(store.setting<any[]>('marketOrigins', [])[0].version).toBe(1);
});

it('backs up safe origin links, rejects dangling references, and keeps existing origins aligned during additive restore', async () => {
  const server = await remote();
  const added = await server.market.add('research-friend', 1);
  const backups = new Backups(store, () => false, () => {});
  const text = backups.export();
  const envelope = JSON.parse(text);
  expect(envelope.payload.marketOrigins).toHaveLength(1);
  expect(envelope.payload.marketOrigins[0]).toMatchObject({ entityId: added.entityId, listingId: 'research-friend', version: 1 });
  expect(text).not.toContain('marketBody:');
  expect(text).not.toContain('marketCatalog');
  const target = new Store(':memory:');
  try {
    const targetBackups = new Backups(target, () => false, () => {});
    targetBackups.restore(targetBackups.preview(text).token);
    expect(new Marketplace(target, () => {}).installations()[0]).toMatchObject({ entityId: added.entityId, version: 1 });
    const invalid = JSON.parse(text);
    invalid.payload.marketOrigins[0].skillIds.skill = crypto.randomUUID();
    invalid.checksum = sha256(JSON.stringify(invalid.payload));
    expect(() => targetBackups.preview(JSON.stringify(invalid))).toThrow(/Nguồn danh mục/);
    await server.publish(template => { template.worker.instructions = 'Updated instructions'; });
    const preview = await server.market.previewUpdate(added.entityId);
    await server.market.applyUpdate(added.entityId, preview.token);
    targetBackups.restore(targetBackups.preview(backups.export()).token);
    expect(new Marketplace(target, () => {}).installations()[0].version).toBe(1);
    expect(target.get<Worker>('workers', added.entityId).revision).toBe(1);
    const market = new Marketplace(target, () => {}, { fetch: server.fetcher });
    await market.catalog(true);
    expect(market.installations()[0].updateAvailable).toBe(true);
    await expect(market.previewUpdate(added.entityId)).resolves.toMatchObject({ installedVersion: 1 });
  } finally { target.close(); }
});



it('rejects a delayed older catalog after a newer refresh has committed', async () => {
  const seed = (await seedCatalog()).listings[0];
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  let requests = 0;
  const market = new Marketplace(store, () => {}, { fetch: async () => {
    requests += 1;
    return requests === 1 ? delayed : new Response(JSON.stringify({ listings: [{ ...seed, version: 3 }] }));
  } });
  const older = market.catalog(true);
  expect((await market.catalog(true)).listings[0].version).toBe(3);
  release(new Response(JSON.stringify({ listings: [{ ...seed, version: 2 }] })));
  expect((await older).error).toBeTruthy();
  expect((await market.catalog()).listings[0].version).toBe(3);
});

it('removes omitted template-owned fields while keeping local connection and privilege choices', async () => {
  const server = await remote('crew');
  const added = await server.market.add('research-review', 1);
  const worker = store.get<Worker>('workers', added.workerIds[0]);
  store.version('workers', { ...worker, description: 'Local description', taskBudgetMicros: 1234, autoApplyProposals: true, revision: 2 });
  const team = store.get<Team>('teams', added.entityId);
  store.version('teams', { ...team, maxConcurrentTasks: 2, taskBudgetMicros: 1234, revision: 2 });
  await server.publish(template => {
    for (const member of template.workers) {
      delete member.avatar;
      delete member.description;
      delete member.taskBudgetMicros;
    }
    delete template.team.maxConcurrentTasks;
    delete template.team.taskBudgetMicros;
  });
  const preview = await server.market.previewUpdate(added.entityId);
  expect(preview.changes[0].before).toContain('maxConcurrentTasks');
  expect(preview.changes[0].after).not.toContain('maxConcurrentTasks');
  await server.market.applyUpdate(added.entityId, preview.token);
  expect(store.get<Team>('teams', added.entityId).maxConcurrentTasks).toBeUndefined();
  expect(store.get<Team>('teams', added.entityId).taskBudgetMicros).toBeUndefined();
  expect(store.get<Worker>('workers', worker.id)).toMatchObject({ provider: worker.provider, autoApplyProposals: true });
  expect(store.get<Worker>('workers', worker.id).avatar).toBeUndefined();
  expect(store.get<Worker>('workers', worker.id).description).toBeUndefined();
  expect(store.get<Worker>('workers', worker.id).taskBudgetMicros).toBeUndefined();
});

it.each(['archivedAt', 'deletedAt'] as const)('rejects a crew update if a member becomes %s during preparation', async stateField => {
  const server = await remote('crew');
  const added = await server.market.add('research-review', 1);
  await server.publish(template => { template.team.instructions = 'Updated crew'; });
  let release!: () => void;
  let preparing!: () => void;
  const started = new Promise<void>(resolve => { preparing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const market = new Marketplace(store, () => {}, { fetch: server.fetcher, defaultModel: async () => {
    preparing();
    await gate;
    return { provider: 'demo' };
  } });
  const preview = await market.previewUpdate(added.entityId);
  const original = store.get<Team>('teams', added.entityId);
  const workers = store.all<Worker>('workers');
  const pending = market.applyUpdate(added.entityId, preview.token);
  await started;
  const state = store.entityState();
  state.workers[added.workerIds[0]] = { [stateField]: new Date().toISOString() };
  store.setSetting('entityState', state);
  release();
  await expect(pending).rejects.toThrow(/lưu trữ hoặc xóa/);
  expect(store.get<Team>('teams', added.entityId)).toEqual(original);
  expect(store.all<Worker>('workers')).toEqual(workers);
  await expect(market.previewUpdate(added.entityId)).rejects.toThrow(/lưu trữ hoặc xóa/);
});
