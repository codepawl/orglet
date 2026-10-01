import { randomUUID } from 'node:crypto';
import type { Task, Team, Worker } from '../../shared/contracts';
import { Channel, channelNameFrom, channelOrgletIds, EmptyChannel, isLegacyGroupChat, MAX_CHANNEL_MEMBERS, type ChannelFields, type ChannelMember } from '../../shared/channels';
import type { Store } from './database';

/** The settings row that holds the channels nobody has written in yet (COD-361). */
const EMPTY_CHANNELS = 'emptyChannels';

const CHANNEL_HAS_NO_ORGLETS = 'Kênh chưa có Tí nào để trả lời. Thêm một Tí hoặc một hội.';

/**
 * Turns every group chat from before channels into a channel (COD-361), keeping its history: the row stays the same
 * row, gains a `channel` record named after its title (or its orglets' names when it never had one), and its
 * orglets become the members. A chat for every orglet ('all') becomes a channel of the orglets listed today; the
 * name it had in `taskTitles` moves onto the channel, which is where a channel's name lives from now on.
 *
 * It runs each time the workspace opens and after a backup is restored, and touches only rows that still look like a
 * group chat, so running it twice changes nothing. The field is optional JSON on the row, so an older build still
 * opens the workspace and reads the row as the group chat it was.
 */
export function migrateGroupChats(store: Store): number {
  const legacy = store.all<Task>('tasks').filter(task => !task.deletedAt && isLegacyGroupChat(task));
  if (!legacy.length) return 0;
  const workers = store.all<Worker>('workers');
  const titles = { ...store.setting<Record<string, string>>('taskTitles', {}) };
  const live = store.entityState().workers;
  const listedWorkers = workers.filter(worker => !live[worker.id]?.archivedAt && !live[worker.id]?.deletedAt);
  let migrated = 0;
  store.transaction(() => {
    for (const task of legacy) {
      const orgletIds = (task.assignees === 'all' ? listedWorkers.map(worker => worker.id) : task.assignees as string[]).slice(0, MAX_CHANNEL_MEMBERS);
      // A chat for every orglet in a workspace with none left has nobody to make members of; it stays as it was.
      if (!orgletIds.length) continue;
      const names = orgletIds.map(orgletId => workers.find(worker => worker.id === orgletId)?.name ?? '');
      const title = titles[task.id]?.trim() || task.title?.trim();
      const name = title ? channelNameFrom([title]) : channelNameFrom(names);
      const members: ChannelMember[] = orgletIds.map(orgletId => ({ kind: 'orglet', id: orgletId }));
      const channel = Channel.parse({ id: randomUUID(), name, members });
      store.update('tasks', { ...task, assignees: [...orgletIds], channel });
      delete titles[task.id];
      migrated += 1;
    }
    store.setSetting('taskTitles', titles);
  });
  return migrated;
}

/**
 * A chat that several orglets answer, made some other way than from an empty channel (the terminal's older `group`,
 * a chat whose settings gave it more orglets): it becomes a channel of those orglets at once, named by `title` or by
 * their names, so no new group chat is ever left without one.
 */
export function channelForGroup(store: Store, task: Pick<Task, 'assignees'>, title?: string): { channel: Channel; assignees: string[] } {
  const workspace = store.workspace();
  const orgletIds = (task.assignees === 'all' ? workspace.workers.map(worker => worker.id) : task.assignees ?? []).slice(0, MAX_CHANNEL_MEMBERS);
  if (!orgletIds.length) throw new Error(CHANNEL_HAS_NO_ORGLETS);
  const names = orgletIds.map(orgletId => workspace.workers.find(worker => worker.id === orgletId)?.name ?? '');
  const name = title?.trim() ? channelNameFrom([title.trim()]) : channelNameFrom(names);
  const members: ChannelMember[] = orgletIds.map(orgletId => ({ kind: 'orglet', id: orgletId }));
  return { channel: Channel.parse({ id: randomUUID(), name, members }), assignees: [...orgletIds] };
}

