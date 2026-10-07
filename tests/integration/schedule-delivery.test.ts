import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { ScheduleDelivery } from '../../apps/desktop/src/core/orchestration/schedule-delivery';
import { compactThread } from '../../apps/desktop/src/core/context/thread';
import { scheduleRunsOf } from '../../apps/desktop/src/shared/schedule-runs';
import type { Artifact, Routine, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
let notified: number;
let delivery: ScheduleDelivery;
let worker: Worker;
let skill: Skill;

beforeEach(() => {
  store = new Store(':memory:');
  notified = 0;
  delivery = new ScheduleDelivery(store, () => { notified++; });
  worker = store.all<Worker>('workers')[0];
  skill = store.all<Skill>('skills')[0];
});
afterEach(() => store.close());

/** A finished chat of the orglet, answered once: its DM, or a schedule's run when `routineId` is given. */
function chat(brief: string, answer: string, extra: Partial<Task> = {}): Task {
  const task: Task = { id: id(), workerId: worker.id, brief, status: 'completed', budgetMicros: 100_000, sourceIds: [], consent: true, accepted: false, createdAt: now(), ...extra };
  store.put('tasks', task);
  const run: Run = { id: id(), taskId: task.id, status: 'completed', error: null, startedAt: now(), snapshot: { worker, skill, input: { brief, sourceIds: [] }, inputRevision: 0 } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const artifact: Artifact = { id: id(), runId: run.id, report: { format: 'chat', title: 'Reply', summary: answer, findings: [], limitations: [] }, hash: 'a'.repeat(64), createdAt: now() };
  store.put('artifacts', artifact, { column: 'run_id', value: run.id });
  return task;
}

function routine(frequency: 'daily' | 'hours'): Routine {
  const saved = { id: id(), name: frequency === 'daily' ? 'Morning digest' : 'Price watch', enabled: true, revision: 1, schedule: { timeZone: 'UTC', time: '09:00', frequency, weekday: 1, ...(frequency === 'hours' ? { everyHours: 1 } : {}) },
    task: { workerId: worker.id, brief: 'Check', sourceIds: [], consent: true, budgetMicros: 100_000 }, nextDueAt: now(), approvedConfig: 'test', pending: null } as unknown as Routine;
  store.put('routines', saved);
  return saved;
}

it('posts a schedule run once into the orglet\'s DM, under the schedule, and the sidebar stops listing it (owner, 2026-10-07)', () => {
  delivery.deliver();
  const dm = chat('Hi', 'Hello!');
  const daily = routine('daily');
  const run = chat('Check', 'Three new emails from the bank.', { routineId: daily.id, routineName: daily.name });
  store.update('routines', { ...daily, lastTaskId: run.id });
  delivery.deliver();
  delivery.deliver();
  const quotes = store.get<Task>('tasks', dm.id).quotes!;
  expect(quotes).toHaveLength(1);
  expect(quotes[0]).toMatchObject({ schedule: 'Morning digest', text: 'Three new emails from the bank.', fromTaskId: run.id, author: worker.name, afterRevision: 0 });
  expect(store.get<Task>('tasks', run.id).deliveredTo).toEqual({ taskId: dm.id, quoteId: quotes[0].id });
  expect(notified).toBe(1);
  // No row of its own any more: the post in the DM is where it is read.
  expect(scheduleRunsOf(store.all<Task>('tasks'), store.all<Routine>('routines'), { workerId: worker.id })).toEqual([]);
  // The orglet reads it with the next message in its DM, as the schedule's.
  const detail = store.detail(dm.id);
  const next: Run = { id: id(), taskId: dm.id, status: 'queued', error: null, startedAt: now(), snapshot: { worker, skill, input: { brief: 'Anything urgent?', sourceIds: [] }, inputRevision: 1 } };
  const sent = compactThread(detail, next, 'Anything urgent?').verbatim.map(turn => turn.text).join('\n');
  expect(sent).toContain('Answer from the scheduled run "Morning digest"');
  expect(sent).toContain('Three new emails from the bank.');
});

it('keeps an hourly run with nothing new out of the chat, and posts it once the decision model finds it noteworthy', () => {
  delivery.deliver();
  const dm = chat('Hi', 'Hello!');
  const hourly = routine('hours');
  const run = chat('Check', 'Price unchanged.', { routineId: hourly.id });
  delivery.deliver();
  expect(store.get<Task>('tasks', run.id).deliveredTo).toEqual({ quiet: true });
  expect(store.get<Task>('tasks', dm.id).quotes).toBeUndefined();
  store.patchTask(run.id, { attention: { score: 0.9, notified: true, decidedAt: now() } });
  delivery.deliver();
  expect(store.get<Task>('tasks', dm.id).quotes?.[0].schedule).toBe('Price watch');
});

it('leaves a run alone when the orglet has no DM yet, and never posts runs from before this existed', () => {
  const daily = routine('daily');
  const older = chat('Check', 'From last week.', { routineId: daily.id, createdAt: '2026-09-01T00:00:00.000Z' });
  delivery.deliver();
  const lonely = chat('Check', 'Nobody to tell yet.', { routineId: daily.id });
  delivery.deliver();
  expect(store.get<Task>('tasks', lonely.id).deliveredTo).toBeUndefined();
  const dm = chat('Hi', 'Hello!');
  delivery.deliver();
  expect(store.get<Task>('tasks', dm.id).quotes?.map(quote => quote.fromTaskId)).toEqual([lonely.id]);
  expect(store.get<Task>('tasks', older.id).deliveredTo).toBeUndefined();
});
