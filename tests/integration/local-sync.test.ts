import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { eraseSources } from '../../apps/desktop/src/core/storage/erase';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import { SyncRecord } from '../../apps/desktop/src/shared/sync-records';
import { chatTurnMessageId, chatTurnRevisions } from '../../apps/desktop/src/shared/chat-turns';
import { ChatSearch } from '../../apps/desktop/src/core/storage/chat-search';
import { MessageInteractions } from '../../apps/desktop/src/core/orchestration/message-interactions';
import { chatHeadline } from '../../apps/desktop/src/shared/forward';

const directory = mkdtempSync(join(tmpdir(), 'orglet-local-sync-'));
const stores: Store[] = [];
const context = SyncRecordingContext.parse({ accountKey: 'a'.repeat(64), generation: 1 });
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function device(time = 1000, path = ':memory:') {
  const store = new Store(path, { syncNow: () => time });
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
function chat(store: Store, workerId = store.all<Worker>('workers')[0].id): Task {
  const task: Task = { id: randomUUID(), workerId, brief: 'Original message', sourceIds: [], status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return store.get<Task>('tasks', task.id);
}
function deliver(first: Store, second: Store) {
  const records = first.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) second.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}

it('does not record account outbox writes without an active context', () => {
  const store = device();
  store.sync.setRecordingContext();
  store.setSetting('theme', 'dark');
  chat(store);
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()?.count).toBe(0);
  store.sync.setRecordingContext(context);
  const snapshot = store.sync.snapshot(context);
  expect(snapshot.some(record => record.data.kind === 'setting' && record.data.change.key === 'theme' && record.data.change.value === 'dark')).toBe(true);
  expect(snapshot.some(record => record.data.kind === 'turn' && record.data.value.input.brief === 'Original message')).toBe(true);
});

it('rolls back a canonical revision, identity, HLC and outbox when the last insert fails', () => {
  const store = device();
  const worker = store.all<Worker>('workers')[0];
  const clock = store.sync.revisions.clock.read();
  const records = store.sync.snapshot(context);
  store.db.exec("CREATE TEMP TRIGGER reject_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'Injected outbox failure'); END");
  expect(() => store.version('workers', { ...worker, revision: 2, name: 'Must roll back' })).toThrow('Injected outbox failure');
  expect(store.get<Worker>('workers', worker.id).name).toBe('Researcher');
  expect(store.nextRevision(worker.id)).toBe(2);
  expect(store.sync.revisions.clock.read()).toEqual(clock);
  expect(store.sync.snapshot(context)).toEqual(records);
  expect(store.sync.outbox(context)).toEqual([]);
  store.db.exec('DROP TRIGGER reject_outbox');
  store.version('workers', { ...worker, revision: 2, name: 'Committed edit' });
  expect(store.sync.outbox(context)).toHaveLength(1);
  expect(store.get<Worker>('workers', worker.id).name).toBe('Committed edit');
});

it('preserves two independent unstarted messages, a rename and a reaction through reversed duplicate delivery', () => {
  const first = device(1000);
  const task = chat(first);
  const second = device(2000);
  deliver(first, second);
  const firstMessageId = first.sync.turns.list(task.id)[0].id;
  first.update('tasks', { ...first.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
    currentInput: { brief: 'First offline message', sourceIds: [] } });
  second.update('tasks', { ...second.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
    currentInput: { brief: 'Second offline message', sourceIds: [] }, messageReactions: [{ messageId: firstMessageId, emoji: 'agree', actor: 'user', createdAt: '2026-01-01T01:00:00.000Z' }] });
  first.setSetting('taskTitles', { [task.id]: 'Renamed on first device' });
  const firstOutbox = first.sync.outbox(context).length;
  const secondOutbox = second.sync.outbox(context).length;
  deliver(first, second);
  deliver(second, first);
  deliver(first, second);
  expect(first.sync.outbox(context)).toHaveLength(firstOutbox);
  expect(second.sync.outbox(context)).toHaveLength(secondOutbox);
  for (const store of [first, second]) {
    const detail = store.detail(task.id);
    expect(detail.savedTurns?.map(turn => turn.input.brief).sort()).toEqual(['First offline message', 'Original message', 'Second offline message']);
    expect(new Set(detail.savedTurns?.map(turn => turn.id)).size).toBe(3);
    expect(store.workspace().tasks.find(item => item.id === task.id)?.title).toBe('Renamed on first device');
    expect(detail.task.messageReactions?.[0].emoji).toBe('agree');
    expect(detail.task.consent).toBe(false);
    expect(detail.task.accepted).toBe(false);
    for (const alias of chatTurnRevisions(detail)) {
      expect(new MessageInteractions(store).target(task.id, chatTurnMessageId(detail, alias)).kind).toBe('user');
    }
    new ChatSearch(store).rebuild();
    expect(new ChatSearch(store).search('Second offline message').chats[0]?.taskId).toBe(task.id);
  }
});

