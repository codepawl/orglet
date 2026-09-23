import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { ToolCalls, UnresolvedAttemptError } from '../../apps/desktop/src/core/storage/tool-calls';
import { WorkspaceProcesses } from '../../apps/desktop/src/core/tools/workspace-processes';
import type { Run, Task, Worker, Skill } from '../../apps/desktop/src/shared/contracts';
import type { WorkspaceProcess } from '../../apps/desktop/src/shared/workspace-processes';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { store.close(); });

it('pages output and retires unknown effects without relaunching or rewriting their history', async () => {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Inspect output', sourceIds: [], status: 'failed',
    budgetMicros: 100000, consent: true, accepted: false, createdAt: now() };
  store.put('tasks', task);
  const run: Run = { id: id(), taskId: task.id, status: 'failed', error: 'interrupted', startedAt: now(),
    snapshot: { worker, skill: store.all<Skill>('skills')[0] } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const process: WorkspaceProcess = { id: id(), runId: run.id, command: { program: 'node', arguments: ['check.cjs'], timeoutMs: 1000 },
    state: 'uncertain', exitCode: null, stdout: '🙂'.repeat(16001), stderr: 'partial error' };
  store.put('workspace_processes', process, { column: 'run_id', value: run.id });
  const recovery = new WorkspaceRecovery(store);
  const input = { taskId: task.id, processId: process.id, stream: 'stdout', offset: 0 };
  const first = recovery.output(input);
  expect([...first.content]).toHaveLength(16000);
  expect(first.nextOffset).toBe(16000);
  expect(first.state).toBe('uncertain');
  expect(recovery.output({ ...input, offset: first.nextOffset })).toEqual({ content: '🙂', nextOffset: null, state: 'uncertain' });
  expect(recovery.output({ ...input, stream: 'stderr' }).content).toBe('partial error');
  expect(() => recovery.output({ ...input, taskId: id() })).toThrow('không thuộc');
  expect(() => recovery.output({ ...input, offset: -1 })).toThrow();
  expect(store.get<WorkspaceProcess>('workspace_processes', process.id)).toEqual(process);
  expect(store.db.prepare('SELECT * FROM tool_calls').all()).toEqual([]);
  store.db.prepare("INSERT INTO tool_calls(run_id,call_id,fingerprint,state,output,replay) VALUES(?,?,?,'uncertain',NULL,'never')")
    .run(run.id, 'uncertain-start', 'a'.repeat(64));
  const fresh: Run = { ...run, id: id(), status: 'queued', error: null };
  store.put('runs', fresh, { column: 'task_id', value: task.id });
  const journal = new ToolCalls(store);
  const processes = new WorkspaceProcesses(store, { runCommand: async () => { throw new Error('Must not launch'); } });
  expect(() => journal.assertEffectsResolved(fresh.id)).toThrow('chưa rõ');
  expect(() => processes.assertKnown(task.id)).toThrow('chưa rõ');
  const review = recovery.view(task.id).attempts.find(attempt => attempt.runId === run.id)!;
  recovery.retire({ taskId: task.id, runId: run.id, reviewToken: review.reviewToken, keepCurrentFiles: true }, () => false);
  expect(() => journal.assertEffectsResolved(fresh.id)).not.toThrow();
  expect(() => processes.assertKnown(task.id)).not.toThrow();
  await expect(journal.execute({ runId: run.id, callId: 'uncertain-start', name: 'workspace_start_process', arguments: {},
    replay: 'never', authorize: () => {}, perform: () => 'must not execute' })).rejects.toThrow('đã kết thúc');
  expect(store.db.prepare('SELECT state FROM tool_calls').get()?.state).toBe('uncertain');
  expect(store.get<WorkspaceProcess>('workspace_processes', process.id)).toEqual(process);
  expect(recovery.output(input).state).toBe('uncertain');
  expect(store.get<Run>('runs', run.id).status).toBe('failed');
});

