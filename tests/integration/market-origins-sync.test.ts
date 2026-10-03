import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';
import { MarketOrigins, type MarketListing } from '../../apps/desktop/src/shared/market';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import type { SyncRecord } from '../../apps/desktop/src/shared/sync-records';
import type { Skill, Team, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Installed marketplace copies and their origins between two computers of one account (GH-479). The two stores
 * exchange exactly what sync would carry: each one's eligible records, received by the other.
 */

const context = SyncRecordingContext.parse({ accountKey: 'b'.repeat(64), generation: 1 });
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

/** An orglet listing carries one `worker`; a crew listing carries `workers`. */
type Template = { worker?: { instructions: string }; workers?: { instructions: string }[] };
const lead = (template: Template) => template.worker ?? template.workers![0];
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function computer(kind: 'orglet' | 'crew') {
  const store = new Store(':memory:');
  stores.push(store);
  store.sync.setRecordingContext(context);
  const seed = (await seedCatalog()).listings.find(item => item.kind === kind)!;
  let body = MARKET_SEED_BODIES[`${seed.listingId}:1`];
  let listing: MarketListing = { ...seed };
  const market = new Marketplace(store, () => {}, {
    fetch: (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v2/catalog') return new Response(null, { status: 404 });
      return new Response(path === '/v1/catalog' ? JSON.stringify({ listings: [listing] }) : body);
    }) as unknown as typeof fetch,
    connected: async () => false,
    defaultModel: async () => ({ provider: 'codex' }),
  });
  await market.catalog(true);
  const publish = async (change: (template: Template) => void) => {
    const template = JSON.parse(body);
    change(template);
    body = JSON.stringify(template);
    listing = { ...listing, version: listing.version + 1, sha256: sha256(body), changelog: 'Next version' };
    await market.catalog(true);
  };
  return { store, market, seed, publish };
}
/** Everything one computer would send, handed to the other in pages, oldest last as a snapshot arrives. */
function deliver(from: Store, to: Store) {
  const records = from.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) to.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}
const origins = (store: Store) => MarketOrigins.parse(store.setting('marketOrigins', []));
const sent = (store: Store): SyncRecord[] => store.sync.snapshot(context);

it.each(['orglet', 'crew'] as const)('an installed %s arrives with its origin, and both computers agree it is unchanged, then edited', async kind => {
  const first = await computer(kind);
  const second = await computer(kind);
  const added = await first.market.add(first.seed.listingId, 1);
  deliver(first.store, second.store);

  expect(origins(second.store)).toEqual(origins(first.store));
  expect(origins(first.store)[0].baselineKind).toBe('authoring-v1');
  expect(second.market.installations().map(item => item.entityId)).toEqual([added.entityId]);
  // The second computer received the copy; it did not install anything or fetch a body.
  expect(second.store.all<Worker>('workers').filter(worker => added.workerIds.includes(worker.id)).length).toBe(added.workerIds.length);

  const change = (template: Template) => { lead(template).instructions += '\nA new line upstream.'; };
  await first.publish(change);
  await second.publish(change);
  expect((await first.market.previewUpdate(added.entityId)).customization).toBe('unchanged');
  expect((await second.market.previewUpdate(added.entityId)).customization).toBe('unchanged');

  // A choice that belongs to one computer (its connection) is not an edit of the installed content.
  const worker = second.store.get<Worker>('workers', added.workerIds[0]);
  second.store.version('workers', { ...worker, revision: second.store.nextRevision(worker.id), provider: 'demo' });
  expect((await second.market.previewUpdate(added.entityId)).customization).toBe('unchanged');

  // An edit made on the second computer is an edit on both.
  const edited = second.store.get<Worker>('workers', added.workerIds[0]);
  second.store.version('workers', { ...edited, revision: second.store.nextRevision(edited.id), instructions: 'Rewritten on the second computer' });
  deliver(second.store, first.store);
  expect((await second.market.previewUpdate(added.entityId)).customization).toBe('customized');
  expect((await first.market.previewUpdate(added.entityId)).customization).toBe('customized');
});

