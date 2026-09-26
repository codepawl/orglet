import type { Activity, Run } from './contracts';

/**
 * The run a paused crew turn stopped after (COD-287): the one whose step came last before the pause. A crew creates
 * its plan, member and combining runs together when the turn starts, each with one line saying so, and a pause
 * marks every run still waiting as paused too. So neither the newest run nor a paused status says who worked last:
 * the combining step used to sign a turn that paused after one member's step. A run that did work has a line after
 * its first one; the turn stopped after the run that wrote the latest of those. Undefined when nobody had started.
 */
export function pausedAfter(runs: readonly Run[], events: readonly Activity[]): Run | undefined {
  const turnRuns = new Map(runs.map(run => [run.id, run]));
  const linesSeen = new Map<string, number>();
  let latest: Run | undefined;
  for (const event of events) {
    const run = turnRuns.get(event.runId);
    if (!run) continue;
    const position = (linesSeen.get(run.id) ?? 0) + 1;
    linesSeen.set(run.id, position);
    const sequence = event.sequence ?? position;
    if (sequence > 1) latest = run;
  }
  return latest;
}
