import type { WorkspaceRecoveryView } from './workspace-recovery';

/** Summarize persisted command and integration records for one chat turn, never model claims. */
export function workOutcomes(recovery: WorkspaceRecoveryView | undefined, runIds: ReadonlySet<string>) {
  if (!recovery) return null;
  const processes = recovery.processes.filter(process => runIds.has(process.runId));
  const copies = recovery.copies.filter(copy => runIds.has(copy.runId));
  const uncertainCalls = recovery.uncertainCalls.filter(call => runIds.has(call.runId)).length;
  if (!processes.length && !copies.length && !uncertainCalls) return null;
  return {
    passedCommands: processes.filter(process => process.state === 'exited' && process.exitCode === 0).length,
    failedCommands: processes.filter(process => process.state === 'timeout' || process.state === 'output_limit'
      || (process.state === 'exited' && process.exitCode !== 0)).length,
    unfinishedCommands: processes.filter(process => !['exited', 'timeout', 'output_limit'].includes(process.state)).length,
    fileConflicts: copies.filter(copy => ['conflict', 'uncertain'].includes(copy.state)
      || copy.changes.some(change => ['conflict', 'blocked'].includes(change.status))).length,
    uncertainCalls,
    truncated: recovery.truncated,
  };
}
