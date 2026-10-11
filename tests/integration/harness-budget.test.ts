import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { HarnessBudgetError, HarnessError, parseClaudeOutput, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import { isPlanRequest, planReply } from './team-plan';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const budgetStop = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: 'Reached max budget of $0.50', total_cost_usd: 0.5123, duration_ms: 1200 });

describe('Claude Code result parsing', () => {
  it('turns a max-budget stop into a budget error that carries the cap and the estimate', () => {
    expect(() => parseClaudeOutput(budgetStop, null, 0.5)).toThrow(HarnessBudgetError);
    expect(() => parseClaudeOutput(budgetStop, null, 0.5)).toThrow('giới hạn chi phí của chính nó ($0.50)');
    let thrown: unknown;
    try { parseClaudeOutput(budgetStop, null, 0.5); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HarnessBudgetError);
    expect((thrown as HarnessBudgetError).limitUsd).toBe(0.5);
    expect((thrown as HarnessBudgetError).costUsd).toBe(0.5123);
  });

  it('recognises the stop from the result text of a build that reports it only there', () => {
    const textOnly = JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'error_max_budget_usd', total_cost_usd: 0.2 });
    expect(() => parseClaudeOutput(textOnly, null, 0.2)).toThrow(HarnessBudgetError);
  });

  it('keeps other errors generic', () => {
    const other = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Something else', total_cost_usd: 0.01 });
    let thrown: unknown;
    try { parseClaudeOutput(other, null, 0.5); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect(thrown).not.toBeInstanceOf(HarnessBudgetError);
  });
});

/** Waits until neither the runner nor a crew is working on any task. */
async function idle(store: Store, core: CoreService) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const busy = store.all<Task>('tasks').some(task => core.runner.isActive(task.id) || core.teams.isActive(task.id));
    if (!busy) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture never went idle');
}

describe('orglet chat on Claude Code', () => {
  let store: Store;
  let core: CoreService;
  let requests: HarnessRequest[];
  let reportedCostUsd: number;
  beforeEach(() => {
    store = new Store(':memory:');
    requests = [];
    reportedCostUsd = 0.01;
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', version: '2.1.270', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua claude.ai' }],
      execute: async request => {
        requests.push(request);
        return { output: { message: 'Done.', report: null }, costUsd: reportedCostUsd };
      },
    });
  });
  afterEach(() => store.close());

  it('runs an orglet that has no limit of its own without a cap, on the person plan', async () => {
    const { taskBudgetMicros: _unset, ...seeded } = store.all<Worker>('workers')[0];
    const worker = await core.command('saveWorker', { ...seeded, provider: 'claude-code' }) as Worker;
    expect(worker.taskBudgetMicros).toBeUndefined();
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Fix the failing test', sourceIds: [], consent: true, providerScopes: ['claude-code'] }) as string;
    await idle(store, core);

    expect(requests[0].maxBudgetUsd).toBeUndefined();
    expect(store.get<Task>('tasks', taskId).status).toBe('completed');
  });

  it('passes no cap and never stops, even when the orglet and the chat still carry an older per-task amount', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'claude-code', taskBudgetMicros: 500_000 }) as Worker;
    // The CLI reports more than the old amount: nothing compares it with a limit any more.
    reportedCostUsd = 5;
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Research this', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 }) as string;
    await idle(store, core);
    expect(requests[0].maxBudgetUsd).toBeUndefined();
    expect(store.get<Task>('tasks', taskId).status).toBe('completed');

    await core.command('reviseTask', { taskId, brief: 'And one more thing', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 });
    await idle(store, core);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every(request => request.maxBudgetUsd === undefined)).toBe(true);
    expect(store.get<Task>('tasks', taskId).status).toBe('completed');
  });
});

describe('crew on Claude Code', () => {
  let store: Store;
  let core: CoreService;
  let requests: HarnessRequest[];
  beforeEach(() => {
    store = new Store(':memory:');
    requests = [];
    const respond = (name: string, args: unknown) => ({ output: { call: { name, arguments: args } }, costUsd: 5 });
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', version: '2.1.270', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua claude.ai' }],
      execute: async request => {
        expect(request.coreToolsOnly).toBe(true);
        requests.push(request);
        const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2)) as { messages: Parameters<typeof planReply>[0]; tools: Parameters<typeof isPlanRequest>[0] };
        if (isPlanRequest(context.tools)) {
          const plan = planReply(context.messages, ids => ids.slice(0, 1));
          return respond('submit_plan', JSON.parse(plan.calls[0].arguments));
        }
        const text = context.messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
        if (text.includes('"assignment":"Do your assigned role')) {
          return respond('submit_report', { title: 'Member report', summary: 'Finished.', findings: [], limitations: [] });
        }
        return respond('submit_report', { title: 'Crew report', summary: 'Joined the member result.', findings: [], limitations: [] });
      },
    });
  });
  afterEach(() => store.close());

  it('runs the plan, the members and the lead without a cap, whatever per-task amount the crew and chat still carry', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    for (const workerId of [...team.memberIds, team.synthesizerId]) await core.command('saveWorker', { ...store.get<Worker>('workers', workerId), provider: 'claude-code' });
    await core.command('saveTeam', { ...store.get<Team>('teams', team.id), taskBudgetMicros: 500_000 });
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Research this', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 }) as string;
    await idle(store, core);

    let detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.artifacts.length).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every(request => request.maxBudgetUsd === undefined)).toBe(true);

    await core.command('reviseTask', { taskId, brief: 'Follow up', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 });
    await idle(store, core);
    detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(requests.every(request => request.maxBudgetUsd === undefined)).toBe(true);
  });
});

describe('Claude Code orglets saved with the old forced limit', () => {
  it('lose the $0.50 default once when the workspace opens, and keep a limit someone picked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-limit-'));
    const path = join(directory, 'orglet.sqlite');
    try {
      let store = new Store(path);
      const [seeded] = store.all<Worker>('workers');
      store.update('workers', { ...seeded, provider: 'claude-code', taskBudgetMicros: 500_000 });
      store.put('workers', { ...seeded, id: randomUUID(), name: 'Picked', provider: 'claude-code', taskBudgetMicros: 2_000_000 });
      store.put('workers', { ...seeded, id: randomUUID(), name: 'On an API', provider: 'openai', taskBudgetMicros: 500_000 });
      // A workspace from before the fix has no marker yet.
      store.clearSetting('claudeCodeDefaultLimitDropped');
      store.close();

      store = new Store(path);
      const limits = Object.fromEntries(store.all<Worker>('workers').map(worker => [worker.name, worker.taskBudgetMicros]));
      expect(limits[seeded.name]).toBeUndefined();
      expect(limits.Picked).toBe(2_000_000);
      expect(limits['On an API']).toBe(500_000);

      // Once done, a $0.50 limit set afterwards on purpose is left alone.
      store.update('workers', { ...store.get<Worker>('workers', seeded.id), taskBudgetMicros: 500_000 });
      store.close();
      store = new Store(path);
      expect(store.get<Worker>('workers', seeded.id).taskBudgetMicros).toBe(500_000);
      store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
