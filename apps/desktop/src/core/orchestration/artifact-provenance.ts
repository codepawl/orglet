import type { Artifact, Run } from '../../shared/contracts';
import { assignmentKey } from './assignments';

/** Authorship comes from the saved attempt that produced the artifact, not the original plan owner. */
export function savedArtifactContext(artifacts: Artifact[], runs: Run[]) {
  return artifacts.map(artifact => {
    const attempt = runs.find(run => run.id === artifact.runId);
    return {
      artifactId: artifact.id,
      runId: artifact.runId,
      assignmentWorkerId: attempt?.stage === 'member' ? assignmentKey(attempt) : null,
      completedBy: attempt ? { workerId: attempt.snapshot.worker.id, workerName: attempt.snapshot.worker.name } : null,
      report: artifact.report,
    };
  });
}

export function savedAssignmentAttempts(assignmentWorkerId: string, runs: Run[], artifacts: Artifact[]) {
  return runs.filter(run => run.stage === 'member' && assignmentKey(run) === assignmentWorkerId).map(run => {
    const artifact = artifacts.find(item => item.runId === run.id);
    return {
      runId: run.id,
      workerId: run.snapshot.worker.id,
      workerName: run.snapshot.worker.name,
      status: run.status,
      error: run.error,
      artifactId: artifact?.id ?? null,
      reportSummary: artifact?.report.summary.slice(0, 2000) ?? null,
      limitations: artifact?.report.limitations.slice(0, 10) ?? [],
    };
  });
}
