import type { Run } from './contracts';
import { workOutcomes } from './work-outcomes';
import type { UncertainCall, WorkspaceRecoveryView } from './workspace-recovery';

/*
 * The recovery view as a person reads it (COD-191): one attempt per run, newest first, with that attempt's working
 * copy, commands and unknown calls under it, and two answers the surface needs: which attempts still need a decision
 * and which one is blocking the chat. Core keeps the flat lists; this module only groups them.
 */

export type AttemptState = 'kept' | 'integrated' | 'not_applied' | 'no_changes' | 'conflict' | 'uncertain' | 'preparing' | 'integrating';

export type RecoveryAttempt = {
  runId: string;
  reviewToken: string;
  workerName: string;
  startedAt: string | null;
  retired: boolean;
  completed: boolean;
  state: AttemptState;
  copy: WorkspaceRecoveryView['copies'][number] | undefined;
  /** Files edited in the private copy that never reached the folder. */
  pendingChanges: number;
  processes: WorkspaceRecoveryView['processes'];
  commands: { total: number; passed: number; failed: number; unfinished: number };
  uncertainCalls: UncertainCall[];
  /** An effect with an unknown outcome that stops every later write in this chat until the attempt is retired. */
  blocking: boolean;
  /** Something the person has to settle: a blocking effect, or edits that were never applied and could still be resumed. */
  needsDecision: boolean;
};

export type RecoveryAttempts = {
  /** Attempts worth reading now, newest first. Never empty when the view has anything in it. */
  shown: RecoveryAttempt[];
  /** Retired, integrated or otherwise settled attempts, folded behind "Show N earlier attempts". */
  earlier: RecoveryAttempt[];
  /** The newest attempt whose unknown effect blocks the chat, if any. */
  blocking: RecoveryAttempt | undefined;
};

/** What a journaled call with an unknown outcome did, in the terms a person uses: a write, a command, an integration. */
export type UncertainCallLabel = { action: 'write' | 'run' | 'apply' | 'other'; target: string | null; tool: string | null };

export function uncertainCallLabel(call: Pick<UncertainCall, 'tool' | 'summary'>): UncertainCallLabel {
  const target = call.summary ?? null;
  if (call.tool === 'workspace_write') return { action: 'write', target, tool: call.tool };
  if (call.tool === 'workspace_start_process') return { action: 'run', target, tool: call.tool };
  if (call.tool === 'integrate_workspace_file') return { action: 'apply', target, tool: call.tool };
  return { action: 'other', target, tool: call.tool ?? null };
}

function attemptState(retired: boolean, copy: RecoveryAttempt['copy']): AttemptState {
  if (retired) return 'kept';
  if (!copy) return 'no_changes';
  if (copy.state === 'ready') return copy.changeCount > 0 ? 'not_applied' : 'no_changes';
  return copy.state;
}

export function groupRecoveryAttempts(view: WorkspaceRecoveryView | undefined, runs: readonly Run[]): RecoveryAttempts {
  if (!view) return { shown: [], earlier: [], blocking: undefined };
  const attempts = view.attempts.map((attempt): RecoveryAttempt => {
    const run = runs.find(candidate => candidate.id === attempt.runId);
    const copy = view.copies.find(candidate => candidate.runId === attempt.runId);
    const processes = view.processes.filter(process => process.runId === attempt.runId);
    const uncertainCalls = view.uncertainCalls.filter(call => call.runId === attempt.runId);
    const outcomes = workOutcomes(view, new Set([attempt.runId]));
    const commands = {
      total: processes.length,
      passed: outcomes?.passedCommands ?? 0,
      failed: outcomes?.failedCommands ?? 0,
      unfinished: outcomes?.unfinishedCommands ?? 0,
    };
    const completed = run?.status === 'completed';
    const pendingChanges = copy?.state === 'ready' ? copy.changeCount : 0;
    const unresolvedChanges = copy?.changes.some(change => change.status === 'conflict' || change.status === 'blocked') ?? false;
    // The three guards that refuse the next write: an unknown never-replay call, an unknown command, an unknown or
    // conflicting working copy. Retiring the attempt lifts all three.
    const blocking = !attempt.retired && (uncertainCalls.some(call => call.replay === 'never')
      || processes.some(process => process.state === 'uncertain')
      || copy?.state === 'uncertain' || copy?.state === 'conflict');
    const needsDecision = !attempt.retired && !completed && (blocking || pendingChanges > 0 || unresolvedChanges);
    return {
      runId: attempt.runId, reviewToken: attempt.reviewToken, workerName: run?.snapshot.worker.name ?? attempt.runId,
      startedAt: run?.startedAt ?? null, retired: attempt.retired, completed, state: attemptState(attempt.retired, copy),
      copy, pendingChanges, processes, commands, uncertainCalls, blocking, needsDecision,
    };
  });
  attempts.sort((first, second) => (second.startedAt ?? '').localeCompare(first.startedAt ?? ''));
  const shown = attempts.filter(attempt => attempt.needsDecision || attempt.blocking);
  const earlier = attempts.filter(attempt => !shown.includes(attempt));
  // A chat whose every attempt is settled still shows its latest one, so the section is never a lone "show earlier" link.
  if (shown.length === 0 && earlier.length > 0) shown.push(earlier.shift()!);
  return { shown, earlier, blocking: attempts.find(attempt => attempt.blocking) };
}