it('withdraws worker descendants and rejects stale offline children until explicit re-enable', () => {
  const first = device(1000);
  const worker = first.all<Worker>('workers')[0];
  const task = chat(first, worker.id);
  const side = { ...task, id: randomUUID(), sideOf: { taskId: task.id, throughRevision: 0 }, brief: 'Private side message', currentTurnId: undefined, turnIds: undefined };
  first.put('tasks', side);
  const second = device(2000);
  deliver(first, second);
  second.update('tasks', { ...second.get<Task>('tasks', side.id), title: 'Offline stale rename' });
  const stale = second.sync.outbox(context).map(item => item.record);
  first.sync.setLocalOnly({ kind: 'worker', id: worker.id, localOnly: true });
  const snapshot = first.sync.snapshot(context);
  expect(snapshot.filter(record => record.data.kind !== 'withdraw')).toEqual([]);
  expect(snapshot[0]?.data).toMatchObject({ kind: 'withdraw', localOnly: true });
  expect(first.sync.outbox(context).map(item => item.record.data.kind)).toEqual(['withdraw']);
  deliver(first, second);
  expect(second.sync.outbox(context)).toEqual([]);
  first.sync.receive(context, stale);
  expect(first.detail(side.id).task.title).toBeUndefined();
  expect(first.sync.turns.list(side.id)[0].input.brief).toBe('Private side message');
  first.sync.setLocalOnly({ kind: 'worker', id: worker.id, localOnly: false });
  deliver(first, second);
  first.sync.receive(context, stale);
  expect(first.detail(side.id).task.title).toBeUndefined();
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'turn' && record.data.value.taskId === side.id)).toBe(true);
});

it('projects eligible fields and keeps local secrets, paths, grants and private marketplace journals out', () => {
  const store = device();
  const task = chat(store);
  const secret = 'private-secret-sentinel';
  const path = 'C:\\private-workspace-sentinel';
  store.setSetting('marketPublishingOperations', [{ secret }]);
  store.setSetting('marketModerationOperations', [{ secret }]);
  store.setSetting('providerConsent', [secret]);
  store.setSetting('newChatWorkspace', { [task.workerId]: { path, permissions: ['read'] } });
  store.setSetting('reviewedSkills', [secret]);
  store.update('tasks', { ...task, consent: true, desktop: { programs: [path] }, currentInput: { brief: task.brief, sourceIds: [], excludedSources: [{ name: path, reason: secret }] } });
  const text = JSON.stringify(store.sync.snapshot(context));
  expect(text).not.toContain(secret);
  expect(text).not.toContain(path);
  expect(text).toContain('Original message');
  const record = store.sync.outbox(context)[0].record;
  expect(() => store.sync.receive(context, [{ ...record, data: { ...record.data, privateAuthority: true } }])).toThrow();
  expect(store.get<Task>('tasks', task.id).consent).toBe(true);
});

it('fences stale account acknowledgements and pauses publishing when a future schema is staged', () => {
  const store = device();
  store.setSetting('theme', 'dark');
  const records = store.sync.outbox(context);
  const next = SyncRecordingContext.parse({ accountKey: 'b'.repeat(64), generation: 2 });
  store.sync.setRecordingContext(next);
  expect(() => store.sync.acknowledge(context, records.map(item => item.record.id))).toThrow('Phiên đồng bộ');
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()?.count).toBe(1);
  store.sync.receive(next, [{ id: randomUUID(), schemaVersion: 2, data: { future: true } }]);
  store.setSetting('theme', 'light');
  expect(store.setting('theme', 'system')).toBe('light');
  expect(() => store.sync.outbox(next)).toThrow('phiên bản Orglet mới hơn');
  expect(() => store.sync.snapshot(next)).toThrow('phiên bản Orglet mới hơn');
  expect(store.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='future'").get()?.count).toBe(1);
});

it('retains unresolved dependency staging and never imports an unknown authority field', () => {
  const first = device();
  const task = chat(first);
  const second = device();
  const records = first.sync.snapshot(context);
  const turn = records.find(record => record.data.kind === 'turn')!;
  second.sync.receive(context, [turn]);
  expect(second.sync.turns.list(task.id)).toEqual([]);
  expect(second.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='pending'").get()?.count).toBe(1);
  deliver(first, second);
  expect(second.sync.turns.list(task.id)[0].input.brief).toBe('Original message');
  expect(() => SyncRecord.parse({ ...turn, scopes: [], data: { kind: 'turn', value: { ...('value' in turn.data ? turn.data.value : {}), grants: ['write'] } } })).toThrow();
});

it('persists a committed outbox and its stable revision identity across a real SQLite restart', () => {
  const path = join(directory, 'restart.sqlite');
  let store = device(1000, path);
  const worker = store.all<Worker>('workers')[0];
  store.version('workers', { ...worker, revision: 2, name: 'Saved before closing' });
  const outbox = store.sync.outbox(context);
  const clock = store.sync.revisions.clock.read();
  store.db.close();
  stores.pop();
  store = device(900, path);
  expect(store.get<Worker>('workers', worker.id).name).toBe('Saved before closing');
  expect(store.sync.outbox(context)).toEqual(outbox);
  expect(store.sync.revisions.clock.read()).toEqual(clock);
});

it('remaps side-thread and quote anchors when concurrent messages have different local aliases', () => {
  const first = device(1000);
  const task = chat(first);
  const second = device(2000);
  deliver(first, second);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
    currentInput: { brief: 'First branch point', sourceIds: [] } });
  second.update('tasks', { ...second.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
    currentInput: { brief: 'Independent second turn', sourceIds: [] } });
  const anchor = first.sync.turns.list(task.id).find(turn => turn.localRevision === 1)!;
  const side: Task = { ...task, id: randomUUID(), currentTurnId: undefined, turnIds: undefined,
    brief: 'Side question', sideOf: { taskId: task.id, throughRevision: 1 } };
  first.put('tasks', side);
  const quote = { id: randomUUID(), fromTaskId: side.id, artifactId: randomUUID(), author: 'Researcher',
    authorId: task.workerId, text: 'A quoted answer', afterRevision: 1, createdAt: task.createdAt };
  first.update('tasks', { ...first.get<Task>('tasks', task.id), quotes: [quote] });
  deliver(first, second);
  const secondAnchor = second.sync.turns.list(task.id).find(turn => turn.id === anchor.id)!;
  expect(secondAnchor.localRevision).toBe(2);
  expect(second.get<Task>('tasks', side.id).sideOf?.throughRevision).toBe(secondAnchor.localRevision);
  expect(second.get<Task>('tasks', task.id).quotes?.[0].afterRevision).toBe(secondAnchor.localRevision);
  const wire = first.sync.snapshot(context);
  const sideRecord = wire.find(record => record.data.kind === 'chat' && record.data.value.id === side.id)!;
  expect(JSON.stringify(sideRecord.data)).not.toContain('throughRevision');
  const quoteRecord = wire.find(record => record.data.kind === 'quote')!;
  expect(JSON.stringify(quoteRecord.data)).not.toContain('afterRevision');
});

