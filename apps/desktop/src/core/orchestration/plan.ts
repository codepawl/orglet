import { validateDependencies } from './assignments';
import { TeamPlan, INVALID_PLAN_ERROR, type Team } from '../../shared/contracts';
import { mentionedPeople, type MentionPerson } from '../../shared/mentions';

export { UNASSIGNED_PLAN_ERROR, MISSING_PLAN_ERROR, INVALID_PLAN_ERROR } from '../../shared/contracts';

type Assignment = TeamPlan['assignments'][number];

/**
 * Demo and fail-closed default: tagged members, or every member when nobody in the roster was @mentioned. Never invents
 * extra workers. Tags are read from `ownText`, the person's own words, which leaves out a forwarded message (COD-257).
 */
export function defaultTeamPlan(team: Team, brief: string, members: readonly MentionPerson[] = [], ownText = brief) {
  const tagged = members.length ? mentionedPeople(ownText, members, [team.name]) : undefined;
  const assigned = tagged?.length ? team.memberIds.filter(workerId => tagged.some(member => member.id === workerId)) : team.memberIds;
  const workerIds = assigned.length ? assigned : team.memberIds;
  return TeamPlan.parse({
    assignments: workerIds.map(workerId => ({ workerId, brief, expectedOutput: brief.slice(0, 2000), dependsOn: [], writeResources: [] })),
    note: tagged?.length && workerIds.length < team.memberIds.length ? 'Giao các thành viên được gắn thẻ.' : 'Giao tất cả thành viên.',
  });
}

/** Rejects unknown ids. Does not add missing members. */
export function assertTeamPlan(team: Team, plan: unknown) {
  const parsed = TeamPlan.parse(plan);
  for (const assignment of parsed.assignments) {
    if (!team.memberIds.includes(assignment.workerId)) throw new Error(INVALID_PLAN_ERROR);
  }
  validateDependencies(parsed);
  return { ...parsed, assignments: parsed.assignments.map(assignment => ({
    ...assignment,
    expectedOutput: assignment.expectedOutput ?? assignment.brief.slice(0, 2000),
    dependsOn: assignment.dependsOn ?? [],
    writeResources: assignment.writeResources ?? [],
  })) };
}

/**
 * The lead's member job is the combining step when it waits for every other assignment, nobody waits for it and it
 * owns no files: that is exactly what the synthesis run does after the members finish, so running it as a member
 * would produce the final answer twice (COD-185). The lead keeps a member job for distinct work of its own.
 */
export function isCombiningAssignment(team: Team, plan: TeamPlan, assignment: Assignment): boolean {
  if (assignment.workerId !== team.synthesizerId) return false;
  if (assignment.writeResources?.length) return false;
  const others = plan.assignments.filter(other => other.workerId !== assignment.workerId);
  if (!others.length) return false;
  const waitsForEveryOther = others.every(other => assignment.dependsOn?.includes(other.workerId));
  const somebodyWaitsForIt = others.some(other => other.dependsOn?.includes(assignment.workerId));
  return waitsForEveryOther && !somebodyWaitsForIt;
}

/** Moves the lead's combining job out of the member assignments and into the plan's synthesis brief. */
export function foldCombiningAssignment(team: Team, plan: TeamPlan): { plan: TeamPlan; folded?: Assignment } {
  const folded = plan.assignments.find(assignment => isCombiningAssignment(team, plan, assignment));
  if (!folded) return { plan };
  const foldedBrief = folded.expectedOutput && folded.expectedOutput !== folded.brief.slice(0, 2000)
    ? `${folded.brief}\nExpected output: ${folded.expectedOutput}`
    : folded.brief;
  const synthesisBrief = [plan.synthesisBrief, foldedBrief].filter(Boolean).join('\n').slice(0, 4000);
  return {
    plan: { ...plan, assignments: plan.assignments.filter(assignment => assignment !== folded), synthesisBrief },
    folded,
  };
}
