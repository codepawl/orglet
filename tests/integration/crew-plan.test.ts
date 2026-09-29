import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Team, TeamPlan, Worker } from '../../apps/desktop/src/shared/contracts';
import { crewPlanDiagram } from '../../apps/desktop/src/shared/crew-plan';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { store.close(); });

function worker(name: string): Worker {
  return { ...store.all<Worker>('workers')[0], id: id(), name };
}

function run(stage: Run['stage'], who: Worker, status: Run['status'], extra: Partial<Run['snapshot']> = {}): Run {
  return { id: id(), taskId: 'crew-task', stage, status, startedAt: now(), error: null,
    snapshot: { worker: who, skill: store.all<Skill>('skills')[0], ...extra } };
}

/** A crew turn: the lead's plan run with the plan on it, one member run per crew member, and the combining run. */
function crewTurn({ members, lead, workflow, plan, statuses = {}, combineStatus = 'queued' }: {
  members: Worker[]; lead: Worker; workflow: Team['workflow']; plan: TeamPlan;
  statuses?: Record<string, Run['status']>; combineStatus?: Run['status'];
}) {
  const team = { ...store.all<Team>('teams')[0], memberIds: members.map(member => member.id), synthesizerId: lead.id, workflow };
  const planRun = run('plan', lead, 'completed', { team, plan });
  const memberRuns = members.map(member => {
    const assignment = plan.assignments.find(item => item.workerId === member.id);
    return run('member', member, statuses[member.name] ?? 'queued', assignment ? { team, assignment } : { team });
  });
  const combineRun = run('synthesis', lead, combineStatus, { team });
  return { planRun, memberRuns, combineRun, runs: [planRun, ...memberRuns, combineRun] };
}

const names = (rows: { worker: Worker }[][]) => rows.map(row => row.map(step => step.worker.name));

