import { useEffect, useRef } from 'react';
import type { Routine, Task, TaskStatus, Workspace } from '../shared/contracts';
import { DAILY_CAP_REACHED, SKIPPED_WHILE_INACTIVE } from '../shared/schedule';
import { triggerOf } from '../shared/routine-triggers';
import { isQuietScheduleRun } from '../shared/quiet-runs';
import { BACKGROUND_NOTICE_CHARS, type BackgroundNotice } from '../shared/background-notice';
import { t, tMessage } from './i18n';
import { chatHeadline } from '../shared/forward';
import { toast } from './components/toast';
import { pendingGroupSize } from './components/notifications';
import { taskWorkers } from './assignees';
import { memberNames } from './channelChat';
import { channelLabel } from '../shared/channels';

const BUSY: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
const NEEDS_YOU: readonly TaskStatus[] = ['waiting_input', 'waiting_budget'];
const NEEDS_LOOK: readonly TaskStatus[] = ['failed', 'partial', 'interrupted'];
const LOOK_MARGIN_MS = 60_000;

/** How a chat stopped working: with its answer, stuck on something that went wrong, or waiting for the person. */
export type ChatOutcome = 'done' | 'needs_look' | 'needs_you';
export type FinishedChat = { task: Task; outcome: ChatOutcome };
/**
 * What the chat notices read about the workspace: the names of orglets, crews and schedules, and which chats hold
 * changes for review, so a schedule's run can say its changes wait (COD-294).
 */
export type ChatNames = Pick<Workspace, 'workers' | 'teams' | 'routines'> & Partial<Pick<Workspace, 'heldForReview'>>;

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

/** How the sidebar names a chat: a channel's `#name`, its title, or the first line of what was asked. */
function chatName(task: Task): string {
  if (task.channel) return channelLabel(task.channel.name);
  return task.title || chatHeadline(task);
}

/** The orglet, crew or group a chat belongs to, the way its header names it. */
function ownerName(task: Task, names: ChatNames): string {
  if (task.teamId) return names.teams.find(team => team.id === task.teamId)?.name ?? 'Orglet';
  if (task.channel) return channelLabel(task.channel.name);
  if (task.assignees === 'all') return t('Toàn bộ Tí');
  const workers = taskWorkers(task, { workers: names.workers, teams: names.teams });
  if (workers.length > 1) return memberNames(workers.map(worker => worker.name)) ?? t('{0} Tí', [workers.length]);
  return workers[0]?.name ?? 'Orglet';
}

function scheduleName(task: Task, names: ChatNames): string {
  return names.routines.find(routine => routine.id === task.routineId)?.name ?? task.routineName ?? chatName(task);
}

/**
 * A notice inside the window: the toast, which Notifications keeps, and the chat it opens. `group` makes its notice
 * take the place of the group's unread one, counting `size` answers (COD-287).
 */
export type InAppNotice = { taskId: string; text: string; tone: 'success' | 'error'; about: string; group?: { key: string; size: number };
  /** The answer a click lands on, so a long answer opens at its first line (user, 2026-10-07). */ messageId?: string };

/** The message a notice about a chat that finished opens at: its newest answer. A chat that needs the person opens at its end. */
export function answerToOpen(task: Pick<Task, 'lastArtifactId'>, outcome: FinishedChat['outcome']): { messageId?: string } {
  return outcome === 'done' && task.lastArtifactId ? { messageId: task.lastArtifactId } : {};
}

/** The group one orglet's side-thread answers share in Notifications, so they wait there as one row. */
export function sideThreadAnswersGroup(task: Pick<Task, 'workerId'>): string {
  return `side-thread-answers:${task.workerId}`;
}

/**
 * Whether the person is in one of the side thread's orglet's chats right now: its main chat, or another of its side
 * threads (COD-287). Its row sits right there under the orglet with its unread mark, so an answer needs no toast.
 */
