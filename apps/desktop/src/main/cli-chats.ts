import type { Routine, Task, Team, Worker, Workspace } from '../shared/contracts';
import { chatHeadline } from '../shared/forward';
import { channelLabel } from '../shared/channels';
import { liveTeamTask, liveWorkerTask } from '../shared/live-task';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliChat, CliChatKind, CliErrorCode } from '../cli/protocol';

/**
 * Finding the orglet, crew or schedule an `orglet` command names (COD-234), shared by every operation module. Nothing
 * here imports Electron.
 */

/** A failure the CLI shows as is. The message is a Vietnamese source string that the server translates. */
export class CliFailure extends Error {
  constructor(readonly code: CliErrorCode, message: string) {
    super(message);
  }
}

export type CoreRequest = (command: string, args: unknown) => Promise<unknown>;

/**
 * Finds an orglet or crew by name: a case-insensitive exact name first, then a unique prefix. Two chats with the
 * same exact name, or a prefix several names share, is ambiguous and lists them; no match lists every name.
 */
export function matchChat(query: string, chats: readonly CliChat[]): CliChat {
  const wanted = query.trim().toLocaleLowerCase();
  const exact = chats.filter(chat => chat.name.toLocaleLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new CliFailure('ambiguous', `"${exact[0].name}" là tên của nhiều Tí hoặc kênh. Đổi tên trong app để phân biệt.`);
  const prefixed = chats.filter(chat => chat.name.toLocaleLowerCase().startsWith(wanted));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) throw ambiguous(query, prefixed);
  const names = chats.map(chat => chat.name).join(', ');
  return notFound(query, names);
}

function ambiguous(query: string, candidates: readonly CliChat[]): CliFailure {
  const names = candidates.map(chat => chat.name).join(', ');
  return new CliFailure('ambiguous', `"${query}" khớp với nhiều tên: ${names}. Gõ tên đầy đủ hơn.`);
}

function notFound(query: string, names: string): never {
  if (!names) throw new CliFailure('not_found', 'Chưa có Tí hay kênh nào.');
  throw new CliFailure('not_found', `Không có Tí hay kênh nào tên "${query}". Có: ${names}.`);
}

/**
 * Finds a schedule by name the way `matchChat` finds a chat: a case-insensitive exact name first, then a unique
 * prefix. Only schedules that exist can match; `run` never makes one.
 */
