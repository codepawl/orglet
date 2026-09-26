import { useEffect, useRef } from 'react';
import type { Task, TaskStatus, Workspace } from '../shared/contracts';
import { BACKGROUND_NOTICE_CHARS, type BackgroundNotice } from '../shared/background-notice';
import { t } from './i18n';
import { toast } from './components/toast';
import { taskWorkers } from './assignees';
import { groupChatNames } from './groupChat';

const BUSY: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
const NEEDS_YOU: readonly TaskStatus[] = ['waiting_input', 'waiting_budget'];
const NEEDS_LOOK: readonly TaskStatus[] = ['failed', 'partial', 'interrupted'];
const LOOK_MARGIN_MS = 60_000;

/** How a chat stopped working: with its answer, stuck on something that went wrong, or waiting for the person. */
export type ChatOutcome = 'done' | 'needs_look' | 'needs_you';
export type FinishedChat = { task: Task; outcome: ChatOutcome };
/** What the chat notices read about the workspace: the names of orglets, crews and schedules. */
export type ChatNames = Pick<Workspace, 'workers' | 'teams' | 'routines'>;

/** A paused or cancelled chat stopped because the person asked, so it is not news. */
function outcomeOf(status: TaskStatus): ChatOutcome | undefined {
  if (status === 'completed') return 'done';
  if (NEEDS_YOU.includes(status)) return 'needs_you';
  if (NEEDS_LOOK.includes(status)) return 'needs_look';
  return undefined;
}

/** Each chat's status now, to compare against on the next workspace. */
export function chatStatuses(tasks: readonly Task[]): Map<string, TaskStatus> {
  return new Map(tasks.filter(task => !task.deletedAt).map(task => [task.id, task.status]));
}

/**
 * The chats that stopped working since `previous` was taken: busy then, done, stuck or waiting now. Only a chat seen
 * busy counts, so opening the app on finished chats announces nothing (COD-247). A schedule's run is the one
 * exception (COD-258): it is started by the clock, a folder or `orglet run`, not from this window, and a short run
 * can start and end between two looks, so one that appears already finished counts too, unless it started before
 * `lookedAt`: then it was not started here but brought in by a restored backup, and it is history (COD-281).
 */
export function finishedChats(previous: ReadonlyMap<string, TaskStatus>, tasks: readonly Task[], lookedAt?: string): FinishedChat[] {
  const finished: FinishedChat[] = [];
  for (const task of tasks) {
    if (task.deletedAt || BUSY.includes(task.status)) continue;
    const outcome = outcomeOf(task.status);
    if (!outcome) continue;
    const before = previous.get(task.id);
    const wasBusy = before !== undefined && BUSY.includes(before);
    const startedSinceLook = !lookedAt || task.createdAt >= lookedAt;
    const appearedFinished = before === undefined && Boolean(task.routineId) && startedSinceLook;
    if (wasBusy || appearedFinished) finished.push({ task, outcome });
  }
  return finished;
}

/** How the sidebar names a chat: its title, or the first line of what was asked. */
function chatName(task: Task): string {
  return task.title || task.brief.split('\n')[0].trim();
}

/** The orglet, crew or group a chat belongs to, the way its header names it. */
function ownerName(task: Task, names: ChatNames): string {
  if (task.teamId) return names.teams.find(team => team.id === task.teamId)?.name ?? 'Orglet';
  if (task.assignees === 'all') return t('Toàn bộ Tí');
  const workers = taskWorkers(task, { workers: names.workers, teams: names.teams });
  if (workers.length > 1) return groupChatNames(workers.map(worker => worker.name)) ?? t('{0} Tí', [workers.length]);
  return workers[0]?.name ?? 'Orglet';
}

function scheduleName(task: Task, names: ChatNames): string {
  return names.routines.find(routine => routine.id === task.routineId)?.name ?? task.routineName ?? chatName(task);
}

/** A notice inside the window: the toast, which Notifications keeps, and the chat it opens. */
export type InAppNotice = { taskId: string; text: string; tone: 'success' | 'error'; about: string };

/**
 * The toast for a chat that stopped while the person was somewhere else in the app. A side thread says its orglet
 * answered (COD-247); a schedule's run names the schedule, with its orglet or crew as what it was about (COD-258).
 * A main chat says nothing: its row in the sidebar already carries the unread mark, and it is where the person
 * talks, so a toast for every answer there would be noise.
 */
