import { afterEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { chatTurnInput, chatTurnMessageId, chatTurnRevisions } from '../../apps/desktop/src/shared/chat-turns';
import { collectTurns, mainChatTurns } from '../../apps/desktop/src/core/context/thread';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';

const stores: Store[] = [];
const context = SyncRecordingContext.parse({ accountKey: 'b'.repeat(64), generation: 1 });
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function device() {
  const store = new Store(':memory:');
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
function deliver(first: Store, second: Store) {
  const records = first.sync.snapshot(context);
  expect(records.length).toBeLessThan(100);
  second.sync.receive(context, records.reverse());
}
function append(store: Store, taskId: string, brief: string, createdAt: string) {
  const localRevision = Math.max(...store.sync.turns.list(taskId).map(turn => turn.localRevision)) + 1;
  const turn = store.sync.turns.save({ id: id(), taskId, createdAt, input: { brief, sourceIds: [] } }, localRevision);
  store.update('tasks', { ...store.get<Task>('tasks', taskId), inputRevision: localRevision, currentTurnId: turn.id, currentInput: turn.input });
  return turn;
}

it('displays reversed deliveries and concurrent branches in one stable order without renumbering aliases', () => {
  const first = device();
  const second = device();
  const worker = first.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Shared predecessor', sourceIds: [], consent: false, accepted: false,
    budgetMicros: 1000, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' };
  first.put('tasks', task);
  deliver(first, second);
  const alpha = append(first, task.id, 'Sequential alpha', '2026-01-01T00:01:00.000Z');
  const beta = append(first, task.id, 'Sequential beta', '2026-01-01T00:03:00.000Z');
  const branch = append(second, task.id, 'Concurrent branch', '2026-01-01T00:02:00.000Z');
  const quoteId = id();
  first.update('tasks', { ...first.get<Task>('tasks', task.id), quotes: [{ id: quoteId, fromTaskId: id(), artifactId: id(), author: worker.name,
    authorId: worker.id, text: 'Quoted at alpha', afterRevision: alpha.localRevision, createdAt: '2026-01-01T00:01:10.000Z' }] });
  const side: Task = { ...task, id: id(), brief: 'Side question', createdAt: '2026-01-01T00:01:20.000Z', sideOf: { taskId: task.id, throughRevision: alpha.localRevision } };
  first.put('tasks', side);
  deliver(first, second);
  deliver(second, first);
  const firstAlpha = first.sync.turns.list(task.id).find(turn => turn.id === alpha.id)!;
  const secondAlpha = second.sync.turns.list(task.id).find(turn => turn.id === alpha.id)!;
  expect(firstAlpha.localRevision).toBe(alpha.localRevision);
  expect(secondAlpha.localRevision).not.toBe(firstAlpha.localRevision);
  expect(second.sync.turns.list(task.id).find(turn => turn.id === branch.id)?.localRevision).toBe(branch.localRevision);
  for (const store of [first, second]) {
    const detail = store.detail(task.id);
    const order = chatTurnRevisions(detail);
    expect(order.map(alias => chatTurnInput(detail, alias)?.brief)).toEqual(['Shared predecessor', 'Sequential alpha', 'Concurrent branch', 'Sequential beta']);
    expect(order.map(alias => chatTurnMessageId(detail, alias))).toEqual([task.id, alpha.id, branch.id, beta.id]);
    const localAlpha = store.sync.turns.list(task.id).find(turn => turn.id === alpha.id)!;
    expect(detail.task.quotes?.find(quote => quote.id === quoteId)?.afterRevision).toBe(localAlpha.localRevision);
    const through = store.get<Task>('tasks', side.id).sideOf!.throughRevision;
    expect(through).toBe(localAlpha.localRevision);
    const prefix = mainChatTurns(detail, through, worker.id);
    expect(prefix.map(turn => turn.text)).toEqual(['Shared predecessor', 'Sequential alpha', expect.stringContaining('Quoted at alpha')]);
    const localBeta = store.sync.turns.list(task.id).find(turn => turn.id === beta.id)!;
    const run: Run = { id: id(), taskId: task.id, status: 'queued', error: null, startedAt: beta.createdAt,
      snapshot: { worker: store.get<Worker>('workers', worker.id), skill: store.get<Skill>('skills', worker.skillId), inputRevision: localBeta.localRevision, input: beta.input } };
    expect(collectTurns(detail, run).past.map(turn => turn.text)).toEqual(['Shared predecessor', 'Sequential alpha', expect.stringContaining('Quoted at alpha'), 'Concurrent branch']);
  }
});

it('uses UUIDs to break concurrent timestamp ties and keeps sequential authored times monotonic across rollback', () => {
  const store = device();
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Initial', sourceIds: [], consent: false, accepted: false,
    budgetMicros: 1000, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' };
  store.put('tasks', task);
  const wallMs = Date.parse(task.createdAt);
  const next = store.sync.turns.nextCreatedAt(task.id, wallMs - 1000);
  expect(next).toBe('2026-01-01T00:00:00.001Z');
  store.sync.turns.save({ id: 'bbbbbbbb-0000-4000-8000-000000000000', taskId: task.id, createdAt: next, input: { brief: 'B', sourceIds: [] } }, 1);
  store.sync.turns.save({ id: 'aaaaaaaa-0000-4000-8000-000000000000', taskId: task.id, createdAt: next, input: { brief: 'A', sourceIds: [] } }, 2);
  const detail = store.detail(task.id);
  expect(chatTurnRevisions(detail).map(alias => chatTurnInput(detail, alias)?.brief)).toEqual(['Initial', 'A', 'B']);
  expect(store.sync.turns.nextCreatedAt(task.id, wallMs)).toBe('2026-01-01T00:00:00.002Z');
});

it('never fabricates revision zero from a task brief rewritten by a later message', () => {
  const store = device();
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Rewritten later input', sourceIds: [], consent: false, accepted: false,
    budgetMicros: 1000, status: 'completed', inputRevision: 2, createdAt: '2026-01-01T00:00:00.000Z' };
  store.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id, JSON.stringify(task));
  const run: Run = { id: id(), taskId: task.id, status: 'failed', error: 'Original input was lost', startedAt: task.createdAt,
    snapshot: { worker, skill: store.get<Skill>('skills', worker.skillId), inputRevision: 0 } };
  store.db.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(run.id, task.id, JSON.stringify(run));
  store.sync.turns.backfill();
  const detail = store.detail(task.id);
  expect(store.sync.turns.list(task.id)).toEqual([]);
  expect(chatTurnInput(detail, 0)).toBeUndefined();
  expect(chatTurnRevisions(detail)).toEqual([0]);
});

it('timestamps a fresh later input when a storage caller supplies no authored timestamp', () => {
  const store = device();
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'First message', sourceIds: [], consent: false, accepted: false,
    budgetMicros: 1000, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' };
  store.put('tasks', task);
  store.update('tasks', { ...store.get<Task>('tasks', task.id), inputRevision: 1, currentInput: { brief: 'Later message', sourceIds: [] } });
  const detail = store.detail(task.id);
  expect(chatTurnRevisions(detail).map(alias => chatTurnInput(detail, alias)?.brief)).toEqual(['First message', 'Later message']);
  expect(detail.savedTurns![1].createdAt > detail.savedTurns![0].createdAt).toBe(true);
});
