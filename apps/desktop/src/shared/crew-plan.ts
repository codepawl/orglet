import type { Artifact, Run, TaskStatus, TeamPlan, Worker } from './contracts';

/** Where one step of a crew turn stands, from its run's status. */
export type CrewStepState = 'waiting' | 'working' | 'done' | 'failed' | 'stopped' | 'paused' | 'needs_you';

/**
 * One box of the flow diagram: the orglet doing the step, the task it was given (or the lead's own note), and the run's
 * status as the core recorded it. `waitingFor` names the teammates whose results this step still needs.
 */
export type CrewStep = {
  id: string;
  role: 'lead' | 'member' | 'combine';
  worker: Worker;
  summary: string;
  status: TaskStatus;
  state: CrewStepState;
  waitingFor: string[];
};

/** How the members' rows read: all side by side, one after another, or both. */
export type CrewPlanShape = 'side_by_side' | 'one_after_another' | 'mixed';

/**
 * A crew turn as a flow (COD-331): the lead splits the work, the members' rows run top to bottom, and the lead combines
 * the results. Members in one row can work at the same time; a row starts from the rows above it.
 */
export type CrewPlanDiagram = {
  lead: CrewStep;
  rows: CrewStep[][];
  combine: CrewStep;
  shape: CrewPlanShape;
  memberCount: number;
};

type Assignment = TeamPlan['assignments'][number];

/** The plan owner identifies an assignment even after the lead handed it to another orglet. */
function assignmentOwner(run: Run): string {
  return run.snapshot.assignment?.workerId ?? run.snapshot.worker.id;
}

function stateOf(status: TaskStatus): CrewStepState {
  if (status === 'queued') return 'waiting';
  if (status === 'running' || status === 'pausing') return 'working';
  if (status === 'completed' || status === 'partial') return 'done';
  if (status === 'failed' || status === 'interrupted') return 'failed';
  if (status === 'cancelled') return 'stopped';
  if (status === 'waiting_input') return 'needs_you';
  return 'paused';
}

/** Whitespace folded to single spaces, so a brief written over several lines reads as one line in its box. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The assignments in the order the crew takes them: its member order, as the team runner does. */
function orderedAssignments(plan: TeamPlan, memberIds: readonly string[] | undefined): Assignment[] {
  if (!memberIds) return [...plan.assignments];
  const ordered = memberIds.map(workerId => plan.assignments.find(assignment => assignment.workerId === workerId)).filter(assignment => assignment !== undefined);
  const outside = plan.assignments.filter(assignment => !memberIds.includes(assignment.workerId));
  return [...ordered, ...outside];
}

/**
 * A sequential crew runs one member at a time: the first one in member order whose dependencies have run. Each member is
 * its own row. An assignment left waiting on something outside the plan goes last, in order.
 */
function sequentialRows(assignments: readonly Assignment[]): Assignment[][] {
  const pending = [...assignments];
  const placed = new Set<string>();
  const rows: Assignment[][] = [];
  while (pending.length) {
    const readyIndex = pending.findIndex(assignment => (assignment.dependsOn ?? []).every(workerId => placed.has(workerId)));
    const [next] = pending.splice(readyIndex === -1 ? 0 : readyIndex, 1);
    placed.add(next.workerId);
    rows.push([next]);
  }
  return rows;
}

/**
 * A parallel crew runs every assignment whose dependencies have delivered, so an assignment's row is the length of its
 * longest chain of dependencies. Without any, every member shares the first row.
 */
