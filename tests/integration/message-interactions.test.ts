import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { MessageInteractions } from '../../apps/desktop/src/core/orchestration/message-interactions';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => store.close());

function savedAnswer() {
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.get<Skill>('skills', worker.skillId);
  const task: Task = { id: id(), workerId: worker.id, brief: 'Original request', sourceIds: [], consent: true,
    budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, status: 'completed', snapshot: { worker, skill, inputRevision: 0,
    input: { brief: task.brief, sourceIds: [] } }, startedAt: now(), error: null };
  const report = { format: 'chat' as const, title: 'Answer', summary: 'The saved answer', findings: [], limitations: [] };
  const artifact: Artifact = { id: id(), runId: run.id, report,
    hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now(), replyTo: turnMessageId(task.id, 0) };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
  store.put('artifacts', artifact, { column: 'run_id', value: run.id });
  return { task, run, artifact, worker, skill };
}

it('uses stable IDs and rejects wrong-chat, missing and uncommitted targets', () => {
  const first = savedAnswer();
  const second = savedAnswer();
  const interactions = new MessageInteractions(store);
  expect(interactions.target(first.task.id, turnMessageId(first.task.id, 0)).kind).toBe('user');
  expect(interactions.target(first.task.id, first.artifact.id).kind).toBe('answer');
  expect(() => interactions.target(first.task.id, second.artifact.id)).toThrow('Không tìm thấy');
  expect(() => interactions.target(first.task.id, id())).toThrow('Không tìm thấy');
  store.update('runs', { ...first.run, status: 'running' });
  expect(() => interactions.target(first.task.id, first.artifact.id)).toThrow('chưa được lưu');
});

it('persists idempotent reactions without creating runs and carries them through backup', () => {
  const { task, artifact } = savedAnswer();
  const interactions = new MessageInteractions(store);
  const runsBefore = store.all<Run>('runs').length;
  const add = { taskId: task.id, messageId: artifact.id, emoji: 'agree', active: true };
  interactions.userReaction(add); interactions.userReaction(add);
  expect(store.get<Task>('tasks', task.id).messageReactions).toHaveLength(1);
  expect(store.all<Run>('runs')).toHaveLength(runsBefore);
  const backup = new Backups(store, () => false, () => {}).export();
  const restored = new Store(':memory:');
  try {
    const manager = new Backups(restored, () => false, () => {});
    manager.restore(manager.preview(backup).token);
    expect(restored.get<Task>('tasks', task.id).messageReactions?.[0].messageId).toBe(artifact.id);
  } finally { restored.close(); }
  interactions.userReaction({ ...add, active: false }); interactions.userReaction({ ...add, active: false });
  expect(store.get<Task>('tasks', task.id).messageReactions).toEqual([]);
  expect(() => interactions.userReaction({ ...add, messageId: id() })).toThrow('Không tìm thấy');
});

it('lets an assigned worker react only while its run is active in the same turn', () => {
  const { task, artifact, worker, skill } = savedAnswer();
  const current = { ...task, inputRevision: 1, currentInput: { brief: 'Follow up', sourceIds: [], replyTo: artifact.id } };
  store.update('tasks', current);
  const run: Run = { id: id(), taskId: task.id, status: 'running', snapshot: { worker, skill, inputRevision: 1,
    input: current.currentInput }, startedAt: now(), error: null };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const interactions = new MessageInteractions(store);
  const personsTurn = turnMessageId(task.id, 0);
  interactions.workerReaction(run, 'react-1', { messageId: personsTurn, emoji: 'watching', active: true });
  interactions.workerReaction(run, 'react-1', { messageId: personsTurn, emoji: 'watching', active: true });
  expect(store.get<Task>('tasks', task.id).messageReactions).toHaveLength(1);
  // The saved answer is this same worker's own; a reaction is for someone else's message (COD-216).
  expect(() => interactions.workerReaction(run, 'react-own', { messageId: artifact.id, emoji: 'agree', active: true })).toThrow('chính mình');
  store.update('runs', { ...run, status: 'completed' });
  expect(() => interactions.workerReaction(run, 'react-2', { messageId: personsTurn, emoji: 'agree', active: true })).toThrow('không còn quyền');
});

it('lets an API worker react through its tool loop and carries a verified reply into the next turn', async () => {
  const messages: unknown[] = [];
  let requestCount = 0;
  const core = new CoreService(store, () => {}, async () => ({ request: async (prompt: unknown) => {
    messages.push(prompt);
    requestCount++;
    const tool = requestCount === 1
      ? { name: 'react_to_message', arguments: JSON.stringify({ messageId: taskId, emoji: 'watching', active: true }) }
      : { name: 'reply', arguments: JSON.stringify({ message: requestCount === 2 ? 'First answer' : 'Follow-up answer', knowledgeProposals: [] }) };
    return { calls: [{ id: id(), ...tool }], usage: { input: 10, output: 10 } };
  } }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  let taskId = '';
  try {
    taskId = await core.command('createTask', { workerId: worker.id, brief: 'Start', sourceIds: [], consent: true,
      providerScopes: ['openai'], budgetMicros: 100_000 }) as string;
    for (let attempt = 0; attempt < 200 && store.get<Task>('tasks', taskId).status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const first = store.detail(taskId);
    expect(first.task.status).toBe('completed');
    expect(first.task.messageReactions).toMatchObject([{ messageId: taskId, actor: 'worker', emoji: 'watching' }]);
    const replyTo = first.artifacts[0].id;
    new MessageInteractions(store).userReaction({ taskId, messageId: replyTo, emoji: 'agree', active: true });
    expect(core.exportMarkdown(replyTo)).not.toContain('Message ID:');
    expect(core.exportMarkdown(replyTo, true)).toContain(`Message ID: ${replyTo}`);
    expect(core.exportMarkdown(replyTo, true)).toContain(`Reply to: ${taskId}`);
    expect(core.exportMarkdown(replyTo, true)).toContain('Reaction: agree');
    await expect(core.command('reviseTask', { taskId, brief: 'Wrong target', replyTo: id(), sourceIds: [], consent: true,
      providerScopes: ['openai'], budgetMicros: 100_000 })).rejects.toThrow('Không tìm thấy');
    expect(store.detail(taskId).task.inputRevision ?? 0).toBe(0);
    await core.command('reviseTask', { taskId, brief: 'Explain more', replyTo, sourceIds: [], consent: true,
      providerScopes: ['openai'], budgetMicros: 100_000 });
    for (let attempt = 0; attempt < 200 && store.detail(taskId).artifacts.length !== 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(store.detail(taskId).task.currentInput?.replyTo).toBe(replyTo);
    expect(JSON.stringify(messages.at(-1))).toContain(replyTo);
    expect(store.detail(taskId).artifacts[1].replyTo).toBe(turnMessageId(taskId, 1));
  } finally { await core.runner.shutdown(); }
});
