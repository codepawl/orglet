import { channelOrgletIds, isChannelChat, type ChannelMember, type EmptyChannel } from '../shared/channels';
import { newChatKey } from '../shared/live-task';
import type { SidebarSelection } from './sidebarSelection';

/**
 * Channels in the window (COD-361), the renderer's side of `shared/channels.ts`. Pure: no state, no bridge calls.
 *
 * A channel created and not written in yet is an `EmptyChannel` from the workspace; on screen it is the empty chat of
 * the orglets its members expand to, the way a group chat used to be before its first message (COD-215). Its first
 * message creates the row with `channelId`, and from then on it is an ordinary chat row with a `channel` record.
 */
export type OpenEmptyChannel = { channelId: string; name: string; topic?: string; members: ChannelMember[]; workerIds: string[] };

type Roster = { workers: readonly { id: string }[]; teams: readonly { id: string; memberIds: readonly string[]; synthesizerId: string }[] };

/** The empty channel on screen, or undefined once it is gone or nobody in it can answer. */
export function openEmptyChannel(channelId: string | undefined, channels: readonly EmptyChannel[], roster: Roster): OpenEmptyChannel | undefined {
  if (!channelId) return undefined;
  const channel = channels.find(item => item.id === channelId);
  if (!channel) return undefined;
  const workerIds = channelOrgletIds(channel.members, roster);
  if (!workerIds.length) return undefined;
  return { channelId: channel.id, name: channel.name, ...(channel.topic ? { topic: channel.topic } : {}), members: channel.members, workerIds };
}

/** Where the empty channel's permissions and folder wait before its first message: under the orglets that answer. */
export function emptyChannelKey(channel: Pick<OpenEmptyChannel, 'workerIds'>): string {
  return newChatKey({ workerIds: channel.workerIds });
}

/** The `createTask` input for the first message; the core expands the members again and keeps its own answer. */
export function channelTaskInput<Fields extends object>(channel: OpenEmptyChannel, fields: Fields): Fields & { channelId: string; workerId: string; assignees: string[] } {
  return { ...fields, channelId: channel.channelId, workerId: channel.workerIds[0], assignees: [...channel.workerIds] };
}

const RECIPIENT_PREFIX = 'channel:';

/** The navigation recipient of an empty channel (COD-202), so a step back opens it again. */
export function channelRecipient(channelId: string): string {
  return `${RECIPIENT_PREFIX}${channelId}`;
}

/** The channel a navigation recipient names, or undefined for a worker or crew recipient. */
export function channelFromRecipient(recipient: string): string | undefined {
  if (!recipient.startsWith(RECIPIENT_PREFIX)) return undefined;
  return recipient.slice(RECIPIENT_PREFIX.length) || undefined;
}

/** Orglets or crews picked in the sidebar start a new channel with them as its members; one orglet is a DM already. */
export function channelMembersFromSelection(selection: SidebarSelection): ChannelMember[] | undefined {
  if (selection.section === 'workers' && selection.ids.length >= 2) return selection.ids.map(id => ({ kind: 'orglet', id }));
  if (selection.section === 'teams' && selection.ids.length >= 1) return selection.ids.map(id => ({ kind: 'crew', id }));
  return undefined;
}

type ChannelRow = { id: string; createdAt: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown; archivedAt?: string; deletedAt?: string; channel?: { id: string; name: string } };

/** One row of the sidebar's Channels section: a channel with messages, or one created and still empty. */
export type SidebarChannel<T extends ChannelRow> = { kind: 'chat'; task: T; createdAt: string } | { kind: 'empty'; channel: EmptyChannel; createdAt: string };

/** The open channels for the sidebar, written in or not, newest first. */
export function sidebarChannels<T extends ChannelRow>(tasks: readonly T[], empty: readonly EmptyChannel[]): SidebarChannel<T>[] {
  const chats = tasks.filter(task => isChannelChat(task) && !task.archivedAt && !task.deletedAt).map(task => ({ kind: 'chat' as const, task, createdAt: task.createdAt }));
  const waiting = empty.map(channel => ({ kind: 'empty' as const, channel, createdAt: channel.createdAt }));
  return [...chats, ...waiting].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/** The open channels with messages, for the rail and the Open list. */
export function openChannelChats<T extends ChannelRow>(tasks: readonly T[]): T[] {
  return sidebarChannels(tasks, []).flatMap(entry => entry.kind === 'chat' ? [entry.task] : []);
}

/** A channel's name for its row: the name it was given, or the orglets' names for a group chat not migrated yet. */
export function channelNameOf(task: { channel?: { name: string }; title?: string }, memberNames: readonly string[]): string {
  return task.channel?.name ?? task.title ?? memberNames.join(', ');
}

/** The names for a header when there are few enough to read at a glance; undefined means the caller counts them instead. */
export function memberNames(names: readonly string[], most = 3): string | undefined {
  return names.length <= most ? names.join(', ') : undefined;
}
