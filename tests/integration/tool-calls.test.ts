import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { ToolCalls } from '../../apps/desktop/src/core/storage/tool-calls';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
let directory: string;
let runId: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orglet-tool-journal-'));
  store = new Store(join(directory, 'state.sqlite'));
  const worker = store.all<Worker>('workers')[0];
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Journal test', sourceIds: [], budgetMicros: 100_000,
    consent: true, accepted: false, status: 'running', createdAt: now() };
  store.put('tasks', task);
  runId = id();
  const run: Run = { id: runId, taskId: task.id, status: 'running', snapshot: { worker, skill }, startedAt: now(), error: null };
  store.put('runs', run, { column: 'task_id', value: task.id });
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function restart() {
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
}

it('migrates v6 without losing runs and preserves a rollback database', () => {
  store.db.exec('DROP TABLE tool_calls; DELETE FROM migrations WHERE version>=7;');
  restart();
  expect(store.get<Run>('runs', runId).id).toBe(runId);
  expect(store.db.prepare('SELECT * FROM tool_calls').all()).toEqual([]);
  const backups = readdirSync(directory).filter(name => /^state\.sqlite\.v6-\d+\.bak$/.test(name));
  expect(backups).toHaveLength(1);
  const backup = new DatabaseSync(join(directory, backups[0]));
  try {
    expect(backup.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version).toBe(6);
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='tool_calls'").get()).toBeUndefined();
    expect(backup.prepare('SELECT id FROM runs WHERE id=?').get(runId)!.id).toBe(runId);
  } finally {
    backup.close();
  }
});

it('retains committed output across restart without repeating the effect', async () => {
  let executions = 0;
  const operation = { runId, callId: 'call-one', name: 'write', arguments: { file: 'note.txt' }, replay: 'never' as const,
    authorize: () => {}, perform: () => ({ revision: ++executions }) };
  expect(await new ToolCalls(store).execute(operation)).toEqual({ revision: 1 });
  restart();
  expect(await new ToolCalls(store).execute(operation)).toEqual({ revision: 1 });
  expect(executions).toBe(1);
});

it('does not replay an effect whose outcome is unknown after restart', async () => {
  let executions = 0;
  const operation = { runId, callId: 'call-one', name: 'write', arguments: {}, replay: 'never' as const,
    authorize: () => {}, perform: () => { executions++; throw new Error('Crash after side effect'); } };
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('Crash');
  store.db.prepare("UPDATE tool_calls SET state='started'").run();
  restart();
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('chưa rõ');
  expect(executions).toBe(1);
  expect(store.db.prepare('SELECT state FROM tool_calls').get()!.state).toBe('uncertain');
});

it('refuses a concurrent duplicate and a changed call identity', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const operation = { runId, callId: 'call-one', name: 'message', arguments: { body: 'one' }, replay: 'idempotent' as const,
    authorize: () => {}, perform: async () => { await pending; return 'saved'; } };
  const first = new ToolCalls(store).execute(operation);
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('chưa rõ');
  release();
  await first;
  await expect(new ToolCalls(store).execute({ ...operation, arguments: { body: 'changed' } })).rejects.toThrow('nội dung khác');
});

it('rechecks permissions before exposing a retained result', async () => {
  let allowed = true;
  const operation = { runId, callId: 'call-one', name: 'read', arguments: {}, replay: 'read' as const,
    authorize: () => { if (!allowed) throw new Error('revoked'); }, perform: () => 'private-result' };
  await new ToolCalls(store).execute(operation);
  allowed = false;
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('revoked');
});

it('allows only explicitly replay-safe operations to recover', async () => {
  let attempts = 0;
  const operation = { runId, callId: 'call-one', name: 'read', arguments: {}, replay: 'read' as const,
    authorize: () => {}, perform: () => { if (++attempts === 1) throw new Error('Transient read'); return 'content'; } };
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('Transient');
  expect(await new ToolCalls(store).execute(operation)).toBe('content');
});

it('blocks unknown effects across new run and call identities but allows recovery reads', async () => {
  let effects = 0;
  const operation = { runId, callId: 'first', name: 'write', arguments: {}, replay: 'never' as const,
    authorize: () => {}, perform: () => { effects++; throw new Error('lost response'); } };
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('lost response');
  restart();
  const previous = store.get<Run>('runs', runId);
  const retryId = id();
  store.put('runs', { ...previous, id: retryId }, { column: 'task_id', value: previous.taskId });
  await expect(new ToolCalls(store).execute({ ...operation, runId: retryId, callId: 'new-call' })).rejects.toThrow('chưa rõ');
  expect(effects).toBe(1);
  expect(await new ToolCalls(store).execute({ ...operation, runId: retryId, callId: 'inspect', replay: 'read',
    perform: () => 'observed file' })).toBe('observed file');
  const anotherTask = { ...store.get<Task>('tasks', previous.taskId), id: id() };
  store.put('tasks', anotherTask);
  const anotherRun = { ...previous, id: id(), taskId: anotherTask.id };
  store.put('runs', anotherRun, { column: 'task_id', value: anotherTask.id });
  expect(await new ToolCalls(store).execute({ ...operation, runId: anotherRun.id,
    perform: () => 'independent task' })).toBe('independent task');
});

it('does not block a later effect because a replay-safe read failed', async () => {
  const operation = { runId, callId: 'read', name: 'read', arguments: {}, replay: 'read' as const,
    authorize: () => {}, perform: () => { throw new Error('read failed'); } };
  await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('read failed');
  expect(await new ToolCalls(store).execute({ ...operation, callId: 'write', name: 'write', replay: 'never',
    perform: () => 'written' })).toBe('written');
});

it('migrates old journal entries conservatively without losing their results', async () => {
  await new ToolCalls(store).execute({ runId, callId: 'saved', name: 'write', arguments: {}, replay: 'never',
    authorize: () => {}, perform: () => 'committed' });
  store.db.exec('ALTER TABLE tool_calls DROP COLUMN replay; DROP TABLE workspace_copies; DROP TABLE workspace_grants; DELETE FROM migrations WHERE version>=8;');
  restart();
  expect(store.db.prepare('SELECT replay,state,output FROM tool_calls').get()).toMatchObject({
    replay: 'never', state: 'completed', output: '"committed"',
  });
});
