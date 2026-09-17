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
};

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
