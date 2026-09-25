import { describe, expect, it } from 'vitest';
import type { Routine, Task } from '../../apps/desktop/src/shared/contracts';
import { chatsUnder, scheduleRunsOf } from '../../apps/desktop/src/shared/schedule-runs';

const row = (id: string, createdAt: string, extra: Partial<Task> = {}): Task => ({
  id, status: 'completed', brief: `Ask ${id}`, workerId: 'researcher', createdAt: `2026-09-${createdAt}T00:00:00.000Z`,
  budgetMicros: 1000, sourceIds: [], consent: true, accepted: false, ...extra,
});
const schedule = (id: string, name: string, lastTaskId?: string) => ({ id, name, ...(lastTaskId ? { lastTaskId } : {}) }) as Routine;

/**
 * COD-258: a schedule's run was a chat reachable only through Schedules → Open latest run. The sidebar lists one row
 * per schedule, under the orglet or crew its newest run was for, showing that run.
 */
describe('schedule runs in the sidebar', () => {
  it('lists each schedule once, by its newest run, under the orglet that ran it, newest first', () => {
    const tasks = [
      row('standup-monday', '21', { routineId: 'standup' }),
      row('standup-tuesday', '22', { routineId: 'standup' }),
      row('digest-run', '23', { routineId: 'digest' }),
      row('main', '24'),
    ];
    const routines = [schedule('standup', 'Daily standup note', 'standup-tuesday'), schedule('digest', 'Morning digest', 'digest-run'), schedule('never', 'Never run')];
    expect(scheduleRunsOf(tasks, routines, { workerId: 'researcher' }).map(({ routine, run }) => [routine.name, run.id])).toEqual([
      ['Morning digest', 'digest-run'],
      ['Daily standup note', 'standup-tuesday'],
    ]);
  });

  it('puts a crew run under the crew, not under its lead, and a run for another orglet under that orglet', () => {
    const tasks = [row('crew-run', '21', { routineId: 'review', teamId: 'crew' }), row('writer-run', '22', { routineId: 'draft', workerId: 'writer' })];
    const routines = [schedule('review', 'Weekly review', 'crew-run'), schedule('draft', 'Draft', 'writer-run')];
    expect(scheduleRunsOf(tasks, routines, { workerId: 'researcher' })).toEqual([]);
    expect(scheduleRunsOf(tasks, routines, { teamId: 'crew' }).map(({ run }) => run.id)).toEqual(['crew-run']);
    expect(scheduleRunsOf(tasks, routines, { workerId: 'writer' }).map(({ run }) => run.id)).toEqual(['writer-run']);
  });

  it('drops the row while the newest run is archived, instead of falling back to an older one', () => {
    const tasks = [row('old', '21', { routineId: 'standup' }), row('newest', '22', { routineId: 'standup', archivedAt: '2026-09-23T00:00:00.000Z' })];
    expect(scheduleRunsOf(tasks, [schedule('standup', 'Daily standup note', 'newest')], { workerId: 'researcher' })).toEqual([]);
  });

  it('ignores a pointer at a chat that is gone or belongs to another schedule', () => {
    const tasks = [row('other', '21', { routineId: 'digest' }), row('deleted', '22', { routineId: 'standup', deletedAt: '2026-09-23T00:00:00.000Z' })];
    expect(scheduleRunsOf(tasks, [schedule('standup', 'A', 'other'), schedule('standup', 'B', 'deleted'), schedule('standup', 'C', 'missing')], { workerId: 'researcher' })).toEqual([]);
  });

  it('lists an orglet’s side threads and schedule runs together, newest first, and only schedule runs under a crew', () => {
    const tasks = [
      row('thread-old', '20', { sideOf: { taskId: 'main', throughRevision: 0 } }),
      row('run', '21', { routineId: 'standup' }),
      row('thread-new', '22', { sideOf: { taskId: 'main', throughRevision: 0 } }),
      row('crew-run', '23', { routineId: 'review', teamId: 'crew' }),
      row('main', '24'),
    ];
    const routines = [schedule('standup', 'Daily standup note', 'run'), schedule('review', 'Weekly review', 'crew-run')];
    expect(chatsUnder(tasks, routines, { workerId: 'researcher' }).map(chat => [chat.kind, chat.task.id])).toEqual([
      ['side', 'thread-new'], ['schedule', 'run'], ['side', 'thread-old'],
    ]);
    expect(chatsUnder(tasks, routines, { teamId: 'crew' }).map(chat => [chat.kind, chat.task.id])).toEqual([['schedule', 'crew-run']]);
  });
});