export function matchSchedule(query: string, routines: readonly Pick<Routine, 'id' | 'name'>[]): Pick<Routine, 'id' | 'name'> {
  const wanted = query.trim().toLocaleLowerCase();
  const exact = routines.filter(routine => routine.name.toLocaleLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new CliFailure('ambiguous', `"${exact[0].name}" là tên của nhiều lịch. Đổi tên trong app để phân biệt.`);
  const prefixed = routines.filter(routine => routine.name.toLocaleLowerCase().startsWith(wanted));
  if (prefixed.length === 1) return prefixed[0];
  const names = (prefixed.length > 1 ? prefixed : routines).map(routine => routine.name).join(', ');
  if (prefixed.length > 1) throw new CliFailure('ambiguous', `"${query}" khớp với nhiều tên: ${names}. Gõ tên đầy đủ hơn.`);
  if (!names) throw new CliFailure('not_found', 'Chưa có lịch nào.');
  throw new CliFailure('not_found', `Không có lịch nào tên "${query}". Các lịch hiện có là ${names}.`);
}

export function chatsOf(workspace: Pick<Workspace, 'workers' | 'teams'>): CliChat[] {
  const orglets = workspace.workers.map(worker => orgletChat(worker));
  const crews = workspace.teams.map(team => crewChat(team, workspace.workers));
  return [...orglets, ...crews];
}

function orgletChat(worker: Worker): CliChat {
  return { kind: 'worker', id: worker.id, name: worker.name, color: defaultAvatarColor(worker) };
}

function crewChat(team: Team, workers: readonly Worker[]): CliChat {
  const lead = workers.find(worker => worker.id === team.synthesizerId);
  const colors = crewRoster(team, workers).map(worker => defaultAvatarColor(worker));
  return { kind: 'team', id: team.id, name: team.name, ...(lead ? { color: defaultAvatarColor(lead) } : {}), colors };
}

/** Members then the lead, without repeats, in crew order: the orglets a crew message runs. */
export function crewRoster(team: Pick<Team, 'memberIds' | 'synthesizerId'>, workers: readonly Worker[]): Worker[] {
  const ids = [...new Set([...team.memberIds, team.synthesizerId])];
  return ids.map(id => workers.find(worker => worker.id === id)).filter((worker): worker is Worker => Boolean(worker));
}

/** The main chat of an orglet or crew, the one a click on it opens; absent before its first message. */
export function liveChatTask(workspace: Pick<Workspace, 'tasks'>, chat: CliChat): Task | undefined {
  return chat.kind === 'team' ? liveTeamTask(workspace.tasks, chat.id) : liveWorkerTask(workspace.tasks, chat.id);
}

/** The orglet or crew a name finds and its main chat, which has to exist already. */
export function existingChat(workspace: Workspace, to: string): { chat: CliChat; task: Task } {
  const chat = matchChat(to, chatsOf(workspace));
  const task = liveChatTask(workspace, chat);
  if (!task) throw new CliFailure('not_found', `Chưa có cuộc trò chuyện với ${chat.name}.`);
  return { chat, task };
}

/** A request that names its chat by orglet or crew (`to`) or by the start of the chat's id (`chat`) (COD-354). */
export type ChatTargetRequest = { to?: string; chat?: string };

export function assertOneTarget(request: ChatTargetRequest): void {
  if ((request.to === undefined) === (request.chat === undefined)) throw new CliFailure('invalid', 'Gõ --to <tên> hoặc --chat <mã>, chỉ một trong hai.');
}

/** The chat a request names, which has to exist already: an orglet's or crew's main chat, or any chat by its id. */
export function targetChat(workspace: Workspace, request: ChatTargetRequest): { chat: CliChat; task: Task } {
  assertOneTarget(request);
  if (request.to !== undefined) return existingChat(workspace, request.to);
  const task = taskById(workspace, request.chat!);
  return { chat: chatOfTask(workspace, task), task };
}

/** A chat by the start of its id, the way `orglet chats` prints it; deleted chats are gone. */
export function taskById(workspace: Pick<Workspace, 'tasks'>, prefix: string): Task {
  const wanted = prefix.trim().replace(/^#/, '').toLowerCase();
  const matches = workspace.tasks.filter(task => !task.deletedAt && task.id.toLowerCase().startsWith(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CliFailure('ambiguous', `Mã "${wanted}" khớp với nhiều chat. Gõ thêm vài ký tự.`);
  throw new CliFailure('not_found', `Không có chat nào có mã "${wanted}". Lệnh orglet chats liệt kê các chat.`);
}

/** What a chat is, as the desktop's sidebar sorts it. */
export function chatKind(task: Pick<Task, 'routineId' | 'sideOf' | 'teamId' | 'assignees'>): CliChatKind {
  if (task.routineId) return 'schedule';
  if (task.sideOf) return 'side';
  if (task.teamId) return 'crew';
  if (task.assignees) return 'channel';
  return 'orglet';
}

/** The orglets a chat's messages go to: a crew's roster, a channel's orglets, or the one orglet. */
export function taskRunners(workspace: Pick<Workspace, 'workers' | 'teams'>, task: Pick<Task, 'teamId' | 'assignees' | 'workerId'>): Worker[] {
  const team = task.teamId ? workspace.teams.find(item => item.id === task.teamId) : undefined;
  if (team) return crewRoster(team, workspace.workers);
  if (task.assignees === 'all') return [...workspace.workers];
  const ids = task.assignees ?? [task.workerId];
  return ids.map(id => workspace.workers.find(worker => worker.id === id)).filter((worker): worker is Worker => Boolean(worker));
}

/** The name a chat goes by: a channel's `#name`, the title it was given, its orglet's or crew's name, or its first line. */
export function chatName(workspace: Pick<Workspace, 'workers' | 'teams'>, task: Task): string {
  if (task.channel) return channelLabel(task.channel.name);
  if (task.title) return task.title;
  const kind = chatKind(task);
  if (kind === 'orglet') return workspace.workers.find(worker => worker.id === task.workerId)?.name ?? chatHeadline(task);
  if (kind === 'crew') return workspace.teams.find(team => team.id === task.teamId)?.name ?? task.teamSnapshot?.name ?? chatHeadline(task);
  if (kind === 'schedule' && task.routineName) return task.routineName;
  return chatHeadline(task);
}

/**
 * A chat as the answers of an operation name it. An orglet's or crew's main chat is that orglet or crew; any other
 * chat carries its id, so the terminal can address it again with `--chat`.
 */
export function chatOfTask(workspace: Workspace, task: Task): CliChat {
  const owner = matchingOwner(workspace, task);
  if (owner && liveChatTask(workspace, owner)?.id === task.id) return owner;
  const lead = taskRunners(workspace, task).at(-1);
  const kind = task.teamId ? 'team' : 'worker';
  return { kind, id: task.teamId ?? task.workerId, name: chatName(workspace, task), ...(lead ? { color: defaultAvatarColor(lead) } : {}), taskId: task.id };
}

function matchingOwner(workspace: Workspace, task: Task): CliChat | undefined {
  const chats = chatsOf(workspace);
  if (task.teamId) return chats.find(chat => chat.kind === 'team' && chat.id === task.teamId);
  return chats.find(chat => chat.kind === 'worker' && chat.id === task.workerId);
}
