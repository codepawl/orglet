import type { Task, Worker, Workspace } from '../shared/contracts';
import { taskWorkers, teamRoster } from './assignees';
import { t } from './i18n';

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
  /**
   * A recent chat that is a side thread (COD-247). Its detail says so and whose it is, and never gives way to a long
   * name, so choosing it is deliberate: files sent there go to the side thread, not to the orglet's main chat.
   */
  sideThread?: true;
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

/** "side thread · Researcher": what a side thread's row says beside its name. */
function sideThreadLabel(orgletName: string | undefined): string {
  return orgletName ? t('chat phụ · {0}', [orgletName]) : t('chat phụ');
}

export function sendToOptions(workspace: Pick<Workspace, 'tasks' | 'workers' | 'teams'>): SendToOption[] {
  const recent = recentChats(workspace).map((task): SendToOption => {
    const faces = taskWorkers(task, workspace);
    return {
      key: `task:${task.id}`,
      group: 'recent',
      target: { kind: 'task', id: task.id },
      name: task.title?.trim() || task.brief,
      faces,
      when: lastTouched(task),
      ...(task.sideOf ? { sideThread: true as const, detail: sideThreadLabel(faces[0]?.name) } : {}),
    };
  });
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
