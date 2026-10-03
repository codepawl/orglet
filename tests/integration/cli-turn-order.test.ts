import { afterEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import type { Artifact, Run, Skill, Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import { chatTurns, latestAnsweredRevision, resolveMessage, turnRevisionAt, savedTurnInput } from '../../apps/desktop/src/main/cli-chat-history';
import { CliChatActions } from '../../apps/desktop/src/main/cli-chat-actions';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const context = SyncRecordingContext.parse({ accountKey: 'c'.repeat(64), generation: 1 });
function device() {
  const store = new Store(':memory:');
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
function reversedReceipt() {
  const first = device();
  const second = device();
  const worker = first.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Shared first turn', sourceIds: [], createdAt: '2026-01-01T00:00:00.000Z',
    status: 'completed', budgetMicros: 1000, consent: false, accepted: false };
  first.put('tasks', task);
  second.sync.receive(context, first.sync.snapshot(context));
  const alpha = first.sync.turns.save({ id: id(), taskId: task.id, createdAt: '2026-01-01T00:01:00.000Z', input: { brief: 'Earlier authored turn', sourceIds: [], replyTo: task.id } }, 1);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), inputRevision: alpha.localRevision, currentTurnId: alpha.id, currentInput: alpha.input });
  const beta = first.sync.turns.save({ id: id(), taskId: task.id, createdAt: '2026-01-01T00:03:00.000Z', input: { brief: 'Later authored turn', sourceIds: [], replyTo: task.id } }, 2);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), inputRevision: beta.localRevision, currentTurnId: beta.id, currentInput: beta.input });
  // Separate receipts prove later-first arrival; snapshot key order is deliberately unrelated to author order.
  const records = first.sync.snapshot(context);
  second.sync.receive(context, records.filter(record => record.data.kind === 'turn' && record.data.value.id === beta.id));
  second.sync.receive(context, records.filter(record => record.data.kind === 'turn' && record.data.value.id === alpha.id));
  const artifactIds = { alpha: id(), beta: id() };
  for (const store of [first, second]) {
    for (const turn of [alpha, beta]) {
      const alias = store.sync.turns.list(task.id).find(saved => saved.id === turn.id)!.localRevision;
      const run: Run = { id: id(), taskId: task.id, status: 'completed', error: null, startedAt: turn.createdAt,
        snapshot: { worker: store.get<Worker>('workers', worker.id), skill: store.get<Skill>('skills', worker.skillId), inputRevision: alias, input: turn.input } };
      const artifact: Artifact = { id: turn.id === alpha.id ? artifactIds.alpha : artifactIds.beta, runId: run.id,
        report: { format: 'chat', title: 'Answer', summary: `Answer to ${turn.input.brief}`, findings: [], limitations: [] }, hash: 'a'.repeat(64), createdAt: turn.createdAt };
      store.db.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(run.id, task.id, JSON.stringify(run));
      store.db.prepare('INSERT INTO artifacts(id,run_id,data) VALUES(?,?,?)').run(artifact.id, run.id, JSON.stringify(artifact));
    }
  }
  return { first, second, task, alpha, beta, artifactIds };
}

it('pages every reversed-receipt turn with chronological numbers, authored timestamps and stable message references', () => {
  const { first, second, task, alpha, beta, artifactIds } = reversedReceipt();
  expect(second.sync.turns.list(task.id).find(turn => turn.id === alpha.id)?.localRevision).toBe(2);
  for (const store of [first, second]) {
    const detail = store.detail(task.id);
    const newest = chatTurns(detail, 1);
    expect(newest.earlier).toBe(2);
    expect(newest.turns[0]).toMatchObject({ number: 3, text: beta.input.brief, sentAt: beta.createdAt, replyTo: '#1 Shared first turn' });
    expect(newest.turns[0].answers[0].ref).toBe('3.1');
    const earlier = chatTurns(detail, 1, newest.turns[0].number);
    expect(earlier).toMatchObject({ earlier: 1, turns: [{ number: 2, text: alpha.input.brief, sentAt: alpha.createdAt }] });
    const oldest = chatTurns(detail, 1, earlier.turns[0].number);
    expect(oldest).toMatchObject({ earlier: 0, turns: [{ number: 1, text: task.brief }] });
    expect(resolveMessage(detail, '2').messageId).toBe(alpha.id);
    expect(resolveMessage(detail, '3.1').messageId).toBe(artifactIds.beta);
    expect(resolveMessage(detail, 'last')).toEqual({ messageId: artifactIds.beta, ref: '3.1' });
    expect(latestAnsweredRevision(detail)).toBe(turnRevisionAt(detail, 3));
  }
});