export function besideSideThread(sideThread: Pick<Task, 'sideOf'>, openTask: Pick<Task, 'id' | 'sideOf'> | undefined): boolean {
  if (!sideThread.sideOf || !openTask) return false;
  const mainChatId = sideThread.sideOf.taskId;
  return openTask.id === mainChatId || openTask.sideOf?.taskId === mainChatId;
}

/**
 * The toast for a chat that stopped while the person was somewhere else in the app. A side thread says its orglet
 * answered (COD-247); a schedule's run names the schedule, with its orglet or crew as what it was about (COD-258).
 * A main chat says nothing: its row in the sidebar already carries the unread mark, and it is where the person
 * talks, so a toast for every answer there would be noise. One orglet's side-thread answers share one notice
 * (COD-287): `earlierInGroup` says how many answers the group's unread notice already counts, and the new notice
 * says the total ("Scout answered in 3 side threads") and opens the newest. A side thread that failed keeps its own
 * notice, since each one is a problem to look at.
 */
export function inAppNotice(chat: FinishedChat, names: ChatNames, earlierInGroup: (group: string) => number = () => 0): InAppNotice | undefined {
  const { task, outcome } = chat;
  const tone = outcome === 'done' ? 'success' : 'error';
  if (quietRun(chat, names)) return undefined;
  if (task.routineId) {
    const schedule = scheduleName(task, names);
    const text = outcome === 'done' ? heldForReview(task, names) ? t('{0} đã xong, thay đổi đang chờ bạn xem', [schedule]) : t('{0} đã xong', [schedule])
      : outcome === 'needs_you' ? t('{0} đang chờ bạn', [schedule])
      : t('{0} cần xem lại', [schedule]);
    return { taskId: task.id, text, tone, about: ownerName(task, names), ...answerToOpen(task, outcome) };
  }
  if (task.sideOf) {
    const author = names.workers.find(worker => worker.id === task.workerId)?.name ?? 'Orglet';
    if (outcome !== 'done') return { taskId: task.id, text: t('Chat phụ của {0} cần xem lại', [author]), tone, about: chatName(task) };
    const group = sideThreadAnswersGroup(task);
    const size = earlierInGroup(group) + 1;
    if (size === 1) return { taskId: task.id, text: t('{0} đã trả lời trong chat phụ', [author]), tone, about: chatName(task), group: { key: group, size }, ...answerToOpen(task, outcome) };
    return { taskId: task.id, text: t('{0} đã trả lời trong {1} chat phụ', [author, size]), tone, about: t('Mới nhất: {0}', [chatName(task)]), group: { key: group, size }, ...answerToOpen(task, outcome) };
  }
  return undefined;
}

/** Whether the chat's changes wait for the person's Apply or Discard (COD-279). */
function heldForReview(task: Task, names: ChatNames): boolean {
  return names.heldForReview?.includes(task.id) ?? false;
}

/**
 * A run of an hourly schedule that simply finished (COD-288). A toast every hour would be noise, so it collects on the
 * schedule's card ("5 runs today") and its row in the sidebar; a run that failed, waits for the person or holds changes
 * for review is still announced.
 */
export function quietRun(chat: FinishedChat, names: ChatNames): boolean {
  if (chat.outcome !== 'done' || !chat.task.routineId) return false;
  const routine = names.routines.find(item => item.id === chat.task.routineId);
  if (!routine?.schedule) return false;
  return isQuietScheduleRun(routine.schedule.frequency, triggerOf(routine).kind, heldForReview(chat.task, names));
}

/** The quiet runs Tacet has already looked at, to compare against on the next workspace (COD-303). */
export function attendedRuns(tasks: readonly Task[]): Set<string> {
  return new Set(tasks.filter(task => task.attention).map(task => task.id));
}

/**
 * Quiet runs Tacet judged worth announcing since `previous` was taken (COD-303). Its verdict lands a few seconds after
 * the run finished, so this is its own moment rather than part of `finishedChats`: the run was already quiet then. A
 * verdict older than `lookedAt` came with a restored backup or an earlier session and is history.
 */
