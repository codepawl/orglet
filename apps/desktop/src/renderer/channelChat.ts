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
export type OpenEmptyChannel = {
  channelId: string; name: string; topic?: string; members: ChannelMember[]; workerIds: string[];
  /** Where the channel sits. Without these the window took a channel in a space for a loose one. */
  spaceId?: string; categoryId?: string; access?: EmptyChannel['access'];
};

type Roster = { workers: readonly { id: string }[]; teams: readonly { id: string; memberIds: readonly string[]; synthesizerId: string }[] };

/** The empty channel on screen, or undefined once it is gone. It may have no orglet; the window then asks for one. */
export function openEmptyChannel(channelId: string | undefined, channels: readonly EmptyChannel[], roster: Roster): OpenEmptyChannel | undefined {
  if (!channelId) return undefined;
  const channel = channels.find(item => item.id === channelId);
  if (!channel) return undefined;
  const workerIds = channelOrgletIds(channel.members, roster);
  return {
    channelId: channel.id, name: channel.name, ...(channel.topic ? { topic: channel.topic } : {}), members: channel.members, workerIds,
    ...(channel.spaceId ? { spaceId: channel.spaceId, categoryId: channel.categoryId, access: channel.access } : {}),
  };
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

/** Orglets picked in the sidebar start a new channel with them as its members; one orglet is a DM already. */
export function channelMembersFromSelection(selection: SidebarSelection): ChannelMember[] | undefined {
  if (selection.section === 'workers' && selection.ids.length >= 2) return selection.ids.map(id => ({ kind: 'orglet', id }));
  return undefined;
}

type ChannelRow = { id: string; createdAt: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown; archivedAt?: string; deletedAt?: string; channel?: { id: string; name: string; spaceId?: string; categoryId?: string } };

/** One row of the sidebar's Channels section: a channel with messages, or one created and still empty. */
export type SidebarChannel<T extends ChannelRow> = { kind: 'chat'; task: T; createdAt: string } | { kind: 'empty'; channel: EmptyChannel; createdAt: string };

/** The open channels for the sidebar, written in or not, newest first. */
export function sidebarChannels<T extends ChannelRow>(tasks: readonly T[], empty: readonly EmptyChannel[]): SidebarChannel<T>[] {
  const chats = tasks.filter(task => isChannelChat(task) && !task.archivedAt && !task.deletedAt).map(task => ({ kind: 'chat' as const, task, createdAt: task.createdAt }));
  const waiting = empty.map(channel => ({ kind: 'empty' as const, channel, createdAt: channel.createdAt }));
  return [...chats, ...waiting].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/**
 * The channel a space's tile opens (owner, 2026-10-11): the one last on screen there, or the first one as the sidebar
 * lists them, which is the channels with no category and then each category's in the space's order, each group in the
 * order the person keeps. Undefined when the space has no channel.
 */
export function spaceLandingChannel<T extends ChannelRow>(
  entries: readonly SidebarChannel<T>[],
  space: { id: string; categories: readonly { id: string }[] },
  channelOrder: readonly string[],
  rememberedChannelId: string | undefined,
): SidebarChannel<T> | undefined {
  const channelOf = (entry: SidebarChannel<T>) => entry.kind === 'chat' ? entry.task.channel : entry.channel;
  const inSpace = entries.filter(entry => channelOf(entry)?.spaceId === space.id);
  const remembered = inSpace.find(entry => channelOf(entry)?.id === rememberedChannelId);
  if (remembered) return remembered;
  const categoryIds = space.categories.map(category => category.id);
  const placed = inSpace.map((entry, index) => {
    const channel = channelOf(entry);
    const kept = channel ? channelOrder.indexOf(channel.id) : -1;
    // A category the space no longer has lists its channels with the uncategorized ones, as the sidebar does.
    const group = channel?.categoryId ? categoryIds.indexOf(channel.categoryId) + 1 : 0;
    return { entry, group, place: kept >= 0 ? kept : channelOrder.length + index };
  });
  placed.sort((first, second) => first.group - second.group || first.place - second.place);
  return placed[0]?.entry;
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

/**
 * The orglets a chat's channel lists right now, or undefined when the chat is not a channel (a direct message, a side
 * thread, a schedule's run). Derived on every call from the current member list; nothing is stored.
 */
export function channelOrgletIdsOf(task: { channel?: { members: readonly ChannelMember[] }; sideOf?: unknown }): string[] | undefined {
  if (!task.channel || task.sideOf) return undefined;
  return task.channel.members.flatMap(member => member.kind === 'orglet' ? [member.id] : []);
}

/**
 * A ghost: a message written by an orglet that is no longer in the channel it was written in. Only a channel has
 * ghosts (`currentOrgletIds` is undefined elsewhere), and an orglet that is deleted or archived but still listed is not
 * one. Adding the orglet back makes its messages ordinary at once, because the list is read afresh every time.
 */
export function isGhostMessage(authorOrgletId: string | undefined, currentOrgletIds: readonly string[] | undefined): boolean {
  if (!authorOrgletId || !currentOrgletIds) return false;
  return !currentOrgletIds.includes(authorOrgletId);
}
