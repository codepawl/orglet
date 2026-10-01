import type { Routine, Task, Team, Worker, Workspace } from '../shared/contracts';
import { liveTeamTask, liveWorkerTask } from '../shared/live-task';
import { defaultAvatarColor } from '../shared/mascot-suggest';
import type { CliChat, CliErrorCode } from '../cli/protocol';

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
  if (exact.length > 1) throw new CliFailure('ambiguous', `"${exact[0].name}" là tên của nhiều Tí hoặc hội. Đổi tên trong app để phân biệt.`);
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
  if (!names) throw new CliFailure('not_found', 'Chưa có Tí hay hội nào.');
  throw new CliFailure('not_found', `Không có Tí hay hội nào tên "${query}". Có: ${names}.`);
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
