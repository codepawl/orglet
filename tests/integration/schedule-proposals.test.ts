import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';
import { ProposeSchedule, proposalToolNames, type AppProposal } from '../../apps/desktop/src/shared/app-proposals';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Routine, Worker } from '../../apps/desktop/src/shared/contracts';

/** A schedule proposal as the model sends it: every field present, null for the ones it leaves alone. */
const emptyScheduleProposal = {
  targetId: null, name: null, brief: null, frequency: null, time: null, weekday: null, timeZone: null, everyHours: null, windowFrom: null, windowTo: null,
  weekdaysOnly: null, dailyCapMicros: null, start: null, watchFolderId: null, enabled: null, workerId: null, workerRef: null, teamId: null, teamRef: null,
};
const scheduleProposal = (fields: Record<string, unknown>) => ({ ...emptyScheduleProposal, ...fields });

let directory: string; let store: Store; let core: CoreService;
let replies: ModelReply[]; let sent: { messages: { role: string; content?: unknown }[] }[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-schedule-proposals-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; sent = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages) {
      sent.push({ messages: structuredClone(messages) as { role: string; content?: unknown }[] });
      const reply = replies.shift();
      if (!reply) throw new Error('Fixture exhausted');
      return reply;
    },
  }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

const call = (name: string, argumentsValue: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 100, output: 20 } });
const answer = (message = 'Done.'): ModelReply => call('reply', { message, title: null, knowledgeProposals: [] });
const until = async (check: () => boolean) => { for (let tries = 0; tries < 300 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
const finished = (taskId: string) => ['completed', 'failed', 'partial'].includes(store.detail(taskId).task.status);
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };
const proposalsOf = (taskId: string) => store.detail(taskId).appProposals;
const toolResults = () => (sent.at(-1)?.messages ?? []).filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)) as Record<string, unknown>);

async function chatWorker(overrides: Partial<Worker> = {}) {
  const worker = store.all<Worker>('workers')[0];
  return core.command('saveWorker', { ...worker, provider: 'openai', taskBudgetMicros: 400_000, ...overrides }) as Promise<Worker>;
}
async function chat(workerId: string, brief = 'Set up a schedule') {
  const taskId = await core.command('createTask', { workerId, brief, ...scope }) as string;
  await until(() => finished(taskId));
  return taskId;
}
/** A second orglet on the sample provider, so a schedule that runs it can be switched on without a model connection. */
async function demoWorker() {
  const { id: _id, ...rest } = store.all<Worker>('workers')[0];
  return core.command('saveWorker', { ...rest, name: 'Helper', provider: 'demo' }) as Promise<Worker>;
}
async function savedSchedule(workerId: string, enabled: boolean, schedule: Routine['schedule'] = { frequency: 'daily', time: '09:00', weekday: 1, timeZone: 'Asia/Ho_Chi_Minh' }) {
  return core.command('saveRoutine', { name: 'Morning review', enabled, schedule, task: { workerId, sourceIds: [], brief: 'Review the night.', consent: false, budgetMicros: 100_000 } }) as Promise<Routine>;
}
async function grantFolder(name: string) {
  const folderPath = await mkdtemp(join(directory, 'watched-'));
  const identity = await stat(folderPath, { bigint: true });
  return core.routineFolders.add({ directory: folderPath, device: identity.dev.toString(), inode: identity.ino.toString(), name });
}

