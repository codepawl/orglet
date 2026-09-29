import type { FolderIntake } from '../shared/contracts';

/**
 * What the person typed and attached in a chat's message bar but has not sent, kept per chat (COD-257): leaving a chat
 * and coming back finds the words and the file cards where they were, and so does reopening the app, which an update
 * does on its own. The core ties no unsent card to a chat, so the bars are kept in the renderer's own storage, like the
 * read stamps. Erasing chats, sources or everything forgets them (`forgetAllDrafts`).
 *
 * A chat that exists is `task:<id>`; an empty chat not started yet is `worker:<id>`, `team:<id>` or
 * `group:<ids>`, from `emptyChatDraftKey`.
 */
export type ChatDraft = { text: string; intake: FolderIntake };

const storageKey = 'orglet.chat-drafts';
/** The bars kept at most, the most recently written last; an older one is dropped first. */
const DRAFT_LIMIT = 50;

let drafts: Map<string, ChatDraft> | undefined;

function isDraft(value: unknown): value is ChatDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ChatDraft>;
  return typeof draft.text === 'string' && Array.isArray(draft.intake?.sources) && Array.isArray(draft.intake?.skipped);
}

function loaded(): Map<string, ChatDraft> {
  if (drafts) return drafts;
  drafts = new Map();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown;
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && isDraft(entry[1])) drafts.set(entry[0], entry[1]);
      }
    }
  } catch { /* no storage, or a damaged entry: start with empty bars */ }
  return drafts;
}

function saved() {
  const all = loaded();
  while (all.size > DRAFT_LIMIT) all.delete(all.keys().next().value!);
  try { localStorage.setItem(storageKey, JSON.stringify([...all])); } catch { /* ignore quota */ }
}

export function taskDraftKey(taskId: string) {
  return `task:${taskId}`;
}

/** The empty chat of an orglet, a crew or a group of orglets, or undefined when none is on screen. */
export function emptyChatDraftKey(target: { teamId?: string; workerIds?: readonly string[]; workerId?: string }): string | undefined {
  if (target.teamId) return `team:${target.teamId}`;
  if (target.workerIds?.length) return `group:${[...target.workerIds].sort().join(',')}`;
  if (target.workerId) return `worker:${target.workerId}`;
  return undefined;
}

export function readDraft(key: string): ChatDraft | undefined {
  return loaded().get(key);
}

/** Keeps the bar's content under `key`; an empty bar keeps nothing. */
export function keepDraft(key: string, draft: ChatDraft) {
  const empty = !draft.text.trim() && draft.intake.sources.length === 0 && draft.intake.skipped.length === 0;
  const all = loaded();
  const kept = all.get(key);
  if (empty && !kept) return;
  if (!empty && kept && JSON.stringify(kept) === JSON.stringify(draft)) return;
  all.delete(key);
  if (!empty) all.set(key, { text: draft.text, intake: { sources: [...draft.intake.sources], skipped: [...draft.intake.skipped] } });
  saved();
}

export function dropDraft(key: string) {
  if (loaded().delete(key)) saved();
}

/** After chats, sources or everything are erased, no bar may bring back words or files from before. */
export function forgetAllDrafts() {
  drafts = new Map();
  try { localStorage.removeItem(storageKey); } catch { /* nothing kept */ }
}
