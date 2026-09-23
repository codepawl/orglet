import { z } from 'zod';

/**
 * What a run changed in its private working copy, read back from Git (COD-163). The copy is compared with the
 * `orglet-snapshot` commit the copy started from, so this is evidence of what the worker did, never a guess from the
 * answer text. Only a copy of a Git repository has that snapshot; a plain folder copy cannot be diffed yet.
 */
export const WorkspaceDiffRequest = z.object({ taskId: z.uuid(), runId: z.uuid() }).strict();
export type WorkspaceDiffRequest = z.infer<typeof WorkspaceDiffRequest>;

/** The counts a turn shows without opening the viewer; saved with the copy when the run finishes. */
export const WorkspaceDiffSummary = z.object({
  files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
}).strict();
export type WorkspaceDiffSummary = z.infer<typeof WorkspaceDiffSummary>;

export type DiffLineKind = 'context' | 'added' | 'removed';
export type DiffLine = {
  kind: DiffLineKind;
  /** The line without its `+`, `-` or space prefix. */
  text: string;
  /** Line number in the snapshot, null for an added line. */
  oldLine: number | null;
  /** Line number in the working copy, null for a removed line. */
  newLine: number | null;
};
export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The function or section Git printed after the hunk range, when it found one. */
  heading: string;
  lines: DiffLine[];
};
export type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed';
export type DiffFile = {
  path: string;
  /** Where a renamed file came from. */
  previousPath?: string;
  status: DiffFileStatus;
  /** Git could not read the file as text; no hunks are sent. */
  binary: boolean;
  additions: number;
  deletions: number;
  /** Some hunk lines were left out: the file passed the per-file line cap, or the whole diff passed its cap. */
  truncated: boolean;
  hunks: DiffHunk[];
};
export type WorkspaceDiff = {
  runId: string;
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** Some files have no hunks because the diff passed its total cap. */
  truncated: boolean;
};

/** Hunk lines kept per file before the rest is dropped. */
export const DIFF_FILE_LINE_LIMIT = 2000;
/** Hunk lines kept across the whole diff before later files lose their hunks. */
export const DIFF_TOTAL_LINE_LIMIT = 10000;
/** Characters kept of one line; a minified file still reads as changed without weighing down the window. */
export const DIFF_LINE_CHARACTER_LIMIT = 4000;
/** Bytes of Git patch output read before the rest is dropped. */
export const DIFF_OUTPUT_BYTE_LIMIT = 4 * 1024 * 1024;

export function summarize(diff: Pick<WorkspaceDiff, 'files' | 'additions' | 'deletions'>): WorkspaceDiffSummary {
  return { files: diff.files.length, additions: diff.additions, deletions: diff.deletions };
}
