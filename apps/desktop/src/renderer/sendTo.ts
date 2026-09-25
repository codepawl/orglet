import type { Task, Worker, Workspace } from '../shared/contracts';
import { taskWorkers, teamRoster } from './assignees';

/**
 * The places files sent from Explorer can go (COD-246): the most recent chats first, then every orglet and every
 * crew, in the sidebar's order. Plain data, so the picker only draws it.
 */

export type SendToTarget = { kind: 'worker' | 'team' | 'task'; id: string };

export type SendToOption = {
  key: string;
  group: 'recent' | 'orglets' | 'crews';
  target: SendToTarget;
  name: string;
  /** Orglets whose faces the row shows: the orglet, a crew's members, or a chat's members. */
  faces: Worker[];
  /** A second, quieter piece of text: an orglet's description, a crew's members, when a chat was last opened. */
  detail?: string;
  /** When a recent chat was last opened or started, for its relative day. */
  when?: string;
};

export const RECENT_CHAT_COUNT = 3;

/** When a chat was last looked at or, if never, when it started. */
function lastTouched(task: Pick<Task, 'createdAt' | 'seenAt'>): string {
  if (task.seenAt && task.seenAt > task.createdAt) return task.seenAt;
  return task.createdAt;
}

function isOpenChat(task: Task): boolean {
  return !task.deletedAt && !task.archivedAt;
}

export function recentChats(workspace: Pick<Workspace, 'tasks'>, count = RECENT_CHAT_COUNT): Task[] {
  const open = workspace.tasks.filter(isOpenChat);
  const newestFirst = [...open].sort((first, second) => lastTouched(second).localeCompare(lastTouched(first)));
  return newestFirst.slice(0, count);
}

export function sendToOptions(workspace: Pick<Workspace, 'tasks' | 'workers' | 'teams'>): SendToOption[] {
  const recent = recentChats(workspace).map((task): SendToOption => ({
    key: `task:${task.id}`,
    group: 'recent',
    target: { kind: 'task', id: task.id },
    name: task.title?.trim() || task.brief,
    faces: taskWorkers(task, workspace),
    when: lastTouched(task),
  }));
  const orglets = workspace.workers.map((worker): SendToOption => ({
    key: `worker:${worker.id}`,
    group: 'orglets',
    target: { kind: 'worker', id: worker.id },
    name: worker.name,
    faces: [worker],
    ...(worker.description ? { detail: worker.description } : {}),
  }));
  const crews = workspace.teams.map((team): SendToOption => {
    const roster = teamRoster(team, workspace.workers);
    return {
      key: `team:${team.id}`,
      group: 'crews',
      target: { kind: 'team', id: team.id },
      name: team.name,
      faces: roster,
      detail: roster.map(worker => worker.name).join(', '),
    };
  });
  return [...recent, ...orglets, ...crews];
}

/** Accent- and case-insensitive, so "ke toan" finds "Kế toán". */
export function foldForSearch(value: string): string {
  const withoutMarks = value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return withoutMarks.replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase();
}

export function filterOptions(options: readonly SendToOption[], query: string): SendToOption[] {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...options];
  return options.filter(option => {
    const text = foldForSearch(`${option.name} ${option.detail ?? ''}`);
    return terms.every(term => text.includes(term));
  });
}
