import type { RunStage, Task, Worker } from './contracts';
import type { DecisionRequest } from './work-decisions';

/**
 * Why a run has not started, or has stopped short of its answer (COD-244). Each reason is a place where the core
 * really holds work back today; none of them is guessed from a status.
 */
export type RunWaitReason =
  /** Waiting for a request slot of this provider (Settings → requests at once per provider). */
  | { kind: 'provider'; provider: Worker['provider']; ahead: number }
  /** A crew member or the combining step waiting for the lead to hand out the work. */
  | { kind: 'plan' }
  /** A crew member whose assignment needs these teammates' results first. */
  | { kind: 'teammates'; names: string[] }
  /** A crew member waiting for one of the crew's member slots. */
  | { kind: 'crew_slot'; ahead: number }
  /** The crew's combining step waiting for the members to finish. */
  | { kind: 'members' }
  /** An orglet in a group chat waiting for the ones before it to answer. */
  | { kind: 'group_turn'; ahead: number }
  /** A new message waiting for the turn still running in the same chat to stop. */
  | { kind: 'previous_turn' }
  /** Stopped at the chat's limit per task; it goes on only after the limit is raised and the chat resumed. */
  | { kind: 'budget' }
  /** Stopped until the person allows or refuses one MCP tool call (COD-241); the answer resumes the same run. */
  | { kind: 'approval'; tool: string; server: string }
  /** Stopped until the person answers a question the orglet asked; the answer resumes the same run. */
  | { kind: 'answer' }
  /** Created and about to start; nothing is holding it back. */
  | { kind: 'starting' };

export type RunningState = 'running' | 'pausing' | 'queued' | 'paused';

/** Money a run has cost so far. `atLeast` when some request's cost is not known; null when nothing is known. */
export type RunningCost = { micros: number; atLeast: boolean } | null;

/** One run in the Running view: running now, waiting its turn, or stopped at a checkpoint. */
export type RunningItem = {
  /** The run's id, or `taskId:workerId` for a group-chat turn whose run is not created yet. */
  key: string;
  runId?: string;
  taskId: string;
  state: RunningState;
  /** What a queued item waits for, or what a stopped one waits for the person to do. */
  wait?: RunWaitReason;
  /** A paused chat that stopped because the crew's work hours ended. */
  pauseReason?: 'shift';
  /** The orglet as the run froze it. */
  worker: Worker;
  stage?: RunStage;
  provider: Worker['provider'];
  /** When it started running, or started waiting, in milliseconds since the epoch; absent when not known. */
  since?: number;
  /** Only for running items; a queued run has not spent anything. */
  cost?: RunningCost;
  /** The newest line the run recorded, for runs that do not stream their steps. */
  lastEvent?: string;
};

/** Task statuses the Running view lists, the same ones the sidebar draws as working or waiting. */
export const RUNNING_TASK_STATUSES = ['queued', 'running', 'pausing', 'paused', 'waiting_budget'] as const;

/** The question or MCP approval this turn stopped on, still unanswered; the answer resumes the same run. */
export function pendingDecision(task: Pick<Task, 'decisionRequests' | 'inputRevision'>): DecisionRequest | undefined {
  const revision = task.inputRevision ?? 0;
  return task.decisionRequests?.find(request => request.inputRevision === revision && !request.answer && !request.interruptedAt);
}

/**
 * Whether the Running view lists a chat: while it works, waits in line or is stopped at a checkpoint, and while it
 * waits for the person's answer to a question or an MCP approval (`waiting_input` with an open request). A chat
 * waiting for input for any other reason, such as evidence a review asked for, has no run to go back to.
 */
export function runningListsTask(task: Pick<Task, 'status' | 'deletedAt' | 'decisionRequests' | 'inputRevision'>): boolean {
  if (task.deletedAt) return false;
  const statuses: readonly string[] = RUNNING_TASK_STATUSES;
  if (statuses.includes(task.status)) return true;
  return task.status === 'waiting_input' && pendingDecision(task) !== undefined;
}

/**
 * How many items are under way or will start on their own: the count on the footer button. A paused chat and a
 * chat stopped at its budget wait for the person, so they are listed but not counted.
 */
export function runningCount(items: readonly RunningItem[]): number {
  return items.filter(item => item.state !== 'paused' && item.wait?.kind !== 'budget').length;
}
