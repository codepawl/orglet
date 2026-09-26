import type { FolderIntake } from '../shared/contracts';

/**
 * What the person typed and attached in a chat's message bar but has not sent, kept per chat while the app is open
 * (COD-257): leaving a chat and coming back finds the words and the file cards where they were. It lives in memory
 * only. The files are already sources in the core, but nothing ties an unsent card to a chat there, so a restart
 * starts every bar empty.
 *
 * A chat that exists is `task:<id>`; an empty chat not started yet is `worker:<id>`, `team:<id>` or
 * `group:<ids>`, from `emptyChatDraftKey`.
 */
export type ChatDraft = { text: string; intake: FolderIntake };

const drafts = new Map<string, ChatDraft>();

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
  return drafts.get(key);
}

/** Keeps the bar's content under `key`; an empty bar keeps nothing. */
export function keepDraft(key: string, draft: ChatDraft) {
  const empty = !draft.text.trim() && draft.intake.sources.length === 0 && draft.intake.skipped.length === 0;
  if (empty) drafts.delete(key);
  else drafts.set(key, { text: draft.text, intake: { sources: [...draft.intake.sources], skipped: [...draft.intake.skipped] } });
}

export function dropDraft(key: string) {
  drafts.delete(key);
}
