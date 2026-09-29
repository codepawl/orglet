import type { Run, Worker } from '../../shared/contracts';
import type { RunWaitReason } from '../../shared/running';

/** A crew or group-chat run the team runner is holding back, and why (COD-244). */
export type TeamWait = { runId?: string; worker: Worker; reason: RunWaitReason; since: number };

type PendingAssignment = { workerId: string; dependsOn?: string[] };

/**
 * What the crew's queued members and its combining step wait for while a batch of members runs: an assignment
 * whose teammates have not delivered waits for them by name, every other one waits for a member slot in the
 * order the crew will take it, and the combining step waits for the members. In a sequential crew each member works
 * from the results of every member before it (COD-257), so `sequentialOrder`, the plan's member order, makes those
 * earlier members its teammates to wait for, the way `dependsOn` does in a parallel crew.
 */
export function crewWaits(pending: readonly PendingAssignment[], delivered: ReadonlySet<string>, runs: ReadonlyMap<string, Run>, synthesis: Run, since: number, sequentialOrder?: readonly string[]): TeamWait[] {
  const waits: TeamWait[] = [];
  let ahead = 0;
  for (const assignment of pending) {
    const run = runs.get(assignment.workerId);
    if (!run) continue;
    const before = sequentialOrder ? sequentialOrder.slice(0, Math.max(0, sequentialOrder.indexOf(assignment.workerId))) : [];
    const missing = [...new Set([...before, ...(assignment.dependsOn ?? [])])].filter(workerId => !delivered.has(workerId));
    if (missing.length) {
      const names = missing.map(workerId => runs.get(workerId)?.snapshot.worker.name ?? workerId);
      waits.push({ runId: run.id, worker: run.snapshot.worker, reason: { kind: 'teammates', names }, since });
      continue;
    }
    waits.push({ runId: run.id, worker: run.snapshot.worker, reason: { kind: 'crew_slot', ahead }, since });
    ahead++;
  }
  waits.push({ runId: synthesis.id, worker: synthesis.snapshot.worker, reason: { kind: 'members' }, since });
  return waits;
}

/** Before the lead has handed out the work, every member and the combining step wait for the plan. */
export function planWaits(members: Iterable<Run>, synthesis: Run, since: number): TeamWait[] {
  const waits: TeamWait[] = [];
  for (const run of members) {
    if (run.status !== 'queued') continue;
    waits.push({ runId: run.id, worker: run.snapshot.worker, reason: { kind: 'plan' }, since });
  }
  waits.push({ runId: synthesis.id, worker: synthesis.snapshot.worker, reason: { kind: 'plan' }, since });
  return waits;
}

/** In a group chat the orglets answer one after another; the ones still to come wait for those before them. */
export function groupWaits(waiting: readonly Worker[], runIdOf: (worker: Worker) => string | undefined, since: number): TeamWait[] {
  return waiting.map((worker, ahead) => ({ runId: runIdOf(worker), worker, reason: { kind: 'group_turn', ahead }, since }));
}
