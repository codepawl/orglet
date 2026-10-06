import type { Task, Team, Workspace } from '../shared/contracts';
import { channelMode, channelOrgletIds, type Channel } from '../shared/channels';
import type { Space } from '../shared/spaces';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliListedChannel } from '../cli/protocol';
import { crewRoster } from './cli-chats';

/**
 * Every channel the way the window lists them: the ones with messages on their chat row and the ones still waiting
 * for a first message, in the order a space shows them. A crew is a channel where the lead splits the work, so one
 * list covers what `orglet list` once split into orglets and crews.
 */

/** A channel, with the chat that holds its messages once it has one. */
export type ListedChannel = { channel: Channel; task?: Task; createdAt: string };

/** How many characters of a chat id the terminal prints, as `orglet chats` does. */
const SHORT_ID_LENGTH = 8;

/** The channels that are not archived, newest first: the order a channel nobody placed keeps. */
export function listedChannels(workspace: Pick<Workspace, 'tasks' | 'emptyChannels'>): ListedChannel[] {
  const written = workspace.tasks.flatMap(task => task.channel && !task.archivedAt && !task.deletedAt ? [{ channel: task.channel, task, createdAt: task.createdAt }] : []);
  const waiting = (workspace.emptyChannels ?? []).map(channel => ({ channel: channel as Channel, createdAt: channel.createdAt }));
  return [...written, ...waiting].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/**
 * The saved order of the channels (`reorder`): the ones the person placed come first, in that order, and a channel
 * never placed stays after them, newest first, as the sidebar keeps it. `channels` must already be newest first.
 */
export function inSavedOrder<Entry extends { channel: Channel }>(channels: readonly Entry[], channelOrder: readonly string[]): Entry[] {
  const placeOf = (entry: Entry, index: number) => {
    const placed = channelOrder.indexOf(entry.channel.id);
    return placed === -1 ? channelOrder.length + index : placed;
  };
  return channels
    .map((entry, index) => ({ entry, place: placeOf(entry, index) }))
    .sort((first, second) => first.place - second.place)
    .map(item => item.entry);
}

/** One space's channels as its page shows them: those directly in the space first, then each category in its order. */
export function channelsOfSpace(space: Space, channels: readonly ListedChannel[], channelOrder: readonly string[]): ListedChannel[] {
  const rankOfCategory = (entry: ListedChannel) => space.categories.findIndex(category => category.id === entry.channel.categoryId);
  return inSavedOrder(channels.filter(entry => entry.channel.spaceId === space.id), channelOrder)
    .sort((first, second) => rankOfCategory(first) - rankOfCategory(second));
}

/** Every channel, grouped by space in the order the spaces are kept, then the ones outside every space. */
export function channelsBySpace(workspace: Workspace): ListedChannel[] {
  const channels = listedChannels(workspace);
  const channelOrder = workspace.channelOrder ?? [];
  const spaces = workspace.spaces ?? [];
  const inSomeSpace = new Set(spaces.flatMap(space => channelsOfSpace(space, channels, channelOrder).map(entry => entry.channel.id)));
  const outside = inSavedOrder(channels.filter(entry => !inSomeSpace.has(entry.channel.id)), channelOrder);
  return [...spaces.flatMap(space => channelsOfSpace(space, channels, channelOrder)), ...outside];
}

/**
 * Every channel as `orglet list` names it, grouped by space. A crew the window has not turned into a channel yet
 * (that happens the next time the app hears of a change) is listed as the channel it is going to be, so no crew is
 * ever missing from the list.
 */
export function channelRows(workspace: Workspace): CliListedChannel[] {
  const channels = channelsBySpace(workspace);
  const adoptedCrews = new Set(channels.flatMap(entry => entry.channel.crewId ?? []));
  const waitingCrews = workspace.teams.filter(team => !adoptedCrews.has(team.id)).map(team => crewRow(workspace, team));
  return [...channels.map(entry => listedChannelRow(workspace, entry)), ...waitingCrews];
}

function nameOfOrglet(workspace: Workspace, orgletId: string): string {
  return workspace.workers.find(worker => worker.id === orgletId)?.name ?? orgletId;
}

function crewRow(workspace: Workspace, crew: Team): CliListedChannel {
  const roster = crewRoster(crew, workspace.workers);
  const lead = workspace.workers.find(worker => worker.id === crew.synthesizerId);
  return {
    name: crew.name,
    mode: 'lead',
    ...(lead ? { lead: lead.name } : {}),
    members: crew.memberIds.map(memberId => nameOfOrglet(workspace, memberId)),
    colors: roster.map(worker => defaultAvatarColor(worker)),
  };
}

/** A channel as `orglet list` names it: how it answers, who is in it, where it sits and the chat that reaches it. */
export function listedChannelRow(workspace: Workspace, entry: ListedChannel): CliListedChannel {
  const { channel } = entry;
  const crew = channel.crewId ? workspace.teams.find(team => team.id === channel.crewId) : undefined;
  const roster = crew ? crewRoster(crew, workspace.workers) : channelOrgletIds(channel.members, workspace).flatMap(orgletId => workspace.workers.find(worker => worker.id === orgletId) ?? []);
  const space = workspace.spaces?.find(item => item.id === channel.spaceId);
  const category = space?.categories.find(item => item.id === channel.categoryId);
  const lead = crew ? workspace.workers.find(worker => worker.id === crew.synthesizerId) : undefined;
  return {
    name: channel.name,
    mode: channelMode(channel),
    ...(lead ? { lead: lead.name } : {}),
    // A channel with a lead names the orglets that do the work, as its crew record did; the lead is named beside it.
    members: crew ? crew.memberIds.map(memberId => nameOfOrglet(workspace, memberId)) : roster.map(worker => worker.name),
    ...(space ? { space: space.name } : {}),
    ...(category ? { category: category.name } : {}),
    colors: roster.map(worker => defaultAvatarColor(worker)),
    ...(entry.task ? { chat: entry.task.id.slice(0, SHORT_ID_LENGTH) } : {}),
  };
}
