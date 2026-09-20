import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { claimAssignment, resourcesOverlap, validateDependencies } from '../../apps/desktop/src/core/orchestration/assignments';
import { PlanAssignment, type Run, type Task, type Team, type TeamPlan, type Worker, type Skill } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, memberIdsFromPlanPrompt } from './team-plan';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { store.close(); });

it('rejects missing dependencies, self dependencies, cycles and ambiguous resource paths', () => {
  const first = id();
  const second = id();
  expect(() => validateDependencies({ assignments: [{ workerId: first, brief: 'one', dependsOn: [id()] }] })).toThrow('cùng kế hoạch');
  expect(() => validateDependencies({ assignments: [{ workerId: first, brief: 'one', dependsOn: [first] }] })).toThrow('cùng kế hoạch');
  expect(() => validateDependencies({ assignments: [{ workerId: first, brief: 'one', dependsOn: [second] }, { workerId: second, brief: 'two', dependsOn: [first] }] })).toThrow('vòng');
  for (const resource of ['../outside', '/absolute', 'C:/outside', 'docs//file', 'docs/file.', 'docs\\file']) {
    expect(PlanAssignment.safeParse({ workerId: first, brief: 'one', writeResources: [resource] }).success).toBe(false);
  }
});

it('treats directory ownership and Windows case aliases as overlapping', () => {
  const first = { workerId: id(), brief: 'one', writeResources: ['Docs'] };
  expect(resourcesOverlap(first, { workerId: id(), brief: 'two', writeResources: ['docs/note.md'] })).toBe(true);
  expect(resourcesOverlap(first, { workerId: id(), brief: 'two', writeResources: ['docs-other/note.md'] })).toBe(false);
});

it('atomically claims a member run and refuses a duplicate owner or stale turn', () => {
  const worker = store.all<Worker>('workers')[0];
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'ownership', budgetMicros: 100_000, sourceIds: [], status: 'running', consent: true, accepted: false, createdAt: now() };
  store.put('tasks', task);
  const run: Run = { id: id(), taskId: task.id, stage: 'member', snapshot: { worker, skill }, status: 'queued', startedAt: now(), error: null };
  const duplicate: Run = { ...run, id: id() };
  store.put('runs', run, { column: 'task_id', value: task.id });
  store.put('runs', duplicate, { column: 'task_id', value: task.id });
  const assignment = { workerId: worker.id, brief: 'write', writeResources: ['note.md'] };
  expect(claimAssignment(store, run, assignment).status).toBe('running');
  expect(() => claimAssignment(store, duplicate, assignment)).toThrow('phụ trách');
  store.update('tasks', { ...task, inputRevision: 1 });
  expect(() => claimAssignment(store, duplicate, assignment)).toThrow('trạng thái');
});

async function executeTeam(options: { dependencies?: boolean; sharedResource?: boolean; failFirst?: boolean; failSecond?: boolean; exhaustBudgetAfterFirst?: boolean }) {
  const calls: string[] = [];
  let live = 0;
  let peak = 0;
  const core = new CoreService(store, () => {}, async () => ({ request: async (messages, tools) => {
    if (isPlanRequest(tools)) {
      const [first, second] = memberIdsFromPlanPrompt(messages);
      const assignments: TeamPlan['assignments'] = [
        { workerId: second, brief: 'second', dependsOn: options.dependencies ? [first] : [], writeResources: options.sharedResource ? ['docs'] : [] },
        { workerId: first, brief: 'first', dependsOn: [], writeResources: options.sharedResource ? ['docs/file.md'] : [] },
      ];
      return { calls: [{ id: id(), name: 'submit_plan', arguments: JSON.stringify({ assignments }) }], usage: { input: 10, output: 10 } };
    }
    const body = messages.map(message => String(message.content)).join('\n');
    const owner = String(messages[0].content).includes('owner-first') ? 'first' : String(messages[0].content).includes('owner-second') ? 'second' : 'synthesis';
    calls.push(owner);
    live++;
    peak = Math.max(peak, live);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (owner === 'first' && options.failFirst) throw new Error('Injected dependency failure');
      if (owner === 'second' && options.failSecond) throw new Error('Injected downstream failure');
      if (owner === 'first' && options.exhaustBudgetAfterFirst) {
        store.setSetting('connectionLimitMicros', 1);
      }
      if (owner === 'second' && options.dependencies) expect(body).toContain('committed-first');
      return { calls: [{ id: id(), name: 'submit_report', arguments: JSON.stringify({ title: 'Result', summary: `committed-${owner}`, findings: [], limitations: [] }) }], usage: { input: 10, output: 10 } };
    } finally {
      live--;
    }
  } }));
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  for (const [index, workerId] of team.memberIds.entries()) {
    const worker = store.get<Worker>('workers', workerId);
    await core.command('saveWorker', { ...worker, instructions: index === 0 ? 'owner-first' : 'owner-second' });
  }
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Work together', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  for (let attempt = 0; attempt < 300 && core.teams.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
  return { core, taskId, calls, peak, detail: store.detail(taskId) };
}

