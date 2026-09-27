import type { Task, Team, Worker, Workspace } from '../shared/contracts';
import type { SelectOption } from './components/Select';

/** The settings the chat header's menu offers first: the orglet's own, the crew's, or none for a group chat. */
export type ChatSettingsTarget = { kind: 'worker'; worker: Worker } | { kind: 'team'; team: Team };

/**
 * Whose settings the chat header's ⋯ opens under "Thiết lập Tí" / "Thiết lập hội" (COD-293). The header used to offer
 * only the chat's own settings (name, who it is assigned to, its limit), so a newcomer looking for the orglet's model
 * found a task form. An open chat is read from its row: a crew's chat opens the crew, a chat with one orglet (its main
 * chat or a side thread) opens that orglet, and a chat several orglets share opens neither. An empty chat is read from
 * what is being opened.
 */
export function chatSettingsTarget(
  open: { task?: Pick<Task, 'teamId' | 'assignees' | 'workerId'>; worker?: Worker; team?: Team; group?: boolean },
  workspace: Pick<Workspace, 'workers' | 'teams'>,
): ChatSettingsTarget | undefined {
  const { task } = open;
  if (task) {
    if (task.teamId) {
      const team = workspace.teams.find(item => item.id === task.teamId);
      return team ? { kind: 'team', team } : undefined;
    }
    const sharedByMany = task.assignees === 'all' || (Array.isArray(task.assignees) && task.assignees.length > 1);
    if (sharedByMany) return undefined;
    const workerId = Array.isArray(task.assignees) && task.assignees.length === 1 ? task.assignees[0] : task.workerId;
    const worker = workspace.workers.find(item => item.id === workerId);
    return worker ? { kind: 'worker', worker } : undefined;
  }
  if (open.team) return { kind: 'team', team: open.team };
  if (open.group) return undefined;
  return open.worker ? { kind: 'worker', worker: open.worker } : undefined;
}

/**
 * The orglet "Kết nối model" sets up in a chat that still runs on Demo: the crew's lead when it is on Demo, otherwise
 * the first orglet on Demo in the chat's order. None when every orglet already has a real model.
 */
export function demoWorkerToConnect(workers: readonly Worker[], team?: Pick<Team, 'synthesizerId'>): Worker | undefined {
  const onDemo = workers.filter(worker => worker.provider === 'demo');
  const lead = team ? onDemo.find(worker => worker.id === team.synthesizerId) : undefined;
  return lead ?? onDemo[0];
}

/**
 * Where "Kết nối model" leads (COD-293). With a connection that can run already there (a saved key, a signed-in
 * harness, a custom connection), the orglet's settings open on the Model field with it chosen. With nothing but Demo,
 * Settings opens on API connections to add one first, and closing Settings comes back to the orglet's settings.
 */
export function connectModelStep(providerOptions: readonly SelectOption[]): 'orglet' | 'settings' {
  const canRun = providerOptions.some(option => option.value !== 'demo' && !option.dimmed);
  return canRun ? 'orglet' : 'settings';
}