it('rolls back a caught nested write without leaking an outbox record into its parent transaction', () => {
  const store = device();
  store.transaction(() => {
    store.setSetting('theme', 'light');
    expect(() => store.transaction(() => {
      store.setSetting('language', 'en');
      throw new Error('Nested failure');
    })).toThrow('Nested failure');
    store.setSetting('sidebarOrder', { workers: [] });
  });
  expect(store.setting('language', 'vi')).toBe('vi');
  expect(store.sync.outbox(context).map(item => item.record.data.kind === 'setting' ? item.record.data.change.key : '')).toEqual(['theme', 'sidebarOrder']);
});

it('keeps an offline deletion above a later-clock privacy re-enable on another device', () => {
  const first = device(1000);
  const task = chat(first);
  const second = device(9000);
  deliver(first, second);
  second.sync.setLocalOnly({ kind: 'worker', id: task.workerId, localOnly: true });
  second.sync.setLocalOnly({ kind: 'worker', id: task.workerId, localOnly: false });
  const state = first.entityState();
  state.workers[task.workerId] = { deletedAt: '2026-01-01T00:00:00.000Z' };
  first.setSetting('entityState', state);
  deliver(first, second);
  expect(second.entityState().workers[task.workerId].deletedAt).toBeTruthy();
  expect(() => second.sync.setLocalOnly({ kind: 'worker', id: task.workerId, localOnly: false })).toThrow('Mục đã xóa');
  expect(second.sync.snapshot(context).some(record => record.data.kind === 'revision' && record.data.revision.value.id === task.workerId)).toBe(false);
  deliver(second, first);
  expect(first.entityState().workers[task.workerId].deletedAt).toBeTruthy();
});

it.each(['members', 'all', 'frozen-team'] as const)('keeps a channel with a private participant local through %s privacy roots', membership => {
  const first = device(1000);
  const second = device(2000);
  const publicWorker = first.all<Worker>('workers')[0];
  const privateSkill: Skill = { id: randomUUID(), revision: 1, name: 'Private skill', content: 'Private skill instruction sentinel' };
  const privateWorker: Worker = { ...publicWorker, id: randomUUID(), revision: 1, skillId: privateSkill.id,
    name: 'Private member', instructions: 'Private member instruction sentinel' };
  first.versionMany([{ table: 'skills', value: privateSkill }, { table: 'workers', value: privateWorker }]);
  first.sync.setLocalOnly({ kind: 'worker', id: privateWorker.id, localOnly: true });
  const task = chat(first, publicWorker.id);
  const team: Team = { id: randomUUID(), revision: 1, name: 'Frozen team', instructions: 'Compare.',
    memberIds: [privateWorker.id], synthesizerId: publicWorker.id, workflow: 'sequential', monthlyBudgetMicros: 1000 };
  if (membership === 'frozen-team') first.version('teams', team);
  first.update('tasks', { ...first.get<Task>('tasks', task.id),
    assignees: membership === 'all' ? 'all' : membership === 'members' ? [publicWorker.id, privateWorker.id] : undefined,
    teamSnapshot: membership === 'frozen-team' ? team : undefined });
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: task.createdAt, error: null,
    snapshot: { worker: privateWorker, skill: privateSkill, inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const snapshot = first.sync.snapshot(context);
  expect(JSON.stringify(snapshot)).not.toContain('Private member instruction sentinel');
  expect(JSON.stringify(snapshot)).not.toContain('Private skill instruction sentinel');
  expect(snapshot.some(record => record.data.kind === 'run' && record.data.value.id === run.id)).toBe(false);
  expect(snapshot.some(record => record.data.kind === 'chat' && record.data.value.id === task.id)).toBe(false);
  deliver(first, second);
  expect(second.workspace().tasks.some(item => item.id === task.id)).toBe(false);
  expect(second.workspace().workers.some(item => item.id === privateWorker.id)).toBe(false);
});

it('requires the frozen historical worker scope after that worker leaves the current channel', () => {
  const first = device(1000);
  const second = device(2000);
  const publicWorker = first.all<Worker>('workers')[0];
  const historical: Worker = { ...publicWorker, id: randomUUID(), revision: 1, name: 'Former member', instructions: 'Historical private sentinel' };
  first.version('workers', historical);
  const task = chat(first, publicWorker.id);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), assignees: [publicWorker.id, historical.id] });
  deliver(first, second);
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: task.createdAt, error: null,
    snapshot: { worker: historical, skill: first.get<Skill>('skills', historical.skillId), inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const original = first.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)!;
  first.update('tasks', { ...first.get<Task>('tasks', task.id), assignees: [publicWorker.id] });
  first.sync.setLocalOnly({ kind: 'worker', id: historical.id, localOnly: true });
  deliver(first, second);
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'run' && record.data.value.id === run.id)).toBe(false);
  const missingPrivateScope = SyncRecord.parse({ ...original, id: randomUUID(), scopes: original.scopes.filter(scope => scope.id !== historical.id) });
  second.sync.receive(context, [missingPrivateScope]);
  expect(second.all('runs')).toEqual([]);
  expect(second.db.prepare("SELECT status FROM sync_inbox WHERE record_id=?").get(missingPrivateScope.id)?.status).toBe('pending');
});

