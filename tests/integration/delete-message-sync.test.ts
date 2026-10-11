import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { DeletedMessages } from '../../apps/desktop/src/core/storage/deleted-messages';
import { hasUnknownKind } from '../../apps/desktop/src/core/storage/local-sync';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';

/*
 * A message deleted on this computer is not sent to the account and cannot be taken back from another computer's copy.
 * This build also skips a sync record of a kind it does not know instead of failing the whole page, so a later build
 * can add a deletion record.
 */

const context = SyncRecordingContext.parse({ accountKey: 'a'.repeat(64), generation: 1 });
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function device(time = 1000) {
  const store = new Store(':memory:', { syncNow: () => time });
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
function chat(store: Store): Task {
  const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief: 'Original message about ZEBRA', sourceIds: [], status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return store.get<Task>('tasks', task.id);
}
function deliver(from: Store, to: Store) {
  const records = from.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) to.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}
const turnIdOf = (store: Store, taskId: string) => String(store.db.prepare('SELECT id FROM chat_turns WHERE task_id=?').get(taskId)!.id);
const turnBrief = (store: Store, taskId: string) => JSON.parse(String(store.db.prepare('SELECT data FROM chat_turns WHERE task_id=?').get(taskId)!.data)).input.brief as string;

it('never sends a deleted message, not even when the chat is written again or the account is seeded again', () => {
  const store = device();
  const task = chat(store);
  const messageId = turnIdOf(store, task.id);
  expect(JSON.stringify(store.sync.outbox(context))).toContain('ZEBRA');

  new DeletedMessages(store).delete(task.id, messageId);

  expect(turnBrief(store, task.id)).toBe('(đã xóa)');
  expect(JSON.stringify(store.sync.outbox(context))).not.toContain('ZEBRA');
  expect(store.db.prepare("SELECT COUNT(*) AS count FROM sync_records WHERE record_key=?").get(`turn:${messageId}`)!.count).toBe(0);
  expect(store.db.prepare("SELECT COUNT(*) AS count FROM sync_deletions WHERE kind='record' AND entity_id=?").get(`turn:${messageId}`)!.count).toBe(1);
  // Another write to the chat and a full snapshot carry neither the words nor the blanked placeholder as a changed message.
  store.update('tasks', { ...store.get<Task>('tasks', task.id), title: 'Renamed' });
  const sent = JSON.stringify([...store.sync.outbox(context), ...store.sync.snapshot(context)]);
  expect(sent).not.toContain('ZEBRA');
  expect(sent).not.toContain('(đã xóa)');
});

it('keeps the deletion when another computer still holds the message and sends it again', () => {
  const other = device(1000);
  const task = chat(other);
  const mine = device(2000);
  deliver(other, mine);
  const messageId = turnIdOf(mine, task.id);
  expect(turnBrief(mine, task.id)).toContain('ZEBRA');

  new DeletedMessages(mine).delete(task.id, messageId);
  // The other computer's copy, and a later record from it, arrive after the deletion.
  expect(() => deliver(other, mine)).not.toThrow();
  other.update('tasks', { ...other.get<Task>('tasks', task.id), title: 'Renamed there' });
  expect(() => deliver(other, mine)).not.toThrow();

  expect(turnBrief(mine, task.id)).toBe('(đã xóa)');
  expect(JSON.stringify(mine.sync.outbox(context))).not.toContain('ZEBRA');
});

it('skips a record of an unknown kind and still applies the known ones, and still rejects a malformed known kind', () => {
  const source = device(1000);
  const task = chat(source);
  const records = source.sync.snapshot(context);
  const unknown = { ...records[0], id: randomUUID(), data: { kind: 'messageDeletion', value: { id: randomUUID() } } };
  expect(hasUnknownKind(unknown)).toBe(true);
  expect(hasUnknownKind(records[0])).toBe(false);

  const target = device(2000);
  expect(() => target.sync.receive(context, [unknown, ...records.slice().reverse()])).not.toThrow();
  expect(target.get<Task>('tasks', task.id).id).toBe(task.id);
  expect(target.db.prepare('SELECT COUNT(*) AS count FROM sync_inbox').get()!.count).toBe(records.length);

  const malformed = { ...records[0], id: randomUUID(), data: { ...records[0].data, surprise: true } };
  expect(hasUnknownKind(malformed)).toBe(false);
  expect(() => device(3000).sync.receive(context, [malformed])).toThrow();
});
