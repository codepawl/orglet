import { z } from 'zod';

/**
 * Side threads (COD-247). An orglet's main chat stays the one live row keyed by its `workerId`; a side thread is a
 * separate `tasks` row of the same orglet that remembers which main chat it was started from and how far that chat
 * had got, so its first turn can read those turns as read-only context.
 */
export const SideOf = z.object({
  /** The main chat the thread was started from. It may be archived or deleted later; the thread keeps working. */
  taskId: z.uuid(),
  /** The main chat's latest turn when the thread started: its first turn reads the main chat up to this one. */
  throughRevision: z.number().int().nonnegative(),
}).strict();
export type SideOf = z.infer<typeof SideOf>;

/** Longest answer text "Bring into main chat" copies; a longer one is cut and says so. */
export const CHAT_QUOTE_CHARS = 16_000;
/** A main chat keeps at most this many brought-in answers. */
export const MAX_CHAT_QUOTES = 200;

/**
 * An answer from a side thread brought into the main chat as a quoted message. It is a copy: deleting the side
 * thread leaves the quote, and bringing it in never starts a run. It sits after the main chat's turn `afterRevision`.
 */
export const ChatQuote = z.object({
  id: z.uuid(),
  fromTaskId: z.uuid(),
  artifactId: z.uuid(),
  /** Who wrote the answer, as the side thread's run named them, and that orglet's id. */
  author: z.string().min(1).max(200),
  authorId: z.uuid(),
  text: z.string().min(1).max(CHAT_QUOTE_CHARS + 200),
  afterRevision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
}).strict();
export type ChatQuote = z.infer<typeof ChatQuote>;

type ChatRow = { id: string; createdAt: string; workerId: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; archivedAt?: string; deletedAt?: string; sideOf?: SideOf };

/** True for a side thread's row, whatever became of its main chat. */
export function isSideThread(task: Pick<ChatRow, 'sideOf'>): boolean {
  return Boolean(task.sideOf);
}

/**
 * Whether a side thread can start from this chat: an orglet's own open main chat. A crew chat, a group chat, a
 * scheduled run and a side thread itself cannot start one (v1 is orglets only).
 */
export function canStartSideThread(task: ChatRow): boolean {
  return !task.teamId && !task.assignees && !task.routineId && !task.sideOf && !task.archivedAt && !task.deletedAt;
}

/** The side threads of one orglet listed in the sidebar: open ones only, newest first. */
export function sideThreadsOf<T extends ChatRow>(tasks: readonly T[], workerId: string): T[] {
  const open = tasks.filter(task => task.sideOf && task.workerId === workerId && !task.archivedAt && !task.deletedAt);
  return [...open].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/** The text a brought-in answer carries, cut to `CHAT_QUOTE_CHARS` with a visible mark when it was longer. */
export function quoteText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CHAT_QUOTE_CHARS) return trimmed;
  return `${trimmed.slice(0, CHAT_QUOTE_CHARS)}…`;
}
