import type { WorkspaceRecoveryView } from './workspace-recovery';

type CommandRecord = WorkspaceRecoveryView['processes'][number];
export type CommandOutcome = 'passed' | 'failed' | 'unfinished';

/** How one command ended: exit 0, a failure (another exit code, a timeout, the output limit), or not finished. */
export function commandOutcome(command: Pick<CommandRecord, 'state' | 'exitCode'>): CommandOutcome {
  if (command.state === 'exited') return command.exitCode === 0 ? 'passed' : 'failed';
  if (command.state === 'timeout' || command.state === 'output_limit') return 'failed';
  return 'unfinished';
}

/** Summarize persisted command and integration records for one chat turn, never model claims. */
export function workOutcomes(recovery: WorkspaceRecoveryView | undefined, runIds: ReadonlySet<string>) {
  if (!recovery) return null;
  const processes = recovery.processes.filter(process => runIds.has(process.runId));
  const copies = recovery.copies.filter(copy => runIds.has(copy.runId));
  const uncertainCalls = recovery.uncertainCalls.filter(call => runIds.has(call.runId)).length;
  if (!processes.length && !copies.length && !uncertainCalls) return null;
  return {
    passedCommands: processes.filter(process => commandOutcome(process) === 'passed').length,
    failedCommands: processes.filter(process => commandOutcome(process) === 'failed').length,
    unfinishedCommands: processes.filter(process => commandOutcome(process) === 'unfinished').length,
    fileConflicts: copies.filter(copy => ['conflict', 'uncertain'].includes(copy.state)
      || copy.changes.some(change => ['conflict', 'blocked'].includes(change.status))).length,
    uncertainCalls,
    truncated: recovery.truncated,
  };
}

export type CommandTally = { last: Pick<CommandRecord, 'state' | 'exitCode'> & { outcome: CommandOutcome }; earlier: Record<CommandOutcome, number> };

/**
 * A turn's commands with the last one first (dogfood, 2026-09-26): how it ended, then how the earlier ones did. A
 * turn that ran the failing test, fixed the code and ran it again read "1 exited 0, 1 failed", which sounds like the
 * fix failed; "last exited 0 · earlier: 1 failed" says the same counts in the order they happened. The recovery view
 * lists commands newest first. Null when the turn ran none.
 */
export function commandTally(recovery: WorkspaceRecoveryView | undefined, runIds: ReadonlySet<string>): CommandTally | null {
  const commands = recovery?.processes.filter(process => runIds.has(process.runId)) ?? [];
  const [last, ...earlierCommands] = commands;
  if (!last) return null;
  const earlier: Record<CommandOutcome, number> = { passed: 0, failed: 0, unfinished: 0 };
  for (const command of earlierCommands) earlier[commandOutcome(command)] += 1;
  return { last: { state: last.state, exitCode: last.exitCode, outcome: commandOutcome(last) }, earlier };
}
