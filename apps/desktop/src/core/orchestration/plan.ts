import { TeamPlan, INVALID_PLAN_ERROR, type Team } from '../../shared/contracts';

export { UNASSIGNED_PLAN_ERROR, MISSING_PLAN_ERROR, INVALID_PLAN_ERROR } from '../../shared/contracts';

/** Demo and fail-closed default: every member gets this turn's user brief. Never invents extra workers. */
export function defaultTeamPlan(team: Team, brief: string) {
  return TeamPlan.parse({ assignments: team.memberIds.map(workerId => ({ workerId, brief })), note: 'Giao tất cả thành viên.' });
}

/** Rejects unknown ids. Does not add missing members. */
export function assertTeamPlan(team: Team, plan: unknown) {
  const parsed = TeamPlan.parse(plan);
  for (const assignment of parsed.assignments) {
    if (!team.memberIds.includes(assignment.workerId)) throw new Error(INVALID_PLAN_ERROR);
  }
  return parsed;
}
