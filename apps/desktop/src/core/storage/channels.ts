import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { MAX_CREW_MEMBERS, type ChannelLeadSettings, type Task, type Team, type TeamInput, type Worker } from '../../shared/contracts';
import { Channel, channelMode, channelNameFrom, channelOrgletIds, EmptyChannel, isLegacyGroupChat, MAX_CHANNEL_MEMBERS, orgletMembers, type ChannelFields, type ChannelMember } from '../../shared/channels';
import { liveTeamTask } from '../../shared/live-task';
import type { Store } from './database';

/** The settings row that holds the channels nobody has written in yet (COD-361). */
const EMPTY_CHANNELS = 'emptyChannels';

const CHANNEL_HAS_NO_ORGLETS = 'Kênh chưa có Tí nào để trả lời. Thêm một Tí.';
const LEAD_NOT_A_MEMBER = 'Tí trưởng phải là một thành viên của kênh.';
const TOO_MANY_FOR_A_LEAD = 'Khi Tí trưởng chia việc, kênh có tối đa 8 Tí làm phần việc.';

/** The lead's instructions a channel starts with when it is switched to the lead splitting the work. */
export const DEFAULT_LEAD_INSTRUCTIONS = 'Gộp phần việc của từng Tí thành một câu trả lời. Giữ nguyên chỗ các Tí không đồng ý với nhau và nói rõ còn thiếu bằng chứng nào.';
const DEFAULT_MONTHLY_BUDGET_MICROS = 5_000_000;
const DEFAULT_TASK_BUDGET_MICROS = 500_000;
const DEFAULT_CONCURRENT_TASKS = 4;

/** A crew record as the crew editor saves it: a new one has no id yet. */
export type CrewInput = z.infer<typeof TeamInput> & { id?: string };

type Roster = { workers: readonly { id: string }[]; teams: readonly { id: string; memberIds: readonly string[]; synthesizerId: string }[] };

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
 * Crews become channels (COD-369), run each time the workspace opens and after a backup is restored. Every listed crew
 * gets a channel where its lead splits the work (`adoptCrews`), and a channel that still names a crew as a member gets
 * that crew's orglets instead. Both look only at what is not done yet, so running them twice changes nothing; the
 * crew rows stay as they were, so an older build still reads every crew and its chat.
 */
export function migrateCrews(store: Store, now: () => string): { adopted: number; expanded: number } {
  const adopted = adoptCrews(store, now);
  const expanded = expandCrewMembers(store);
  return { adopted, expanded };
}

/**
 * Gives each listed crew that has no channel yet a channel where its lead splits the work (COD-369): its main chat,
 * when it has one, gains the channel record and keeps its history and its `teamId`, so the crew engine runs it as
 * before; a crew that has not been written to yet becomes an empty channel. A crew made later (a template, the
 * terminal, an orglet's proposal) is adopted the same way the next time the window hears of a change, so no crew is
 * ever left without its channel. Archived crews wait until they are restored; deleted ones are never adopted.
 *
 * It decides from what is stored, not from a list of crews it has seen: a crew's channel is deleted together with the
 * crew record, so a listed crew without a channel is always one not adopted yet. The check is two small queries, since
 * it runs every time the window is told something changed.
 */
export function adoptCrews(store: Store, now: () => string): number {
  // A change announced from inside a transaction is adopted on the next announcement, once the transaction is over.
  if (store.db.isTransaction) return 0;
  const waitingIds = crewsWithAChannel(store);
  const state = store.entityState().teams;
  const teamIds = store.db.prepare('SELECT id FROM teams').all().map(row => String(row.id));
  const missing = teamIds.filter(teamId => !waitingIds.has(teamId) && !state[teamId]?.archivedAt && !state[teamId]?.deletedAt);
  if (!missing.length) return 0;
  const tasks = store.all<Task>('tasks').filter(task => !task.deletedAt);
  const waiting = emptyChannels(store);
  store.transaction(() => {
    for (const teamId of missing) {
      const team = store.get<Team>('teams', teamId);
      const channel = crewChannelRecord(team);
      const live = liveTeamTask(tasks, team.id);
      if (live && !live.channel) store.patchTask(live.id, { channel });
      else waiting.push(EmptyChannel.parse({ ...channel, createdAt: now() }));
    }
    saveEmptyChannels(store, waiting);
  });
  return missing.length;
}

/** The crews some channel, written in or empty, already stands for. */
function crewsWithAChannel(store: Store): Set<string> {
  const onRows = store.db.prepare(`SELECT DISTINCT json_extract(data,'$.channel.crewId') AS crew FROM tasks
    WHERE json_extract(data,'$.channel.crewId') IS NOT NULL AND json_extract(data,'$.deletedAt') IS NULL`).all().map(row => String(row.crew));
  const empty = emptyChannels(store).flatMap(channel => channel.crewId ? [channel.crewId] : []);
  return new Set([...onRows, ...empty]);
}

