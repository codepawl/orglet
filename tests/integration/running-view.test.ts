import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Task, Team, Workspace, Worker } from '../../apps/desktop/src/shared/contracts';
import { runningCount, runningListsTask, type RunningItem } from '../../apps/desktop/src/shared/running';
import { crewWaits } from '../../apps/desktop/src/core/orchestration/crew-waits';
import { taskStatusMark } from '../../apps/desktop/src/renderer/components/StatusMark';
import { isPlanRequest, planReply } from './team-plan';
import type { CustomConnection } from '../../apps/desktop/src/shared/custom-connections';
import { runningChatName } from '../../apps/desktop/src/renderer/runningList';
import { liveWorkerTask } from '../../apps/desktop/src/shared/live-task';
import { sideThreadsOf } from '../../apps/desktop/src/shared/side-threads';

/* COD-244: one place that lists every run across chats, with the queue the core really keeps. */

let store: Store;
let core: CoreService;
/** Each model request waits at its own gate until the test opens it, oldest first. */
let gates: (() => void)[];
let planGate: Promise<void>;
let openPlan: () => void;
const report = JSON.stringify({ title: 'Report', summary: 'Fixture.', findings: [], limitations: [] });

beforeEach(() => {
  store = new Store(':memory:');
  gates = [];
  planGate = new Promise(resolve => { openPlan = resolve; });
  const adapter: ModelAdapter = {
    async request(messages, tools, signal) {
      if (isPlanRequest(tools)) {
        await planGate;
        return planReply(messages);
      }
      await new Promise<void>((resolve, reject) => {
        gates.push(resolve);
        signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      });
      return { calls: [{ id: 'report', name: 'submit_report', arguments: report }], usage: { input: 10, output: 10 } };
    },
  };
  core = new CoreService(store, () => {}, async () => adapter);
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
});

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(condition()).toBe(true);
}

function openNextGate() {
  const open = gates.shift();
  if (!open) throw new Error('No request is waiting at a gate.');
  open();
}

async function useOpenAi(providerConcurrency: number) {
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, providerConcurrency });
  return worker.id;
}

async function startChat(workerId: string, brief: string, budgetMicros = 1_000_000) {
  return core.command('createTask', { workerId, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros }) as Promise<string>;
}

function statusOf(taskId: string) {
  return store.get<Task>('tasks', taskId).status;
}

function itemsOf(taskId: string) {
  return core.running().filter(item => item.taskId === taskId);
}

function summary(items: RunningItem[]) {
  return items.map(item => ({ task: item.taskId, state: item.state, wait: item.wait }));
}

/**
 * The sidebar draws a chat as working or waiting exactly when the Running view lists it; a chat that needs the
 * person's answer is listed only while a question or approval is open.
 */
function expectSidebarAgrees() {
  const listed = new Set(core.running().map(item => item.taskId));
  for (const task of store.all<Task>('tasks')) {
    const mark = taskStatusMark(task.status, true);
    const drawnAsActive = mark.variant === 'busy' || (mark.variant === 'dashed' && mark.tone === 'muted');
    if (task.status !== 'waiting_input') expect(drawnAsActive).toBe(listed.has(task.id));
    expect(runningListsTask(task)).toBe(listed.has(task.id));
  }
}