it('runs dependencies first regardless of plan order and passes their committed output', async () => {
  const result = await executeTeam({ dependencies: true });
  expect(result.calls).toEqual(['first', 'second', 'synthesis']);
  expect(result.peak).toBe(1);
  expect(result.detail.task.status).toBe('completed');
});

it('pauses before a dependent request when the connection budget is exhausted', async () => {
  const result = await executeTeam({ dependencies: true, exhaustBudgetAfterFirst: true });
  expect(result.calls).toEqual(['first']);
  expect(result.detail.task.status).toBe('paused');
  expect(result.detail.artifacts).toHaveLength(1);
  expect(result.detail.artifacts[0].report.summary).toBe('committed-first');
  expect(result.detail.runs.some(run => run.stage === 'member' && run.status === 'waiting_budget')).toBe(true);
  expect(result.detail.runs.some(run => run.stage === 'synthesis' && run.status === 'completed')).toBe(false);
  const retainedId = result.detail.artifacts[0].id;
  store.setSetting('connectionLimitMicros', 10_000_000);
  await result.core.command('resume', { id: result.taskId });
  for (let attempt = 0; attempt < 300 && result.core.teams.isActive(result.taskId); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(result.core.teams.isActive(result.taskId)).toBe(false);
  expect(result.calls).toEqual(['first', 'second', 'synthesis']);
  const resumed = store.detail(result.taskId);
  expect(resumed.task.status).toBe('completed');
  expect(resumed.artifacts.filter(artifact => artifact.id === retainedId)).toHaveLength(1);
});

it('serializes overlapping write ownership while preserving parallel independent work', async () => {
  const result = await executeTeam({ sharedResource: true });
  expect(result.peak).toBe(1);
  expect(result.detail.task.status).toBe('completed');
});

it('does not dispatch a dependent worker when its prerequisite fails', async () => {
  const result = await executeTeam({ dependencies: true, failFirst: true });
  expect(result.calls).toEqual(['first', 'synthesis']);
  expect(result.detail.task.status).toBe('failed');
  expect(result.detail.runs.some(run => run.error?.includes('đang chờ kết quả'))).toBe(true);
});

it('retains a committed prerequisite when retrying the failed dependent worker', async () => {
  const options = { dependencies: true, failSecond: true };
  const result = await executeTeam(options);
  const retained = result.detail.artifacts[0].id;
  expect(result.detail.task.status).toBe('partial');
  options.failSecond = false;
  await result.core.command('retry', { id: result.taskId });
  for (let attempt = 0; attempt < 300 && result.core.teams.isActive(result.taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(result.core.teams.isActive(result.taskId)).toBe(false);
  const retried = store.detail(result.taskId);
  expect(retried.task.status).toBe('completed');
  expect(result.calls.filter(owner => owner === 'first')).toHaveLength(1);
  expect(retried.artifacts.filter(artifact => artifact.id === retained)).toHaveLength(1);
});