it('two computers that each add the same listing while apart keep both copies, each with its own origin', async () => {
  const first = await computer('orglet');
  const second = await computer('orglet');
  const one = await first.market.add(first.seed.listingId, 1);
  const two = await second.market.add(second.seed.listingId, 1);
  deliver(first.store, second.store);
  deliver(second.store, first.store);
  for (const store of [first.store, second.store]) {
    expect(origins(store).map(origin => origin.entityId).sort()).toEqual([one.entityId, two.entityId].sort());
  }
  // Delivered again, nothing doubles.
  deliver(first.store, second.store);
  expect(origins(second.store)).toHaveLength(2);
  expect(second.market.installations()).toHaveLength(2);
});

it('an update applied on one computer moves the other to the same version and baseline', async () => {
  const first = await computer('orglet');
  const second = await computer('orglet');
  const added = await first.market.add(first.seed.listingId, 1);
  deliver(first.store, second.store);
  const change = (template: Template) => { lead(template).instructions = 'Version two instructions'; };
  await first.publish(change);
  await second.publish(change);
  const preview = await first.market.previewUpdate(added.entityId);
  await first.market.applyUpdate(added.entityId, preview.token);
  deliver(first.store, second.store);

  expect(origins(second.store)).toEqual(origins(first.store));
  expect(origins(second.store)[0].version).toBe(2);
  expect(second.store.get<Worker>('workers', added.workerIds[0]).instructions).toBe('Version two instructions');
  expect(second.market.installations()[0]).toMatchObject({ version: 2, updateAvailable: false });
  await expect(second.market.previewUpdate(added.entityId)).rejects.toThrow('Chưa có bản cập nhật cho bạn này.');
});

it('deleting the installed orglet removes it on the other computer, and a stale copy cannot bring it back', async () => {
  const first = await computer('orglet');
  const second = await computer('orglet');
  const added = await first.market.add(first.seed.listingId, 1);
  deliver(first.store, second.store);
  const stale = sent(second.store);
  const state = first.store.entityState();
  first.store.setSetting('entityState', { ...state, workers: { ...state.workers, [added.entityId]: { deletedAt: new Date().toISOString() } } });
  deliver(first.store, second.store);
  expect(second.market.installations()).toEqual([]);
  first.store.sync.receive(context, stale.slice(0, 100));
  expect(first.market.installations()).toEqual([]);
});

it('never sends the origin, orglet or skill of a copy marked only on this computer', async () => {
  const first = await computer('orglet');
  const added = await first.market.add(first.seed.listingId, 1);
  const worker = first.store.get<Worker>('workers', added.entityId);
  first.store.sync.setLocalOnly({ kind: 'worker', id: added.entityId, localOnly: true });
  const records = JSON.stringify(sent(first.store).filter(record => record.data.kind !== 'withdraw'));
  expect(records).not.toContain(added.entityId);
  expect(records).not.toContain(first.store.get<Skill>('skills', worker.skillId).content.slice(0, 40));
  expect(sent(first.store).some(record => record.data.kind === 'origin')).toBe(false);
});

it('says unknown, not edited, for a copy installed before baselines were comparable between computers', async () => {
  const first = await computer('crew');
  const second = await computer('crew');
  const added = await first.market.add(first.seed.listingId, 1);
  // What an older build saved: a digest of this computer's whole rows, with no tag.
  const [origin] = origins(first.store);
  const workers = Object.values(origin.workerIds).map(workerId => first.store.get<Worker>('workers', workerId));
  const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => first.store.get<Skill>('skills', skillId));
  const { baselineKind: _kind, ...legacy } = origin;
  first.store.setSetting('marketOrigins', [{ ...legacy, baseline: sha256(JSON.stringify({ workers, skills, team: first.store.get<Team>('teams', origin.entityId) })) }]);
  deliver(first.store, second.store);
  const change = (template: Template) => { lead(template).instructions += '\nUpstream.'; };
  await first.publish(change);
  await second.publish(change);
  expect((await first.market.previewUpdate(added.entityId)).customization).toBe('unchanged');
  // The second computer gives its members a local connection, so its rows differ though nobody edited the content.
  const member = second.store.get<Worker>('workers', added.workerIds[0]);
  second.store.version('workers', { ...member, revision: second.store.nextRevision(member.id), provider: 'demo' });
  expect((await second.market.previewUpdate(added.entityId)).customization).toBe('unknown');
  // Applying the update there records a comparable baseline from then on.
  const preview = await second.market.previewUpdate(added.entityId);
  await second.market.applyUpdate(added.entityId, preview.token);
  expect(origins(second.store)[0].baselineKind).toBe('authoring-v1');
});
