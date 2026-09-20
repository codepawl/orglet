import { PlanAssignment, type Run, type TeamPlan } from '../../shared/contracts';
import { Store } from '../storage/database';

type Assignment = TeamPlan['assignments'][number];

/** The original plan owner identifies the assignment even when its current worker changes. */
export const assignmentKey = (run: Run): string => run.snapshot.assignment?.workerId ?? run.snapshot.worker.id;

/** Resource ownership is conservative on every platform, including case-insensitive Windows paths. */
export function resourcesOverlap(first: Assignment, second: Assignment): boolean {
  return (first.writeResources ?? []).some(left => (second.writeResources ?? []).some(right => {
    const firstPath = left.toLowerCase();
    const secondPath = right.toLowerCase();
    return firstPath === secondPath || firstPath.startsWith(`${secondPath}/`) || secondPath.startsWith(`${firstPath}/`);
  }));
}

export function validateDependencies(plan: TeamPlan): void {
  const remaining = new Map(plan.assignments.map(assignment => [assignment.workerId, assignment]));
  for (const assignment of remaining.values()) {
    if (assignment.dependsOn?.some(workerId => workerId === assignment.workerId || !remaining.has(workerId))) {
      throw new Error('Phụ thuộc phải trỏ tới phần việc khác trong cùng kế hoạch.');
    }
  }
  while (remaining.size) {
    const ready = [...remaining.values()].filter(assignment => (assignment.dependsOn ?? []).every(workerId => !remaining.has(workerId)));
    if (!ready.length) throw new Error('Phân việc có phụ thuộc vòng.');
    for (const assignment of ready) remaining.delete(assignment.workerId);
  }
}

/** Single local core; ownership survives in the run snapshot and is acquired under SQLite's write transaction. */
export function claimAssignment(store: Store, run: Run, rawAssignment: Assignment): Run {
  const assignment = PlanAssignment.parse(rawAssignment);
  return store.transaction(() => {
    const current = store.get<Run>('runs', run.id);
    if (current.stage !== 'member' || current.snapshot.worker.id !== assignment.workerId) {
      throw new Error('Người nhận không khớp phần việc.');
    }
    const revision = current.snapshot.inputRevision ?? 0;
    const detail = store.detail(current.taskId);
    if ((detail.task.inputRevision ?? 0) !== revision || !['queued', 'paused', 'interrupted', 'waiting_budget'].includes(current.status)) {
      throw new Error('Phần việc không còn ở trạng thái có thể nhận.');
    }
    const siblings = detail.runs.filter(candidate =>
      candidate.stage === 'member' && (candidate.snapshot.inputRevision ?? 0) === revision);
    if (siblings.some(candidate =>
      (assignmentKey(candidate) === assignment.workerId && ['running', 'completed'].includes(candidate.status)) ||
      (candidate.snapshot.worker.id === current.snapshot.worker.id && candidate.status === 'running') ||
      (candidate.status === 'running' && candidate.snapshot.assignment && resourcesOverlap(assignment, candidate.snapshot.assignment)))) {
      throw new Error('Phần việc hoặc tài nguyên đang có người phụ trách.');
    }
    if (assignment.dependsOn?.some(workerId => !siblings.some(candidate => assignmentKey(candidate) === workerId
      && candidate.status === 'completed' && detail.artifacts.some(artifact => artifact.runId === candidate.id)))) {
      throw new Error('Phần việc đang chờ kết quả từ phần việc chưa hoàn tất.');
    }
    const claimed: Run = { ...current, status: 'running', snapshot: { ...current.snapshot, assignment } };
    store.update('runs', claimed);
    return claimed;
  });
}
