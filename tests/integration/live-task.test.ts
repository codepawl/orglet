import { expect, it } from 'vitest';
import { liveChatOf, liveChatToAdopt, liveTeamTask, liveWorkerTask, nextTeamMessage, nextWorkerMessage, type LiveThreadTask } from '../../apps/desktop/src/shared/live-task';

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

it('picks the newest live worker thread and ignores team, group, archived, routine and side-thread rows', () => {
  const worker = 'worker-a';
  const tasks: LiveThreadTask[] = [
    row({ id: 'old', workerId: worker, createdAt: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'live', workerId: worker, createdAt: '2026-02-01T00:00:00.000Z' }),
    row({ id: 'team', workerId: worker, teamId: 'team-a', createdAt: '2026-03-01T00:00:00.000Z' }),
    row({ id: 'group', workerId: worker, assignees: ['worker-a', 'worker-b'], createdAt: '2026-03-02T00:00:00.000Z' }),
    row({ id: 'archived', workerId: worker, createdAt: '2026-03-03T00:00:00.000Z', archivedAt: '2026-03-04T00:00:00.000Z' }),
    row({ id: 'routine', workerId: worker, createdAt: '2026-03-05T00:00:00.000Z', routineId: 'routine-1' }),
    // A side thread (COD-247) is newer than the main chat and still never the main chat.
    row({ id: 'side', workerId: worker, createdAt: '2026-03-06T00:00:00.000Z', sideOf: { taskId: 'live', throughRevision: 0 } }),
    row({ id: 'other', workerId: 'worker-b', createdAt: '2026-04-01T00:00:00.000Z' }),
  ];
  expect(liveWorkerTask(tasks, worker)?.id).toBe('live');
  expect(nextWorkerMessage(tasks, worker)).toEqual({ mode: 'revise', taskId: 'live' });
  expect(nextWorkerMessage([], worker)).toEqual({ mode: 'create' });
  expect(liveWorkerTask(tasks, 'missing')).toBeUndefined();
});

it('adopts a main chat that appeared while the empty chat was on screen, never a side thread (COD-241, COD-247)', () => {
  const worker = 'worker-a';
  const main = row({ id: 'main', workerId: worker, createdAt: '2026-02-01T00:00:00.000Z' });
  const side = row({ id: 'side', workerId: worker, createdAt: '2026-02-02T00:00:00.000Z', sideOf: { taskId: 'main', throughRevision: 0 } });
  // Nothing was live when the empty chat opened; the terminal command then starts the main chat.
  expect(liveChatToAdopt([main], { workerId: worker }, undefined)).toBe('main');
  // The main chat was already live: a side thread starting from it is not a new chat to switch to.
  expect(liveChatToAdopt([main, side], { workerId: worker }, 'main')).toBeUndefined();
  // Even with no main chat live, a side-thread row alone is never taken for the orglet's chat, so a draft in the
  // empty chat never follows it there.
  expect(liveChatToAdopt([side], { workerId: worker }, undefined)).toBeUndefined();
  expect(liveChatOf([main, side], { workerId: worker })?.id).toBe('main');
  expect(liveChatOf([side], { workerId: worker })).toBeUndefined();
  // A crew chat is found the same way.
  const crew = row({ id: 'crew', workerId: 'lead', teamId: 'team-a', createdAt: '2026-02-03T00:00:00.000Z' });
  expect(liveChatToAdopt([crew], { teamId: 'team-a' }, undefined)).toBe('crew');
});