it('supports fifty channel participants and rejects an incoming record missing a member scope', () => {
  const first = device(1000);
  const second = device(2000);
  const seed = first.all<Worker>('workers')[0];
  const workers = [seed, ...Array.from({ length: 49 }, (_, index) => ({ ...seed, id: randomUUID(), revision: 1, name: `Member ${index}` }))];
  first.versionMany(workers.slice(1).map(value => ({ table: 'workers' as const, value })));
  const task = chat(first, seed.id);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), assignees: workers.map(worker => worker.id) });
  const records = first.sync.snapshot(context);
  const channel = records.find(record => record.data.kind === 'chat' && record.data.value.id === task.id)!;
  expect(channel.scopes).toHaveLength(51);
  const incomplete = SyncRecord.parse({ ...channel, id: randomUUID(), scopes: channel.scopes.filter(scope => scope.id !== workers[49].id) });
  second.sync.receive(context, [incomplete]);
  expect(second.workspace().tasks.some(item => item.id === task.id)).toBe(false);
  deliver(first, second);
  expect(second.get<Task>('tasks', task.id).assignees).toEqual(workers.map(worker => worker.id));
});

it('refreshes an unchanged shared skill when a public owner joins or switches away without restarting', () => {
  const first = device(1000);
  const second = device(2000);
  const seed = first.all<Worker>('workers')[0];
  const shared: Skill = { id: randomUUID(), revision: 1, name: 'Shared skill', content: 'Intentionally shared instructions' };
  const privateOwner: Worker = { ...seed, id: randomUUID(), revision: 1, skillId: shared.id, instructions: 'Private owner sentinel' };
  first.versionMany([{ table: 'skills', value: shared }, { table: 'workers', value: privateOwner }]);
  first.sync.setLocalOnly({ kind: 'worker', id: privateOwner.id, localOnly: true });
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'revision' && record.data.revision.value.id === shared.id)).toBe(false);
  const publicOwner: Worker = { ...seed, id: randomUUID(), revision: 1, skillId: shared.id, name: 'Public owner' };
  first.version('workers', publicOwner);
  const snapshot = first.sync.snapshot(context);
  const skillRecord = snapshot.find(record => record.data.kind === 'revision' && record.data.revision.value.id === shared.id)!;
  expect(skillRecord.scopes.some(scope => scope.id === publicOwner.id)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain('Private owner sentinel');
  deliver(first, second);
  expect(second.get<Worker>('workers', publicOwner.id).skillId).toBe(shared.id);
  expect(second.get<Skill>('skills', shared.id).content).toBe(shared.content);
  const replacement: Skill = { ...shared, id: randomUUID(), name: 'Replacement skill' };
  first.version('skills', replacement);
  first.version('workers', { ...publicOwner, revision: 2, skillId: replacement.id });
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'revision' && record.data.revision.value.id === shared.id)).toBe(false);
  deliver(first, second);
  expect(second.get<Worker>('workers', publicOwner.id).skillId).toBe(replacement.id);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('fills an imported unnamed chat from its original saved message after reversed delivery', () => {
  const first = device(1000);
  const second = device(2000);
  const task = chat(first);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
    currentTurnCreatedAt: '2026-01-01T01:00:00.000Z', currentInput: { brief: 'Later message must not become the headline', sourceIds: [] } });
  deliver(first, second);
  expect(chatHeadline(second.get<Task>('tasks', task.id))).toBe('Original message');
  expect(second.sync.turns.list(task.id).map(turn => turn.input.brief).sort()).toEqual(['Later message must not become the headline', 'Original message']);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('scans pending outbox once when bootstrapping many canonical chats', () => {
  const first = device(1000);
  const second = device(2000);
  for (let index = 0; index < 12; index++) chat(first);
  const before = first.sync.outbox(context);
  const prepare = vi.spyOn(first.db, 'prepare');
  try {
    first.sync.refreshFromCanonical();
    expect(prepare.mock.calls.filter(([sql]) => sql === 'SELECT sequence,data FROM sync_outbox')).toHaveLength(1);
  } finally {
    prepare.mockRestore();
  }
  expect(first.sync.outbox(context)).toEqual(before);
  deliver(first, second);
  expect(second.workspace().tasks).toHaveLength(12);
});


