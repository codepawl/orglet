import { z } from 'zod';

/**
 * Channels (COD-361). A channel is a named chat with a topic whose members are orglets and crews, the way Slack and
 * Discord have #launch and #research beside one-to-one DMs. It is the group chat's `tasks` row with a `channel`
 * record on it: `assignees` stays the list of orglets that answer, expanded from the members, so the runner, the
 * routing and the permissions read a channel exactly as they read a group chat. A channel with no message yet has no
 * row; it waits in the workspace's `emptyChannels` until its first message moves it onto the row it creates.
 *
 * Members carry a `kind` so a person can join later (COD-362) without changing what is stored now. Since COD-369 a
 * crew is a channel itself: what made it a crew (its lead, workflow, budget and hours) is how its channel works, kept
 * in the crew record its `crewId` names, and its chat row keeps its `teamId` so the crew engine runs it. A `crew`
 * member is still read, from records written before then, as that crew's orglets.
 */

export const CHANNEL_NAME_LIMIT = 80;
export const CHANNEL_TOPIC_LIMIT = 250;
export const MAX_CHANNEL_MEMBERS = 50;

export const ChannelMember = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('orglet'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('crew'), id: z.uuid() }).strict(),
]);
export type ChannelMember = z.infer<typeof ChannelMember>;

/** A name as typed: a leading `#` is the mark the app draws, not part of the name. */
export const ChannelName = z.string().transform(name => name.trim().replace(/^#+\s*/, '')).pipe(z.string().min(1, 'Kênh cần một tên.').max(CHANNEL_NAME_LIMIT));

export const ChannelMembers = z.array(ChannelMember).min(1, 'Kênh cần ít nhất một thành viên.').max(MAX_CHANNEL_MEMBERS)
  .refine(members => new Set(members.map(memberKey)).size === members.length, 'Thành viên bị trùng.');

/**
 * How a channel answers a message (COD-369). `turns`: each orglet answers in turn and reads the answers before it, the
 * way a channel worked when it was a group chat. `lead`: the lead plans the message, splits it among the orglets and
 * combines their parts, the way a crew's chat worked before crews became channels.
 */
export const ChannelMode = z.enum(['turns', 'lead']);
export type ChannelMode = z.infer<typeof ChannelMode>;

export const Channel = z.object({
  id: z.uuid(),
  name: ChannelName,
  topic: z.string().trim().max(CHANNEL_TOPIC_LIMIT).optional(),
  members: ChannelMembers,
  /**
   * Set when the lead splits the work (COD-369): the crew record that holds the lead, the workflow, the budget and the
   * hours. The crew engine reads that record as it always did, so a channel made from a crew keeps working the same.
   */
  crewId: z.uuid().optional(),
}).strict();
export type Channel = z.infer<typeof Channel>;

/** How this channel answers: a channel with a crew record behind it is one where the lead splits the work. */
export function channelMode(channel: Pick<Channel, 'crewId'>): ChannelMode {
  return channel.crewId ? 'lead' : 'turns';
}

/** A channel created and not written in yet: it has no `tasks` row, only this record and when it was made. */
export const EmptyChannel = Channel.extend({ createdAt: z.iso.datetime() }).strict();
export type EmptyChannel = z.infer<typeof EmptyChannel>;

/**
 * What the create and edit dialogs send; an empty topic clears it. `mode` left out keeps how an existing channel works
 * (a new one takes turns), so a caller that only renames or changes members never switches it by accident.
 */
export const ChannelFields = z.object({
  name: ChannelName,
  topic: z.string().trim().max(CHANNEL_TOPIC_LIMIT),
  members: ChannelMembers,
  mode: ChannelMode.optional(),
}).strict();
export type ChannelFields = z.infer<typeof ChannelFields>;

export function memberKey(member: ChannelMember): string {
  return `${member.kind}:${member.id}`;
}

type Roster = {
  workers: readonly { id: string }[];
  teams: readonly { id: string; memberIds: readonly string[]; synthesizerId: string }[];
};

/**
 * The orglets that answer in a channel: its orglets in the order they were added, then each crew's members and lead,
 * each orglet once. A crew answers as its orglets, one after another like everyone else in the channel; its lead does
 * not plan the turn the way it does in the crew's own chat. Orglets and crews that are no longer listed answer nothing.
 */
export function channelOrgletIds(members: readonly ChannelMember[], roster: Roster): string[] {
  const listed = new Set(roster.workers.map(worker => worker.id));
  const ids: string[] = [];
  for (const member of members) {
    for (const orgletId of orgletsOfMember(member, roster)) {
      if (listed.has(orgletId) && !ids.includes(orgletId)) ids.push(orgletId);
    }
  }
  return ids;
}

/**
 * The members as orglets only (COD-369): crews are channels now, so a crew a channel had as a member, or one the
 * terminal still names with `--with`, joins as its orglets. Order and the cap follow `channelOrgletIds`.
 */
export function orgletMembers(members: readonly ChannelMember[], roster: Roster): ChannelMember[] {
  return channelOrgletIds(members, roster).slice(0, MAX_CHANNEL_MEMBERS).map(orgletId => ({ kind: 'orglet', id: orgletId }));
}

function orgletsOfMember(member: ChannelMember, roster: Roster): readonly string[] {
  if (member.kind === 'orglet') return [member.id];
  const crew = roster.teams.find(team => team.id === member.id);
  if (!crew) return [];
  return [...crew.memberIds, crew.synthesizerId];
}

/** A name made from the members' names, for a group chat that never had a title of its own. */
export function channelNameFrom(names: readonly string[]): string {
  const joined = names.filter(Boolean).join(', ').trim();
  if (!joined) return 'channel';
  if (joined.length <= CHANNEL_NAME_LIMIT) return joined;
  return `${joined.slice(0, CHANNEL_NAME_LIMIT - 1).trimEnd()}…`;
}

/** How a channel's name reads wherever it is shown on its own: `#launch`. */
export function channelLabel(name: string): string {
  return `#${name}`;
}

type ChatRow = { teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: unknown; channel?: object };

/**
 * A group chat from before channels: several orglets (or every one) answer, it is not a crew's chat, a schedule's run
 * or a side thread, and it has no channel record yet. Storage turns each one into a channel when the workspace opens.
 */
export function isLegacyGroupChat(task: ChatRow): boolean {
  if (task.channel || task.teamId || task.routineId || task.sideOf) return false;
  return task.assignees === 'all' || (Array.isArray(task.assignees) && task.assignees.length >= 2);
}

/** True for a channel's row, and for a group chat not migrated yet, which reads as one. */
export function isChannelChat(task: ChatRow): boolean {
  return Boolean(task.channel) || isLegacyGroupChat(task);
}