function parallelRows(assignments: readonly Assignment[]): Assignment[][] {
  const byOwner = new Map(assignments.map(assignment => [assignment.workerId, assignment]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (assignment: Assignment): number => {
    const known = depths.get(assignment.workerId);
    if (known !== undefined) return known;
    // The core refuses a plan with a cycle; this only keeps a damaged saved plan from recursing forever.
    if (visiting.has(assignment.workerId)) return 0;
    visiting.add(assignment.workerId);
    const prerequisites = (assignment.dependsOn ?? []).map(workerId => byOwner.get(workerId)).filter(prerequisite => prerequisite !== undefined);
    const depth = prerequisites.length ? Math.max(...prerequisites.map(depthOf)) + 1 : 0;
    visiting.delete(assignment.workerId);
    depths.set(assignment.workerId, depth);
    return depth;
  };
  const rows: Assignment[][] = [];
  for (const assignment of assignments) {
    const depth = depthOf(assignment);
    while (rows.length <= depth) rows.push([]);
    rows[depth].push(assignment);
  }
  return rows.filter(row => row.length > 0);
}

function shapeOf(rows: readonly unknown[][]): CrewPlanShape {
  if (rows.length === 1) return 'side_by_side';
  if (rows.every(row => row.length === 1)) return 'one_after_another';
  return 'mixed';
}

/**
 * The flow diagram of one crew turn, built only from what the core saved for it: the lead's plan on its plan run, each
 * assignment's latest member run (a reassigned one shows the orglet that took it over), and the combining run. Nothing
 * is drawn for a turn without a saved plan (still planning, a failed plan, an older run, a group chat), for a plan
 * with fewer than two assignments, or when a run the plan needs is missing.
 */
export function crewPlanDiagram(runs: readonly Run[], artifacts: readonly Pick<Artifact, 'runId'>[]): CrewPlanDiagram | undefined {
  const planRun = runs.findLast(run => run.stage === 'plan' && run.snapshot.plan !== undefined);
  const combineRun = runs.findLast(run => run.stage === 'synthesis');
  const plan = planRun?.snapshot.plan;
  if (!planRun || !plan || !combineRun || plan.assignments.length < 2) return undefined;
  const latestRuns = new Map<string, Run>();
  for (const run of runs) if (run.stage === 'member') latestRuns.set(assignmentOwner(run), run);
  const assignments = orderedAssignments(plan, planRun.snapshot.team?.memberIds);
  if (assignments.some(assignment => !latestRuns.has(assignment.workerId))) return undefined;
  const sequential = planRun.snapshot.team?.workflow === 'sequential';
  const assignmentRows = sequential ? sequentialRows(assignments) : parallelRows(assignments);
  const chainOrder = assignmentRows.flat().map(assignment => assignment.workerId);
  const delivered = (workerId: string) => {
    const run = latestRuns.get(workerId);
    return run?.status === 'completed' && artifacts.some(artifact => artifact.runId === run.id);
  };
  const memberStep = (assignment: Assignment): CrewStep => {
    const run = latestRuns.get(assignment.workerId)!;
    const state = stateOf(run.status);
    // A sequential member works from every member before it, as the team runner hands their results on.
    const before = sequential ? chainOrder.slice(0, chainOrder.indexOf(assignment.workerId)) : [];
    const prerequisites = [...new Set([...before, ...(assignment.dependsOn ?? [])])];
    const waitingFor = state === 'done' || state === 'working' ? [] : prerequisites
      .filter(workerId => !delivered(workerId))
      .map(workerId => latestRuns.get(workerId)?.snapshot.worker.name ?? workerId);
    return { id: run.id, role: 'member', worker: run.snapshot.worker, summary: oneLine(assignment.brief), status: run.status, state, waitingFor };
  };
  const rows = assignmentRows.map(row => row.map(memberStep));
  const leadStep = (run: Run, role: 'lead' | 'combine', summary: string): CrewStep =>
    ({ id: run.id, role, worker: run.snapshot.worker, summary, status: run.status, state: stateOf(run.status), waitingFor: [] });
  return {
    lead: leadStep(planRun, 'lead', oneLine(plan.note)),
    rows,
    combine: leadStep(combineRun, 'combine', oneLine(plan.synthesisBrief)),
    shape: shapeOf(rows),
    memberCount: assignments.length,
  };
}
