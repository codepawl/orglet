import type { Task } from './contracts';

/** Fields that identify the one live team chat thread (`docs/team-chat-context.md`). */
export type TeamThreadTask = Pick<Task, 'id' | 'createdAt' | 'teamId' | 'assignees' | 'archivedAt' | 'deletedAt' | 'routineId'>;

/** True when this row is the open conversation for `teamId`, not a routine or archived pile item. */
export function isLiveTeamThread(task: TeamThreadTask, teamId: string): boolean {
  return !task.archivedAt && !task.deletedAt && !task.routineId && !task.assignees && task.teamId === teamId;
}

/** Newest non-archived team chat for this team. Undefined until the first user message creates the row. */
export function liveTeamTask<T extends TeamThreadTask>(tasks: readonly T[], teamId: string): T | undefined {
  return tasks.reduce<T | undefined>((newest, task) => {
    if (!isLiveTeamThread(task, teamId)) return newest;
    if (!newest || task.createdAt > newest.createdAt) return task;
    return newest;
  }, undefined);
}

/** How the team chat composer should persist the next user message: one live `tasks` row, not a row per send. */
export function nextTeamMessage(tasks: readonly TeamThreadTask[], teamId: string): { mode: 'create' } | { mode: 'revise'; taskId: string } {
  const live = liveTeamTask(tasks, teamId);
  return live ? { mode: 'revise', taskId: live.id } : { mode: 'create' };
}
