import type { Artifact, Run } from './contracts';

/** Display only the latest attempt for each logical assignment in one turn. */
export function teamProgress(runs: Run[], artifacts: Pick<Artifact, 'runId'>[]) {
  const assignments = new Map<string, Run>();
  for (const run of runs) {
    if (run.stage === 'member' && run.snapshot.assignment) {
      assignments.set(run.snapshot.assignment.workerId, run);
    }
  }
  return [...assignments.values()].filter(run => run.status !== 'completed').map(run => {
    const waitingFor = (run.snapshot.assignment?.dependsOn ?? []).filter(workerId => {
      const prerequisite = assignments.get(workerId);
      return !prerequisite || prerequisite.status !== 'completed'
        || !artifacts.some(artifact => artifact.runId === prerequisite.id);
    }).map(workerId => assignments.get(workerId)?.snapshot.worker.name ?? workerId);
    return { run, waitingFor };
  });
}
