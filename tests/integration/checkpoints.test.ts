import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now, SCHEMA_VERSION } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Checkpoints } from '../../apps/desktop/src/core/storage/checkpoints';
import { BudgetLedger } from '../../apps/desktop/src/core/budgets/ledger';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, planReply } from './team-plan';

let directory: string; let store: Store; let core: CoreService;
const report = (sources: string[] = []): ModelReply => ({ calls: [{ id: id(), name: 'submit_report', arguments: JSON.stringify({ title: 'Saved report', summary: 'Fixture summary', findings: sources.map(source => ({ title: 'Observed', detail: 'Saved evidence', severity: 'info', sourceIds: [source], coverage: 'Full fixture' })), limitations: [] }) }], usage: { input: 100, output: 20 } });
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-checkpoints-')); store = new Store(join(directory, 'state.sqlite')); });
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
async function idle(taskId: string) {
  for (let i = 0; i < 100 && (core.runner.isActive(taskId) || core.teams.isActive(taskId)); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.runner.isActive(taskId) || core.teams.isActive(taskId)).toBe(false);
}
function fixture() {
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const }; const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Recovery', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000, status: 'running', accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, status: 'running', snapshot: { worker, skill }, startedAt: now(), error: null };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id }); return { task, run };
}
it('pauses after a committed read, restarts and resumes the same snapshot without paying for that step again', async () => {
  const path = join(directory, 'evidence.txt'); await writeFile(path, 'Saved evidence');
  let calls = 0; let sourceId = ''; let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const adapter: ModelAdapter = { async request(messages) {
    calls++;
    if (calls === 1) { entered(); await gate; return { calls: [{ id: id(), name: 'read_source', arguments: JSON.stringify({ sourceId }) }], usage: { input: 100, output: 20 } }; }
    expect(JSON.stringify(messages)).toContain('Saved evidence'); expect(JSON.stringify(messages)).not.toContain('CHANGED INSTRUCTIONS');
    return report([sourceId]);
  } };
  core = new CoreService(store, () => {}, async () => adapter);
  sourceId = (await core.sources.import([path]))[0].id;
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Paused read', sourceIds: [sourceId], consent: true, budgetMicros: 1_000_000 }) as string;
  await started; await core.command('pause', { id: taskId }); release(); await idle(taskId);
  const runId = store.detail(taskId).runs[0].id;
  expect(store.detail(taskId).task.status).toBe('paused'); expect(calls).toBe(1);
  expect(new Checkpoints(store).get(runId)).toMatchObject({ phase: 'ready', step: 1, readIds: [sourceId] });
  expect(store.db.prepare('SELECT * FROM leases').all()).toEqual([]);
  await core.command('saveWorker', { ...worker, provider: 'openai', instructions: 'CHANGED INSTRUCTIONS' });
  store.close(); store = new Store(join(directory, 'state.sqlite')); core = new CoreService(store, () => {}, async () => adapter);
  await core.command('resume', { id: taskId }); await idle(taskId);
  const detail = store.detail(taskId);
  expect(detail.task.status).toBe('completed'); expect(detail.runs).toHaveLength(1); expect(detail.artifacts).toHaveLength(1); expect(calls).toBe(2);
  expect(store.db.prepare('SELECT state FROM step_attempts ORDER BY step').all()).toEqual([{ state: 'committed' }, { state: 'committed' }]);
  expect(new Checkpoints(store).get(runId)).toBeUndefined();
  expect(detail.events.map(event => event.sequence)).toEqual(detail.events.map((_, index) => index + 1));
});
it('refuses to replay an uncertain request after restart and retains its reservation', async () => {
  const { task, run } = fixture(); const checkpoints = new Checkpoints(store);
  new BudgetLedger(store).reserve(run.id, task.id, 'openai', 1000, task.budgetMicros, 5_000_000, undefined, reservation => checkpoints.requested({ id: run.id, step: 0, phase: 'ready', messages: [], readIds: [] }, reservation));
  checkpoints.claim(run.id);
  store.close(); store = new Store(join(directory, 'state.sqlite')); let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request() { calls++; return report(); } }));
  await expect(core.command('resume', { id: task.id })).rejects.toThrow('chưa rõ');
  expect(calls).toBe(0); expect(store.usage().uncertainCount).toBe(1);
  expect(store.db.prepare('SELECT state FROM step_attempts').get()?.state).toBe('unknown');
  expect(store.db.prepare('SELECT * FROM leases').all()).toEqual([]);
});
it('uses an already received reply after restart without a second provider request', async () => {
  const { task, run } = fixture(); const cp = new Checkpoints(store); const checkpoint = { id: run.id, step: 0, phase: 'ready' as const, messages: [], readIds: [] };
  const ledger = new BudgetLedger(store); const reservation = ledger.reserve(run.id, task.id, 'openai', 1000, task.budgetMicros, 5_000_000, undefined, id => cp.requested(checkpoint, id));
  ledger.settle(reservation, 100, 20); cp.received(checkpoint, report());
  store.close(); store = new Store(join(directory, 'state.sqlite')); let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request() { calls++; return report(); } }));
  await core.command('resume', { id: task.id }); await idle(task.id);
  expect(calls).toBe(0); expect(store.detail(task.id).artifacts).toHaveLength(1);
  expect(store.db.prepare('SELECT * FROM ledger').all()).toHaveLength(1);
});
it('rolls back reservation creation if the durable dispatch marker cannot be written', () => {
  const { task, run } = fixture();
  expect(() => new BudgetLedger(store).reserve(run.id, task.id, 'openai', 1000, task.budgetMicros, 5_000_000, undefined, () => { throw new Error('Injected disk write failure'); })).toThrow('Injected');
  expect(store.usage().reservedMicros).toBe(0);
});
it('does not send cached context after a source changes while paused', async () => {
  const path = join(directory, 'evidence.txt'); await writeFile(path, 'Original content');
  core = new CoreService(store, () => {}, async () => { throw new Error('Adapter not expected yet'); });
  const source = (await core.sources.import([path]))[0]; const { task, run } = fixture();
  store.update('tasks', { ...task, status: 'paused', sourceIds: [source.id] }); store.update('runs', { ...run, status: 'paused' });
  new Checkpoints(store).save({ id: run.id, step: 1, phase: 'ready', messages: [{ role: 'user', content: 'Original content' }], readIds: [source.id] });
  await writeFile(path, 'Changed content'); let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request() { calls++; return report(); } }));
  await core.command('resume', { id: task.id }); await idle(task.id);
  expect(calls).toBe(0); expect(store.detail(task.id).runs[0].error).toContain('thay đổi');
});
it('migrates a v1 workspace without losing reports and refuses a newer database version', () => {
  const { task } = fixture();
  store.db.exec('DROP TABLE tool_calls; DROP TABLE routines; DROP TABLE preflights; DROP TABLE step_attempts; DROP TABLE leases; DROP TABLE checkpoints; DELETE FROM migrations WHERE version>1;');
  store.close(); store = new Store(join(directory, 'state.sqlite'));
  expect(store.detail(task.id).task.brief).toBe('Recovery');
  expect(store.db.prepare('SELECT MAX(version) AS version FROM migrations').get()?.version).toBe(SCHEMA_VERSION);
  store.db.exec('INSERT INTO migrations VALUES(99)');
  expect(() => new Store(join(directory, 'state.sqlite'))).toThrow('mới hơn');
});
it('freezes undispatched team roles across pause/resume and reuses completed member reports', async () => {
  let calls = 0; let taskId = ''; const systems: string[] = [];
  core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    calls++; systems.push(String(messages[0].content));
    if (calls === 1) await core.command('pause', { id: store.all<Task>('tasks')[0].id });
    return report();
  } }));
  const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, workflow: 'sequential' }) as Team;
  taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Team pause', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await idle(taskId); expect(store.detail(taskId).task.status).toBe('paused');
  const retained = store.detail(taskId).artifacts[0].id;
  const other = store.get<Worker>('workers', team.memberIds[1]); await core.command('saveWorker', { ...other, instructions: 'CHANGED ROLE' });
  await core.command('resume', { id: taskId }); await idle(taskId);
  expect(calls).toBe(3); expect(systems.join(' ')).not.toContain('CHANGED ROLE');
  expect(store.detail(taskId).task.status).toBe('completed'); expect(store.detail(taskId).runs).toHaveLength(4);
  expect(store.detail(taskId).artifacts.filter(artifact => artifact.id === retained)).toHaveLength(1);
});
it('honors a lowered live team cap and refuses acceptance without a synthesis artifact', async () => {
  let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request(_messages, tools) {
    if (isPlanRequest(tools)) return planReply(_messages);
    calls++;
    const team = store.all<Task>('tasks')[0].teamSnapshot!;
    await core.command('saveTeam', { ...team, monthlyBudgetMicros: 1000 });
    return report();
  } }));
  const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, workflow: 'sequential' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Lower budget during run', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await idle(taskId);
  expect(calls).toBe(1); expect(store.detail(taskId).task.status).toBe('paused');
  expect(store.detail(taskId).artifacts).toHaveLength(1);
  await expect(core.command('accept', { id: taskId })).rejects.toThrow('Chỉ chấp nhận báo cáo');
  expect(store.detail(taskId).runs.some(run => run.stage === 'synthesis' && run.status === 'completed')).toBe(false);
  store.update('tasks', { ...store.get<Task>('tasks', taskId), status: 'partial' });
  await expect(core.command('accept', { id: taskId })).rejects.toThrow('tổng hợp');
  expect(store.detail(taskId).task.accepted).toBe(false);
});
