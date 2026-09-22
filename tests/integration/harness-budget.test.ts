import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Checkpoints } from '../../apps/desktop/src/core/storage/checkpoints';
import { CoreService } from '../../apps/desktop/src/core/service';
import { HarnessBudgetError, HarnessError, parseClaudeOutput, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import { isPlanRequest, planReply } from './team-plan';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const budgetStop = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: 'Reached max budget of $0.50', total_cost_usd: 0.5123, duration_ms: 1200 });

describe('Claude Code result parsing', () => {
  it('turns a max-budget stop into a budget error that carries the cap and the estimate', () => {
    expect(() => parseClaudeOutput(budgetStop, null, 0.5)).toThrow(HarnessBudgetError);
    expect(() => parseClaudeOutput(budgetStop, null, 0.5)).toThrow('giới hạn mỗi task ($0.50)');
    expect(() => parseClaudeOutput(budgetStop, null, 0.5)).toThrow('Giới hạn mỗi task');
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
  let stopOnBudget: boolean;
  beforeEach(() => {
    store = new Store(':memory:');
    requests = [];
    stopOnBudget = true;
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', version: '2.1.270', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua claude.ai' }],
      execute: async request => {
        requests.push(request);
        if (stopOnBudget) throw new HarnessBudgetError(request.maxBudgetUsd, 0.5);
        return { output: { message: 'Done within the limit.', report: null }, costUsd: 0.01 };
      },
    });
  });
  afterEach(() => store.close());

  it('waits for budget with the orglet wording, then retry and a follow-up take the orglet\'s raised limit', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'claude-code' }) as Worker;
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Research this', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 }) as string;
    await idle(store, core);

    let detail = store.detail(taskId);
    expect(requests[0].maxBudgetUsd).toBe(0.5);
    expect(detail.task.status).toBe('waiting_budget');
    expect(detail.runs.at(-1)?.status).toBe('waiting_budget');
    expect(detail.runs.at(-1)?.error).toBe('Claude Code dừng vì chạm giới hạn mỗi task của chat này ($0.50). Nâng Giới hạn mỗi task trong Thiết lập Tí, rồi thử lại.');
    const messages = detail.events.map(event => event.message);
    expect(messages).toContain('Claude Code dừng ở giới hạn; harness ước tính $0.5000 theo gói hoặc tài khoản của nó. Khoản này tính vào giới hạn mỗi task của chat này, không trừ vào ngân sách tháng.');
    expect(detail.usage).toEqual({ chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 });

    // Retrying with the same settings hits the same cap: the limit lives on the orglet, not on the renderer's copy.
    await core.command('retry', { id: taskId });
    await idle(store, core);
    expect(requests[1].maxBudgetUsd).toBe(0.5);
    expect(store.get<Task>('tasks', taskId).status).toBe('waiting_budget');

    await core.command('saveWorker', { ...store.get<Worker>('workers', worker.id), taskBudgetMicros: 4_000_000 });
    stopOnBudget = false;
    await core.command('retry', { id: taskId });
    await idle(store, core);
    detail = store.detail(taskId);
    expect(detail.task.budgetMicros).toBe(4_000_000);
    expect(requests[2].maxBudgetUsd).toBe(4);
    expect(detail.task.status).toBe('completed');

    // A follow-up sent with the thread's stale copy of the limit still runs under the orglet's current one.
    await core.command('reviseTask', { taskId, brief: 'And one more thing', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 });
    await idle(store, core);
    detail = store.detail(taskId);
    expect(detail.task.budgetMicros).toBe(4_000_000);
    expect(requests[3].maxBudgetUsd).toBe(4);
    expect(detail.task.status).toBe('completed');
  });
});

