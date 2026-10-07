/**
 * Live progress of a worker that streams its work (today: Claude Code). It is kept in memory only and sent to the
 * window as it changes; the saved answer, not this, is what the task keeps.
 */

/** What a step does, so the window can word it in the user's language. */
export type ActivityKind = 'read' | 'search' | 'list' | 'other';

export type ActivityStep = {
  id: string;
  kind: ActivityKind;
  /** File name, search pattern or tool name. Empty until the harness has sent the step's input. */
  target: string;
  done: boolean;
  /** The harness explicitly reported a tool error; no result content is carried. */
  failed?: boolean;
};

export type HarnessProgress = {
  /** Thinking text so far, when the model shares it. */
  thinking: string;
  /** Plain text the worker wrote before its answer, such as "I'll read the contract first." */
  preamble: string;
  activity: ActivityStep[];
  /** The answer message as far as it has been written. */
  answer: string;
  /** True once the worker has started writing its final answer or report. */
  writing: boolean;
  /** The Orglet tool a CLI is choosing in a tool-loop step, read from its output as it streams; not an answer tool. */
  choosing?: string;
};

/** The tools whose call is the answer itself: choosing one of them is writing the answer. */
export const ANSWER_TOOLS: readonly string[] = ['reply', 'submit_report', 'submit_plan'];

/**
 * What a CLI's structured output is, read from its JSON as far as it has streamed: a tool-loop step names its call
 * (`{"call":{"name":"read_source",…}}`), anything else is the answer or report itself. Undefined until it is clear.
 */
export function structuredOutputShape(json: string): { kind: 'answer' } | { kind: 'call'; name?: string } | undefined {
  const start = json.trimStart();
  if (!start.startsWith('{')) return undefined;
  if (/^\{\s*"call"/.test(start)) {
    const name = /^\{\s*"call"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"/.exec(start)?.[1];
    return { kind: 'call', ...(name ? { name } : {}) };
  }
  // Too little has streamed to know: `{"` alone, or the first key still being written.
  if (/^\{\s*("[^"]*)?$/.test(start)) return undefined;
  return { kind: 'answer' };
}

export type RunProgressUpdate = {
  taskId: string;
  runId: string;
  /** When the run started streaming, in milliseconds since the epoch. */
  startedAt: number;
  /** Null when the run has stopped streaming and the window should drop its live view. */
  progress: HarnessProgress | null;
};

export function emptyProgress(): HarnessProgress {
  return { thinking: '', preamble: '', activity: [], answer: '', writing: false };
}

/**
 * A short message an orglet sends the person while it works ("Đọc xong file rồi, giờ mình tính biên lợi nhuận"), kept
 * as a run event the core writes with this prefix, so it is saved, backed up and synced like any other event and the
 * chat can show it between the person's message and the answer (user, 2026-10-07: waiting on a silent run was dull).
 */
export const PROGRESS_NOTE_PREFIX = 'Tin nhắn giữa chừng: ';
/** Longest progress note kept; a longer one is cut, since it is a heads-up, not the answer. */
export const PROGRESS_NOTE_CHARACTERS = 400;

/** The note an event carries, or undefined for any other event. */
export function progressNoteOf(message: string): string | undefined {
  return message.startsWith(PROGRESS_NOTE_PREFIX) ? message.slice(PROGRESS_NOTE_PREFIX.length) : undefined;
}