it.each(['completed', 'running-process'] as const)('rejects retirement of %s even without an active runner', state => {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Recovery guard', sourceIds: [], status: 'failed',
    budgetMicros: 100000, consent: true, accepted: false, createdAt: now() };
  store.put('tasks', task);
  const run: Run = { id: id(), taskId: task.id, status: state === 'completed' ? 'completed' : 'failed', error: null, startedAt: now(),
    snapshot: { worker, skill: store.all<Skill>('skills')[0] } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const process: WorkspaceProcess = { id: id(), runId: run.id,
    command: { program: 'node', arguments: ['check.cjs'], timeoutMs: 1000 },
    state: state === 'running-process' ? 'running' : 'exited', exitCode: state === 'completed' ? 0 : null,
    stdout: '', stderr: '' };
  store.put('workspace_processes', process, { column: 'run_id', value: run.id });
  const recovery = new WorkspaceRecovery(store);
  const review = recovery.view(task.id).attempts[0];
  expect(() => recovery.retire({ taskId: task.id, runId: run.id, reviewToken: review.reviewToken,
    keepCurrentFiles: true }, () => false)).toThrow('Dừng công việc');
  expect(store.setting(`workspace-retired:${run.id}`, null)).toBeNull();
  expect(store.get<Run>('runs', run.id)).toEqual(run);
  expect(store.get<WorkspaceProcess>('workspace_processes', process.id)).toEqual(process);
});

it('names an unknown call by its tool, target and time, and fails the next write with a code the chat can act on', async () => {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Name the unknown call', sourceIds: [], status: 'failed',
    budgetMicros: 100000, consent: true, accepted: false, createdAt: now() };
  store.put('tasks', task);
  const run: Run = { id: id(), taskId: task.id, status: 'failed', error: 'interrupted', startedAt: now(),
    snapshot: { worker, skill: store.all<Skill>('skills')[0] } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const journal = new ToolCalls(store);
  await expect(journal.execute({ runId: run.id, callId: 'write-1', name: 'workspace_write', replay: 'never',
    arguments: { operation: 'write', path: 'lib/http.js', content: 'never shown', expectedHash: null },
    authorize: () => {}, perform: () => { throw new Error('helper crashed'); } })).rejects.toThrow('helper crashed');
  // The write above already blocks this chat, so the command that ends unknown belongs to a second chat.
  const otherTask: Task = { ...task, id: id() };
  store.put('tasks', otherTask);
  const otherRun: Run = { ...run, id: id(), taskId: otherTask.id };
  store.put('runs', otherRun, { column: 'task_id', value: otherTask.id });
  await expect(journal.execute({ runId: otherRun.id, callId: 'run-1', name: 'workspace_start_process', replay: 'never',
    arguments: { program: 'node', arguments: ['--test'], timeoutMs: 1000 },
    authorize: () => {}, perform: () => { throw new Error('sandbox lost'); } })).rejects.toThrow('sandbox lost');
  const view = new WorkspaceRecovery(store).view(task.id);
  expect(view.uncertainCalls.map(call => ({ callId: call.callId, tool: call.tool, summary: call.summary })))
    .toEqual([{ callId: 'write-1', tool: 'workspace_write', summary: 'lib/http.js' }]);
  expect(new WorkspaceRecovery(store).view(otherTask.id).uncertainCalls.map(call => ({ callId: call.callId, tool: call.tool, summary: call.summary })))
    .toEqual([{ callId: 'run-1', tool: 'workspace_start_process', summary: 'node --test' }]);
  for (const call of view.uncertainCalls) expect(call.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(JSON.stringify(view)).not.toContain('never shown');
  // A row journaled before the columns existed still reads, with nothing to name.
  store.db.prepare("INSERT INTO tool_calls(run_id,call_id,fingerprint,state,output,replay) VALUES(?,?,?,'uncertain',NULL,'never')")
    .run(run.id, 'legacy', 'b'.repeat(64));
  const legacy = new WorkspaceRecovery(store).view(task.id).uncertainCalls.find(call => call.callId === 'legacy');
  expect(legacy).toEqual({ runId: run.id, callId: 'legacy', replay: 'never', tool: null, summary: null, at: null });
  const fresh: Run = { ...run, id: id(), status: 'queued', error: null };
  store.put('runs', fresh, { column: 'task_id', value: task.id });
  let failure: unknown;
  try { journal.assertEffectsResolved(fresh.id); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(UnresolvedAttemptError);
  expect((failure as UnresolvedAttemptError).code).toBe('unresolved_attempt');
});