it('maps numbered edits to the correct saved input while keeping the core idle guard', async () => {
  const { second, task } = reversedReceipt();
  let revised: unknown;
  const detail = second.detail(task.id);
  const actions = new CliChatActions({ request: async (command, input) => {
    if (command === 'workspace') return second.workspace();
    if (command === 'task') return detail;
    if (command === 'reviseTask') { revised = input; return; }
    throw new Error(`Unexpected command ${command}`);
  }, version: () => 'test', open: () => undefined, translate: message => message });
  await actions.revise({ op: 'revise', token: 'a'.repeat(64), chat: task.id, message: '2', text: 'Correction', wait: false, timeoutSeconds: 5 }, new AbortController().signal);
  expect(revised).toMatchObject({ taskId: task.id, brief: 'Correction', replyTo: task.id, onlyWhenIdle: true });
});

it('edits the durable imported alias-zero message without borrowing aggregate chat attachments or reply targets', () => {
  const first = device();
  const second = device();
  const worker = first.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Original predecessor', sourceIds: [], createdAt: '2026-01-01T00:00:00.000Z',
    status: 'completed', budgetMicros: 1000, consent: false, accepted: false };
  first.put('tasks', task);
  const firstSource: Source = { id: id(), name: 'alpha.txt', bytes: 5, hash: 'a'.repeat(64), revoked: false };
  const secondSource: Source = { id: id(), name: 'beta.txt', bytes: 4, hash: 'b'.repeat(64), revoked: false };
  first.put('sources', firstSource, { column: 'path', value: '' });
  first.put('sources', secondSource, { column: 'path', value: '' });
  const alpha = first.sync.turns.save({ id: id(), taskId: task.id, createdAt: '2026-01-01T00:01:00.000Z',
    input: { brief: 'Alpha original input', sourceIds: [firstSource.id], replyTo: task.id } }, 1);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), sourceIds: [firstSource.id], inputRevision: 1, currentTurnId: alpha.id, currentInput: alpha.input });
  const beta = first.sync.turns.save({ id: id(), taskId: task.id, createdAt: '2026-01-01T00:03:00.000Z',
    input: { brief: 'Beta original input', sourceIds: [secondSource.id], replyTo: alpha.id } }, 2);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), sourceIds: [firstSource.id, secondSource.id], inputRevision: 2, currentTurnId: beta.id, currentInput: beta.input });
  const records = first.sync.snapshot(context);
  // Import identity and attachment placeholders without any user turns, then deliver beta before alpha and the predecessor.
  second.sync.receive(context, records.filter(record => record.data.kind !== 'turn'));
  expect(second.sync.turns.list(task.id)).toEqual([]);
  for (const turnId of [beta.id, alpha.id, task.id]) {
    second.sync.receive(context, records.filter(record => record.data.kind === 'turn' && record.data.value.id === turnId));
  }
  const detail = second.detail(task.id);
  expect(detail.savedTurns?.find(turn => turn.id === beta.id)?.localRevision).toBe(0);
  expect(new Set(detail.task.sourceIds)).toEqual(new Set([firstSource.id, secondSource.id]));
  expect(turnRevisionAt(detail, 3)).toBe(0);
  expect(resolveMessage(detail, '3').messageId).toBe(beta.id);
  expect(savedTurnInput(detail, 0)).toEqual(beta.input);
  expect(savedTurnInput(detail, 1)).toEqual(alpha.input);
  expect(savedTurnInput(detail, 0)?.sourceIds).toEqual([secondSource.id]);
  expect(savedTurnInput(detail, 0)?.replyTo).toBe(alpha.id);
});
