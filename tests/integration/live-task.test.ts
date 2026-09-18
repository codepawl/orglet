import { expect, it } from 'vitest';
import { liveTeamTask, liveWorkerTask, nextTeamMessage, nextWorkerMessage, type LiveThreadTask } from '../../apps/desktop/src/shared/live-task';

const row = (partial: Partial<LiveThreadTask> & Pick<LiveThreadTask, 'id' | 'createdAt' | 'workerId'>): LiveThreadTask => ({
  assignees: undefined, archivedAt: undefined, deletedAt: undefined, routineId: undefined, ...partial,
});

it('picks the newest live team thread and ignores archived, deleted, routine and group-chat rows', () => {
  const team = 'team-a';
  const tasks: LiveThreadTask[] = [
    row({ id: 'old', workerId: 'lead', teamId: team, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'live', workerId: 'lead', teamId: team, createdAt: '2026-02-01T00:00:00.000Z' }),
    row({ id: 'archived', workerId: 'lead', teamId: team, createdAt: '2026-03-01T00:00:00.000Z', archivedAt: '2026-03-02T00:00:00.000Z' }),
    row({ id: 'deleted', workerId: 'lead', teamId: team, createdAt: '2026-03-03T00:00:00.000Z', deletedAt: '2026-03-04T00:00:00.000Z' }),
    row({ id: 'routine', workerId: 'lead', teamId: team, createdAt: '2026-03-05T00:00:00.000Z', routineId: 'routine-1' }),
    row({ id: 'group', workerId: 'lead', teamId: team, createdAt: '2026-03-06T00:00:00.000Z', assignees: ['w1', 'w2'] }),
    row({ id: 'other', workerId: 'lead', teamId: 'team-b', createdAt: '2026-04-01T00:00:00.000Z' }),
  ];
  expect(liveTeamTask(tasks, team)?.id).toBe('live');
  expect(nextTeamMessage(tasks, team)).toEqual({ mode: 'revise', taskId: 'live' });
  expect(nextTeamMessage([], team)).toEqual({ mode: 'create' });
  expect(liveTeamTask(tasks, 'missing')).toBeUndefined();
});

it('picks the newest live worker thread and ignores team, group, archived and routine rows', () => {
  const worker = 'worker-a';
  const tasks: LiveThreadTask[] = [
    row({ id: 'old', workerId: worker, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'live', workerId: worker, createdAt: '2026-02-01T00:00:00.000Z' }),
    row({ id: 'team', workerId: worker, teamId: 'team-a', createdAt: '2026-03-01T00:00:00.000Z' }),
    row({ id: 'group', workerId: worker, assignees: ['worker-a', 'worker-b'], createdAt: '2026-03-02T00:00:00.000Z' }),
    row({ id: 'archived', workerId: worker, createdAt: '2026-03-03T00:00:00.000Z', archivedAt: '2026-03-04T00:00:00.000Z' }),
    row({ id: 'routine', workerId: worker, createdAt: '2026-03-05T00:00:00.000Z', routineId: 'routine-1' }),
    row({ id: 'other', workerId: 'worker-b', createdAt: '2026-04-01T00:00:00.000Z' }),
  ];
  expect(liveWorkerTask(tasks, worker)?.id).toBe('live');
  expect(nextWorkerMessage(tasks, worker)).toEqual({ mode: 'revise', taskId: 'live' });
  expect(nextWorkerMessage([], worker)).toEqual({ mode: 'create' });
  expect(liveWorkerTask(tasks, 'missing')).toBeUndefined();
});
