import type { Task } from './contracts';

/** Fields that identify one live worker or team chat (`docs/team-chat-context.md`). */
export type LiveThreadTask = Pick<Task, 'id' | 'createdAt' | 'workerId' | 'teamId' | 'assignees' | 'archivedAt' | 'deletedAt' | 'routineId'>;

/** @deprecated Use `LiveThreadTask`. Kept so existing imports keep compiling. */
export type TeamThreadTask = LiveThreadTask;

function isOpenEnvelope(task: Pick<LiveThreadTask, 'archivedAt' | 'deletedAt' | 'routineId' | 'assignees'>): boolean {
  return !task.archivedAt && !task.deletedAt && !task.routineId && !task.assignees;
}

/** True when this row is the open conversation for `teamId`, not a routine or archived pile item. */
export function isLiveTeamThread(task: LiveThreadTask, teamId: string): boolean {
  return isOpenEnvelope(task) && task.teamId === teamId;
}

/** True when this row is the open 1:1 conversation for `workerId` (no team, no group assignees). */
export function isLiveWorkerThread(task: LiveThreadTask, workerId: string): boolean {
  return isOpenEnvelope(task) && !task.teamId && task.workerId === workerId;
}

function newestLive<T extends LiveThreadTask>(tasks: readonly T[], match: (task: T) => boolean): T | undefined {
  return tasks.reduce<T | undefined>((newest, task) => {
    if (!match(task)) return newest;
    if (!newest || task.createdAt > newest.createdAt) return task;
    return newest;
  }, undefined);
}

/** Newest non-archived team chat for this team. Undefined until the first user message creates the row. */
export function liveTeamTask<T extends LiveThreadTask>(tasks: readonly T[], teamId: string): T | undefined {
  return newestLive(tasks, task => isLiveTeamThread(task, teamId));
}

/** Newest non-archived 1:1 chat for this worker. Undefined until the first user message creates the row. */
export function liveWorkerTask<T extends LiveThreadTask>(tasks: readonly T[], workerId: string): T | undefined {
  return newestLive(tasks, task => isLiveWorkerThread(task, workerId));
}

/** How the team chat composer should persist the next user message: one live `tasks` row, not a row per send. */
export function nextTeamMessage(tasks: readonly LiveThreadTask[], teamId: string): { mode: 'create' } | { mode: 'revise'; taskId: string } {
  const live = liveTeamTask(tasks, teamId);
  return live ? { mode: 'revise', taskId: live.id } : { mode: 'create' };
}

/** How the worker chat composer should persist the next user message: one live `tasks` row, not a row per send. */
export function nextWorkerMessage(tasks: readonly LiveThreadTask[], workerId: string): { mode: 'create' } | { mode: 'revise'; taskId: string } {
  const live = liveWorkerTask(tasks, workerId);
  return live ? { mode: 'revise', taskId: live.id } : { mode: 'create' };
}

/**
 * Where the permissions of a chat that has not started yet are kept (`Workspace.newChatCapabilities`, COD-178).
 * The row does not exist before the first message, so the set is keyed by the worker or team instead and
 * `createTask` moves it onto the row it creates.
 */
export function newChatKey(chat: { teamId?: string; workerId?: string }): string {
  if (chat.teamId) return `team:${chat.teamId}`;
  if (chat.workerId) return `worker:${chat.workerId}`;
  throw new Error('Chat cần một Tí hoặc một hội.');
}