/** A crew's channel record: the crew's name, its orglets (members, then the lead) and the crew it stands for. */
export function crewChannelRecord(team: Team): Channel {
  const orgletIds = [...new Set([...team.memberIds, team.synthesizerId])].slice(0, MAX_CHANNEL_MEMBERS);
  return Channel.parse({ id: randomUUID(), name: channelNameFrom([team.name]), members: orgletIds.map(orgletId => ({ kind: 'orglet', id: orgletId })), crewId: team.id });
}

/**
 * A channel made before crews became channels may have a crew among its members (COD-361); that crew joins as its
 * orglets now (COD-369), in the order the channel already answers in, so who answers does not change.
 */
function expandCrewMembers(store: Store): number {
  const roster: Roster = { workers: store.all<Worker>('workers'), teams: store.all<Team>('teams') };
  const hasCrew = (members: readonly ChannelMember[]) => members.some(member => member.kind === 'crew');
  const rows = store.all<Task>('tasks').filter(task => !task.deletedAt && task.channel && hasCrew(task.channel.members));
  const waiting = emptyChannels(store);
  const waitingWithCrews = waiting.filter(channel => hasCrew(channel.members));
  if (!rows.length && !waitingWithCrews.length) return 0;
  let expanded = 0;
  store.transaction(() => {
    for (const task of rows) {
      const members = orgletMembers(task.channel!.members, roster);
      if (!members.length) continue;
      store.patchTask(task.id, { channel: { ...task.channel!, members } });
      expanded += 1;
    }
    const updated = waiting.map(channel => {
      if (!hasCrew(channel.members)) return channel;
      const members = orgletMembers(channel.members, roster);
      if (!members.length) return channel;
      expanded += 1;
      return { ...channel, members };
    });
    saveEmptyChannels(store, updated);
  });
  return expanded;
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
 * The crew record a channel where the lead splits the work keeps its settings in (COD-369): its name, the channel's
 * orglets and the lead's settings, each taken from `settings`, else the crew as it is, else a new crew's default.
 *
 * An existing crew whose lead did not do a part of the work keeps it that way; any other lead does a part too, the
 * way a new crew always started. A crew holds at most eight orglets that do a part, so a bigger channel is refused.
 */
export function crewForChannel(name: string, orgletIds: readonly string[], settings: ChannelLeadSettings | undefined, existing?: Team): CrewInput {
  const lead = settings?.synthesizerId ?? (existing && orgletIds.includes(existing.synthesizerId) ? existing.synthesizerId : orgletIds[0]);
  if (!lead || !orgletIds.includes(lead)) throw new Error(LEAD_NOT_A_MEMBER);
  const leadDoesAPart = existing ? existing.memberIds.includes(existing.synthesizerId) : true;
  const working = orgletIds.filter(orgletId => orgletId !== lead || leadDoesAPart);
  const memberIds = working.length ? working : [lead];
  if (memberIds.length > MAX_CREW_MEMBERS) throw new Error(TOO_MANY_FOR_A_LEAD);
  const optional = optionalCrewSettings(settings, existing);
  return {
    ...(existing ? { id: existing.id } : {}),
    name: channelNameFrom([name]),
    instructions: settings?.instructions ?? existing?.instructions ?? DEFAULT_LEAD_INSTRUCTIONS,
    memberIds,
    synthesizerId: lead,
    workflow: settings?.workflow ?? existing?.workflow ?? 'parallel',
    monthlyBudgetMicros: settings?.monthlyBudgetMicros ?? existing?.monthlyBudgetMicros ?? DEFAULT_MONTHLY_BUDGET_MICROS,
    maxConcurrentTasks: settings?.maxConcurrentTasks ?? existing?.maxConcurrentTasks ?? DEFAULT_CONCURRENT_TASKS,
    taskBudgetMicros: settings?.taskBudgetMicros ?? existing?.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS,
    ...optional,
  };
}

/** Work hours, the dataset check and the checklist: `null` turns one off, left out keeps what the crew has. */
function optionalCrewSettings(settings: ChannelLeadSettings | undefined, existing?: Team): Pick<CrewInput, 'workHours' | 'preflight' | 'reviewPolicy'> {
  const pick = <Key extends 'workHours' | 'preflight' | 'reviewPolicy'>(key: Key): CrewInput[Key] | undefined => {
    const given = settings?.[key];
    if (given === null) return undefined;
    return (given ?? existing?.[key]) as CrewInput[Key] | undefined;
  };
  const workHours = pick('workHours');
  const preflight = pick('preflight');
  const reviewPolicy = pick('reviewPolicy');
  return { ...(workHours ? { workHours } : {}), ...(preflight ? { preflight } : {}), ...(reviewPolicy ? { reviewPolicy } : {}) };
}

/**
 * What the channels need from the service for the crew record behind a channel where the lead splits the work: saving
 * it as a new revision with the crew editor's checks, and retiring it once no channel works that way any more (which
 * refuses while a schedule still runs it).
 */
export type CrewRecords = {
  save(input: CrewInput): Team;
  retire(teamId: string): void;
};

type ChannelCommand = ChannelFields & { lead?: ChannelLeadSettings };

/**
 * The person's channels (COD-361): the empty ones in settings, and those written in on their `tasks` rows. A channel
 * keeps its id from creation to deletion, so the window edits it by that id whether it has a row yet or not. A channel
 * where the lead splits the work (COD-369) also has a crew record, which these methods save alongside it.
 */
export class Channels {
  constructor(private readonly store: Store, private readonly clock: () => Date, private readonly crews: CrewRecords) {}

  /** A new channel with no message yet; only listed orglets can join it, and a crew joins as its orglets. */
  create(fields: ChannelCommand): string {
    const members = this.listedOrglets(fields.members);
    const orgletIds = answeringOrglets(this.store, members);
    const crew = fields.mode === 'lead' ? this.crews.save(crewForChannel(fields.name, orgletIds, fields.lead)) : undefined;
    const record = this.recordOf(randomUUID(), { ...fields, members }, crew?.id, undefined);
    const channel = EmptyChannel.parse({ ...record, createdAt: this.clock().toISOString() });
    saveEmptyChannels(this.store, [...emptyChannels(this.store), channel]);
    return channel.id;
  }

  /**
   * Renames a channel, sets its topic, changes who is in it and how it works. A channel with a row takes its new
   * members from the next message on; while a turn is under way the caller refuses the change, as it does for a group
   * chat's settings. Switching to the lead splitting the work gives the channel a crew record and its row the crew's
   * `teamId`; switching back gives the row its orglets as `assignees` and retires the crew record.
   */
  update(channelId: string, fields: ChannelCommand): Task | undefined {
    const current = this.recordById(channelId);
    const members = this.listedOrglets(fields.members);
    const orgletIds = answeringOrglets(this.store, members);
    const mode = fields.mode ?? channelMode(current);
    const existingCrew = current.crewId ? this.store.get<Team>('teams', current.crewId) : undefined;
    if (mode === 'turns' && existingCrew && this.onlyChannelOf(existingCrew.id, channelId)) this.crews.retire(existingCrew.id);
    const crew = mode === 'lead' ? this.crews.save(crewForChannel(fields.name, orgletIds, fields.lead, existingCrew)) : undefined;
    const record = Channel.parse(this.recordOf(channelId, { ...fields, members }, crew?.id, current));
    const waiting = emptyChannels(this.store);
    const empty = waiting.find(channel => channel.id === channelId);
    if (empty) {
      const updated = EmptyChannel.parse({ ...record, createdAt: empty.createdAt });
      saveEmptyChannels(this.store, waiting.map(channel => channel.id === channelId ? updated : channel));
      return undefined;
    }
    const updated = rowFor(this.rowOf(channelId), record, orgletIds, crew);
    this.store.update('tasks', updated);
    return updated;
  }

  /** Removes a channel nobody has written in, with the crew record behind it; one with messages is deleted as a chat. */
  deleteEmpty(channelId: string) {
    const waiting = emptyChannels(this.store);
    const empty = waiting.find(channel => channel.id === channelId);
    if (!empty) throw new Error('Kênh này đã có tin nhắn. Xóa nó như một cuộc trò chuyện.');
    if (empty.crewId && this.onlyChannelOf(empty.crewId, channelId)) this.crews.retire(empty.crewId);
    saveEmptyChannels(this.store, waiting.filter(channel => channel.id !== channelId));
  }

  /**
   * A channel's chat is being deleted: the crew record behind it goes too, unless another channel still works from it.
   * Called before the row goes, so a schedule that still runs the crew refuses the delete instead of stranding it.
   */
  retireCrewOf(task: Task) {
    const crewId = task.channel?.crewId;
    if (!crewId || !this.onlyChannelOf(crewId, task.channel!.id)) return;
    this.crews.retire(crewId);
  }

  /** The empty channel a first message is for, with the orglets that answer it; the caller writes the row. */
  waiting(channelId: string): { channel: Channel; orgletIds: string[] } {
    const empty = emptyChannels(this.store).find(channel => channel.id === channelId);
    if (!empty) throw new Error('Không tìm thấy kênh này.');
    const { createdAt: _createdAt, ...channel } = empty;
    return { channel, orgletIds: answeringOrglets(this.store, channel.members) };
  }

  /**
   * The channel a crew's first message is written into (COD-369): its empty channel when it has one, else a new
   * record, so the crew's chat is a channel whichever way it started (the window's empty channel, the terminal's
   * `--to <crew>`, an older window).
   */
  forCrewChat(team: Team): { channel: Channel; waitingId?: string } {
    const empty = emptyChannels(this.store).find(channel => channel.crewId === team.id);
    if (!empty) return { channel: crewChannelRecord(team) };
    const { createdAt: _createdAt, ...channel } = empty;
    return { channel, waitingId: empty.id };
  }

  /** Drops the empty channel once its first message wrote its row; called inside that transaction. */
  takeWaiting(channelId: string) {
    saveEmptyChannels(this.store, emptyChannels(this.store).filter(channel => channel.id !== channelId));
  }

  /**
   * A crew was saved some other way than from its channel (the terminal's `edit crew`, an orglet's proposal): the
   * channels it stands for take its name and its orglets, so the channel and the crew never disagree.
   */
  followCrew(team: Team) {
    const members = crewChannelRecord(team).members;
    const record = <Record extends Channel>(channel: Record): Record => ({ ...channel, name: channelNameFrom([team.name]), members });
    for (const task of this.store.all<Task>('tasks')) {
      if (task.deletedAt || task.channel?.crewId !== team.id) continue;
      this.store.patchTask(task.id, { channel: record(task.channel) });
    }
    const waiting = emptyChannels(this.store);
    if (!waiting.some(channel => channel.crewId === team.id)) return;
    saveEmptyChannels(this.store, waiting.map(channel => channel.crewId === team.id ? EmptyChannel.parse(record(channel)) : channel));
  }

  /** The row of a channel that has messages. */
  rowOf(channelId: string): Task {
    const task = this.store.all<Task>('tasks').find(row => row.channel?.id === channelId && !row.deletedAt);
    if (!task) throw new Error('Không tìm thấy kênh này.');
    return task;
  }

  private recordById(channelId: string): Channel {
    const empty = emptyChannels(this.store).find(channel => channel.id === channelId);
    if (empty) {
      const { createdAt: _createdAt, ...channel } = empty;
      return channel;
    }
    return this.rowOf(channelId).channel!;
  }

  /** True when no other channel, written in or empty, works from this crew record. */
  private onlyChannelOf(crewId: string, channelId: string): boolean {
    const onRows = this.store.all<Task>('tasks').some(task => !task.deletedAt && task.channel?.crewId === crewId && task.channel.id !== channelId);
    const waiting = emptyChannels(this.store).some(channel => channel.crewId === crewId && channel.id !== channelId);
    return !onRows && !waiting;
  }

  private recordOf(channelId: string, fields: ChannelFields, crewId: string | undefined, current: Channel | undefined): Channel {
    const topic = fields.topic.trim();
    const category = fields.category === undefined ? current?.category : fields.category.trim();
    return Channel.parse({ id: channelId, name: fields.name, ...(topic ? { topic } : {}), ...(category ? { category } : {}), members: fields.members, ...(crewId ? { crewId } : {}) });
  }

  /** The members as listed orglets: a crew joins as its orglets, and one that left the workspace is refused. */
  private listedOrglets(members: readonly ChannelMember[]): ChannelMember[] {
    const workspace = this.store.workspace();
    for (const member of members) {
      const listed = member.kind === 'orglet'
        ? workspace.workers.some(worker => worker.id === member.id)
        : workspace.teams.some(team => team.id === member.id);
      if (!listed) throw new Error('Một thành viên đã được lưu trữ hoặc xóa. Bỏ họ khỏi kênh rồi lưu lại.');
    }
    return orgletMembers(members, { workers: workspace.workers, teams: workspace.teams });
  }
}

/**
 * A channel's row after its settings changed: with a crew, the crew's chat (its `teamId`, the lead as the row's orglet,
 * no `assignees`), so the crew engine runs it; without one, the orglets in turn.
 */
function rowFor(task: Task, channel: Channel, orgletIds: string[], crew: Team | undefined): Task {
  const { teamId: _teamId, teamSnapshot: _teamSnapshot, assignees: _assignees, ...rest } = task;
  if (crew) return { ...rest, channel, workerId: crew.synthesizerId, teamId: crew.id, teamSnapshot: crew };
  return { ...rest, channel, assignees: orgletIds, workerId: orgletIds[0] };
}
