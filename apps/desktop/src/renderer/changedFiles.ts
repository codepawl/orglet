import type { Run } from '../shared/contracts';
import { changeOutcomeOf, type WorkspaceRecoveryView } from '../shared/workspace-recovery';
import type { WorkspaceDiffEntry, WorkspaceDiffSummary } from '../shared/workspace-diff';
import type { ReviewStatus } from './components/DiffViewer';

export type ChangedFilesLineOf = { run: Run; summary: WorkspaceDiffSummary; review?: ReviewStatus; restored?: true };

/**
 * The runs of a turn that changed files or folders in their working copy, with the counts the core kept (COD-163)
 * and where the changes stand (COD-279, COD-291): every line says it, whether the changes waited for review or were
 * handed in at once. A run whose working copy is not on this computer after a restore gets the line the backup kept
 * (COD-299), marked `restored`.
 */
export function changedFilesOf(runs: readonly Run[], recovery: WorkspaceRecoveryView | undefined): ChangedFilesLineOf[] {
  if (!recovery) return [];
  return runs.flatMap(run => {
    const copy = recovery.copies.find(item => item.runId === run.id);
    if (copy) return lineOf(run, copy.diff, changeOutcomeOf(copy));
    const kept = recovery.restored?.find(item => item.runId === run.id);
    if (kept) return lineOf(run, kept.diff, restoredOutcome(kept.outcome), true);
    return [];
  });
}

function lineOf(run: Run, summary: WorkspaceDiffSummary | undefined, review: ReviewStatus | undefined, restored = false): ChangedFilesLineOf[] {
  if (!summary || (summary.files === 0 && (summary.folders ?? 0) === 0)) return [];
  const line: ChangedFilesLineOf = { run, summary };
  if (review) line.review = review;
  if (restored) line.restored = true;
  return [line];
}

/**
 * Where restored changes stand once their working copy is gone: changes that waited for review can no longer be
 * applied, so they read as never applied, and an apply that was under way or stopped midway says nothing it cannot
 * show.
 */
function restoredOutcome(outcome: ReviewStatus | undefined): ReviewStatus | undefined {
  if (outcome?.state === 'pending') return { state: 'unapplied' };
  if (outcome?.state === 'applying' || outcome?.state === 'stopped') return undefined;
  return outcome;
}

/** Rows the card shows before "Show more". */
export const CARD_FILE_ROWS = 3;

export type CardRows = {
  /** The entries to draw, in the order the core kept them. */
  shown: WorkspaceDiffEntry[];
  /** Listed entries still folded away; "Show N more" reveals them. */
  hidden: number;
  /** Entries the core did not keep (past its cap); only the viewer lists them. */
  unlisted: number;
};

/**
 * The file rows of a turn's card, or undefined when the line stays a single line: a run from before the files were
 * kept has only counts, and a line whose changes cannot be opened (carried on by a later turn, or restored from a
 * backup that keeps no path) has nothing to click.
 */
export function cardRowsOf(line: Pick<ChangedFilesLineOf, 'summary' | 'review'> & { restored?: boolean }, expanded: boolean): CardRows | undefined {
  const entries = line.summary.entries;
  if (!entries?.length || line.restored || line.review?.state === 'carried') return undefined;
  const shown = expanded ? entries : entries.slice(0, CARD_FILE_ROWS);
  return { shown, hidden: entries.length - shown.length, unlisted: line.summary.moreEntries ?? 0 };
}

/**
 * What a row says about lines: "+6 −2", "binary" for a file Git read no lines from, nothing for a folder, for a plain
 * copy (it counts no lines, so "+0 −0" would be a false claim) or a file whose lines did not change.
 */
export function entryCountsKind(summary: Pick<WorkspaceDiffSummary, 'lines'>, entry: WorkspaceDiffEntry): 'lines' | 'binary' | 'none' {
  if (entry.folder || summary.lines === false) return 'none';
  if (entry.binary) return 'binary';
  return entry.added > 0 || entry.removed > 0 ? 'lines' : 'none';
}
