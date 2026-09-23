import { newChatKey } from '../shared/live-task';
import type { SidebarSelection } from './sidebarSelection';

/**
 * A group chat started from orglets picked in the sidebar (COD-215). Until the first message nothing exists in the
 * core: the target is only these ids, in sidebar order, held by the renderer. The first message creates the row with
 * every orglet as an assignee and the first one picked as the row's `workerId`, the way `updateTask` treats the first
 * chosen orglet. Pure: no state, no bridge calls.
 */
export type PendingGroupChat = { workerIds: string[] };

const RECIPIENT_PREFIX = 'group:';

/** Two or more orglets picked in the Orglets section make a group; crews, or one orglet, do not. */
export function groupChatFromSelection(selection: SidebarSelection): PendingGroupChat | undefined {
  if (selection.section !== 'workers' || selection.ids.length < 2) return undefined;
  return { workerIds: [...selection.ids] };
}

/** Drops orglets that left the workspace; with fewer than two left there is no group any more. */
export function pruneGroupChat(group: PendingGroupChat, workerIds: readonly string[]): PendingGroupChat | undefined {
  const kept = group.workerIds.filter(id => workerIds.includes(id));
  if (kept.length < 2) return undefined;
  if (kept.length === group.workerIds.length) return group;
  return { workerIds: kept };
}

/** Where the group's permissions and folder wait before the first message: the sorted ids, so the order picked does not matter. */
export function groupChatKey(group: PendingGroupChat): string {
  return newChatKey({ workerIds: group.workerIds });
}

/** The `createTask` input for the first message: every orglet answers, and the first one picked owns the row. */
export function groupChatTaskInput<Fields extends object>(group: PendingGroupChat, fields: Fields): Fields & { workerId: string; assignees: string[] } {
  return { ...fields, workerId: group.workerIds[0], assignees: [...group.workerIds] };
}

/** True for a chat row that these same orglets answer, whatever order they were picked in. */
export function isGroupChatTask(task: { teamId?: string; assignees?: 'all' | string[] }, group: PendingGroupChat): boolean {
  if (task.teamId || !Array.isArray(task.assignees)) return false;
  return newChatKey({ workerIds: task.assignees }) === groupChatKey(group);
}

/** The navigation recipient of the empty group chat (COD-202), keeping the order picked so a step back restores the same owner. */
export function groupChatRecipient(group: PendingGroupChat): string {
  return `${RECIPIENT_PREFIX}${group.workerIds.join(',')}`;
}

/** The group a navigation recipient names, or undefined for a worker or team recipient. */
export function groupChatFromRecipient(recipient: string): PendingGroupChat | undefined {
  if (!recipient.startsWith(RECIPIENT_PREFIX)) return undefined;
  const workerIds = recipient.slice(RECIPIENT_PREFIX.length).split(',').filter(Boolean);
  return workerIds.length >= 2 ? { workerIds } : undefined;
}

/** The names for a header when there are few enough to read at a glance; undefined means the caller counts them instead. */
export function groupChatNames(names: readonly string[], most = 3): string | undefined {
  return names.length <= most ? names.join(', ') : undefined;
}