it('erases permanent chat payloads from wire caches and every scoped inbox while rejecting delayed replay', () => {
  const first = device(1000);
  const task = chat(first);
  const second = device(2000);
  deliver(first, second);
  const original = first.sync.snapshot(context);
  const turn = original.find(record => record.data.kind === 'turn' && record.data.value.taskId === task.id)!;
  const unrelated = chat(first);
  const unrelatedTurn = first.sync.snapshot(context).find(record => record.data.kind === 'turn' && record.data.value.taskId === unrelated.id)!;
  const otherAccount = 'd'.repeat(64);
  const future = { ...turn, id: randomUUID(), schemaVersion: 2 };
  second.db.prepare('INSERT INTO sync_inbox VALUES(?,?,?,?)').run(otherAccount, future.id, JSON.stringify(future), 'future');
  second.db.prepare('INSERT INTO sync_inbox VALUES(?,?,?,?)').run(otherAccount, unrelatedTurn.id, JSON.stringify(unrelatedTurn), 'applied');
  first.sync.deleteChat(task.id);
  deliver(first, second);
  for (const store of [first, second]) {
    for (const table of ['sync_records', 'sync_inbox', 'sync_outbox']) {
      const cached = store.db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(String(row.data)));
      expect(cached.some(record => record.data?.kind === 'turn' && record.data.value.taskId === task.id)).toBe(false);
      expect(cached.some(record => record.data?.kind === 'chat' && record.data.value.id === task.id)).toBe(false);
    }
    expect(store.sync.snapshot(context).some(record => record.data.kind === 'withdraw' && record.data.root.id === task.id && record.data.deleted)).toBe(true);
  }
  expect(second.db.prepare('SELECT record_id FROM sync_inbox WHERE record_id=?').get(future.id)).toBeUndefined();
  expect(second.db.prepare('SELECT record_id FROM sync_inbox WHERE record_id=?').get(unrelatedTurn.id)).toBeDefined();
  second.sync.receive(context, [turn, SyncRecord.parse({ ...turn, id: randomUUID(), scopes: [] }), future]);
  expect(second.db.prepare('SELECT record_id FROM sync_inbox WHERE record_id=?').get(turn.id)).toBeUndefined();
  expect(second.db.prepare('SELECT record_id FROM sync_inbox WHERE record_id=?').get(future.id)).toBeUndefined();
  expect(second.sync.outbox(context)).toEqual([]);
});

it('rolls back a permanent withdrawal when its payload purge fails', () => {
  const first = device(1000);
  const task = chat(first);
  const second = device(2000);
  deliver(first, second);
  const records = second.sync.snapshot(context);
  const clock = second.sync.revisions.clock.read();
  second.db.exec("CREATE TEMP TRIGGER reject_purge BEFORE DELETE ON sync_inbox BEGIN SELECT RAISE(ABORT,'Injected purge failure'); END");
  expect(() => second.sync.deleteChat(task.id)).toThrow('Injected purge failure');
  expect(second.sync.snapshot(context)).toEqual(records);
  expect(second.sync.revisions.clock.read()).toEqual(clock);
  expect(second.db.prepare("SELECT COUNT(*) AS count FROM sync_deletions WHERE kind='record'").get()?.count).toBe(0);
});

it('refreshes historical channel scopes after a public member joins without changing frozen participants or echoing', () => {
  const path = join(directory, 'expanded-channel.sqlite');
  const first = device(1000, path);
  const seed = first.all<Worker>('workers')[0];
  const former: Worker = { ...seed, id: randomUUID(), revision: 1, name: 'Former participant' };
  const added: Worker = { ...seed, id: randomUUID(), revision: 1, name: 'New participant' };
  first.versionMany([{ table: 'workers', value: former }, { table: 'workers', value: added }]);
  const task = chat(first, seed.id);
  first.update('tasks', { ...task, assignees: [seed.id, former.id] });
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: task.createdAt, error: null,
    snapshot: { worker: former, skill: first.get<Skill>('skills', former.skillId), inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const previous = first.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)!;
  const existingReceiver = device(2000);
  deliver(first, existingReceiver);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), assignees: [seed.id, former.id, added.id] });
  const updated = first.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)!;
  expect(updated.data).toEqual(previous.data);
  expect(updated.id).not.toBe(previous.id);
  expect(updated.scopes.map(scope => scope.id)).toEqual(expect.arrayContaining([task.id, seed.id, former.id, added.id]));
  expect(first.sync.snapshot(context).find(record => record.data.kind === 'turn' && record.data.value.taskId === task.id)?.scopes.map(scope => scope.id))
    .toEqual(expect.arrayContaining([task.id, seed.id, added.id]));
  expect(first.sync.outbox(context).some(item => item.record.id === updated.id)).toBe(true);
  deliver(first, existingReceiver);
  expect(existingReceiver.get<Task>('tasks', task.id).assignees).toEqual([seed.id, former.id, added.id]);
  expect(existingReceiver.all('runs')).toHaveLength(1);
  expect(existingReceiver.sync.outbox(context)).toEqual([]);
  const second = device(2000);
  deliver(first, second);
  expect(second.detail(task.id).savedTurns?.[0].input.brief).toBe('Original message');
  expect(second.get<Run>('runs', run.id).snapshot.worker?.id).toBe(former.id);
  expect(second.sync.outbox(context)).toEqual([]);
  first.close();
  stores.splice(stores.indexOf(first), 1);
  const restarted = device(3000, path);
  expect(restarted.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)).toEqual(updated);
  deliver(restarted, second);
  expect(second.all('runs')).toHaveLength(1);
  expect(second.sync.outbox(context)).toEqual([]);
});


it('purges a permanently deleted crew revision while retaining its deletion state and rejecting offline edits', () => {
  const first = device(1000);
  const worker = first.all<Worker>('workers')[0];
  const team: Team = { id: randomUUID(), revision: 1, name: 'Deleted crew', instructions: 'Deleted crew payload sentinel',
    memberIds: [worker.id], synthesizerId: worker.id, workflow: 'sequential', monthlyBudgetMicros: 1000 };
  first.version('teams', team);
  const second = device(9000);
  deliver(first, second);
  second.version('teams', { ...team, revision: 2, instructions: 'Stale offline crew payload' });
  const delayed = second.sync.snapshot(context);
  const state = first.entityState();
  state.teams[team.id] = { deletedAt: '2026-01-01T00:00:00.000Z' };
  first.setSetting('entityState', state);
  deliver(first, second);
  deliver(second, first);
  first.sync.receive(context, delayed);
  for (const store of [first, second]) {
    expect(store.entityState().teams[team.id].deletedAt).toBeTruthy();
    expect(store.sync.snapshot(context).some(record => record.data.kind === 'delete' && record.data.id === team.id)).toBe(true);
    for (const table of ['sync_records', 'sync_inbox', 'sync_outbox']) {
      const payloads = store.db.prepare(`SELECT data FROM ${table}`).all().map(row => String(row.data)).join('');
      expect(payloads).not.toContain('Deleted crew payload sentinel');
      expect(payloads).not.toContain('Stale offline crew payload');
    }
  }
});