describe('schedule proposals', () => {
  it('give the orglet the schedules, crews with their hours, granted folders and the rule on deleting', async () => {
    const worker = await chatWorker();
    const helper = await demoWorker();
    await savedSchedule(helper.id, false, { frequency: 'hours', time: '00:00', weekday: 1, timeZone: 'Asia/Ho_Chi_Minh', everyHours: 4, window: { from: '08:00', to: '18:00' }, weekdaysOnly: true, dailyCapMicros: 500_000 });
    const folder = await grantFolder('Invoices');
    const team = await core.command('saveTeam', { name: 'Night desk', instructions: 'Cover the night.', memberIds: [worker.id], synthesizerId: worker.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000, workHours: { timeZone: 'Asia/Ho_Chi_Minh', start: '20:00', end: '06:00', days: [1, 2, 3, 4, 5] } });
    replies.push(answer());
    await chat(worker.id);

    const context = sent[0].messages.map(message => String(message.content ?? '')).find(content => content.includes('"appChanges"'));
    const appChanges = JSON.parse(context!).appChanges;
    expect(appChanges.schedules).toEqual([{
      id: expect.any(String), name: 'Morning review', enabled: false, start: { kind: 'schedule' },
      clock: { frequency: 'hours', time: '00:00', weekday: 1, timeZone: 'Asia/Ho_Chi_Minh', everyHours: 4, window: { from: '08:00', to: '18:00' }, weekdaysOnly: true },
      dailyCapMicros: 500_000, runsAs: { orgletId: helper.id }, perRunBudgetMicros: 100_000,
    }]);
    expect(appChanges.watchFolders).toEqual([{ id: folder.folderId, name: 'Invoices' }]);
    expect(JSON.stringify(appChanges)).not.toContain(directory.replace(/\\/g, '\\\\'));
    expect(appChanges.crews).toEqual([expect.objectContaining({ id: (team as { id: string }).id, workHours: { timeZone: 'Asia/Ho_Chi_Minh', start: '20:00', end: '06:00', days: [1, 2, 3, 4, 5] } })]);
    expect(appChanges.computerTimeZone).toEqual(expect.any(String));
    expect(appChanges.instruction).toContain('cannot delete a schedule');
    expect(appChanges.instruction).toContain('Delete schedule');
  });

  it('propose an hourly schedule with a window, weekdays only and a daily cap, and the card shows them', async () => {
    const worker = await chatWorker();
    replies.push(
      call('propose_schedule', scheduleProposal({ name: 'News sweep', brief: 'Read the news.', frequency: 'hours', everyHours: 3, windowFrom: '08:00', windowTo: '20:00', weekdaysOnly: true, dailyCapMicros: 2_000_000, timeZone: 'Asia/Ho_Chi_Minh' })),
      answer('Proposed.'),
    );
    const taskId = await chat(worker.id);
    const [proposal] = proposalsOf(taskId);
    expect(proposal).toMatchObject({ kind: 'schedule', action: 'create', status: 'pending', hold: null });
    expect(proposal.changes).toEqual(expect.arrayContaining([
      { field: 'schedule', before: null, after: 'every 3h 08:00-20:00 weekdays · Asia/Ho_Chi_Minh' },
      { field: 'dailyCapMicros', before: null, after: '2000000' },
      { field: 'enabled', before: null, after: 'false' },
    ]));
    const applied = await core.command('applyAppProposal', { id: proposal.id }) as AppProposal;
    expect(store.get<Routine>('routines', applied.target!.id)).toMatchObject({
      enabled: false, schedule: { frequency: 'hours', everyHours: 3, window: { from: '08:00', to: '20:00' }, weekdaysOnly: true, dailyCapMicros: 2_000_000, timeZone: 'Asia/Ho_Chi_Minh' },
    });
  });

  it('refuse a clock that does not hold together, and a daily cap below one run', async () => {
    const worker = await chatWorker();
    replies.push(
      call('propose_schedule', scheduleProposal({ name: 'A', brief: 'x', frequency: 'hours', windowFrom: '08:00', windowTo: '20:00' })),
      call('propose_schedule', scheduleProposal({ name: 'B', brief: 'x', frequency: 'daily', time: '09:00', everyHours: 2 })),
      call('propose_schedule', scheduleProposal({ name: 'C', brief: 'x', frequency: 'hours', everyHours: 2, windowFrom: '08:00' })),
      call('propose_schedule', scheduleProposal({ name: 'D', brief: 'x', frequency: 'hours', everyHours: 2, windowFrom: '20:00', windowTo: '08:00' })),
      call('propose_schedule', scheduleProposal({ name: 'E', brief: 'x', frequency: 'daily', time: '09:00', dailyCapMicros: 1000 })),
      answer('Could not.'),
    );
    const taskId = await chat(worker.id);
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(proposalsOf(taskId)).toEqual([]);
    expect(toolResults().map(result => result.error)).toEqual([
      'Chọn số giờ giữa hai lần chạy.',
      'everyHours, windowFrom, windowTo và weekdaysOnly chỉ dùng khi frequency là "hours".',
      'Khung giờ cần cả windowFrom và windowTo.',
      expect.stringContaining('Giờ bắt đầu của khung giờ phải trước giờ kết thúc.'),
      'Giới hạn mỗi ngày cần ít nhất bằng giới hạn mỗi lần chạy.',
    ]);
  });

  it('propose a folder trigger only on a folder the person already granted', async () => {
    const worker = await chatWorker();
    const folder = await grantFolder('Invoices');
    replies.push(
      call('propose_schedule', scheduleProposal({ name: 'Invoice intake', brief: 'Read the new invoice.', start: 'folder', watchFolderId: folder.folderId })),
      call('propose_schedule', scheduleProposal({ name: 'Elsewhere', brief: 'x', start: 'folder', watchFolderId: id() })),
      call('propose_schedule', scheduleProposal({ name: 'No folder', brief: 'x', start: 'folder' })),
      call('propose_schedule', scheduleProposal({ name: 'Mixed', brief: 'x', frequency: 'daily', time: '09:00', start: 'clock', watchFolderId: folder.folderId })),
      answer('Done.'),
    );
    const taskId = await chat(worker.id);
    const [proposal] = proposalsOf(taskId);
    expect(proposalsOf(taskId)).toHaveLength(1);
    expect(proposal.changes).toContainEqual({ field: 'trigger', before: null, after: 'folder:Invoices' });
    expect(toolResults().slice(1).map(result => result.error)).toEqual([
      expect.stringContaining('chưa được cấp quyền'),
      expect.stringContaining('cần watchFolderId'),
      expect.stringContaining('chỉ dùng khi start là "folder"'),
    ]);
    const applied = await core.command('applyAppProposal', { id: proposal.id }) as AppProposal;
    expect(store.get<Routine>('routines', applied.target!.id)).toMatchObject({ enabled: false, trigger: { kind: 'folder', folderId: folder.folderId, folderName: 'Invoices' } });
  });

  it('edit an existing schedule into an hourly one and keep it off', async () => {
    const worker = await chatWorker();
    const helper = await demoWorker();
    const routine = await savedSchedule(helper.id, true);
    replies.push(call('propose_schedule', scheduleProposal({ targetId: routine.id, frequency: 'hours', everyHours: 6, dailyCapMicros: 300_000 })), answer());
    const taskId = await chat(worker.id);
    const [proposal] = proposalsOf(taskId);
    expect(proposal).toMatchObject({ action: 'edit', hold: null });
    expect(proposal.changes).toEqual([
      { field: 'schedule', before: 'daily 09:00 · Asia/Ho_Chi_Minh', after: 'every 6h · Asia/Ho_Chi_Minh' },
      { field: 'dailyCapMicros', before: null, after: '300000' },
      { field: 'enabled', before: 'true', after: 'false' },
    ]);
    await core.command('applyAppProposal', { id: proposal.id });
    expect(store.get<Routine>('routines', routine.id)).toMatchObject({ enabled: false, schedule: { frequency: 'hours', everyHours: 6, dailyCapMicros: 300_000 } });
  });

  it('propose turning a schedule on or off, wait for a click even with auto-apply, and never switch a new one on', async () => {
    const worker = await chatWorker({ autoApplyProposals: true });
    const helper = await demoWorker();
    const off = await savedSchedule(helper.id, false);
    replies.push(
      call('propose_schedule', scheduleProposal({ targetId: off.id, enabled: true })),
      call('propose_schedule', scheduleProposal({ name: 'Fresh', brief: 'x', frequency: 'daily', time: '09:00', enabled: true })),
      answer('Proposed.'),
    );
    const turnOn = await chat(worker.id);
    const [onCard] = proposalsOf(turnOn);
    expect(proposalsOf(turnOn)).toHaveLength(1);
    expect(toolResults()[1].error).toContain('chỉ bật hoặc tắt được lịch có sẵn');
    expect(onCard).toMatchObject({ action: 'edit', status: 'pending', hold: 'enable', heldReason: 'enable', changes: [{ field: 'enabled', before: 'false', after: 'true' }] });
    expect(store.get<Routine>('routines', off.id).enabled).toBe(false);

    await core.command('applyAppProposal', { id: onCard.id });
    expect(store.get<Routine>('routines', off.id)).toMatchObject({ enabled: true, name: 'Morning review', schedule: { time: '09:00' } });

    replies.push(call('propose_schedule', scheduleProposal({ targetId: off.id, enabled: false })), answer('Off.'));
    const turnOff = await chat(worker.id, 'Pause the morning review');
    const [offCard] = proposalsOf(turnOff);
    expect(offCard).toMatchObject({ hold: null, changes: [{ field: 'enabled', before: 'true', after: 'false' }] });
    // Turning off lowers what can run, so the worker's auto-apply switch applies it on its own.
    expect(offCard.status).toBe('applied');
    expect(store.get<Routine>('routines', off.id).enabled).toBe(false);
  });

  it('can only be asked to delete by telling the person where the button is: there is no field or tool for it', async () => {
    const worker = await chatWorker();
    const helper = await demoWorker();
    const routine = await savedSchedule(helper.id, false);
    replies.push(
      call('propose_schedule', scheduleProposal({ targetId: routine.id, delete: true })),
      call('delete_schedule', { targetId: routine.id }),
      answer('Use Delete schedule in the three-dot menu of its card.'),
    );
    const taskId = await chat(worker.id, 'Delete the morning review');
    expect(proposalsOf(taskId)).toEqual([]);
    expect(store.get<Routine>('routines', routine.id)).toBeDefined();
    expect(toolResults()[0].error).toBe('The arguments do not match propose_schedule.');
    expect(toolResults()[1].error).toEqual(expect.stringContaining('delete_schedule'));
    expect(Object.keys(ProposeSchedule.shape).some(field => /delete|remove/i.test(field))).toBe(false);
    expect(proposalToolNames.some(name => /delete|remove/i.test(name))).toBe(false);
    expect(toolDefinitions.propose_schedule.model.type === 'function' && toolDefinitions.propose_schedule.model.function.description).toContain('You cannot delete a schedule');
  });
});