describe('crew on Claude Code', () => {
  let store: Store;
  let core: CoreService;
  let memberRequests: HarnessRequest[];
  let memberStops: number;
  beforeEach(() => {
    store = new Store(':memory:');
    memberRequests = [];
    memberStops = 1;
    const respond = (name: string, args: unknown) => ({ output: { call: { name, arguments: args } }, costUsd: 0.01 });
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', version: '2.1.270', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua claude.ai' }],
      execute: async request => {
        expect(request.coreToolsOnly).toBe(true);
        const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2)) as { messages: Parameters<typeof planReply>[0]; tools: Parameters<typeof isPlanRequest>[0] };
        if (isPlanRequest(context.tools)) {
          const plan = planReply(context.messages, ids => ids.slice(0, 1));
          return respond('submit_plan', JSON.parse(plan.calls[0].arguments));
        }
        const text = context.messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
        if (text.includes('"assignment":"Do your assigned role')) {
          memberRequests.push(request);
          if (memberStops > 0) { memberStops--; throw new HarnessBudgetError(request.maxBudgetUsd, 0.5); }
          return respond('submit_report', { title: 'Member report', summary: 'Finished within the limit.', findings: [], limitations: [] });
        }
        return respond('submit_report', { title: 'Crew report', summary: 'Joined the member result.', findings: [], limitations: [] });
      },
    });
  });
  afterEach(() => store.close());

  async function crewOnClaudeCode() {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    for (const workerId of [...team.memberIds, team.synthesizerId]) await core.command('saveWorker', { ...store.get<Worker>('workers', workerId), provider: 'claude-code' });
    await core.command('saveTeam', { ...store.get<Team>('teams', team.id), taskBudgetMicros: 500_000 });
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Research this', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 }) as string;
    await idle(store, core);
    return { team, taskId };
  }

  it('reports the member\'s budget stop as the crew waiting for budget, with the crew wording', async () => {
    const { taskId } = await crewOnClaudeCode();
    const detail = store.detail(taskId);
    expect(memberRequests[0].maxBudgetUsd).toBe(0.5);
    expect(detail.task.status).toBe('waiting_budget');
    const member = detail.runs.find(run => run.stage === 'member')!;
    expect(member.status).toBe('waiting_budget');
    expect(member.error).toBe('Claude Code dừng vì chạm giới hạn mỗi task của chat này ($0.50). Nâng Giới hạn mỗi task trong Thiết lập hội → Giới hạn & ca, rồi thử lại.');
    // The lead never started; the crew marks its queued run the way it does for any stop before synthesis.
    expect(detail.runs.find(run => run.stage === 'synthesis')?.status).toBe('interrupted');
    expect(detail.artifacts).toHaveLength(0);
    // The estimate the CLI spent before stopping stays on the run's checkpoint, ready for the same step to run again.
    const checkpoint = new Checkpoints(store).get(member.id);
    expect(checkpoint?.phase).toBe('ready');
    expect(checkpoint?.harnessCostMicros).toBe(500_000);
    expect(detail.events.map(event => event.message)).toContain('Claude Code dừng ở giới hạn; harness ước tính $0.5000 theo gói hoặc tài khoản của nó. Khoản này tính vào giới hạn mỗi task của chat này, không trừ vào ngân sách tháng.');
  });

  it('retry and a follow-up turn run under the crew\'s raised limit', async () => {
    const { team, taskId } = await crewOnClaudeCode();
    await core.command('saveTeam', { ...store.get<Team>('teams', team.id), taskBudgetMicros: 4_000_000 });

    await core.command('retry', { id: taskId });
    await idle(store, core);
    let detail = store.detail(taskId);
    expect(detail.task.budgetMicros).toBe(4_000_000);
    expect(memberRequests[1].maxBudgetUsd).toBe(4);
    expect(detail.task.status).toBe('completed');
    expect(detail.artifacts.length).toBeGreaterThan(0);

    await core.command('reviseTask', { taskId, brief: 'Follow up', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 });
    await idle(store, core);
    detail = store.detail(taskId);
    expect(detail.task.budgetMicros).toBe(4_000_000);
    expect(memberRequests[2].maxBudgetUsd).toBe(4);
    expect(detail.task.status).toBe('completed');
  });

  it('resume continues the stopped member with what the raised limit has left', async () => {
    const { team, taskId } = await crewOnClaudeCode();
    await core.command('saveTeam', { ...store.get<Team>('teams', team.id), taskBudgetMicros: 4_000_000 });

    await core.command('resume', { id: taskId });
    await idle(store, core);
    const detail = store.detail(taskId);
    expect(detail.task.budgetMicros).toBe(4_000_000);
    // $4 minus the $0.50 the first attempt reported before it stopped.
    expect(memberRequests[1].maxBudgetUsd).toBe(3.5);
    // The same member run continued; the other member run is the one the plan left unassigned.
    expect(detail.runs.filter(run => run.stage === 'member' && run.status !== 'cancelled')).toHaveLength(1);
    expect(detail.task.status).toBe('completed');
  });
});
