import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { nextOccurrence, inWorkHours, type Schedule } from '../../apps/desktop/src/shared/schedule';
import { ROUTINE_MISS_MS, SKIPPED_WHILE_INACTIVE, shouldDeferRoutine } from '../../apps/desktop/src/core/orchestration/routines';
import type { Routine, Task, Team } from '../../apps/desktop/src/shared/contracts';
import { modelCatalog } from '../../apps/desktop/src/core/adapters/catalog';
import { isPlanRequest, planReply } from './team-plan';

let store: Store; let core: CoreService; let current: Date; let directory: string;
const schedule: Schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 };
beforeEach(async () => {
  current = new Date('2026-01-05T01:59:50Z'); directory = await mkdtemp(join(tmpdir(), 'orglet-routines-'));
  store = new Store(join(directory, 'state.sqlite')); core = new CoreService(store, () => {}, async () => { throw new Error('No live provider'); }, undefined, () => current);
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
async function save(overrides: Record<string, unknown> = {}) {
  return await core.command('saveRoutine', { name: 'Morning review', enabled: true, schedule, task: { workerId: store.workspace().workers[0].id, sourceIds: [], brief: 'Scheduled evidence review', consent: false, budgetMicros: 1000 }, ...overrides }) as Routine;
}
async function idle() {
  for (let i = 0; i < 200 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id) || core.teams.isActive(task.id)); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(store.all<Task>('tasks').some(task => core.runner.isActive(task.id) || core.teams.isActive(task.id))).toBe(false);
}
it('defers on first tick, after a 30s gap, when overdue, or when a catch-up is already pending', () => {
  const now = Date.parse('2026-01-05T02:00:10Z');
  const due = Date.parse('2026-01-05T02:00:00Z');
  expect(shouldDeferRoutine(now, due, null, false)).toBe(true);
  expect(shouldDeferRoutine(now, due, now - 5_000, false)).toBe(false);
  expect(shouldDeferRoutine(now, due, now - ROUTINE_MISS_MS - 1, false)).toBe(true);
  expect(shouldDeferRoutine(now + ROUTINE_MISS_MS + 1, due, now, false)).toBe(true);
  expect(shouldDeferRoutine(now, due, now - 5_000, true)).toBe(true);
});
it('computes local daily/weekly dates, skips DST gaps and runs only the first overlap', () => {
  expect(nextOccurrence(schedule, current)).toBe('2026-01-05T02:00:00.000Z');
  expect(nextOccurrence({ ...schedule, frequency: 'weekly', weekday: 0 }, current)).toBe('2026-01-11T02:00:00.000Z');
  const ny: Schedule = { ...schedule, timeZone: 'America/New_York', time: '02:30' };
  expect(nextOccurrence(ny, new Date('2026-03-08T06:00:00Z'))).toBe('2026-03-09T06:30:00.000Z');
  expect(nextOccurrence({ ...ny, time: '01:30' }, new Date('2026-11-01T05:00:00Z'))).toBe('2026-11-01T05:30:00.000Z');
  expect(nextOccurrence({ ...ny, time: '01:30' }, new Date('2026-11-01T05:45:00Z'))).toBe('2026-11-02T06:30:00.000Z');
  expect(nextOccurrence({ ...schedule, timeZone: 'Asia/Kathmandu' }, new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05T03:15:00.000Z');
});
it('defines overnight shifts by their starting weekday with an exclusive end', () => {
  const policy = { timeZone: 'UTC', start: '22:00', end: '06:00', days: [1] };
  expect(inWorkHours(policy, new Date('2026-01-05T22:00:00Z'))).toBe(true);
  expect(inWorkHours(policy, new Date('2026-01-06T05:59:00Z'))).toBe(true);
  expect(inWorkHours(policy, new Date('2026-01-06T06:00:00Z'))).toBe(false);
  expect(inWorkHours(policy, new Date('2026-01-06T22:00:00Z'))).toBe(false);
});
it('claims an on-time occurrence once and persists next due with the task', async () => {
  const routine = await save(); await core.tick(); current = new Date('2026-01-05T02:00:00Z');
  await Promise.all([core.tick(), core.tick()]); await idle(); await core.tick();
  const saved = store.get<Routine>('routines', routine.id);
  expect(store.workspace().tasks).toHaveLength(1); expect(saved.nextDueAt).toBe('2026-01-06T02:00:00.000Z');
  expect(store.get<Task>('tasks', saved.lastTaskId!).routineId).toBe(routine.id);
  store.close(); store = new Store(join(directory, 'state.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No provider'); }, undefined, () => current);
  await core.tick(); expect(store.workspace().tasks).toHaveLength(1);
});
it('preserves waiting evidence across restart and defers routines until explicit acceptance', async () => {
  const team = await core.command('createTemplate', { templateId: 'eris-review', provider: 'demo' }) as Team;
  const routine = await save({ task: { workerId: team.synthesizerId, teamId: team.id, sourceIds: [], brief: 'Missing evidence', consent: false, budgetMicros: 1000 } });
  await core.tick(); current = new Date('2026-01-05T02:00:00Z'); await core.tick(); await idle();
  const taskId = store.get<Routine>('routines', routine.id).lastTaskId!;
  expect(store.get<Task>('tasks', taskId).status).toBe('waiting_input');
  const reports = store.detail(taskId).artifacts;
  store.close(); store = new Store(join(directory, 'state.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No live provider'); }, undefined, () => current);
  expect(store.get<Task>('tasks', taskId).status).toBe('waiting_input');
  current = new Date('2026-01-06T01:59:50Z'); await core.tick(); current = new Date('2026-01-06T02:00:00Z'); await core.tick();
  expect(store.all<Task>('tasks')).toHaveLength(1);
  expect(store.get<Routine>('routines', routine.id).pending?.reason).toContain('Lần trước chưa kết thúc');
  await expect(core.command('catchUpRoutine', { id: routine.id })).rejects.toThrow('Lần trước chưa kết thúc');
  await core.command('accept', { id: taskId });
  await core.command('catchUpRoutine', { id: routine.id }); await idle();
  expect(store.all<Task>('tasks')).toHaveLength(2);
  expect(store.detail(taskId).artifacts).toEqual(reports);
});
it('coalesces offline days into one explicit catch-up and prevents double dispatch', async () => {
  const routine = await save();
  const firstDue = store.get<Routine>('routines', routine.id).nextDueAt;
  current = new Date('2026-01-12T04:00:00Z'); await core.tick();
  const skipped = store.get<Routine>('routines', routine.id);
  expect(store.workspace().tasks).toHaveLength(0);
  expect(skipped.pending).toEqual({ dueAt: firstDue, reason: SKIPPED_WHILE_INACTIVE });
  expect(skipped.nextDueAt).toBe(nextOccurrence(schedule, current));
  current = new Date('2026-01-19T04:00:00Z'); await core.tick();
  expect(store.get<Routine>('routines', routine.id).pending?.dueAt).toBe(firstDue);
  expect(store.get<Routine>('routines', routine.id).nextDueAt).toBe(nextOccurrence(schedule, current));
  const results = await Promise.allSettled([core.command('catchUpRoutine', { id: routine.id }), core.command('catchUpRoutine', { id: routine.id })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); await idle();
  expect(store.workspace().tasks).toHaveLength(1); expect(store.get<Routine>('routines', routine.id).pending).toBeNull();
});
it('keeps one catch-up after reopen across a long overdue window', async () => {
  const routine = await save();
  const firstDue = store.get<Routine>('routines', routine.id).nextDueAt;
  expect(firstDue).toBe('2026-01-05T02:00:00.000Z');
  store.close();
  current = new Date('2026-02-04T04:00:00Z');
  store = new Store(join(directory, 'state.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No provider'); }, undefined, () => current);
  await core.tick();
  const skipped = store.get<Routine>('routines', routine.id);
  expect(store.workspace().tasks).toHaveLength(0);
  expect(skipped.pending).toEqual({ dueAt: firstDue, reason: SKIPPED_WHILE_INACTIVE });
  expect(skipped.nextDueAt).toBe('2026-02-05T02:00:00.000Z');
  await core.tick();
  expect(store.get<Routine>('routines', routine.id).pending?.dueAt).toBe(firstDue);
  expect(store.workspace().tasks).toHaveLength(0);
  await core.command('catchUpRoutine', { id: routine.id }); await idle();
  expect(store.workspace().tasks).toHaveLength(1);
  expect(store.get<Routine>('routines', routine.id).pending).toBeNull();
  await expect(core.command('catchUpRoutine', { id: routine.id })).rejects.toThrow('Không có lần chạy bù đang chờ.');
});
it('runs a schedule now from the window through the guards a trigger passes, and keeps its next time', async () => {
  const routine = await save();
  const nextDueAt = store.get<Routine>('routines', routine.id).nextDueAt;
  // The window names the schedule and nothing else: it cannot add files to the run.
  await expect(core.command('runRoutineNow', { id: routine.id, sourceIds: [] })).rejects.toThrow();

  const taskId = await core.command('runRoutineNow', { id: routine.id }) as string;
  await idle();
  const ran = store.get<Routine>('routines', routine.id);
  expect(store.get<Task>('tasks', taskId).routineId).toBe(routine.id);
  expect(ran.lastTaskId).toBe(taskId);
  expect(ran.nextDueAt).toBe(nextDueAt);
  expect(ran.pending).toBeNull();

  await core.command('saveRoutine', { id: routine.id, name: routine.name, enabled: false, schedule, task: routine.task });
  await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow('Lịch đang tắt');
  await core.command('saveRoutine', { id: routine.id, name: routine.name, enabled: true, schedule, task: routine.task });
  await core.command('saveWorker', { ...store.workspace().workers[0], instructions: 'Changed instructions' });
  await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow('đã đổi');
  expect(store.workspace().tasks).toHaveLength(1);
});
it('dismisses a coalesced miss without creating a task or moving the next due time', async () => {
  const routine = await save();
  current = new Date('2026-02-04T04:00:00Z'); await core.tick();
  const skipped = store.get<Routine>('routines', routine.id);
  expect(skipped.pending).not.toBeNull();
  await core.command('dismissRoutine', { id: routine.id });
  const after = store.get<Routine>('routines', routine.id);
  expect(after.pending).toBeNull();
  expect(after.nextDueAt).toBe(skipped.nextDueAt);
  expect(store.workspace().tasks).toHaveLength(0);
});
it('does not silently reuse recurring approval after worker changes or send changed source bytes', async () => {
  const path = join(directory, 'source.txt'); await writeFile(path, 'original'); const source = (await core.sources.import([path]))[0];
  let routine = await save({ task: { workerId: store.workspace().workers[0].id, sourceIds: [source.id], brief: 'Review', consent: false, budgetMicros: 1000 } });
  await core.tick(); await core.command('saveWorker', { ...store.workspace().workers[0], instructions: 'Changed instructions' });
  current = new Date('2026-01-05T02:00:00Z'); await core.tick();
  expect(store.get<Routine>('routines', routine.id).pending?.reason).toContain('đã đổi'); expect(store.workspace().tasks).toHaveLength(0);
  routine = await core.command('saveRoutine', { id: routine.id, name: routine.name, schedule: routine.schedule, task: routine.task, enabled: true }) as Routine;
  await writeFile(path, 'changed'); current = new Date('2026-01-06T01:59:50Z'); await core.tick(); current = new Date('2026-01-06T02:00:00Z'); await core.tick();
  expect(store.get<Routine>('routines', routine.id).pending?.reason).toContain('thay đổi'); expect(store.workspace().tasks).toHaveLength(0);
});
it('keeps disabled schedules idle and restores schedules without permission or automatic execution', async () => {
  const routine = await save({ enabled: false }); current = new Date('2026-01-06T04:00:00Z'); await core.tick();
  expect(store.get<Routine>('routines', routine.id).pending).toBeNull();
  const enabled = await save({ name: 'Enabled future schedule' });
  const text = core.backups.export(); const other = new Store(':memory:');
  try {
    const restored = new CoreService(other, () => {}, async () => { throw new Error('No provider'); }, undefined, () => current);
    restored.backups.restore(restored.backups.preview(text).token); await restored.tick();
    expect(other.get<Routine>('routines', enabled.id)).toMatchObject({ enabled: false, approvedConfig: '', task: { consent: false, providerScopes: [] } });
    expect(other.workspace().tasks).toHaveLength(0);
  } finally { other.close(); }
});
it('rolls back both task and occurrence when a routine update fails', async () => {
  const routine = await save(); await core.tick();
  store.db.exec("CREATE TRIGGER reject_routine BEFORE UPDATE ON routines BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;");
  current = new Date('2026-01-05T02:00:00Z'); await expect(core.tick()).rejects.toThrow('fixture disk failure');
  expect(store.workspace().tasks).toHaveLength(0); expect(store.get<Routine>('routines', routine.id).nextDueAt).toBe(routine.nextDueAt);
});
it('blocks absent provider consent before enabling a recurring task', async () => {
  const worker = store.workspace().workers[0]; await core.command('saveWorker', { ...worker, provider: 'openai' });
  await expect(save()).rejects.toThrow('provider'); expect(store.all('routines')).toHaveLength(0);
});
it('requires renewed approval when the installed model pricing catalog changes', async () => {
  const worker = store.workspace().workers[0]; await core.command('saveWorker', { ...worker, provider: 'openai' });
  const routine = await save({ task: { workerId: worker.id, sourceIds: [], brief: 'Catalog update', consent: true, providerScopes: ['openai'], budgetMicros: 1000 } });
  await core.tick(); const original = modelCatalog.openai.pricingVersion;
  try {
    Object.assign(modelCatalog.openai, { pricingVersion: 'fixture-new-pricing' });
    current = new Date('2026-01-05T02:00:00Z'); await core.tick();
    expect(store.get<Routine>('routines', routine.id).pending?.reason).toContain('model đã đổi'); expect(store.workspace().tasks).toHaveLength(0);
  } finally { Object.assign(modelCatalog.openai, { pricingVersion: original }); }
});
it('keeps reservations and provider budget gates for automatic execution', async () => {
  let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request() { calls++; throw new Error('Budget must block dispatch'); } }), undefined, () => current);
  const worker = store.workspace().workers[0]; await core.command('saveWorker', { ...worker, provider: 'openai' });
  const routine = await save({ task: { workerId: worker.id, sourceIds: [], brief: 'Budget fixture', consent: true, providerScopes: ['openai'], budgetMicros: 1000 } });
  await core.tick(); current = new Date('2026-01-05T02:00:00Z'); await core.tick(); await idle();
  const lastTaskId = store.get<Routine>('routines', routine.id).lastTaskId!;
  expect(store.get<Task>('tasks', lastTaskId).status).toBe('waiting_budget'); expect(calls).toBe(0);
});
it('pauses in-flight work at shift end and rejects a second task at capacity', async () => {
  current = new Date('2026-01-05T09:00:00Z'); let entered!: () => void; let release!: () => void; let calls = 0;
  const entering = new Promise<void>(resolve => { entered = resolve; }); const waiting = new Promise<void>(resolve => { release = resolve; });
  core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    calls++; entered(); await waiting;
    return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Review', summary: 'Finished current step', findings: [], limitations: [] }) }], usage: { input: 100, output: 100 } };
  } }), undefined, () => current);
  const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, workflow: 'sequential', maxConcurrentTasks: 1, workHours: { timeZone: 'UTC', start: '09:00', end: '17:00', days: [1] } }) as Team;
  const input = { workerId: team.synthesizerId, teamId: team.id, brief: 'In-flight shift', sourceIds: [], consent: true, budgetMicros: 1_000_000 };
  const taskId = await core.command('createTask', input) as string; await entering;
  await expect(core.command('createTask', input)).rejects.toThrow('đồng thời');
  current = new Date('2026-01-05T17:00:00Z'); await core.tick(); expect(store.get<Task>('tasks', taskId).status).toBe('pausing');
  release(); await idle(); expect(calls).toBe(1); expect(store.get<Task>('tasks', taskId).status).toBe('paused');
  expect(store.get<Task>('tasks', taskId).handoff?.artifactIds).toHaveLength(1);
});
it('invalidates a pending dispatch when the routine is disabled during source verification', async () => {
  const path = join(directory, 'race.txt'); await writeFile(path, 'selected'); const source = (await core.sources.import([path]))[0];
  const routine = await save({ task: { workerId: store.workspace().workers[0].id, sourceIds: [source.id], brief: 'Race', consent: false, budgetMicros: 1000 } });
  current = new Date('2026-01-06T04:00:00Z'); await core.tick();
  let entered!: () => void; let release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; }); const waiting = new Promise<void>(resolve => { release = resolve; });
  const verify = core.sources.verify.bind(core.sources);
  core.sources.verify = async (...args) => { entered(); await waiting; return verify(...args); };
  const result = core.command('catchUpRoutine', { id: routine.id }); await entering;
  await core.command('saveRoutine', { id: routine.id, name: routine.name, task: routine.task, schedule: routine.schedule, enabled: false });
  release(); await expect(result).rejects.toThrow('thay đổi'); expect(store.workspace().tasks).toHaveLength(0);
});
it('enforces live team concurrency and shift boundaries with a deterministic resumable handoff', async () => {
  current = new Date('2026-01-05T09:00:00Z'); let calls = 0;
  core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    calls++; current = new Date('2026-01-05T17:00:00Z');
    return { calls: [{ id: `report-${calls}`, name: 'submit_report', arguments: JSON.stringify({ title: 'Review', summary: 'Evidence fixture', findings: [], limitations: [] }) }], usage: { input: 100, output: 100 } };
  } }), undefined, () => current);
  const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, workflow: 'sequential', maxConcurrentTasks: 1, workHours: { timeZone: 'UTC', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] } }) as Team;
  const input = { workerId: team.synthesizerId, teamId: team.id, brief: 'Shift task', sourceIds: [], consent: true, budgetMicros: 1_000_000 };
  const taskId = await core.command('createTask', input) as string;
  await expect(core.command('createTask', input)).rejects.toThrow(/đồng thời|khung giờ/); await idle();
  const paused = store.detail(taskId); expect(calls).toBe(1); expect(paused.task.status).toBe('paused');
  expect(paused.task.handoff?.artifactIds).toEqual(paused.artifacts.map(artifact => artifact.id));
  expect(paused.task.handoff?.chargedMicros).toBeGreaterThan(0);
  store.update('tasks', { ...paused.task, handoff: undefined });
  const recovering = new CoreService(store, () => {}, async () => { throw new Error('Recovery must not dispatch'); }, undefined, () => current);
  expect(recovering.store.get<Task>('tasks', taskId).handoff?.artifactIds).toEqual(paused.artifacts.map(artifact => artifact.id));
  await expect(core.command('resume', { id: taskId })).rejects.toThrow('khung giờ');
  core.backups.export();
  current = new Date('2026-01-06T09:00:00Z');
  core = new CoreService(store, () => {}, async () => ({ async request() {
    calls++; return { calls: [{ id: `report-${calls}`, name: 'submit_report', arguments: JSON.stringify({ title: 'Review', summary: 'Resumed', findings: [], limitations: [] }) }], usage: { input: 100, output: 100 } };
  } }), undefined, () => current);
  await core.command('resume', { id: taskId }); await idle();
  expect(store.detail(taskId).task.status).toBe('completed'); expect(calls).toBe(3); expect(store.detail(taskId).task.handoff).toBeUndefined();
});
