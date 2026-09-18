import type { Task, Team, Worker, Workspace } from '../shared/contracts';

/** Members then synthesizer, de-duplicated, in team order. */
export function teamRoster(team: Pick<Team, 'memberIds' | 'synthesizerId'>, workers: readonly Worker[]): Worker[] {
  return [...new Set([...team.memberIds, team.synthesizerId])]
    .map(id => workers.find(worker => worker.id === id))
    .filter((worker): worker is Worker => Boolean(worker));
}

/** Workers who answer a task: a team's roles, the group chat's workers ('all' means every worker), or the single worker. */
export function taskWorkers(task: Pick<Task, 'teamId' | 'assignees' | 'workerId'>, workspace: Pick<Workspace, 'workers' | 'teams'>) {
  const team = task.teamId ? workspace.teams.find(item => item.id === task.teamId) : undefined;
  if (team) return teamRoster(team, workspace.workers);
  if (task.assignees === 'all') return workspace.workers;
  if (task.assignees?.length) return workspace.workers.filter(worker => task.assignees!.includes(worker.id));
  return workspace.workers.filter(worker => worker.id === task.workerId);
}

/** Short name for who a task is assigned to, for headers. */
export function assigneeLabel(task: Pick<Task, 'teamId' | 'assignees' | 'workerId'>, workspace: Pick<Workspace, 'workers' | 'teams'>, labels: { all: string; many: (count: number) => string }) {
  if (task.teamId) return workspace.teams.find(item => item.id === task.teamId)?.name;
  if (task.assignees === 'all') return labels.all;
  const workers = taskWorkers(task, workspace);
  return workers.length > 1 ? labels.many(workers.length) : workers[0]?.name;
}
