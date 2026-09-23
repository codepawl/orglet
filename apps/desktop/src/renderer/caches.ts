import { ProviderId, type TaskDetail, type Workspace } from '../shared/contracts';
import type { ModelListResult } from '../shared/models';
import type { PackageReview } from '../shared/skill-package';
import type { WorkspaceDiff } from '../shared/workspace-diff';
import type { WorkspaceGrantView } from '../shared/workspace-access';
import type { AboutInfo, Changelog, UpdateState } from '../shared/updates';
import { SessionCache } from './prefetch';
import { orglet } from './api';

/**
 * What the renderer keeps for the session, one cache per kind of thing a click opens (COD-218). Each is filled by
 * a hover, a focus or an earlier open, and read first when the thing opens, so the pane is never empty. What the
 * core knows better is asked again behind the kept copy where it matters; see each caller.
 */

/** A chat's detail, keyed by task id. Opening a chat draws this at once and fetches the fresh copy behind it. */
export const taskDetails = new SessionCache<TaskDetail>({ load: id => orglet.call('task', { id }), limit: 20 });

/** A chat's folder grant, keyed by task id. Dropped on every workspace change: a grant can change under it. */
export const taskGrants = new SessionCache<WorkspaceGrantView | null>({ load: taskId => orglet.call('workspaceAccess', { taskId }), limit: 20 });

/** A provider's model list, keyed by provider id. The core keeps its own day-long copy; this only spares the round trip. */
export const modelLists = new SessionCache<ModelListResult>({ load: provider => orglet.call('modelList', { provider: ProviderId.parse(provider) }), limit: 12 });

/** An imported skill package's review, keyed by `skillId:hash`, which pins it to one immutable package. */
export const skillReviews = new SessionCache<PackageReview>({ load: key => orglet.call('inspectSkill', { id: key.split(':')[0] }), limit: 10 });

/** What one run changed, keyed by `taskId:runId`. Dropped on every workspace change, since integration moves the copy. */
export const workspaceDiffs = new SessionCache<WorkspaceDiff>({
  load: key => {
    const [taskId, runId] = key.split(':');
    return orglet.call('workspaceDiff', { taskId, runId });
  },
  limit: 10,
});

/** The text of a source, keyed by `taskId:sourceId:hash`; the hash makes the entry immutable. Media is never kept. */
export const sourcePreviews = new SessionCache<string>({
  load: key => {
    const [taskId, id] = key.split(':');
    return orglet.call('previewSource', { taskId, id }).then(result => result.text);
  },
  limit: 8,
});

/** One entry each, under this key: the running build, the release list and the updater's state. */
export const APP_KEY = 'app';
export const aboutInfo = new SessionCache<AboutInfo>({ load: () => orglet.about(), limit: 1 });
// A failed fetch is a list too: the About tab shows the failure rather than the shape of a list forever.
export const changelogs = new SessionCache<Changelog>({
  load: () => orglet.changelog(false).catch((error: Error) => ({ releases: [], fetchedAt: null, stale: true, error: error.message })),
  limit: 1,
});
export const updateStates = new SessionCache<UpdateState>({ load: () => orglet.updateState(), limit: 1 });

/** Everything the About tab shows, asked for together when the pointer rests on the way there. */
export function dwellAbout(resting: boolean): void {
  aboutInfo.dwell(APP_KEY, resting);
  changelogs.dwell(APP_KEY, resting);
  updateStates.dwell(APP_KEY, resting);
}

/** Everything a chat needs when it opens: its detail and its folder grant. */
export function dwellChat(taskId: string, resting: boolean): void {
  taskDetails.dwell(taskId, resting);
  taskGrants.dwell(taskId, resting);
}

/** The model list a worker's prompt bar and dialog draw; Demo has none. */
export function dwellModels(provider: ProviderId, resting: boolean): void {
  if (provider === 'demo') return;
  modelLists.dwell(provider, resting);
}

/**
 * Whether a kept chat still describes the row the workspace lists: the same result, input and status. A row that
 * changed drops its kept detail, so a prefetched copy of an older answer is never the first thing drawn.
 */
export function detailMatchesRow(detail: TaskDetail, row: Workspace['tasks'][number] | undefined): boolean {
  if (!row) return false;
  const kept = detail.task;
  return kept.status === row.status
    && kept.inputRevision === row.inputRevision
    && kept.lastArtifactId === row.lastArtifactId
    && kept.archivedAt === row.archivedAt
    && kept.deletedAt === row.deletedAt;
}

/** Follows a workspace that just arrived: kept chats that changed go, and every grant goes. */
export function followWorkspace(workspace: Workspace): void {
  const rows = new Map(workspace.tasks.map(task => [task.id, task]));
  taskDetails.prune((id, detail) => detailMatchesRow(detail, rows.get(id)));
  taskGrants.invalidate();
  workspaceDiffs.invalidate();
}