export function noteworthyRuns(previous: ReadonlySet<string>, tasks: readonly Task[], lookedAt?: string): Task[] {
  return tasks.filter(task => {
    if (task.deletedAt || !task.attention?.notified || previous.has(task.id)) return false;
    return !lookedAt || task.attention.decidedAt >= lookedAt;
  });
}

/** The toast for a quiet run Tacet flagged: the schedule found something, about its orglet or crew. */
export function noteworthyNotice(task: Task, names: ChatNames): InAppNotice {
  return { taskId: task.id, text: t('{0} có điều mới', [scheduleName(task, names)]), tone: 'success', about: ownerName(task, names), ...answerToOpen(task, 'done') };
}

/** The system notification for it: the schedule's name, and that something is new; never the answer itself. */
export function noteworthyBackgroundNotice(task: Task, names: ChatNames): BackgroundNotice {
  return { taskId: task.id, title: clipped(scheduleName(task, names)), body: clipped(t('Có điều mới')), ...answerToOpen(task, 'done') };
}

/**
 * Whether a chat that stopped is announced inside the window. The chat on screen says nothing, since the person is
 * reading it, with one exception (COD-294): a schedule's run that failed or waits for the person always does. Run now
 * opens the run it starts, and a run that then failed left no trace in Notifications, so a problem with unattended
 * work could be missed once the person moved on.
 */
export function announcedInWindow(chat: FinishedChat, openTask: Pick<Task, 'id' | 'sideOf'> | undefined): boolean {
  const open = chat.task.id === openTask?.id;
  if (open) return Boolean(chat.task.routineId) && chat.outcome !== 'done';
  if (chat.outcome === 'done' && besideSideThread(chat.task, openTask)) return false;
  return true;
}

/** A schedule that could not start a run, and why: what the card's "did not run" or missed note says (COD-294). */
export type BlockedSchedule = { routine: Routine; reason: string };

/**
 * The schedules whose last attempt to start was refused since `previous` was read: a new "did not run" note (a folder
 * gone, files that could not start a run) or a new missed run whose reason is not that the app was closed. A miss
 * while Orglet was closed is not a problem; the card and the catch-up banner already offer to run it once.
 */
export function blockedSchedules(previous: readonly Routine[], routines: readonly Routine[]): BlockedSchedule[] {
  const blocked: BlockedSchedule[] = [];
  for (const routine of routines) {
    const before = previous.find(item => item.id === routine.id);
    const noticeIsNew = routine.notice && routine.notice.at !== before?.notice?.at;
    if (routine.notice && noticeIsNew) {
      blocked.push({ routine, reason: routine.notice.reason });
      continue;
    }
    const pending = routine.pending;
    const missedIsNew = pending && pending.reason !== SKIPPED_WHILE_INACTIVE && pending.reason !== before?.pending?.reason;
    if (pending && missedIsNew) blocked.push({ routine, reason: pending.reason });
  }
  return blocked;
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
  const body = outcome === 'done' ? heldForReview(task, names) ? t('Thay đổi đang chờ bạn xem') : t('Đã xong')
    : outcome === 'needs_you' ? t('Đang chờ bạn') : t('Cần xem lại');
  return { taskId: task.id, title: clipped(title), body: clipped(body), ...answerToOpen(task, outcome) };
}

/**
 * Which chats may get a system notification: every one that stopped, in any chat, unless the person turned the
 * setting off. Main shows them only while the window is not focused, which it knows for certain; the page's own
 * `document.hasFocus()` cannot be trusted for that, since a test driver or DevTools can pin it to true.
 */
export function backgroundNotices(finished: readonly FinishedChat[], names: ChatNames, enabled: boolean): BackgroundNotice[] {
  if (!enabled) return [];
  return finished.filter(chat => !quietRun(chat, names)).map(chat => backgroundNotice(chat, names));
}

