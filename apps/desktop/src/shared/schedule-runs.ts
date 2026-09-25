import type { Routine, Task } from './contracts';
import { sideThreadsOf } from './side-threads';

/**
 * Schedule runs in the sidebar (COD-258). Every run a schedule starts is its own chat row carrying `routineId`, and
 * the schedule keeps its newest one as `lastTaskId`. Before this, a finished run could only be reached through
 * Schedules → the card → Open latest run, so a daily run's result went unread (dogfood, 0.5.1).
 *
 * The sidebar lists one row per schedule, under the orglet or crew its newest run was for, showing that run under
 * the schedule's name. An archived newest run takes the row away until the next run; deleting it clears
 * `lastTaskId`, so the row goes with it.
 */
type RunRow = Pick<Task, 'id' | 'createdAt' | 'workerId' | 'teamId' | 'assignees' | 'routineId' | 'archivedAt' | 'deletedAt' | 'sideOf'>;
type ScheduleRow = Pick<Routine, 'id' | 'name' | 'lastTaskId'>;

/** The orglet or crew a sidebar row stands for. */
export type ChatOwner = { workerId: string } | { teamId: string };

/** A schedule and the newest run it started, listed under that run's orglet or crew. */
export type ScheduleRun<T extends RunRow, R extends ScheduleRow> = { routine: R; run: T };

/** Whether a chat row belongs under this owner: its crew, or its one orglet when no crew and no group own it. */
function ownedBy(task: RunRow, owner: ChatOwner): boolean {
  if ('teamId' in owner) return task.teamId === owner.teamId;
  return !task.teamId && !task.assignees && task.workerId === owner.workerId;
}

/** The schedules whose newest run belongs to this orglet or crew, newest run first. */
export function scheduleRunsOf<T extends RunRow, R extends ScheduleRow>(tasks: readonly T[], routines: readonly R[], owner: ChatOwner): ScheduleRun<T, R>[] {
  const rows: ScheduleRun<T, R>[] = [];
  for (const routine of routines) {
    if (!routine.lastTaskId) continue;
    const run = tasks.find(task => task.id === routine.lastTaskId);
    if (!run || run.routineId !== routine.id || run.archivedAt || run.deletedAt) continue;
    if (!ownedBy(run, owner)) continue;
    rows.push({ routine, run });
  }
  return rows.sort((first, second) => second.run.createdAt.localeCompare(first.run.createdAt));
}

/** One row listed under an orglet or crew: a side thread, or a schedule's newest run. */
export type ChildChat<T extends RunRow, R extends ScheduleRow> = { kind: 'side'; task: T } | { kind: 'schedule'; task: T; routine: R };

/**
 * Everything listed under an orglet's or crew's row, newest first: an orglet's open side threads (COD-247) and the
 * newest run of each of its schedules. A crew has no side threads, so only its schedules are listed.
 */
export function chatsUnder<T extends RunRow, R extends ScheduleRow>(tasks: readonly T[], routines: readonly R[], owner: ChatOwner): ChildChat<T, R>[] {
  const schedules: ChildChat<T, R>[] = scheduleRunsOf(tasks, routines, owner).map(({ routine, run }) => ({ kind: 'schedule', task: run, routine }));
  const threads: ChildChat<T, R>[] = 'workerId' in owner ? sideThreadsOf(tasks, owner.workerId).map(task => ({ kind: 'side', task })) : [];
  return [...schedules, ...threads].sort((first, second) => second.task.createdAt.localeCompare(first.task.createdAt));
}
