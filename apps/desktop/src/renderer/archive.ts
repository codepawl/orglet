/**
 * What Settings → Lưu trữ lists (COD-375). Pure: no state, no bridge calls.
 *
 * Archived things used to hang off the sidebar as three collapsible lists. People look at them rarely, so they moved
 * into Settings and the sidebar keeps its room for what is used. Everything archived is grouped by what it is:
 * orglets, channels (a crew archived before crews became channels is one too), and chats of every other kind.
 * Restoring an item returns it to the sidebar section it came from, so no group remembers a section.
 */
import { archivedChatKind, type ArchivedChatKind } from './sidebarChats';

type ChatRow = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown };
type EntityRow = { id: string; archivedAt?: string };

export type ArchiveGroupId = 'orglets' | 'channels' | 'chats';

/** One archived thing: an orglet, a crew that is still archived as one (shown as a channel), or a chat of some kind. */
export type ArchiveEntry<Worker extends EntityRow, Team extends EntityRow, Task extends ChatRow> =
  | { type: 'worker'; id: string; archivedAt: string; worker: Worker }
  | { type: 'team'; id: string; archivedAt: string; team: Team }
  | { type: 'chat'; id: string; archivedAt: string; task: Task; kind: ArchivedChatKind };

export type ArchiveGroup<Worker extends EntityRow, Team extends EntityRow, Task extends ChatRow> = { id: ArchiveGroupId; entries: ArchiveEntry<Worker, Team, Task>[] };

/** The groups in the order Settings shows them; a group with nothing in it is left out. */
export const archiveGroupOrder: readonly ArchiveGroupId[] = ['orglets', 'channels', 'chats'];

/** Which group an archived chat belongs to: a channel's own chat is a channel, everything else is a chat. */
export function archiveGroupOfChat(kind: ArchivedChatKind): ArchiveGroupId {
  return kind === 'channel' ? 'channels' : 'chats';
}

const newestFirst = (first: { archivedAt: string }, second: { archivedAt: string }) => second.archivedAt.localeCompare(first.archivedAt);

/** Everything archived and not yet deleted, grouped, most recently archived first inside each group. */
export function archiveGroups<Worker extends EntityRow, Team extends EntityRow, Task extends ChatRow>(
  source: { workers: readonly Worker[]; teams: readonly Team[]; tasks: readonly Task[] },
): ArchiveGroup<Worker, Team, Task>[] {
  const orglets: ArchiveEntry<Worker, Team, Task>[] = source.workers
    .filter(worker => worker.archivedAt)
    .map(worker => ({ type: 'worker' as const, id: worker.id, archivedAt: worker.archivedAt!, worker }));
  const crews: ArchiveEntry<Worker, Team, Task>[] = source.teams
    .filter(team => team.archivedAt)
    .map(team => ({ type: 'team' as const, id: team.id, archivedAt: team.archivedAt!, team }));
  const chats: ArchiveEntry<Worker, Team, Task>[] = source.tasks
    .filter(task => task.archivedAt && !task.deletedAt)
    .map(task => ({ type: 'chat' as const, id: task.id, archivedAt: task.archivedAt!, task, kind: archivedChatKind(task) }));
  const byGroup: Record<ArchiveGroupId, ArchiveEntry<Worker, Team, Task>[]> = {
    orglets,
    channels: [...crews, ...chats.filter(entry => entry.type === 'chat' && archiveGroupOfChat(entry.kind) === 'channels')],
    chats: chats.filter(entry => entry.type === 'chat' && archiveGroupOfChat(entry.kind) === 'chats'),
  };
  return archiveGroupOrder
    .map(id => ({ id, entries: [...byGroup[id]].sort(newestFirst) }))
    .filter(group => group.entries.length > 0);
}