it('keeps every member of an all-orglets chat above picker and scope limits through sync, backup and restart', () => {
  const first = device(1000, join(directory, 'large-roster-origin.sqlite'));
  const seed = first.all<Worker>('workers')[0];
  const workers = [seed, ...Array.from({ length: 69 }, (_, index) => ({ ...seed, id: randomUUID(), revision: 1, name: `Large roster ${index}` }))];
  first.versionMany(workers.slice(1).map(value => ({ table: 'workers' as const, value })));
  const task = chat(first, seed.id);
  first.update('tasks', { ...task, assignees: 'all' });
  const records = first.sync.snapshot(context);
  const chatRecord = records.find(record => record.data.kind === 'chat' && record.data.value.id === task.id)!;
  expect(chatRecord.data.kind === 'chat' && [...(chatRecord.data.value.assignees as string[])].sort()).toEqual(workers.map(worker => worker.id).sort());
  expect(chatRecord.scopes).toHaveLength(71);
  expect(chatRecord.scopes.filter(scope => scope.kind === 'worker').map(scope => scope.id).sort()).toEqual(workers.map(worker => worker.id).sort());
  const path = join(directory, 'large-roster-receiver.sqlite');
  const second = device(2000, path);
  deliver(first, second);
  expect([...(second.get<Task>('tasks', task.id).assignees as string[])].sort()).toEqual(workers.map(worker => worker.id).sort());
  expect(second.detail(task.id).savedTurns?.[0].input.brief).toBe('Original message');
  expect(second.sync.outbox(context)).toEqual([]);
  const backup = new Backups(second, () => false, () => {}).export();
  const restored = device(3000, join(directory, 'large-roster-restored.sqlite'));
  const manager = new Backups(restored, () => false, () => {});
  manager.restore(manager.preview(backup).token);
  expect([...(restored.get<Task>('tasks', task.id).assignees as string[])].sort()).toEqual(workers.map(worker => worker.id).sort());
  second.close();
  stores.splice(stores.indexOf(second), 1);
  const restarted = device(4000, path);
  expect([...(restarted.get<Task>('tasks', task.id).assignees as string[])].sort()).toEqual(workers.map(worker => worker.id).sort());
  expect(restarted.sync.snapshot(context).find(record => record.data.kind === 'chat' && record.data.value.id === task.id)).toEqual(chatRecord);
  first.sync.setLocalOnly({ kind: 'worker', id: workers[69].id, localOnly: true });
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'chat' && record.data.value.id === task.id)).toBe(false);
  expect(first.sync.snapshot(context).some(record => record.data.kind === 'turn' && record.data.value.taskId === task.id)).toBe(false);
  expect(first.sync.outbox(context).some(item => item.record.scopes.some(scope => scope.id === workers[69].id))).toBe(false);
});

it('keeps a shared source usable by more than sixty-four chats without expanding unrelated owners into its scopes', () => {
  const first = device(1000, join(directory, 'many-source-owners-origin.sqlite'));
  const source = { id: randomUUID(), name: 'Shared evidence', bytes: 17, hash: 'b'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: '' });
  const tasks = Array.from({ length: 70 }, () => {
    const task: Task = { id: randomUUID(), workerId: first.all<Worker>('workers')[0].id,
      brief: 'Shared source question', sourceIds: [source.id], status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
    first.put('tasks', task);
    return task;
  });
  const sourceRecord = first.sync.snapshot(context).find(record => record.data.kind === 'source' && record.data.value.id === source.id)!;
  expect(sourceRecord.scopes.filter(scope => scope.kind === 'task')).toHaveLength(1);
  expect(first.all<Task>('tasks').filter(task => task.sourceIds.includes(source.id))).toHaveLength(70);
  const second = device(2000, join(directory, 'many-source-owners-receiver.sqlite'));
  deliver(first, second);
  for (const task of tasks) expect(second.get<Task>('tasks', task.id).sourceIds).toEqual([source.id]);
  expect(second.get<{ id: string }>('sources', source.id).id).toBe(source.id);
  expect(second.sync.outbox(context)).toEqual([]);
  expect(() => new Backups(second, () => false, () => {}).export()).not.toThrow();
});


it('redacts an erased source on an existing receiver and bootstraps cited turns with inert deletion placeholders', () => {
  const first = device(1000);
  const second = device(2000);
  const source = { id: randomUUID(), name: 'Erased source metadata sentinel', bytes: 17, hash: 'e'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: 'C:\\private-source.txt' });
  const task: Task = { id: randomUUID(), workerId: first.all<Worker>('workers')[0].id, brief: 'Question citing erased evidence',
    sourceIds: [source.id], status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
  first.put('tasks', task);
  const delayed = first.sync.snapshot(context);
  deliver(first, second);
  expect(second.get<{ name: string }>('sources', source.id).name).toBe(source.name);
  eraseSources(first);
  deliver(first, second);
  const fresh = device(3000);
  deliver(first, fresh);
  for (const store of [second, fresh]) {
    expect(store.detail(task.id).savedTurns?.[0].input).toEqual({ brief: task.brief, sourceIds: [source.id] });
    expect(store.get('sources', source.id)).toEqual({ id: source.id, name: 'Nguồn đã xóa', bytes: 0,
      hash: '0'.repeat(64), revoked: true, availability: 'other-device' });
    expect(store.db.prepare('SELECT path FROM sources WHERE id=?').get(source.id)?.path).toBe('');
    expect(() => new Backups(store, () => false, () => {}).export()).not.toThrow();
    store.sync.receive(context, delayed);
    expect(store.get<{ name: string }>('sources', source.id).name).toBe('Nguồn đã xóa');
    expect(store.sync.outbox(context)).toEqual([]);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='pending'").get()?.count).toBe(0);
  }
});

