import { TeamPlan, INVALID_PLAN_ERROR, type Team } from '../../shared/contracts';
import { mentionedPeople, type MentionPerson } from '../../shared/mentions';

export { UNASSIGNED_PLAN_ERROR, MISSING_PLAN_ERROR, INVALID_PLAN_ERROR } from '../../shared/contracts';

/** Demo and fail-closed default: tagged members, or every member when nobody in the roster was @mentioned. Never invents extra workers. */
export function defaultTeamPlan(team: Team, brief: string, members: readonly MentionPerson[] = []) {
  const tagged = members.length ? mentionedPeople(brief, members, [team.name]) : undefined;
  const assigned = tagged?.length ? team.memberIds.filter(workerId => tagged.some(member => member.id === workerId)) : team.memberIds;
  const workerIds = assigned.length ? assigned : team.memberIds;
  return TeamPlan.parse({
    assignments: workerIds.map(workerId => ({ workerId, brief })),
    note: tagged?.length && workerIds.length < team.memberIds.length ? 'Giao các thành viên được gắn thẻ.' : 'Giao tất cả thành viên.',
  });
}

/** Rejects unknown ids. Does not add missing members. */
export function assertTeamPlan(team: Team, plan: unknown) {
  const parsed = TeamPlan.parse(plan);
  for (const assignment of parsed.assignments) {
    if (!team.memberIds.includes(assignment.workerId)) throw new Error(INVALID_PLAN_ERROR);
  }
  return parsed;
}
