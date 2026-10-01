/**
 * Small pure helpers for the sidebar's chat rows (COD-286). Archived chats no longer hang off the sidebar (COD-375):
 * Settings → Lưu trữ lists them, grouped by `archive.ts`. What a chat was is still named here.
 */
type ChatRow = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown };

/** What an archived chat was, so its row can say so: a main chat, a side thread, a schedule's run or a channel. */
export type ArchivedChatKind = 'main' | 'side' | 'schedule' | 'channel';

export function archivedChatKind(task: ChatRow): ArchivedChatKind {
  if (task.sideOf) return 'side';
  if (task.routineId) return 'schedule';
  if (task.teamId || task.assignees) return 'channel';
  return 'main';
}

/**
 * Whether a list cut to its first `limit` rows hides the one on screen. A chat opened from search can sit past a
 * "Show N more", and it has to be revealed so the sidebar marks where the person is (COD-286).
 */
export function hidesActive<T>(items: readonly T[], limit: number, isActive: (item: T) => boolean): boolean {
  return items.slice(limit).some(isActive);
}
