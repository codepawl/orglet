import type { Store } from '../storage/database';
import type { Routine, Task } from '../../shared/contracts';

/**
 * A daily cost cap per schedule (COD-288). Every run a routine starts records the local day it belongs to
 * (`Task.routineDay`, in the schedule's time zone), and what the runs of one day cost is read from the ledger: settled
 * charges, plus money still held or of unknown cost at the amount held. A run started at 23:50 belongs to that day
 * even when it spends past midnight, and a message the person sends later in a run's chat counts on the run's day.
 */

/** A task a routine started that is still going or waiting for the person; the routine's next run waits for it. */
export const UNFINISHED_TASK_STATUSES: readonly Task['status'][] = ['queued', 'running', 'pausing', 'paused', 'interrupted', 'waiting_budget', 'waiting_input'];

type RunCost = { status: Task['status']; budgetMicros: number; usedMicros: number };

/** Every run a routine started on one local day, with what each one charged or still holds. */
function runCostsOfDay(store: Store, routineId: string, day: string): RunCost[] {
  const rows = store.db.prepare(`SELECT json_extract(t.data,'$.status') AS status, json_extract(t.data,'$.budgetMicros') AS budget,
      (SELECT COALESCE(SUM(CASE WHEN r.state='settled' THEN COALESCE(l.amount,0) ELSE r.amount END),0)
        FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id WHERE r.task_id=t.id) AS used
    FROM tasks t WHERE json_extract(t.data,'$.routineId')=? AND json_extract(t.data,'$.routineDay')=?`).all(routineId, day);
  return rows.map(row => ({ status: String(row.status) as Task['status'], budgetMicros: Number(row.budget), usedMicros: Number(row.used) }));
}

/** What a routine's runs of one day cost so far: settled charges plus what is still held or unknown. */
export function spentOnDay(store: Store, routineId: string, day: string): number {
  let total = 0;
  for (const run of runCostsOfDay(store, routineId, day)) total += run.usedMicros;
  return total;
}

/**
 * Each routine's runs and spend on its own current day, read in one pass for the workspace view: `days` maps a
 * routine to the day it is in now, in its time zone.
 */
export function daysSoFar(store: Store, days: Record<string, string>): Record<string, { runs: number; spentMicros: number }> {
  const totals: Record<string, { runs: number; spentMicros: number }> = {};
  for (const routineId of Object.keys(days)) totals[routineId] = { runs: 0, spentMicros: 0 };
  const distinctDays = [...new Set(Object.values(days))];
  if (!distinctDays.length) return totals;
  const placeholders = distinctDays.map(() => '?').join(',');
  const rows = store.db.prepare(`SELECT json_extract(t.data,'$.routineId') AS routineId, json_extract(t.data,'$.routineDay') AS day,
      (SELECT COALESCE(SUM(CASE WHEN r.state='settled' THEN COALESCE(l.amount,0) ELSE r.amount END),0)
        FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id WHERE r.task_id=t.id) AS used
    FROM tasks t WHERE json_extract(t.data,'$.routineDay') IN (${placeholders})`).all(...distinctDays);
  for (const row of rows) {
    const routineId = String(row.routineId);
    if (days[routineId] !== String(row.day)) continue;
    totals[routineId].runs += 1;
    totals[routineId].spentMicros += Number(row.used);
  }
  return totals;
}

/**
 * What a routine's runs of one day may still come to: a run that is still going counts at its whole limit, since it
 * may spend up to it, and a finished one at what it charged or holds.
 */
function committedOnDay(store: Store, routineId: string, day: string): number {
  let total = 0;
  for (const run of runCostsOfDay(store, routineId, day)) {
    const stillGoing = UNFINISHED_TASK_STATUSES.includes(run.status);
    total += stillGoing ? Math.max(run.usedMicros, run.budgetMicros) : run.usedMicros;
  }
  return total;
}

/**
 * Whether one more run with this limit fits under the schedule's cap for that day. A run is admitted only when its
 * whole limit fits, so the day's runs never cost more than the cap, and a run never stops half-way for the cap.
 */
export function fitsDailyCap(store: Store, routine: Pick<Routine, 'id' | 'schedule'>, day: string, budgetMicros: number): boolean {
  const cap = routine.schedule.dailyCapMicros;
  if (cap === undefined) return true;
  return committedOnDay(store, routine.id, day) + budgetMicros <= cap;
}

/** The cap and the day a schedule's run counts against, when the task is one and its schedule has a cap. */
export function dailyCapOfTask(store: Store, taskId: string): { routineId: string; day: string; capMicros: number } | undefined {
  const task = store.db.prepare(`SELECT json_extract(data,'$.routineId') AS routineId, json_extract(data,'$.routineDay') AS day FROM tasks WHERE id=?`).get(taskId);
  if (!task?.routineId || !task.day) return undefined;
  const routine = store.db.prepare(`SELECT json_extract(data,'$.schedule.dailyCapMicros') AS cap FROM routines WHERE id=?`).get(String(task.routineId));
  if (routine?.cap === null || routine?.cap === undefined) return undefined;
  return { routineId: String(task.routineId), day: String(task.day), capMicros: Number(routine.cap) };
}
