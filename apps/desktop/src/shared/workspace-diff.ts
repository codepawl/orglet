import { z } from 'zod';

/**
 * What a run changed in its private working copy, read back from Git (COD-163). The copy is compared with the
 * `orglet-snapshot` commit the copy started from, so this is evidence of what the worker did, never a guess from the
 * answer text. Only a copy of a Git repository has that snapshot; a plain folder copy cannot be diffed yet.
 */
export const WorkspaceDiffRequest = z.object({ taskId: z.uuid(), runId: z.uuid() }).strict();
export type WorkspaceDiffRequest = z.infer<typeof WorkspaceDiffRequest>;

/**
 * The counts a turn shows without opening the viewer. The optional counts (COD-254) are present only when they are not
 * zero, and `lines` only when it is false: a plain folder copy knows which files moved or were deleted but has no line
 * counts. A backup keeps only these counts, never a path.
 */
export const WorkspaceDiffCounts = z.object({
  files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** Files moved to another folder or renamed. */
  moved: z.number().int().positive().optional(),
  /** Files deleted. */
  removed: z.number().int().positive().optional(),
  /** Folders created or removed. */
  folders: z.number().int().positive().optional(),
  lines: z.literal(false).optional(),
}).strict();
export type WorkspaceDiffCounts = z.infer<typeof WorkspaceDiffCounts>;

/** Entries a summary keeps; a run that changed more says how many it left out in `moreEntries`. */
export const DIFF_SUMMARY_ENTRY_LIMIT = 200;
/**
 * One changed file or folder in a summary, counted once when the run finishes so the chat's card never diffs on a
 * render. `added` and `removed` are lines; a plain copy and a folder have none.
 */
export const WorkspaceDiffEntry = z.object({
  path: z.string().min(1).max(1024),
  previousPath: z.string().min(1).max(1024).optional(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed']),
  /** A folder the copy created or removed. */
  folder: z.literal(true).optional(),
  /** Git could not read the file as text, so it has no line counts. */
  binary: z.literal(true).optional(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
}).strict();
export type WorkspaceDiffEntry = z.infer<typeof WorkspaceDiffEntry>;

/**
 * The counts with the files behind them; saved with the copy when the run finishes. A run from before the files were
 * kept has the counts alone and shows the single line.
 */
export const WorkspaceDiffSummary = WorkspaceDiffCounts.extend({
  entries: z.array(WorkspaceDiffEntry).max(DIFF_SUMMARY_ENTRY_LIMIT).optional(),
  /** Files and folders beyond the entries kept. */
  moreEntries: z.number().int().positive().optional(),
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
/** A folder the copy created or removed (COD-254). Git keeps no folders, so this comes from the two inventories. */
export type DiffFolder = { path: string; status: 'added' | 'deleted' };
export type WorkspaceDiff = {
  runId: string;
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** Some files have no hunks because the diff passed its total cap. */
  truncated: boolean;
  /** Folders created or removed; absent when there are none. */
  folders?: DiffFolder[];
  /**
   * False for a plain folder copy: its snapshot kept only hashes, so the files are listed with what happened to them
   * (added, changed, moved, deleted) and without lines or counts.
   */
  lines?: false;
};

/** Hunk lines kept per file before the rest is dropped. */
export const DIFF_FILE_LINE_LIMIT = 2000;
/** Hunk lines kept across the whole diff before later files lose their hunks. */
export const DIFF_TOTAL_LINE_LIMIT = 10000;
/** Characters kept of one line; a minified file still reads as changed without weighing down the window. */
export const DIFF_LINE_CHARACTER_LIMIT = 4000;
/** Bytes of Git patch output read before the rest is dropped. */
export const DIFF_OUTPUT_BYTE_LIMIT = 4 * 1024 * 1024;

/** Files first, then folders, at most the limit; the rest is only counted. */
export function summaryEntries(diff: Pick<WorkspaceDiff, 'files' | 'folders'>): Pick<WorkspaceDiffSummary, 'entries' | 'moreEntries'> {
  const fits = (entry: WorkspaceDiffEntry) => entry.path.length <= 1024 && (entry.previousPath?.length ?? 0) <= 1024;
  const everything: WorkspaceDiffEntry[] = [
    ...diff.files.map(file => ({
      path: file.path,
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
      status: file.status,
      ...(file.binary ? { binary: true as const } : {}),
      added: file.additions,
      removed: file.deletions,
    })),
    ...(diff.folders ?? []).map(folder => ({ path: folder.path, status: folder.status, folder: true as const, added: 0, removed: 0 })),
  ];
  if (everything.length === 0) return {};
  // A path too long to store is left out with the rest and only counted.
  const kept = everything.filter(fits).slice(0, DIFF_SUMMARY_ENTRY_LIMIT);
  const left = everything.length - kept.length;
  return { ...(kept.length ? { entries: kept } : {}), ...(left > 0 ? { moreEntries: left } : {}) };
}

/** The counts alone, which is all a backup carries. */
export function countsOf(summary: WorkspaceDiffSummary): WorkspaceDiffCounts {
  const { entries: _entries, moreEntries: _moreEntries, ...counts } = summary;
  return counts;
}

export function summarize(diff: Pick<WorkspaceDiff, 'files' | 'additions' | 'deletions' | 'folders' | 'lines'>): WorkspaceDiffSummary {
  const moved = diff.files.filter(file => file.status === 'renamed').length;
  const removed = diff.files.filter(file => file.status === 'deleted').length;
  const folders = diff.folders?.length ?? 0;
  return {
    files: diff.files.length, additions: diff.additions, deletions: diff.deletions,
    ...(moved ? { moved } : {}), ...(removed ? { removed } : {}), ...(folders ? { folders } : {}),
    ...(diff.lines === false ? { lines: false as const } : {}),
    ...summaryEntries(diff),
  };
}