describe('provider queue', () => {
  it('lists the waiting runs with their place in line, and follows them from queued to running to done', async () => {
    const workerId = await useOpenAi(1);
    const first = await startChat(workerId, 'First');
    const second = await startChat(workerId, 'Second');
    const third = await startChat(workerId, 'Third');
    await until(() => gates.length === 1 && core.running().filter(item => item.state === 'queued').length === 2);

    expect(summary(core.running())).toEqual([
      { task: first, state: 'running', wait: undefined },
      { task: second, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } },
      { task: third, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 1 } },
    ]);
    const running = itemsOf(first)[0];
    expect(running.worker.id).toBe(workerId);
    expect(running.provider).toBe('openai');
    expect(running.since).toBeTypeOf('number');
    // A request is in flight and nothing is settled yet: it has cost nothing so far, which is known.
    expect(running.cost).toEqual({ micros: 0, atLeast: false });
    expect(running.lastEvent).toBe('Đang gọi model · bước 1/6');
    expect(runningCount(core.running())).toBe(3);
    expectSidebarAgrees();

    // The same list rides on the workspace the window reads, so it lands with the sidebar's statuses.
    const workspace = await core.command('workspace', {}) as Workspace;
    expect(workspace.running?.map(item => item.taskId)).toEqual([first, second, third]);

    openNextGate();
    await until(() => statusOf(first) === 'completed' && itemsOf(second)[0]?.state === 'running');
    expect(summary(core.running())).toEqual([
      { task: second, state: 'running', wait: undefined },
      { task: third, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } },
    ]);
    expectSidebarAgrees();

    openNextGate();
    await until(() => itemsOf(third)[0]?.state === 'running');
    openNextGate();
    await until(() => [first, second, third].every(taskId => statusOf(taskId) === 'completed'));
    expect(core.running()).toEqual([]);
    expectSidebarAgrees();
  });

  it('cancels a queued run before it starts, and the line behind it moves up', async () => {
    const workerId = await useOpenAi(1);
    const first = await startChat(workerId, 'First');
    const second = await startChat(workerId, 'Second');
    const third = await startChat(workerId, 'Third');
    await until(() => core.running().filter(item => item.state === 'queued').length === 2);

    await core.command('cancel', { id: second });
    await until(() => statusOf(second) === 'cancelled');
    expect(summary(core.running())).toEqual([
      { task: first, state: 'running', wait: undefined },
      { task: third, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } },
    ]);
    // It never reached the provider, so it holds no money and made no request.
    expect(store.usage(second).reservedMicros).toBe(0);
    expect(gates).toHaveLength(1);
    expectSidebarAgrees();

    openNextGate();
    await until(() => itemsOf(third)[0]?.state === 'running');
    openNextGate();
    await until(() => statusOf(third) === 'completed');
    expect(store.detail(second).runs[0].status).toBe('cancelled');
  });

  it('cancels a running run and leaves the queue to the next one', async () => {
    const workerId = await useOpenAi(1);
    const first = await startChat(workerId, 'First');
    const second = await startChat(workerId, 'Second');
    await until(() => itemsOf(second)[0]?.state === 'queued');

    await core.command('cancel', { id: first });
    await until(() => statusOf(first) === 'cancelled' && itemsOf(second)[0]?.state === 'running');
    expect(itemsOf(first)).toEqual([]);
    openNextGate();
    openNextGate();
    await until(() => statusOf(second) === 'completed');
    expect(core.running()).toEqual([]);
  });
});

describe('crew queue', () => {
  async function crewOfThree() {
    const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    // The lead works as a third member, so a parallel crew has one member more than its two member slots.
    const team = await core.command('saveTeam', { ...template, workflow: 'parallel', memberIds: [...template.memberIds, template.synthesizerId] }) as Team;
    await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, providerConcurrency: 4 });
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Review', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
    return { team, taskId };
  }

  it('says who waits for the plan, for a member slot and for the members, then empties when the crew is done', async () => {
    const { team, taskId } = await crewOfThree();
    await until(() => itemsOf(taskId).some(item => item.stage === 'plan' && item.state === 'running'));
    const planning = itemsOf(taskId);
    expect(planning.filter(item => item.state === 'queued').map(item => [item.stage, item.wait])).toEqual([
      ['member', { kind: 'plan' }], ['member', { kind: 'plan' }], ['member', { kind: 'plan' }], ['synthesis', { kind: 'plan' }],
    ]);
    expectSidebarAgrees();

    openPlan();
    await until(() => gates.length === 2);
    const working = itemsOf(taskId);
    expect(working.filter(item => item.state === 'running').map(item => item.stage)).toEqual(['member', 'member']);
    expect(working.filter(item => item.state === 'queued').map(item => [item.stage, item.wait])).toEqual([
      ['member', { kind: 'crew_slot', ahead: 0 }],
      ['synthesis', { kind: 'members' }],
    ]);
    const waitingMember = working.find(item => item.wait?.kind === 'crew_slot')!;
    expect(team.memberIds).toContain(waitingMember.worker.id);

    openNextGate();
    openNextGate();
    await until(() => gates.length === 1);
    expect(itemsOf(taskId).filter(item => item.state === 'queued').map(item => item.wait)).toEqual([{ kind: 'members' }]);
    openNextGate();
    await until(() => gates.length === 1 && itemsOf(taskId).some(item => item.stage === 'synthesis' && item.state === 'running'));
    openNextGate();
    await until(() => !core.teams.isActive(taskId));
    expect(statusOf(taskId)).toBe('completed');
    expect(core.running()).toEqual([]);
  });

  it('cancels a crew turn whose members are still queued', async () => {
    const { taskId } = await crewOfThree();
    openPlan();
    await until(() => gates.length === 2);
    await core.command('cancel', { id: taskId });
    await until(() => !core.teams.isActive(taskId));
    expect(statusOf(taskId)).toBe('cancelled');
    expect(core.running()).toEqual([]);
    expect(store.detail(taskId).runs.filter(run => run.status === 'queued')).toEqual([]);
  });

  it('names the teammates a dependent assignment waits for', () => {
    const worker = store.all<Worker>('workers')[0];
    const run = (workerId: string, name: string, stage: Run['stage']): Run => ({ id: `run-${workerId}`, taskId: 'task', stage, status: 'queued', startedAt: new Date(0).toISOString(), error: null,
      snapshot: { worker: { ...worker, id: workerId, name }, skill: store.all<import('../../apps/desktop/src/shared/contracts').Skill>('skills')[0] } });
    const runs = new Map([['a', run('a', 'Researcher', 'member')], ['b', run('b', 'Reviewer', 'member')], ['c', run('c', 'Editor', 'member')]]);
    const synthesis = run('lead', 'Lead', 'synthesis');
    const waits = crewWaits([{ workerId: 'b', dependsOn: ['a'] }, { workerId: 'c' }], new Set(), runs, synthesis, 5);
    expect(waits.map(wait => [wait.worker.name, wait.reason])).toEqual([
      ['Reviewer', { kind: 'teammates', names: ['Researcher'] }],
      ['Editor', { kind: 'crew_slot', ahead: 0 }],
      ['Lead', { kind: 'members' }],
    ]);
    expect(crewWaits([{ workerId: 'b', dependsOn: ['a'] }], new Set(['a']), runs, synthesis, 5)[0].reason).toEqual({ kind: 'crew_slot', ahead: 0 });
  });
});

