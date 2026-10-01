import type { Run } from '../shared/contracts';
import { changeOutcomeOf, type WorkspaceRecoveryView } from '../shared/workspace-recovery';
import type { WorkspaceDiffSummary } from '../shared/workspace-diff';
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
