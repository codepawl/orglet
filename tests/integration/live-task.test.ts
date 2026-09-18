import { expect, it } from 'vitest';
import { liveTeamTask, nextTeamMessage, type TeamThreadTask } from '../../apps/desktop/src/shared/live-task';

const row = (partial: Partial<TeamThreadTask> & Pick<TeamThreadTask, 'id' | 'teamId' | 'createdAt'>): TeamThreadTask => ({
  assignees: undefined, archivedAt: undefined, deletedAt: undefined, routineId: undefined, ...partial,
});

it('picks the newest live team thread and ignores archived, deleted, routine and group-chat rows', () => {
  const team = 'team-a';
  const tasks: TeamThreadTask[] = [
    row({ id: 'old', teamId: team, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'live', teamId: team, createdAt: '2026-02-01T00:00:00.000Z' }),
    row({ id: 'archived', teamId: team, createdAt: '2026-03-01T00:00:00.000Z', archivedAt: '2026-03-02T00:00:00.000Z' }),
    row({ id: 'deleted', teamId: team, createdAt: '2026-03-03T00:00:00.000Z', deletedAt: '2026-03-04T00:00:00.000Z' }),
    row({ id: 'routine', teamId: team, createdAt: '2026-03-05T00:00:00.000Z', routineId: 'routine-1' }),
    row({ id: 'group', teamId: team, createdAt: '2026-03-06T00:00:00.000Z', assignees: ['w1', 'w2'] }),
    row({ id: 'other', teamId: 'team-b', createdAt: '2026-04-01T00:00:00.000Z' }),
  ];
  expect(liveTeamTask(tasks, team)?.id).toBe('live');
  expect(nextTeamMessage(tasks, team)).toEqual({ mode: 'revise', taskId: 'live' });
  expect(nextTeamMessage([], team)).toEqual({ mode: 'create' });
  expect(liveTeamTask(tasks, 'missing')).toBeUndefined();
});