it('reassigns a shared source scope to the surviving chat before deleting its previous owner', () => {
  const first = device(1000);
  const source = { id: randomUUID(), name: 'Shared surviving source', bytes: 17, hash: 'f'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: '' });
  const tasks = Array.from({ length: 2 }, () => {
    const task: Task = { id: randomUUID(), workerId: first.all<Worker>('workers')[0].id, brief: 'Shared surviving question',
      sourceIds: [source.id], status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
    first.put('tasks', task);
    return task;
  });
  const previous = first.sync.snapshot(context).find(record => record.data.kind === 'source' && record.data.value.id === source.id)!;
  const deletedId = previous.scopes.find(scope => scope.kind === 'task')!.id;
  const surviving = tasks.find(task => task.id !== deletedId)!;
  first.sync.deleteChat(deletedId);
  const current = first.sync.snapshot(context).find(record => record.data.kind === 'source' && record.data.value.id === source.id)!;
  expect(current.data).toEqual(previous.data);
  expect(current.id).not.toBe(previous.id);
  expect(current.scopes.some(scope => scope.kind === 'task' && scope.id === surviving.id)).toBe(true);
  expect(current.scopes.some(scope => scope.id === deletedId)).toBe(false);
  expect(first.sync.outbox(context).some(item => item.record.id === current.id)).toBe(true);
  const second = device(2000);
  deliver(first, second);
  expect(second.detail(surviving.id).savedTurns?.[0].input.sourceIds).toEqual([source.id]);
  expect(second.get<{ name: string }>('sources', source.id).name).toBe(source.name);
  expect(second.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='pending'").get()?.count).toBe(0);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('validates a shared source against its supplied surviving owner despite reversed receiver chat order', () => {
  const first = device(1000);
  const second = device(2000);
  const source = { id: randomUUID(), name: 'Shared source before update', bytes: 17, hash: 'f'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: '' });
  const tasks = Array.from({ length: 2 }, () => {
    const task: Task = { id: randomUUID(), workerId: first.all<Worker>('workers')[0].id, brief: 'Shared source question',
      sourceIds: [source.id], status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 1000, consent: false, accepted: false };
    first.put('tasks', task);
    return task;
  });
  const records = first.sync.snapshot(context);
  const sourceRecord = records.find(record => record.data.kind === 'source')!;
  const ownerId = sourceRecord.scopes.find(scope => scope.kind === 'task')!.id;
  const otherId = tasks.find(task => task.id !== ownerId)!.id;
  const chats = records.filter(record => record.data.kind === 'chat').sort((a, b) =>
    Number(a.data.kind === 'chat' && a.data.value.id === ownerId) - Number(b.data.kind === 'chat' && b.data.value.id === ownerId));
  second.sync.receive(context, records.filter(record => record.data.kind === 'revision'));
  for (const record of chats) second.sync.receive(context, [record]);
  second.sync.receive(context, records.filter(record => record.data.kind === 'turn'));
  expect(second.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='pending'").get()?.count).toBeGreaterThan(0);
  second.sync.receive(context, [sourceRecord]);
  expect(second.db.prepare('SELECT id FROM tasks ORDER BY rowid').all().map(row => String(row.id))).toEqual([otherId, ownerId]);
  expect(second.sync.snapshot(context).some(record => record.data.kind === 'source' && record.data.value.id === source.id)).toBe(true);
  first.update('sources', { ...source, name: 'Shared source after update' });
  deliver(first, second);
  expect(second.get<{ name: string }>('sources', source.id).name).toBe('Shared source after update');
  first.sync.setLocalOnly({ kind: 'task', id: ownerId, localOnly: true });
  deliver(first, second);
  first.sync.deleteChat(ownerId);
  deliver(first, second);
  expect(second.detail(otherId).savedTurns?.[0].input.sourceIds).toEqual([source.id]);
  const fresh = device(3000);
  deliver(first, fresh);
  expect(fresh.get<{ name: string }>('sources', source.id).name).toBe('Shared source after update');
  for (const receiver of [second, fresh]) {
    expect(receiver.db.prepare("SELECT COUNT(*) AS count FROM sync_inbox WHERE status='pending'").get()?.count).toBe(0);
    expect(receiver.sync.outbox(context)).toEqual([]);
  }
});

it('keeps an imported all-orglets roster frozen when this device creates an unrelated private orglet', () => {
  const first = device(1000);
  const worker = first.all<Worker>('workers')[0];
  const task = chat(first);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), assignees: 'all' });
  const second = device(2000);
  deliver(first, second);
  const before = second.get<Task>('tasks', task.id);
  expect(before.assignees).toEqual([worker.id]);
  const privateId = randomUUID();
  second.version('workers', { ...worker, id: privateId, revision: 1, name: 'Unrelated private orglet', instructions: 'PRIVATE_ROSTER_SENTINEL' });
  second.sync.setLocalOnly({ kind: 'worker', id: privateId, localOnly: true });
  expect(second.get<Task>('tasks', task.id).assignees).toEqual([worker.id]);
  const records = second.sync.snapshot(context);
  expect(records.some(record => record.data.kind === 'turn' && record.data.value.taskId === task.id)).toBe(true);
  expect(JSON.stringify(records)).not.toContain('PRIVATE_ROSTER_SENTINEL');
  expect(records.filter(record => record.data.kind === 'chat' && record.data.value.id === task.id)
    .every(record => !record.scopes.some(scope => scope.id === privateId))).toBe(true);
});

