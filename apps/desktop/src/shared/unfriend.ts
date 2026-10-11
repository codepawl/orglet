import type { Task } from './contracts';
import type { Channel, EmptyChannel } from './channels';
import type { Space } from './spaces';

/**
 * Where an unfriended orglet can still stay. Unfriending takes an orglet out of the person's direct messages. If it
 * is a member of spaces or channels, the person chooses per place to kick it out (the default) or keep it there. The
 * window shows these rows and the core kicks from the same list, so the two never disagree. Pure: no store, no bridge.
 *
 * A space is one row that stands for the space and every channel in it. A channel in a space is not listed on its own,
 * because it takes its orglets from the space. A channel outside every space is one row, whether its orglets take
 * turns or a lead splits the work.
 */
export type OrgletPlace = {
  kind: 'space' | 'channel';
  id: string;
  name: string;
  /** False when kicking would leave the place with no orglet to answer, so the place always keeps this orglet. */
  canKick: boolean;
};

export type PlaceSource = {
  spaces: readonly Pick<Space, 'id' | 'name' | 'orgletIds' | 'categories'>[];
  tasks: readonly Pick<Task, 'channel' | 'deletedAt' | 'archivedAt'>[];
  emptyChannels: readonly Pick<EmptyChannel, 'id' | 'name' | 'members' | 'spaceId'>[];
};

type ChannelRecord = Pick<Channel, 'id' | 'name' | 'members' | 'spaceId'>;

function hasOrglet(channel: ChannelRecord, workerId: string): boolean {
  return channel.members.some(member => member.kind === 'orglet' && member.id === workerId);
}

function otherOrgletCount(channel: ChannelRecord, workerId: string): number {
  return channel.members.filter(member => member.kind === 'orglet' && member.id !== workerId).length;
}

/** Every channel, written in or empty, that is still open. */
export function openChannels(source: PlaceSource): ChannelRecord[] {
  const written = source.tasks.flatMap(task => !task.deletedAt && !task.archivedAt && task.channel ? [task.channel] : []);
  return [...written, ...source.emptyChannels];
}

/** The places this orglet is in: its spaces first, then its channels outside every space, each in the order the workspace holds them. */
export function orgletPlaces(source: PlaceSource, workerId: string): OrgletPlace[] {
  const channels = openChannels(source);
  const places: OrgletPlace[] = [];
  for (const space of source.spaces) {
    if (!space.orgletIds.includes(workerId)) continue;
    // A channel of the space where this orglet is the only one does not hold it back: when the orglet leaves, that
    // channel takes the space's other orglets (Channels.inheritIfOnlyOrglet). A category with its own list does.
    const leavesCategoriesStaffed = space.categories.every(category => !category.orgletIds?.includes(workerId) || category.orgletIds.length > 1);
    places.push({ kind: 'space', id: space.id, name: space.name, canKick: space.orgletIds.length > 1 && leavesCategoriesStaffed });
  }
  const spaceIds = new Set(source.spaces.map(space => space.id));
  for (const channel of channels) {
    if (channel.spaceId && spaceIds.has(channel.spaceId)) continue;
    if (!hasOrglet(channel, workerId)) continue;
    places.push({ kind: 'channel', id: channel.id, name: channel.name, canKick: otherOrgletCount(channel, workerId) > 0 });
  }
  return places;
}