export function inAppNotice(chat: FinishedChat, names: ChatNames): InAppNotice | undefined {
  const { task, outcome } = chat;
  const tone = outcome === 'done' ? 'success' : 'error';
  if (task.routineId) {
    const schedule = scheduleName(task, names);
    const text = outcome === 'done' ? t('{0} đã xong', [schedule])
      : outcome === 'needs_you' ? t('{0} đang chờ bạn', [schedule])
      : t('{0} cần xem lại', [schedule]);
    return { taskId: task.id, text, tone, about: ownerName(task, names) };
  }
  if (task.sideOf) {
    const author = names.workers.find(worker => worker.id === task.workerId)?.name ?? 'Orglet';
    const text = outcome === 'done' ? t('{0} đã trả lời trong chat phụ', [author]) : t('Chat phụ của {0} cần xem lại', [author]);
    return { taskId: task.id, text, tone, about: chatName(task) };
  }
  return undefined;
}

function clipped(text: string): string {
  if (text.length <= BACKGROUND_NOTICE_CHARS) return text;
  return `${text.slice(0, BACKGROUND_NOTICE_CHARS - 1)}…`;
}

/**
 * The system notification for one chat: who, and what happened in two or three words. Never the answer, the
 * question or a file name, since it shows on the desktop (COD-258). A side thread's title says so, because the
 * orglet's main chat is a different place to land.
 */
export function backgroundNotice(chat: FinishedChat, names: ChatNames): BackgroundNotice {
  const { task, outcome } = chat;
  const owner = ownerName(task, names);
  const title = task.routineId ? scheduleName(task, names) : task.sideOf ? t('{0} · chat phụ', [owner]) : owner;
  const body = outcome === 'done' ? t('Đã xong') : outcome === 'needs_you' ? t('Đang chờ bạn') : t('Cần xem lại');
  return { taskId: task.id, title: clipped(title), body: clipped(body) };
}

/**
 * Which chats may get a system notification: every one that stopped, in any chat, unless the person turned the
 * setting off. Main shows them only while the window is not focused, which it knows for certain; the page's own
 * `document.hasFocus()` cannot be trusted for that, since a test driver or DevTools can pin it to true.
 */
export function backgroundNotices(finished: readonly FinishedChat[], names: ChatNames, enabled: boolean): BackgroundNotice[] {
  if (!enabled) return [];
  return finished.map(chat => backgroundNotice(chat, names));
}

/**
 * Announces chats that stopped working. Inside the window, a side thread (COD-247) or a schedule's run (COD-258)
 * that finished while the person was elsewhere gets a toast with Open, which Notifications keeps as unread; the chat
 * already open says nothing. Any chat that finished, failed or needs the person is also offered to main as a system
 * notification, unless Settings turned that off; main shows it only while the window is in the background.
 */
export function useChatNotices(workspace: Workspace | undefined, openChat: string | null, open: (taskId: string) => void) {
  const previous = useRef<{ statuses: Map<string, TaskStatus>; at: number }>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!workspace) return;
    const known = previous.current;
    previous.current = { statuses: chatStatuses(workspace.tasks), at: Date.now() };
    if (!known) return;
    // A run started while the last workspace was on its way here is still news, hence the margin.
    const lookedAt = new Date(known.at - LOOK_MARGIN_MS).toISOString();
    const finished = finishedChats(known.statuses, workspace.tasks, lookedAt);
    if (!finished.length) return;
    for (const chat of finished) {
      if (chat.task.id === openChat) continue;
      const notice = inAppNotice(chat, workspace);
      if (!notice) continue;
      // An answer that landed while the person was elsewhere is news, so it waits in Notifications (COD-255).
      toast(notice.text, notice.tone, notice.about, { action: { label: t('Mở'), onSelect: () => openRef.current(notice.taskId) }, unread: true, chat: notice.taskId });
    }
    for (const notice of backgroundNotices(finished, workspace, workspace.backgroundNotifications)) {
      // Main drops it while the window is focused, where the sidebar and the toasts above already say it.
      void window.orglet?.notifyInBackground?.(notice).catch(() => undefined);
    }
  }, [workspace?.tasks]);
}
