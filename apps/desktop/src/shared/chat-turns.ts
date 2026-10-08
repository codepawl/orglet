import type { Run, RunInput, TaskDetail } from './contracts';
import { turnMessageId } from './message-interactions';

type TurnDetail = Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>;
type SavedTurn = NonNullable<TurnDetail['savedTurns']>[number];

/**
 * What a chat's turns are looked up by. The thread asks for each turn's input, time and message id, and each of those
 * searched the chat's saved turns and runs from the start, so a chat of 2,000 turns did about 24 million comparisons
 * to list itself. One pass builds the lookups; the first saved turn or run of a number wins, as `find` did.
 */
type TurnIndex = {
  runs: TurnDetail['runs'];
  savedTurns: TurnDetail['savedTurns'];
  runCount: number;
  savedCount: number;
  saved: Map<number, SavedTurn>;
  firstRun: Map<number, Run>;
  firstRunWithInput: Map<number, Run>;
};
const indexes = new WeakMap<object, TurnIndex>();

function indexOf(detail: TurnDetail): TurnIndex {
  const known = indexes.get(detail);
  if (known && known.runs === detail.runs && known.savedTurns === detail.savedTurns
    && known.runCount === detail.runs.length && known.savedCount === (detail.savedTurns?.length ?? 0)) return known;
  const saved = new Map<number, SavedTurn>();
  for (const turn of detail.savedTurns ?? []) if (!saved.has(turn.localRevision)) saved.set(turn.localRevision, turn);
  const firstRun = new Map<number, Run>();
  const firstRunWithInput = new Map<number, Run>();
  for (const run of detail.runs) {
    const revision = run.snapshot.inputRevision ?? 0;
    if (!firstRun.has(revision)) firstRun.set(revision, run);
    if (run.snapshot.input && !firstRunWithInput.has(revision)) firstRunWithInput.set(revision, run);
  }
  const built: TurnIndex = { runs: detail.runs, savedTurns: detail.savedTurns, runCount: detail.runs.length, savedCount: detail.savedTurns?.length ?? 0, saved, firstRun, firstRunWithInput };
  indexes.set(detail, built);
  return built;
}

/** New durable turns and recoverable legacy snapshots share local aliases without inventing lost messages. */
export function chatTurnRevisions(detail: TurnDetail): number[] {
  const index = indexOf(detail);
  const sortKeys = new Map<number, { createdAt: string; messageId: string }>();
  const revisions = [...new Set([0, detail.task.inputRevision ?? 0, ...index.firstRun.keys(), ...index.saved.keys()])]
    .filter(revision => Boolean(chatTurnInput(detail, revision)?.brief) || index.firstRun.has(revision));
  for (const revision of revisions) sortKeys.set(revision, { createdAt: chatTurnCreatedAt(detail, revision), messageId: chatTurnMessageId(detail, revision) });
  return revisions.sort((first, second) => sortKeys.get(first)!.createdAt.localeCompare(sortKeys.get(second)!.createdAt)
    || sortKeys.get(first)!.messageId.localeCompare(sortKeys.get(second)!.messageId));
}

export function chatTurnInput(detail: TurnDetail, revision: number): RunInput | undefined {
  const index = indexOf(detail);
  const saved = index.saved.get(revision);
  if (saved) return saved.input;
  if (revision === (detail.task.inputRevision ?? 0) && detail.task.currentInput) return detail.task.currentInput;
  return index.firstRunWithInput.get(revision)?.snapshot.input
    ?? (revision === 0 && (detail.task.inputRevision ?? 0) === 0 ? { brief: detail.task.brief, sourceIds: detail.task.sourceIds, excludedSources: detail.task.excludedSources } : undefined);
}

export function chatTurnMessageId(detail: TurnDetail, revision: number): string {
  return indexOf(detail).saved.get(revision)?.id ?? turnMessageId(detail.task.id, revision, detail.task.turnIds);
}

/** Authored timestamps are immutable on durable turns; legacy snapshots keep their observed run time. */
export function chatTurnCreatedAt(detail: TurnDetail, revision: number): string {
  const index = indexOf(detail);
  return index.saved.get(revision)?.createdAt
    ?? index.firstRun.get(revision)?.startedAt
    ?? detail.task.createdAt;
}
