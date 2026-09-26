/**
 * Which chats the sidebar lists and where (COD-286). Pure: no state, no bridge calls.
 *
 * Archiving a side thread, a schedule's run or a group chat took its row away and left no list to find it in again,
 * only search; orglets and crews already had an "Archived (N)" list at the end of their section. Each archived chat
 * now waits at the end of the section its row came from: a crew's chats under Crews, an orglet's main chat, side
 * threads and schedule runs under Orglets, a group chat under Group chats.
 */
type ChatRow = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown };

/** The sidebar section an archived chat is listed in. */
export type ArchivedChatSection = 'teams' | 'workers' | 'groups';

/** What an archived chat was, so its row can say so: a main chat, a side thread, a schedule's run or a group chat. */
export type ArchivedChatKind = 'main' | 'side' | 'schedule' | 'group';

export type ArchivedChat<T extends ChatRow> = { task: T; kind: ArchivedChatKind };

/** Where the chat's own row sat: its crew, a group of orglets, or its one orglet. */
export function archivedChatSection(task: ChatRow): ArchivedChatSection {
  if (task.teamId) return 'teams';
  if (task.assignees) return 'groups';
  return 'workers';
}

export function archivedChatKind(task: ChatRow): ArchivedChatKind {
  if (task.sideOf) return 'side';
  if (task.routineId) return 'schedule';
  if (!task.teamId && task.assignees) return 'group';
  return 'main';
}

/** The archived chats listed in one section, most recently archived first. Deleted chats are gone for good. */
export function archivedChatsIn<T extends ChatRow>(tasks: readonly T[], section: ArchivedChatSection): ArchivedChat<T>[] {
  const archived = tasks.filter(task => task.archivedAt && !task.deletedAt && archivedChatSection(task) === section);
  const newestFirst = [...archived].sort((first, second) => second.archivedAt!.localeCompare(first.archivedAt!));
  return newestFirst.map(task => ({ task, kind: archivedChatKind(task) }));
}

/**
 * Whether a list cut to its first `limit` rows hides the one on screen. A chat opened from search can sit past a
 * "Show N more", and it has to be revealed so the sidebar marks where the person is (COD-286).
 */
export function hidesActive<T>(items: readonly T[], limit: number, isActive: (item: T) => boolean): boolean {
  return items.slice(limit).some(isActive);
}
