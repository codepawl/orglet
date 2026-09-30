import type { Run, Task, TaskStatus, Worker } from '../shared/contracts';
import { chatKindOf, connectionOf, durationBucket, isFinishedOutcome, stepCountBucket, type AnalyticsEvent } from '../shared/analytics';
import type { Store } from './storage/database';

/**
 * The analytics events only the core can describe (COD-344): a turn the person sent and a run that ended. Each is
 * built from ids and enums the store already holds, never from the chat's text, names or files. The core posts them
 * to main, which drops them unless the person is signed in with analytics on.
 */

/** The commands through which the person sends a message into a chat. */
export const TURN_COMMANDS = new Set(['createTask', 'reviseTask', 'startSideThread']);

/** The chat a turn command went to: the new chat's id for a create, the named chat's otherwise. */
export function turnTaskId(command: string, args: unknown, result: unknown): string | undefined {
  if (command === 'reviseTask') return (args as { taskId?: string }).taskId;
  return typeof result === 'string' ? result : undefined;
}

export function turnSentEvent(store: Store, taskId: string, now: Date): AnalyticsEvent | undefined {
  try {
    const task = store.get<Task>('tasks', taskId);
    const worker = store.get<Worker>('workers', task.workerId);
    return {
      name: 'chat_turn_sent',
      at: now.toISOString(),
      props: { chatKind: chatKindOf(task), ...connectionOf(worker.provider, worker.modelId) },
    };
  } catch {
    return undefined;
  }
}

/** A run that reached an end state; a run still going, paused or waiting on the person has no event yet. */
export function runFinishedEvent(store: Store, taskId: string, runId: string, status: TaskStatus, now: Date): AnalyticsEvent | undefined {
  if (!isFinishedOutcome(status)) return undefined;
  try {
    const task = store.get<Task>('tasks', taskId);
    const run = store.get<Run>('runs', runId);
    const started = Date.parse(run.startedAt);
    const duration = Number.isFinite(started) ? now.getTime() - started : 0;
    return {
      name: 'run_finished',
      at: now.toISOString(),
      props: { outcome: status, durationBucket: durationBucket(duration), stepCountBucket: stepCountBucket(toolCallCount(store, runId)), chatKind: chatKindOf(task) },
    };
  } catch {
    return undefined;
  }
}

function toolCallCount(store: Store, runId: string): number {
  const row = store.db.prepare('SELECT COUNT(*) AS count FROM tool_calls WHERE run_id=?').get(runId);
  return Number(row?.count ?? 0);
}