describe('crew plan diagram', () => {
  it('puts a parallel crew without dependencies side by side, each with its own brief and state', () => {
    const lead = worker('Lead');
    const [research, write, check] = [worker('Research'), worker('Write'), worker('Check')];
    const { runs, memberRuns } = crewTurn({ members: [research, write, check], lead, workflow: 'parallel',
      plan: { assignments: [
        { workerId: check.id, brief: 'Check the\n  numbers' },
        { workerId: research.id, brief: 'Find sources' },
        { workerId: write.id, brief: 'Draft the post' },
      ], note: 'Three  parts', synthesisBrief: 'Keep it short' },
      statuses: { Research: 'completed', Write: 'running', Check: 'queued' } });
    const diagram = crewPlanDiagram(runs, [{ runId: memberRuns[0].id }])!;
    expect(diagram.shape).toBe('side_by_side');
    expect(diagram.memberCount).toBe(3);
    // The crew's member order, as the team runner takes them, not the order the lead listed them in.
    expect(names(diagram.rows)).toEqual([['Research', 'Write', 'Check']]);
    expect(diagram.rows[0].map(step => step.state)).toEqual(['done', 'working', 'waiting']);
    expect(diagram.rows[0][2].summary).toBe('Check the numbers');
    expect(diagram.rows[0][2].waitingFor).toEqual([]);
    expect(diagram.lead).toMatchObject({ role: 'lead', summary: 'Three parts', state: 'done' });
    expect(diagram.combine).toMatchObject({ role: 'combine', summary: 'Keep it short', state: 'waiting' });
  });

  it('chains a sequential crew in member order, moved only by a dependency, and waits on every member before', () => {
    const lead = worker('Lead');
    const [outline, draft, review] = [worker('Outline'), worker('Draft'), worker('Review')];
    const { runs, memberRuns } = crewTurn({ members: [outline, draft, review], lead, workflow: 'sequential',
      plan: { assignments: [
        { workerId: outline.id, brief: 'Outline', dependsOn: [review.id] },
        { workerId: draft.id, brief: 'Draft' },
        { workerId: review.id, brief: 'Review' },
      ] },
      statuses: { Outline: 'queued', Draft: 'completed', Review: 'running' } });
    const diagram = crewPlanDiagram(runs, [{ runId: memberRuns[1].id }])!;
    expect(diagram.shape).toBe('one_after_another');
    expect(names(diagram.rows)).toEqual([['Draft'], ['Review'], ['Outline']]);
    expect(diagram.rows[2][0].waitingFor).toEqual(['Review']);
    expect(diagram.lead.summary).toBe('');
    expect(diagram.combine.summary).toBe('');
  });

  it('draws a parallel crew with dependencies as rows by the longest chain before each member', () => {
    const lead = worker('Lead');
    const [first, second, third, fourth] = [worker('First'), worker('Second'), worker('Third'), worker('Fourth')];
    const { runs } = crewTurn({ members: [first, second, third, fourth], lead, workflow: 'parallel',
      plan: { assignments: [
        { workerId: first.id, brief: 'One' },
        { workerId: second.id, brief: 'Two' },
        { workerId: third.id, brief: 'Three', dependsOn: [first.id] },
        { workerId: fourth.id, brief: 'Four', dependsOn: [third.id, second.id] },
      ] },
      statuses: { First: 'failed', Second: 'completed', Third: 'interrupted' }, combineStatus: 'completed' });
    const diagram = crewPlanDiagram(runs, [])!;
    expect(diagram.shape).toBe('mixed');
    expect(names(diagram.rows)).toEqual([['First', 'Second'], ['Third'], ['Fourth']]);
    expect(diagram.rows.flat().map(step => step.state)).toEqual(['failed', 'done', 'failed', 'waiting']);
    // A completed run without a saved result has not delivered, the way the team runner counts it.
    expect(diagram.rows[1][0].waitingFor).toEqual(['First']);
    expect(diagram.rows[2][0].waitingFor).toEqual(['Third', 'Second']);
    expect(diagram.combine.state).toBe('done');
  });

  it('shows the orglet that took over a reassigned part, and maps stopped and paused runs', () => {
    const lead = worker('Lead');
    const [original, other] = [worker('Original'), worker('Other')];
    const { runs, memberRuns } = crewTurn({ members: [original, other], lead, workflow: 'parallel',
      plan: { assignments: [{ workerId: original.id, brief: 'Part one' }, { workerId: other.id, brief: 'Part two' }] },
      statuses: { Original: 'failed', Other: 'cancelled' }, combineStatus: 'paused' });
    const replacement = run('member', worker('Replacement'), 'running', { assignment: memberRuns[0].snapshot.assignment });
    const diagram = crewPlanDiagram([...runs, replacement], [])!;
    expect(diagram.rows[0][0]).toMatchObject({ id: replacement.id, state: 'working', summary: 'Part one' });
    expect(diagram.rows[0][0].worker.name).toBe('Replacement');
    expect(diagram.rows[0][1].state).toBe('stopped');
    expect(diagram.combine.state).toBe('paused');
  });

  it('draws nothing without a saved plan of at least two parts and every run it needs', () => {
    const lead = worker('Lead');
    const [first, second] = [worker('First'), worker('Second')];
    const plan: TeamPlan = { assignments: [{ workerId: first.id, brief: 'One' }, { workerId: second.id, brief: 'Two' }] };
    const turn = crewTurn({ members: [first, second], lead, workflow: 'parallel', plan });
    expect(crewPlanDiagram(turn.runs, [])).toBeDefined();
    // Still planning, or a plan that failed: the plan run carries no plan.
    const planning = { ...turn.planRun, status: 'running' as const, snapshot: { ...turn.planRun.snapshot, plan: undefined } };
    expect(crewPlanDiagram([planning, ...turn.memberRuns, turn.combineRun], [])).toBeUndefined();
    // One part is not a flow.
    const single = crewTurn({ members: [first, second], lead, workflow: 'parallel', plan: { assignments: [{ workerId: first.id, brief: 'One' }] } });
    expect(crewPlanDiagram(single.runs, [])).toBeUndefined();
    // No combining run, or a part without its member run.
    expect(crewPlanDiagram([turn.planRun, ...turn.memberRuns], [])).toBeUndefined();
    expect(crewPlanDiagram([turn.planRun, turn.memberRuns[0], turn.combineRun], [])).toBeUndefined();
    // A group chat's runs and a solo chat's run have no plan.
    expect(crewPlanDiagram([run('group', first, 'completed'), run('group', second, 'running')], [])).toBeUndefined();
    expect(crewPlanDiagram([run(undefined, first, 'completed')], [])).toBeUndefined();
  });
});
