import type { Task } from '../shared/contracts';

/**
 * The chat that was open when Orglet last closed, so the next start (an update restarts the app on its own) opens it
 * again instead of the first orglet (dogfood round 5, COD-287). Only its id is kept, in the renderer's own storage like
 * the read stamps; a chat archived or deleted since is not reopened.
 */
const storageKey = 'orglet.last-open-chat';

export function rememberOpenChat(taskId: string) {
  try {
    localStorage.setItem(storageKey, taskId);
  } catch {
    // No storage: the next start opens the first orglet, as before.
  }
}

export function rememberedChat(): string | undefined {
  try {
    return localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The remembered chat, while it is still a chat that can be open. */
export function chatToReopen(tasks: readonly Pick<Task, 'id' | 'archivedAt' | 'deletedAt'>[], remembered: string | undefined) {
  if (!remembered) return undefined;
  return tasks.find(task => task.id === remembered && !task.archivedAt && !task.deletedAt);
}
