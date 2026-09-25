import { isLocalApi, isPlanApi, type Run, type Task, type Worker } from '../../shared/contracts';
import { isHarness } from '../../shared/harness';
import { connectionPricing, findCustomConnection, isCustomProvider } from '../../shared/custom-connections';
import { readCustomConnections } from '../storage/custom-connections';
import { pendingDecision, runningListsTask, type RunningCost, type RunningItem, type RunWaitReason } from '../../shared/running';
import type { Store } from '../storage/database';
import type { TeamWait } from './crew-waits';
import type { SlotWait } from './slots';

/** What the runners know that the database does not: which runs are live, and who waits for what. */
export type RunningRuntime = {
  activeRun(runId: string): { since: number; paused: boolean } | undefined;
  slotWaits(): readonly SlotWait[];
  teamWaits(taskId: string): readonly TeamWait[];
};

const BUSY_TASK_STATUSES: readonly Task['status'][] = ['queued', 'running', 'pausing'];
const FINISHED_RUN_STATUSES: readonly Run['status'][] = ['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'waiting_input'];

/**
 * Every run that is working, waiting its turn or stopped at a checkpoint, across all chats (COD-244). A chat is
 * listed exactly when the sidebar draws it as working or waiting (`RUNNING_TASK_STATUSES`), and a listed chat
 * always has at least one item, so the two can never disagree.
 */
export function runningView(store: Store, runtime: RunningRuntime): RunningItem[] {
  const slotWaits = new Map(runtime.slotWaits().map(wait => [wait.runId, wait]));
  const items: RunningItem[] = [];
  for (const task of listedTasks(store)) {
    const runs = runsOf(store, task.id);
    const taskItems = BUSY_TASK_STATUSES.includes(task.status)
      ? busyItems(store, task, runs, runtime, slotWaits)
      : [stoppedItem(store, task, runs)];
    items.push(...taskItems);
  }
  return items.sort(compareItems);
}

function listedTasks(store: Store): Task[] {
  return store.all<Task>('tasks').filter(runningListsTask);
}

function runsOf(store: Store, taskId: string): Run[] {
  return store.db.prepare('SELECT data FROM runs WHERE task_id=? ORDER BY rowid').all(taskId).map(row => JSON.parse(String(row.data)) as Run);
}

/** A chat whose turn is under way: its live runs, the runs held back behind them, and a new message waiting its turn. */
function busyItems(store: Store, task: Task, runs: Run[], runtime: RunningRuntime, slotWaits: Map<string, SlotWait>): RunningItem[] {
  const items: RunningItem[] = [];
  const teamWaits = runtime.teamWaits(task.id);
  const revision = task.inputRevision ?? 0;
  const listedRunIds = new Set<string>();
  for (const run of runs) {
    const active = runtime.activeRun(run.id);
    if (!active) continue;
    listedRunIds.add(run.id);
    const slotWait = slotWaits.get(run.id);
    if (slotWait) {
      items.push(queuedItem(task, run.snapshot.worker, run, { kind: 'provider', provider: run.snapshot.worker.provider, ahead: slotWait.ahead }, slotWait.since));
      continue;
    }
    const pausing = task.status === 'pausing' || active.paused;
    items.push({ ...baseItem(task, run.snapshot.worker, run), state: pausing ? 'pausing' : 'running', since: active.since, cost: runCost(store, run), lastEvent: lastEvent(store, run.id) });
  }
  for (const wait of teamWaits) {
    const run = wait.runId ? runs.find(candidate => candidate.id === wait.runId) : undefined;
    if (run && (listedRunIds.has(run.id) || FINISHED_RUN_STATUSES.includes(run.status))) continue;
    if (run) listedRunIds.add(run.id);
    items.push(queuedItem(task, wait.worker, run, wait.reason, wait.since));
  }
  for (const run of runs) {
    if (listedRunIds.has(run.id) || run.status !== 'queued' || (run.snapshot.inputRevision ?? 0) !== revision) continue;
    items.push(queuedItem(task, run.snapshot.worker, run, { kind: 'starting' }, Date.parse(run.startedAt)));
  }
  if (task.pendingStart) items.push(queuedItem(task, chatWorker(store, task, runs), undefined, { kind: 'previous_turn' }));
  // A busy chat always has a line here, so the sidebar's working mark never points at an empty list.
  if (!items.length) items.push(queuedItem(task, chatWorker(store, task, runs), runs.at(-1), { kind: 'starting' }));
  return items;
}

/**
 * A chat stopped at a checkpoint or at its budget waits for one decision, so it is one line: the run that stopped,
 * or failing that the newest run of the turn.
 */
function stoppedItem(store: Store, task: Task, runs: Run[]): RunningItem {
  const decision = pendingDecision(task);
  if (task.status === 'waiting_input' && decision) return decisionItem(store, task, runs, decision);
  const revision = task.inputRevision ?? 0;
  const turn = runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
  const stopped = turn.find(run => run.status === 'waiting_budget')
    ?? turn.find(run => run.status === 'paused' && hasCheckpoint(store, run.id))
    ?? turn.find(run => run.status === 'paused')
    ?? turn.at(-1)
    ?? runs.at(-1);
  const worker = stopped?.snapshot.worker ?? chatWorker(store, task, runs);
  if (task.status === 'waiting_budget') return queuedItem(task, worker, stopped, { kind: 'budget' });
  return { ...baseItem(task, worker, stopped), state: 'paused', ...(task.pauseReason ? { pauseReason: task.pauseReason } : {}) };
}

/** A chat stopped on a question or an MCP approval: the run that asked, waiting for the person's answer. */
function decisionItem(store: Store, task: Task, runs: Run[], decision: NonNullable<ReturnType<typeof pendingDecision>>): RunningItem {
  const asking = runs.find(run => run.id === decision.runId) ?? runs.at(-1);
  const worker = asking?.snapshot.worker ?? chatWorker(store, task, runs);
  const wait: RunWaitReason = decision.approval
    ? { kind: 'approval', tool: decision.approval.tool, server: decision.approval.serverName }
    : { kind: 'answer' };
  return { ...baseItem(task, worker, asking), state: 'paused', wait, since: Date.parse(decision.requestedAt) };
}

function baseItem(task: Task, worker: Worker, run: Run | undefined): Omit<RunningItem, 'state'> {
  return {
    key: run?.id ?? `${task.id}:${worker.id}`,
    ...(run ? { runId: run.id } : {}),
    taskId: task.id,
    worker,
    ...(run?.stage ? { stage: run.stage } : {}),
    provider: worker.provider,
  };
}

function queuedItem(task: Task, worker: Worker, run: Run | undefined, wait: RunWaitReason, since?: number): RunningItem {
  return { ...baseItem(task, worker, run), state: 'queued', wait, ...(since !== undefined && Number.isFinite(since) ? { since } : {}) };
}

/** The orglet a chat belongs to when no run says so: the newest run's, else the chat's own orglet or lead. */
function chatWorker(store: Store, task: Task, runs: Run[]): Worker {
  const latest = runs.at(-1);
  if (latest) return latest.snapshot.worker;
  return store.get<Worker>('workers', task.workerId);
}

function hasCheckpoint(store: Store, runId: string): boolean {
  return !!store.db.prepare('SELECT 1 FROM checkpoints WHERE id=?').get(runId);
}

function lastEvent(store: Store, runId: string): string | undefined {
  const row = store.db.prepare('SELECT data FROM events WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(runId);
  if (!row) return undefined;
  return (JSON.parse(String(row.data)) as { message: string }).message;
}

/**
 * What a running run has cost so far, only from what was recorded: the ledger for a paid API or a custom connection
 * with a known price (at least that much while a request's cost is unknown), the CLI's own reports for a harness,
 * nothing for Demo or Ollama. A plan-billed API, a custom connection with no known price, or a harness that has not
 * reported yet stays unknown rather than reading as $0.
 */
export function runCost(store: Store, run: Run): RunningCost {
  const provider = run.snapshot.worker.provider;
  if (provider === 'demo' || isLocalApi(provider)) return { micros: 0, atLeast: false };
  if (isPlanApi(provider)) return null;
  if (isHarness(provider)) return harnessCost(store, run.id);
  if (isCustomProvider(provider) && !customPriceKnown(store, provider)) return null;
  return ledgerCost(store, run.id);
}

/** A custom connection has a price when one was entered or it is a local, free server (COD-242). */
function customPriceKnown(store: Store, provider: string): boolean {
  const connection = findCustomConnection(readCustomConnections(store), provider);
  if (!connection) return false;
  return connectionPricing(connection).kind !== 'unknown';
}

function harnessCost(store: Store, runId: string): RunningCost {
  const row = store.db.prepare(`SELECT json_extract(data,'$.harnessCostMicros') AS cost, json_extract(data,'$.harnessCallsWithoutCost') AS missing
    FROM checkpoints WHERE id=?`).get(runId);
  const reported = row?.cost === null || row?.cost === undefined ? undefined : Number(row.cost);
  const missing = row?.missing === null || row?.missing === undefined ? 0 : Number(row.missing);
  if (reported === undefined && !missing) return null;
  return { micros: reported ?? 0, atLeast: missing > 0 };
}

function ledgerCost(store: Store, runId: string): RunningCost {
  const row = store.db.prepare(`SELECT COALESCE(SUM(l.amount),0) AS charged, COALESCE(SUM(CASE WHEN r.state='unknown' THEN 1 ELSE 0 END),0) AS uncertain
    FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id WHERE r.run_id=?`).get(runId)!;
  const charged = Number(row.charged);
  const uncertain = Number(row.uncertain) > 0;
  // Nothing settled and something unknown is not "at least $0": it is simply not known.
  if (uncertain && charged === 0) return null;
  return { micros: charged, atLeast: uncertain };
}

const stateOrder: Record<RunningItem['state'], number> = { running: 0, pausing: 0, queued: 1, paused: 2 };

/** Working first, then the line in the order it will move, then what waits for the person. */
function compareItems(first: RunningItem, second: RunningItem): number {
  const byState = stateOrder[first.state] - stateOrder[second.state];
  if (byState) return byState;
  const byWait = waitRank(first.wait) - waitRank(second.wait);
  if (byWait) return byWait;
  const byAhead = aheadOf(first.wait) - aheadOf(second.wait);
  if (byAhead) return byAhead;
  return (first.since ?? Number.MAX_SAFE_INTEGER) - (second.since ?? Number.MAX_SAFE_INTEGER);
}

const waitOrder: Record<RunWaitReason['kind'], number> = { starting: 0, provider: 1, crew_slot: 2, group_turn: 3, teammates: 4, plan: 5, members: 6, previous_turn: 7, budget: 8, approval: 9, answer: 10 };

function waitRank(wait: RunWaitReason | undefined): number {
  return wait ? waitOrder[wait.kind] : 0;
}

function aheadOf(wait: RunWaitReason | undefined): number {
  if (wait && 'ahead' in wait) return wait.ahead;
  return 0;
}