/** The channels created and not written in yet, newest first. */
export function emptyChannels(store: Store): EmptyChannel[] {
  const rows = store.setting<unknown[]>(EMPTY_CHANNELS, []);
  const channels = rows.flatMap(row => {
    const parsed = EmptyChannel.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return channels.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

function saveEmptyChannels(store: Store, channels: EmptyChannel[]) {
  store.setSetting(EMPTY_CHANNELS, channels);
}

/** The orglets that answer for these members, refused when there are none: a channel needs someone to answer. */
export function answeringOrglets(store: Store, members: readonly ChannelMember[]): string[] {
  const live = store.workspace();
  const orgletIds = channelOrgletIds(members, { workers: live.workers, teams: live.teams });
  if (!orgletIds.length) throw new Error(CHANNEL_HAS_NO_ORGLETS);
  return orgletIds;
}

/**
 * The person's channels (COD-361): the empty ones in settings, and those written in on their `tasks` rows. A channel
 * keeps its id from creation to deletion, so the window edits it by that id whether it has a row yet or not.
 */
export class Channels {
  constructor(private readonly store: Store, private readonly clock: () => Date) {}

  /** A new channel with no message yet; only orglets and crews that are listed can join it. */
  create(fields: ChannelFields): string {
    this.assertMembersListed(fields.members);
    answeringOrglets(this.store, fields.members);
    const channel = EmptyChannel.parse({ ...this.recordOf(randomUUID(), fields), createdAt: this.clock().toISOString() });
    saveEmptyChannels(this.store, [...emptyChannels(this.store), channel]);
    return channel.id;
  }

  /**
   * Renames a channel, sets its topic and changes who is in it. A channel with a row takes its new members from the
   * next message on; while a turn is under way the caller refuses the change, as it does for a group chat's settings.
   */
  update(channelId: string, fields: ChannelFields): Task | undefined {
    this.assertMembersListed(fields.members);
    const orgletIds = answeringOrglets(this.store, fields.members);
    const waiting = emptyChannels(this.store);
    const empty = waiting.find(channel => channel.id === channelId);
    if (empty) {
      const updated = EmptyChannel.parse({ ...this.recordOf(channelId, fields), createdAt: empty.createdAt });
      saveEmptyChannels(this.store, waiting.map(channel => channel.id === channelId ? updated : channel));
      return undefined;
    }
    const task = this.rowOf(channelId);
    const updated: Task = { ...task, channel: Channel.parse(this.recordOf(channelId, fields)), assignees: orgletIds, workerId: orgletIds[0] };
    this.store.update('tasks', updated);
    return updated;
  }

  /** Removes a channel nobody has written in; one with messages is deleted as a chat, with its history. */
  deleteEmpty(channelId: string) {
    const waiting = emptyChannels(this.store);
    if (!waiting.some(channel => channel.id === channelId)) throw new Error('Kênh này đã có tin nhắn. Xóa nó như một cuộc trò chuyện.');
    saveEmptyChannels(this.store, waiting.filter(channel => channel.id !== channelId));
  }

  /** The empty channel a first message is for, with the orglets that answer it; the caller writes the row. */
  waiting(channelId: string): { channel: Channel; orgletIds: string[] } {
    const empty = emptyChannels(this.store).find(channel => channel.id === channelId);
    if (!empty) throw new Error('Không tìm thấy kênh này.');
    const { createdAt: _createdAt, ...channel } = empty;
    return { channel, orgletIds: answeringOrglets(this.store, channel.members) };
  }

  /** Drops the empty channel once its first message wrote its row; called inside that transaction. */
  takeWaiting(channelId: string) {
    saveEmptyChannels(this.store, emptyChannels(this.store).filter(channel => channel.id !== channelId));
  }

  /**
   * A crew's members changed: every channel it is in answers with its new members from the next message on. A
   * channel left with no orglet at all keeps the list it had, so it never reads as an orglet's one-to-one chat.
   */
  followCrew(team: Team) {
    const workspace = this.store.workspace();
    const roster = { workers: workspace.workers, teams: workspace.teams.map(item => item.id === team.id ? team : item) };
    for (const task of this.store.all<Task>('tasks')) {
      if (task.deletedAt || !task.channel?.members.some(member => member.kind === 'crew' && member.id === team.id)) continue;
      const orgletIds = channelOrgletIds(task.channel.members, roster);
      if (!orgletIds.length || sameList(orgletIds, task.assignees)) continue;
      this.store.patchTask(task.id, { assignees: orgletIds, workerId: orgletIds[0] });
    }
  }

  /** The row of a channel that has messages. */
  rowOf(channelId: string): Task {
    const task = this.store.all<Task>('tasks').find(row => row.channel?.id === channelId && !row.deletedAt);
    if (!task) throw new Error('Không tìm thấy kênh này.');
    return task;
  }

  private recordOf(channelId: string, fields: ChannelFields): Channel {
    const topic = fields.topic.trim();
    return Channel.parse({ id: channelId, name: fields.name, ...(topic ? { topic } : {}), members: fields.members });
  }

  private assertMembersListed(members: readonly ChannelMember[]) {
    const workspace = this.store.workspace();
    for (const member of members) {
      const listed = member.kind === 'orglet'
        ? workspace.workers.some(worker => worker.id === member.id)
        : workspace.teams.some(team => team.id === member.id);
      if (!listed) throw new Error('Một thành viên đã được lưu trữ hoặc xóa. Bỏ họ khỏi kênh rồi lưu lại.');
    }
  }
}

function sameList(first: readonly string[], second: Task['assignees']): boolean {
  if (!Array.isArray(second) || first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}
