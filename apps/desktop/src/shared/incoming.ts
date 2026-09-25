import type { FolderIntake, Source } from './contracts';
import type { OpenChatTarget } from './cli';

/**
 * What reaches the window from outside the app (COD-246): files sent from Explorer's Send to menu, and `orglet://`
 * links. Main parses and checks everything first; the renderer only ever gets a hand-off id with the files' names,
 * a chat to open, or a notice. It never gets a path.
 */

/** Files someone sent from Explorer. The window asks where they go, then trades `id` for the imported sources. */
export type IncomingFiles = { kind: 'files'; id: string; count: number; names: string[] };

/** A link asked to open this chat, with `text` to put in its message box. Nothing is ever sent by a link. */
export type IncomingChat = { kind: 'chat'; chat: OpenChatTarget; text?: string };

/** A link could not be followed; `message` is a Vietnamese source string the window translates. */
export type IncomingNotice = { kind: 'notice'; message: string };

export type Incoming = IncomingFiles | IncomingChat | IncomingNotice;

/** Whether Explorer's Send to menu offers Orglet. Only a packaged Windows build can add it. */
export type SendToState = { mode: 'windows'; installed: boolean } | { mode: 'unavailable' };

/** The most files one message carries, the same as the file picker. */
export const ATTACHMENT_LIMIT = 20;

export const FULL_MESSAGE_REASON = 'Task đã có đủ 20 tệp.';

/** What the message box of an empty chat holds: typed or linked text, attached files, and what was left out. */
export type EmptyChatDraft = { text: string; sources: readonly Source[]; skipped: FolderIntake['skipped'] };

/** The part of a draft that moves to the chat's next message, or nothing when the box was empty. */
export type CarriedDraft = { text?: string; intake?: FolderIntake };

/**
 * When a live chat appears for the empty chat on screen, the window switches to it (COD-241), and the empty chat's
 * message box goes away. Its text and files are not dropped (COD-246): they move to that chat's next message. The
 * skipped list only travels with files; on its own it says nothing about the new chat.
 */
export function carriedDraft(draft: EmptyChatDraft): CarriedDraft {
  const carried: CarriedDraft = {};
  if (draft.text.trim()) carried.text = draft.text;
  if (draft.sources.length > 0) carried.intake = { sources: [...draft.sources], skipped: [...draft.skipped] };
  return carried;
}

/**
 * Files arriving from Send to, added to what the message box already holds. A file already there is not added twice,
 * and files past the limit are listed as skipped, the way the folder picker lists them.
 */
/**
 * The files added on the bar of a chat that already has a conversation (COD-257), after more arrive. The chat's
 * `carried` files go with the next message anyway, so they count toward the limit and are never added twice, but
 * only the added ones are returned: they are the cards on the bar. What did not fit joins the skipped list.
 */
export function addToNextMessage(carried: readonly Source[], added: FolderIntake, intake: FolderIntake, limit = ATTACHMENT_LIMIT): FolderIntake {
  const going = [...carried, ...added.sources];
  const merged = attachIntake(going, intake, limit);
  return { sources: merged.sources.slice(carried.length), skipped: [...added.skipped, ...merged.skipped] };
}

export function attachIntake(current: readonly Source[], intake: FolderIntake, limit = ATTACHMENT_LIMIT): FolderIntake {
  const known = new Set(current.map(source => source.id));
  const fresh = intake.sources.filter(source => !known.has(source.id));
  const room = Math.max(0, limit - current.length);
  const added = fresh.slice(0, room);
  const overflow = fresh.slice(room).map(source => ({ name: source.name, reason: FULL_MESSAGE_REASON }));
  return { sources: [...current, ...added], skipped: [...intake.skipped, ...overflow] };
}