describe('group chat', () => {
  it('lists the orglets still to answer, in the order they will', async () => {
    const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const [firstId, secondId] = template.memberIds;
    const taskId = await core.command('createTask', { workerId: firstId, assignees: [firstId, secondId, template.synthesizerId], brief: 'Hello all', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as string;
    await until(() => gates.length === 1);
    const items = itemsOf(taskId);
    expect(items.map(item => [item.worker.id, item.state, item.wait])).toEqual([
      [firstId, 'running', undefined],
      [secondId, 'queued', { kind: 'group_turn', ahead: 0 }],
      [template.synthesizerId, 'queued', { kind: 'group_turn', ahead: 1 }],
    ]);
    // Their runs do not exist yet, so each line is keyed by the chat and the orglet.
    expect(items[1].runId).toBeUndefined();
    expect(items[1].key).toBe(`${taskId}:${secondId}`);
    openNextGate();
    await until(() => gates.length === 1 && itemsOf(taskId).length === 2);
    openNextGate();
    await until(() => gates.length === 1 && itemsOf(taskId).length === 1);
    openNextGate();
    await until(() => !core.teams.isActive(taskId));
    expect(core.running()).toEqual([]);
  });
});

describe('stopped chats', () => {
  it('keeps a paused chat as one paused line, not counted on the footer, until it resumes', async () => {
    const workerId = await useOpenAi(1);
    const first = await startChat(workerId, 'Keep going');
    const second = await startChat(workerId, 'Pause me');
    await until(() => gates.length === 1 && itemsOf(second)[0]?.state === 'queued');
    // A pause takes effect at the next step; a run still in line keeps its place until then.
    await core.command('pause', { id: second });
    expect(summary(itemsOf(second))).toEqual([{ task: second, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } }]);
    openNextGate();
    await until(() => statusOf(first) === 'completed' && statusOf(second) === 'paused' && !core.runner.isActive(second));
    expect(itemsOf(second).map(item => item.state)).toEqual(['paused']);
    expect(runningCount(core.running())).toBe(0);
    expectSidebarAgrees();

    await core.command('resume', { id: second });
    await until(() => itemsOf(second)[0]?.state === 'running' && gates.length === 1);
    openNextGate();
    await until(() => statusOf(second) === 'completed');
    expect(core.running()).toEqual([]);
  });

  it('shows a chat stopped at its limit as waiting for budget', async () => {
    const workerId = await useOpenAi(2);
    const taskId = await startChat(workerId, 'Too little money', 1000);
    await until(() => statusOf(taskId) === 'waiting_budget' && !core.runner.isActive(taskId));
    expect(summary(itemsOf(taskId))).toEqual([{ task: taskId, state: 'queued', wait: { kind: 'budget' } }]);
    expect(runningCount(core.running())).toBe(0);
    expectSidebarAgrees();
  });
});

describe('custom connections', () => {
  it('queues each connection on its own slots and keeps a cost without a price unknown', async () => {
    const worker = store.all<Worker>('workers')[0];
    await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, providerConcurrency: 1 });
    const local = await core.command('saveCustomConnection', { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' }) as CustomConnection;
    const hosted = await core.command('saveCustomConnection', { name: 'Hosted', baseUrl: 'https://proxy.example.com/v1' }) as CustomConnection;
    const onLocal = await core.command('saveWorker', { ...worker, id: undefined, name: 'Local', provider: `custom:${local.id}`, modelId: 'local-model' }) as Worker;
    const onHosted = await core.command('saveWorker', { ...worker, id: undefined, name: 'Hosted', provider: `custom:${hosted.id}`, modelId: 'hosted-model' }) as Worker;
    const start = (owner: Worker, brief: string) => core.command('createTask', { workerId: owner.id, brief, sourceIds: [], consent: true, providerScopes: [owner.provider], budgetMicros: 1_000_000 }) as Promise<string>;
    const localFirst = await start(onLocal, 'Local one');
    const localSecond = await start(onLocal, 'Local two');
    const hostedFirst = await start(onHosted, 'Hosted one');
    // One slot per connection: the second local chat waits, the hosted one runs beside the first.
    await until(() => gates.length === 2 && itemsOf(localSecond)[0]?.state === 'queued');
    expect(itemsOf(localSecond)[0].wait).toEqual({ kind: 'provider', provider: `custom:${local.id}`, ahead: 0 });
    expect(itemsOf(localFirst)[0].cost).toEqual({ micros: 0, atLeast: false });
    expect(itemsOf(hostedFirst)[0].cost).toBeNull();
    openNextGate();
    openNextGate();
    await until(() => gates.length === 1);
    openNextGate();
    await until(() => [localFirst, localSecond, hostedFirst].every(taskId => statusOf(taskId) === 'completed'));
    expect(core.running()).toEqual([]);
  });
});

describe('side threads (COD-247)', () => {
  it('lists each running or queued side thread as its own row, named like its sidebar row, and opening it opens the side thread', async () => {
    const workerId = await useOpenAi(1);
    const main = await startChat(workerId, 'Main question');
    await until(() => gates.length === 1 && itemsOf(main)[0]?.state === 'running');
    const scope = { sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 };
    // Started while the main chat is still working: they share the orglet's provider slot and wait behind it.
    const pricing = await core.command('startSideThread', { taskId: main, brief: 'Compare two pricing options', ...scope }) as string;
    const naming = await core.command('startSideThread', { taskId: main, brief: 'Suggest a name\nwith detail', ...scope }) as string;
    await core.command('renameTask', { id: pricing, title: 'Pricing ideas' });
    await until(() => core.running().filter(item => item.state === 'queued').length === 2);

    expect(summary(core.running())).toEqual([
      { task: main, state: 'running', wait: undefined },
      { task: pricing, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } },
      { task: naming, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 1 } },
    ]);
    const workspace = await core.command('workspace', {}) as Workspace;
    const names = Object.fromEntries(workspace.running!.map(item => [item.taskId, runningChatName(item, workspace.tasks, workspace.teams)]));
    expect(names).toEqual({ [main]: 'Main question', [pricing]: 'Pricing ideas', [naming]: 'Suggest a name' });
    // Every listed side thread has its own row under the orglet, and the orglet's own row is still the main chat.
    const nested = sideThreadsOf(workspace.tasks, workerId).map(task => task.id);
    expect(nested.sort()).toEqual([pricing, naming].sort());
    expect(liveWorkerTask(workspace.tasks, workerId)?.id).toBe(main);
    // "Open chat" opens the row's task, which is the side thread itself.
    expect(itemsOf(pricing).map(item => item.taskId)).toEqual([pricing]);
    expectSidebarAgrees();

    openNextGate();
    await until(() => statusOf(main) === 'completed' && itemsOf(pricing)[0]?.state === 'running');
    expect(summary(core.running())).toEqual([
      { task: pricing, state: 'running', wait: undefined },
      { task: naming, state: 'queued', wait: { kind: 'provider', provider: 'openai', ahead: 0 } },
    ]);
    expectSidebarAgrees();
    openNextGate();
    await until(() => itemsOf(naming)[0]?.state === 'running');
    openNextGate();
    await until(() => [main, pricing, naming].every(taskId => statusOf(taskId) === 'completed'));
    expect(core.running()).toEqual([]);
    expectSidebarAgrees();
  });
});
