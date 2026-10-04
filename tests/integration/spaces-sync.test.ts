import { afterEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import type { SyncRecord } from '../../apps/desktop/src/shared/sync-records';
import { Space } from '../../apps/desktop/src/shared/spaces';

/*
 * Spaces between two computers of one account (docs/spaces-design.md). The two stores exchange exactly what sync
 * would carry: each one's eligible records, received by the other. A space names its orglets, so it travels only
 * while every one of them does.
 */

const context = SyncRecordingContext.parse({ accountKey: 'c'.repeat(64), generation: 1 });
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function computer() {
  const store = new Store(':memory:');
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
/** Everything one computer would send, handed to the other in pages, oldest last as a snapshot arrives. */
function deliver(from: Store, to: Store) {
  const records = from.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) to.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}
const spaces = (store: Store) => store.workspace().spaces;
const sentSpaces = (store: Store): SyncRecord[] => store.sync.snapshot(context).filter(record => record.data.kind === 'space');

it('a space arrives on the other computer, follows an edit, and leaves when it is deleted', () => {
  const first = computer();
  const second = computer();
  const orgletId = first.workspace().workers[0].id;
  const space = Space.parse({ id: id(), name: 'Launch', orgletIds: [orgletId], categories: [{ id: id(), name: 'Copy' }], defaults: { capabilities: ['network.web'] } });
  first.setSetting('spaces', [space]);
  deliver(first, second);
  expect(spaces(second)).toEqual([space]);

  const renamed = { ...space, name: 'Launch week', categories: [] };
  first.setSetting('spaces', [renamed]);
  deliver(first, second);
  expect(spaces(second)).toEqual([renamed]);

  first.setSetting('spaces', []);
  deliver(first, second);
  expect(spaces(second)).toEqual([]);
});

it('a space with an orglet that stays on this computer is not sent', () => {
  const first = computer();
  const orgletId = first.workspace().workers[0].id;
  first.setSetting('spaces', [Space.parse({ id: id(), name: 'Private', orgletIds: [orgletId], categories: [] })]);
  expect(sentSpaces(first)).toHaveLength(1);
  first.sync.setLocalOnly({ kind: 'worker', id: orgletId, localOnly: true });
  expect(sentSpaces(first)).toHaveLength(0);
});