/**
 * The toast for a schedule that could not start: the reason, with a way to the schedules. A day whose cap is reached is
 * said once, as news rather than a problem (COD-288); the core writes that note once a day, not once per skipped run.
 */
export function blockedScheduleNotice(blocked: BlockedSchedule): { text: string; tone: 'error' | 'info'; about: string } {
  if (blocked.reason === DAILY_CAP_REACHED) return { text: t('{0} đã chạm giới hạn chi phí hôm nay', [blocked.routine.name]), tone: 'info', about: tMessage(blocked.reason) };
  return { text: t('{0} chưa chạy', [blocked.routine.name]), tone: 'error', about: tMessage(blocked.reason) };
}

/**
 * Announces chats that stopped working. Inside the window, a side thread (COD-247) or a schedule's run (COD-258)
 * that finished while the person was elsewhere gets a toast with Open, which Notifications keeps as unread; the chat
 * already open says nothing. Any chat that finished, failed or needs the person is also offered to main as a system
 * notification, unless Settings turned that off; main shows it only while the window is in the background.
 */
export function useChatNotices(workspace: Workspace | undefined, openChat: string | null, open: (taskId: string, messageId?: string) => void, openSchedules: () => void) {
  const previous = useRef<{ statuses: Map<string, TaskStatus>; routines: Routine[]; attended: Set<string>; at: number }>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  const openSchedulesRef = useRef(openSchedules);
  openSchedulesRef.current = openSchedules;
  useEffect(() => {
    if (!workspace) return;
    const known = previous.current;
    previous.current = { statuses: chatStatuses(workspace.tasks), routines: workspace.routines, attended: attendedRuns(workspace.tasks), at: Date.now() };
    if (!known) return;
    // A schedule that could not start is unattended work that did not happen, so it is a problem to look at (COD-294).
    for (const blocked of blockedSchedules(known.routines, workspace.routines)) {
      const notice = blockedScheduleNotice(blocked);
      toast(notice.text, notice.tone, notice.about, { action: { label: t('Xem lịch chạy'), onSelect: () => openSchedulesRef.current() } });
    }
    // A run started while the last workspace was on its way here is still news, hence the margin.
    const lookedAt = new Date(known.at - LOOK_MARGIN_MS).toISOString();
    const openTask = openChat ? workspace.tasks.find(task => task.id === openChat) : undefined;
    // A quiet run Tacet flagged says so now, the way a finished schedule run would have (COD-303).
    for (const task of noteworthyRuns(known.attended, workspace.tasks, lookedAt)) {
      if (task.id !== openTask?.id) {
        const notice = noteworthyNotice(task, workspace);
        toast(notice.text, notice.tone, notice.about, { action: { label: t('Mở'), onSelect: () => openRef.current(notice.taskId, notice.messageId) }, unread: true, chat: notice.taskId, message: notice.messageId });
      }
      if (workspace.backgroundNotifications) void window.orglet?.notifyInBackground?.(noteworthyBackgroundNotice(task, workspace)).catch(() => undefined);
    }
    const finished = finishedChats(known.statuses, workspace.tasks, lookedAt);
    if (!finished.length) return;
    for (const chat of finished) {
      if (!announcedInWindow(chat, openTask)) continue;
      const notice = inAppNotice(chat, workspace, pendingGroupSize);
      if (!notice) continue;
      // An answer that landed while the person was elsewhere is news, so it waits in Notifications (COD-255).
      toast(notice.text, notice.tone, notice.about, { action: { label: t('Mở'), onSelect: () => openRef.current(notice.taskId, notice.messageId) }, unread: true, chat: notice.taskId, message: notice.messageId, group: notice.group });
    }
    for (const notice of backgroundNotices(finished, workspace, workspace.backgroundNotifications)) {
      // Main drops it while the window is focused, where the sidebar and the toasts above already say it.
      void window.orglet?.notifyInBackground?.(notice).catch(() => undefined);
    }
  }, [workspace?.tasks]);
}
