import type { Task } from './contracts';

/** Fields that identify one live worker or team chat (`docs/team-chat-context.md`). */
export type LiveThreadTask = Pick<Task, 'id' | 'createdAt' | 'workerId' | 'teamId' | 'assignees' | 'archivedAt' | 'deletedAt' | 'routineId' | 'sideOf'>;

/** @deprecated Use `LiveThreadTask`. Kept so existing imports keep compiling. */
export type TeamThreadTask = LiveThreadTask;

/**
 * A row that can be the one live chat of an orglet or crew. A side thread (COD-247) never is: it is a second row of
 * the same orglet, and the main chat keeps meaning the row this finds.
 */
function isOpenEnvelope(task: Pick<LiveThreadTask, 'archivedAt' | 'deletedAt' | 'routineId' | 'assignees' | 'sideOf'>): boolean {
  return !task.archivedAt && !task.deletedAt && !task.routineId && !task.assignees && !task.sideOf;
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

/** The live chat of an orglet or a crew: its main chat, never a side thread (COD-247). */
export function liveChatOf<T extends LiveThreadTask>(tasks: readonly T[], chat: { teamId: string } | { workerId: string }): T | undefined {
  if ('teamId' in chat) return liveTeamTask(tasks, chat.teamId);
  return liveWorkerTask(tasks, chat.workerId);
}

/**
 * The chat an empty chat on screen switches to (COD-241): the orglet's or crew's live chat when it appeared after
 * the view was entered (`baselineLiveId` is what was live then). Anything a draft carries follows this choice, so a
 * side thread starting (COD-247) is never adopted: it is not the live chat, and the empty chat stays the main one.
 */
export function liveChatToAdopt(tasks: readonly LiveThreadTask[], chat: { teamId: string } | { workerId: string }, baselineLiveId: string | undefined): string | undefined {
  const live = liveChatOf(tasks, chat);
  if (!live || live.id === baselineLiveId) return undefined;
  return live.id;
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

const GROUP_KEY_PREFIX = 'group:';

/**
 * Where the permissions of a chat that has not started yet are kept (`Workspace.newChatCapabilities`, COD-178).
 * The row does not exist before the first message, so the set is keyed by the worker or team instead and
 * `createTask` moves it onto the row it creates. A group chat started from several orglets (COD-215) is keyed by
 * their sorted ids, so the same orglets picked in another order share one waiting set.
 */
export function newChatKey(chat: { teamId?: string; workerId?: string; workerIds?: readonly string[] }): string {
  if (chat.teamId) return `team:${chat.teamId}`;
  if (chat.workerIds) return `${GROUP_KEY_PREFIX}${[...chat.workerIds].sort().join(',')}`;
  if (chat.workerId) return `worker:${chat.workerId}`;
  throw new Error('Chat cần một Tí hoặc một hội.');
}

/** True for the key of a group chat this worker is part of: once the worker is gone, that group cannot start. */
export function newChatKeyNames(key: string, workerId: string): boolean {
  if (!key.startsWith(GROUP_KEY_PREFIX)) return false;
  return key.slice(GROUP_KEY_PREFIX.length).split(',').includes(workerId);
}
