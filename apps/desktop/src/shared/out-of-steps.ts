import type { Run } from './contracts';

/**
 * Whether the person can press Continue under this run's answer (COD-257): a solo chat's run (a side thread or a
 * schedule's chat included) that handed in its best answer because its steps ran out. The next turn then starts with
 * this run's tool calls and results. A run with a folder is left out: its changes reached the folder or wait for
 * review, and a new run's working copy would not hold what the old run's calls and results describe.
 */
export function canContinueRun(run: Run): boolean {
  return run.status === 'completed' && run.outOfSteps === true && run.stage === undefined
    && !run.snapshot.workspaceGrant && run.snapshot.worker.provider !== 'demo';
}
