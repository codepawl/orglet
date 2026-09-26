import type { Task, TaskDetail, Workspace } from '../shared/contracts';
import type { WorkspaceGrantView } from '../shared/workspace-access';
import type { WorkspaceRecoveryView } from '../shared/workspace-recovery';

/**
 * What the open chat's own reads came back with during a refresh: its detail, its folder grant and its working-copy
 * recovery. They go out beside the workspace, but each is settled on its own, so a chat that was archived, deleted
 * or erased since can never hold the workspace back (COD-282: after Delete chat history the sidebar kept listing
 * the deleted threads, and every click added a Problems entry, until a reload).
 */
export type OpenChatReads = {
  detail: PromiseSettledResult<TaskDetail>;
  grant: PromiseSettledResult<WorkspaceGrantView | null>;
  recovery: PromiseSettledResult<WorkspaceRecoveryView>;
};

/** What a refresh does with the open chat once the fresh workspace is in. */
export type OpenChatRefresh =
  /** The workspace no longer lists the chat: it was deleted or erased, so the view leaves it. */
  | { gone: true }
  | {
    gone: false;
    /** Absent when the read failed; the copy on screen stays. */
    detail?: TaskDetail;
    /** `null` is no folder; absent is not known yet. */
    grant: WorkspaceGrantView | null | undefined;
    recovery?: WorkspaceRecoveryView;
    /** The first read that failed for a reason worth showing. */
    error?: string;
  };

/**
 * Sorts the open chat's reads against the workspace that arrived with them. A chat the workspace does not list is
 * gone, and nothing about it is an error. An archived chat has no folder to use, and the core refuses to read its
 * grant: that refusal is expected, so the grant is simply none and the refusal is not shown.
 */
export function openChatRefresh(taskId: string, tasks: readonly Pick<Task, 'id' | 'archivedAt'>[], reads: OpenChatReads): OpenChatRefresh {
  const row = tasks.find(task => task.id === taskId);
  if (!row) return { gone: true };
  const archived = Boolean(row.archivedAt);
  const detail = reads.detail.status === 'fulfilled' ? reads.detail.value : undefined;
  const recovery = reads.recovery.status === 'fulfilled' ? reads.recovery.value : undefined;
  let grant: WorkspaceGrantView | null | undefined;
  if (archived) grant = null;
  else if (reads.grant.status === 'fulfilled') grant = reads.grant.value;
  const worthShowing = archived ? [reads.detail, reads.recovery] : [reads.detail, reads.grant, reads.recovery];
  const failed = worthShowing.find((read): read is PromiseRejectedResult => read.status === 'rejected');
  const error = failed ? messageOf(failed.reason) : undefined;
  return { gone: false, detail, grant, recovery, ...(error ? { error } : {}) };
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The orglet or crew whose main chat stands in for a chat that is gone. */
export type ChatDestination = { kind: 'worker' | 'team'; id: string };

/**
 * Where the view goes when the open chat disappears: its crew's or its orglet's main chat while that one is still
 * listed (a side thread lands in its orglet's main chat, a group chat with the orglet that owns its row), otherwise
 * the first orglet, then the first crew. Nothing is left only when the workspace has neither.
 */
export function closedChatDestination(closed: Pick<Task, 'workerId' | 'teamId'> | undefined, workspace: Pick<Workspace, 'workers' | 'teams'>): ChatDestination | undefined {
  if (closed?.teamId && workspace.teams.some(team => team.id === closed.teamId)) return { kind: 'team', id: closed.teamId };
  if (closed?.workerId && workspace.workers.some(worker => worker.id === closed.workerId)) return { kind: 'worker', id: closed.workerId };
  const firstWorker = workspace.workers[0];
  if (firstWorker) return { kind: 'worker', id: firstWorker.id };
  const firstTeam = workspace.teams[0];
  if (firstTeam) return { kind: 'team', id: firstTeam.id };
  return undefined;
}

/** The orglet or crew a chat belongs to, when it was archived or deleted since the chat started. */
export type ClosedOwner = { kind: 'worker' | 'team'; id: string; name: string; state: 'archived' | 'deleted' };

/** Why the open chat takes no new message. `undefined` from `chatClosure` means it does. */
export type ChatClosure = { archived: boolean; owner?: ClosedOwner };

/**
 * Whether the open chat is read-only, and why: the chat itself was archived, or the one orglet or crew it belongs
 * to was archived or deleted. A group chat has no single owner and is left to the core. A deleted owner is named
 * from the chat's own record (the crew it froze, the orglet its latest run used), since the workspace no longer
 * lists it.
 */
export function chatClosure(detail: Pick<TaskDetail, 'task' | 'runs'>, workspace: Pick<Workspace, 'workers' | 'teams' | 'archivedWorkers' | 'archivedTeams'>): ChatClosure | undefined {
  const owner = closedOwnerOf(detail, workspace);
  const archived = Boolean(detail.task.archivedAt);
  if (!archived && !owner) return undefined;
  return { archived, ...(owner ? { owner } : {}) };
}

function closedOwnerOf(detail: Pick<TaskDetail, 'task' | 'runs'>, workspace: Pick<Workspace, 'workers' | 'teams' | 'archivedWorkers' | 'archivedTeams'>): ClosedOwner | undefined {
  const { task } = detail;
  if (task.teamId) {
    if (workspace.teams.some(team => team.id === task.teamId)) return undefined;
    const archivedTeam = workspace.archivedTeams.find(team => team.id === task.teamId);
    if (archivedTeam) return { kind: 'team', id: archivedTeam.id, name: archivedTeam.name, state: 'archived' };
    const frozenName = task.teamSnapshot?.name ?? detail.runs.findLast(run => run.snapshot.team)?.snapshot.team?.name;
    return { kind: 'team', id: task.teamId, name: frozenName ?? '', state: 'deleted' };
  }
  if (task.assignees) return undefined;
  if (workspace.workers.some(worker => worker.id === task.workerId)) return undefined;
  const archivedWorker = workspace.archivedWorkers.find(worker => worker.id === task.workerId);
  if (archivedWorker) return { kind: 'worker', id: archivedWorker.id, name: archivedWorker.name, state: 'archived' };
  const lastRunName = detail.runs.findLast(run => run.snapshot.worker.id === task.workerId)?.snapshot.worker.name;
  return { kind: 'worker', id: task.workerId, name: lastRunName ?? '', state: 'deleted' };
}
