import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { commands, RoutineInput, TaskInput, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';
import { SyncRoutine } from '../../apps/desktop/src/shared/sync-records';
import { ProposeCrew, ProposeOrglet } from '../../apps/desktop/src/shared/app-proposals';

// A chat, crew or orglet has no spending limit of its own (owner, 2026-10-11). Older rows, backups, sync records and
// terminal commands still carry `budgetMicros`; it is accepted and ignored.

const workerId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const brief = 'Summarise the notes';

describe('older data that still carries a per-task amount', () => {
  it('parses a task input with or without it', () => {
    const base = { workerId, brief, sourceIds: [], consent: true };
    expect(TaskInput.safeParse(base).success).toBe(true);
    expect(TaskInput.safeParse({ ...base, budgetMicros: 500_000 }).success).toBe(true);
    expect(TaskInput.safeParse({ ...base, budgetMicros: 0 }).success).toBe(true);
  });

  it('parses the commands an older terminal or window sends, with or without it', () => {
    const revise = { taskId, brief, sourceIds: [], consent: true, providerScopes: [] };
    expect(commands.reviseTask.safeParse(revise).success).toBe(true);
    expect(commands.reviseTask.safeParse({ ...revise, budgetMicros: 500_000 }).success).toBe(true);
    const side = { taskId, brief, sourceIds: [], consent: true, providerScopes: [] };
    expect(commands.startSideThread.safeParse(side).success).toBe(true);
    expect(commands.startSideThread.safeParse({ ...side, budgetMicros: 500_000 }).success).toBe(true);
    const update = { id: taskId, title: 'Notes', assignee: { kind: 'all' } };
    expect(commands.updateTask.safeParse(update).success).toBe(true);
    expect(commands.updateTask.safeParse({ ...update, budgetMicros: 500_000 }).success).toBe(true);
  });

  it('parses a schedule and its sync record, with or without it', () => {
    const task = { workerId, brief, sourceIds: [], consent: false };
    const schedule = { frequency: 'daily', time: '09:00', weekday: 1, timeZone: 'UTC' };
    const routine = { name: 'Morning', enabled: false, schedule };
    expect(RoutineInput.safeParse({ ...routine, task }).success).toBe(true);
    expect(RoutineInput.safeParse({ ...routine, task: { ...task, budgetMicros: 100_000 } }).success).toBe(true);
    const record = { id: taskId, name: 'Morning', enabled: false, schedule, trigger: 'schedule', task: { workerId, brief, sourceIds: [] } };
    expect(SyncRoutine.safeParse(record).success).toBe(true);
    expect(SyncRoutine.safeParse({ ...record, task: { ...record.task, budgetMicros: 100_000 } }).success).toBe(true);
  });

  it('no longer lets an orglet propose one', () => {
    const orglet = { targetId: null, ref: null, name: null, description: null, instructions: null, provider: null, modelId: null, skillId: null, skillRef: null, effort: null };
    expect(ProposeOrglet.shape).not.toHaveProperty('taskBudgetMicros');
    expect(ProposeOrglet.safeParse({ ...orglet, taskBudgetMicros: 900_000 }).success).toBe(false);
    expect(ProposeCrew.shape).not.toHaveProperty('taskBudgetMicros');
  });
});

describe('a chat is never stopped by a per-task amount', () => {
  let store: Store;
  let core: CoreService;
  let requests: number;
  const adapter = {
    async request() {
      requests += 1;
      // 100,000 tokens in and out cost far more than any amount an older row could carry.
      return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Summary', summary: 'Done.', findings: [], limitations: [] }) }], usage: { input: 100_000, output: 100_000 } };
    },
  };

  beforeEach(() => {
    store = new Store(':memory:');
    requests = 0;
    core = new CoreService(store, () => {}, async () => adapter);
  });
  afterEach(() => store.close());

  async function until(done: () => boolean) {
    for (let attempt = 0; attempt < 500 && !done(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  }

  it('runs a first message and a follow-up that carry a tiny amount, and charges what they used', async () => {
    const seeded = store.all<Worker>('workers')[0];
    const worker = await core.command('saveWorker', { ...seeded, provider: 'openai', taskBudgetMicros: 1000 }) as Worker;
    const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1000 };
    const id = await core.command('createTask', { workerId: worker.id, brief, ...scope }) as string;
    await until(() => store.get<Task>('tasks', id).status !== 'running' && !core.runner.isActive(id));
    expect(store.get<Task>('tasks', id).status).toBe('completed');

    await core.command('reviseTask', { taskId: id, brief: 'And again', ...scope });
    await until(() => store.detail(id).runs.length === 2 && !core.runner.isActive(id));
    const detail = store.detail(id);
    expect(detail.task.status).toBe('completed');
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(detail.usage.chargedMicros).toBeGreaterThan(1000);
  });
});