it('refreshes all-orglets chat history immediately when a worker joins and preserves its frozen run', () => {
  const first = device(1000);
  const seed = first.all<Worker>('workers')[0];
  const task = chat(first, seed.id);
  first.update('tasks', { ...task, assignees: 'all' });
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: task.createdAt, error: null,
    snapshot: { worker: seed, skill: first.get<Skill>('skills', seed.skillId), inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const oldRun = first.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)!;
  const second = device(2000);
  deliver(first, second);
  const added: Worker = { ...seed, id: randomUUID(), revision: 1, name: 'New all-chat participant' };
  first.version('workers', added);
  const records = first.sync.snapshot(context);
  const wireChat = records.find(record => record.data.kind === 'chat' && record.data.value.id === task.id)!;
  expect(wireChat.data.kind === 'chat' && wireChat.data.value.assignees).toEqual(expect.arrayContaining([seed.id, added.id]));
  for (const kind of ['turn', 'run']) {
    const history = records.find(record => record.data.kind === kind)!;
    expect(history.scopes.some(scope => scope.kind === 'worker' && scope.id === added.id)).toBe(true);
  }
  expect(records.find(record => record.data.kind === 'run' && record.data.value.id === run.id)?.data).toEqual(oldRun.data);
  deliver(first, second);
  const fresh = device(3000);
  deliver(first, fresh);
  for (const store of [second, fresh]) {
    expect(store.get<Task>('tasks', task.id).assignees).toEqual(expect.arrayContaining([seed.id, added.id]));
    expect(store.detail(task.id).savedTurns?.[0].input.brief).toBe('Original message');
    expect(store.get<Run>('runs', run.id).snapshot.worker?.id).toBe(seed.id);
    expect(store.sync.outbox(context)).toEqual([]);
  }
  first.sync.setLocalOnly({ kind: 'worker', id: added.id, localOnly: true });
  expect(first.sync.snapshot(context).some(record => record.scopes.some(scope => scope.kind === 'task' && scope.id === task.id))).toBe(false);
});

it('preserves a shared source for another public orglet when its prior owner is permanently deleted', () => {
  const first = device(1000);
  const seed = first.all<Worker>('workers')[0];
  const another = { ...seed, id: randomUUID(), name: 'Other public orglet' };
  first.version('workers', another);
  const source = { id: randomUUID(), name: 'Shared source after owner deletion', bytes: 8, hash: 'a'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: '' });
  const tasks = [seed, another].map(worker => {
    const task = chat(first, worker.id);
    first.update('tasks', { ...task, sourceIds: [source.id], inputRevision: 1, currentInput: { brief: 'Uses shared source', sourceIds: [source.id] } });
    return task;
  });
  const before = first.sync.snapshot(context).find(record => record.data.kind === 'source')!;
  const owner = tasks.find(task => before.scopes.some(scope => scope.kind === 'task' && scope.id === task.id))!;
  const survivor = tasks.find(task => task.id !== owner.id)!;
  const state = first.entityState();
  state.workers[owner.workerId] = { deletedAt: '2026-01-01T00:00:00.000Z' };
  first.setSetting('entityState', state);
  const after = first.sync.snapshot(context).find(record => record.data.kind === 'source')!;
  expect(after.scopes.some(scope => scope.id === survivor.id)).toBe(true);
  expect(after.scopes.some(scope => scope.id === owner.workerId)).toBe(false);
  const second = device(2000);
  deliver(first, second);
  expect(second.detail(survivor.id).savedTurns?.some(turn => turn.input.sourceIds.includes(source.id))).toBe(true);
  expect(second.get<{ name: string }>('sources', source.id).name).toBe(source.name);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('restores a batch of permanent barriers atomically and never replays an already restored batch', () => {
  const store = device(1000);
  const deletions = Array.from({ length: 500 }, () => ({ kind: 'source' as const, id: randomUUID() }));
  const before = store.sync.revisions.clock.read();
  store.db.exec(`CREATE TEMP TRIGGER reject_barrier BEFORE INSERT ON sync_deletions WHEN NEW.entity_id='${deletions.at(-1)!.id}' BEGIN SELECT RAISE(ABORT,'Injected barrier failure'); END`);
  expect(() => store.sync.restorePermanentDeletions(deletions)).toThrow('Injected barrier failure');
  expect(store.sync.permanentDeletions()).toEqual([]);
  expect(store.sync.revisions.clock.read()).toEqual(before);
  store.db.exec('DROP TRIGGER reject_barrier');
  store.sync.restorePermanentDeletions(deletions);
  expect(new Set(store.sync.permanentDeletions().map(row => row.id))).toEqual(new Set(deletions.map(row => row.id)));
  const restoredClock = store.sync.revisions.clock.read();
  const outgoing = store.sync.outbox(context);
  store.sync.restorePermanentDeletions(deletions);
  expect(store.sync.revisions.clock.read()).toEqual(restoredClock);
  expect(store.sync.outbox(context)).toEqual(outgoing);
});
