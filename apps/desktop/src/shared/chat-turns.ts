import type { RunInput, TaskDetail } from './contracts';
import { turnMessageId } from './message-interactions';

type TurnDetail = Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>;

/** New durable turns and recoverable legacy snapshots share local aliases without inventing lost messages. */
export function chatTurnRevisions(detail: TurnDetail): number[] {
  return [...new Set([0, detail.task.inputRevision ?? 0, ...detail.runs.map(run => run.snapshot.inputRevision ?? 0),
    ...(detail.savedTurns ?? []).map(turn => turn.localRevision)])].filter(revision => Boolean(chatTurnInput(detail, revision)?.brief)
      || detail.runs.some(run => (run.snapshot.inputRevision ?? 0) === revision))
    .sort((first, second) => chatTurnCreatedAt(detail, first).localeCompare(chatTurnCreatedAt(detail, second))
      || chatTurnMessageId(detail, first).localeCompare(chatTurnMessageId(detail, second)));
}

export function chatTurnInput(detail: TurnDetail, revision: number): RunInput | undefined {
  const saved = detail.savedTurns?.find(turn => turn.localRevision === revision);
  if (saved) return saved.input;
  if (revision === (detail.task.inputRevision ?? 0) && detail.task.currentInput) return detail.task.currentInput;
  return detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)?.snapshot.input
    ?? (revision === 0 && (detail.task.inputRevision ?? 0) === 0 ? { brief: detail.task.brief, sourceIds: detail.task.sourceIds, excludedSources: detail.task.excludedSources } : undefined);
}

export function chatTurnMessageId(detail: TurnDetail, revision: number): string {
  return detail.savedTurns?.find(turn => turn.localRevision === revision)?.id ?? turnMessageId(detail.task.id, revision, detail.task.turnIds);
}

/** Authored timestamps are immutable on durable turns; legacy snapshots keep their observed run time. */
export function chatTurnCreatedAt(detail: TurnDetail, revision: number): string {
  return detail.savedTurns?.find(turn => turn.localRevision === revision)?.createdAt
    ?? detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision)?.startedAt
    ?? detail.task.createdAt;
}
