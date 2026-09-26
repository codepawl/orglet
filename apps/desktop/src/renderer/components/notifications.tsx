import { useSyncExternalStore } from 'react';
import { translated } from '../i18n';

/**
 * Everything the app has told you, kept after the toast has gone.
 *
 * A toast says something once and disappears, which is right for "Đã lưu" and wrong for a failure you were not
 * looking at — the owner hit exactly that with a red banner they could only dismiss (2026-09-20). Every message
 * raised anywhere is recorded here, so the toast can stay brief and nothing is lost by missing it.
 *
 * A toast is read with the control it answers under the cursor, so "Đã lưu" is enough in the moment. Replayed
 * later, that context is gone, so a notice also records what it was about (COD-174): the setting, the worker, the
 * chat, the command. The centre shows that line under the message.
 *
 * Stored in the browser, not in the workspace: these are notes about this machine's session, not work. They are
 * capped so the list cannot grow without bound, and a blocked store costs a note rather than an error.
 */

export type NoticeKind = 'error' | 'done' | 'info';
export type Notice = {
  id: number;
  at: string;
  kind: NoticeKind;
  /** What happened, in the words the toast used. */
  text: string;
  /** What it was about, when the caller knew. Notices stored before COD-174 have none. */
  about?: string;
  /**
   * A confirmation of something the person just did, such as "Đã lưu Tí": kept in the list, but never counted as
   * unread or marked new, because it was read under the cursor when it appeared (COD-255).
   */
  confirmation?: true;
  /** The chat this notice is about, such as a schedule's run that finished (COD-258): its row opens that chat. */
  taskId?: string;
  /**
   * One kind of news from one place, such as one orglet's side-thread answers (COD-287). A new notice of the group
   * replaces the group's unread one, so the list and the count grow by one row however many answers land.
   */
  group?: string;
  /** How many pieces of news a grouped notice stands for; absent means one. */
  groupSize?: number;
};

export const noticeKindNames: Record<NoticeKind, string> = translated({ error: 'Lỗi', done: 'Đã xong', info: 'Thông tin' });
/** The order the filter offers, with everything first. */
export const noticeKinds: NoticeKind[] = ['error', 'done', 'info'];

const storageKey = 'orglet.notices';
const LIMIT = 200;

/** Web storage is missing in a test process; reading through this keeps the module loadable there. */
function readStored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function read(): Notice[] {
  try {
    const value = JSON.parse(readStored(storageKey) || '[]') as Notice[];
    return Array.isArray(value) ? value.slice(-LIMIT) : [];
  } catch { return []; }
}

let notices = read();
let nextId = notices.reduce((highest, notice) => Math.max(highest, notice.id), 0) + 1;
let seenAt = Number(readStored(`${storageKey}.seen`) ?? 0);
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const save = () => {
  try { localStorage.setItem(storageKey, JSON.stringify(notices)); } catch { /* a blocked store costs the note, not the app */ }
};

export type NoticeDetails = { confirmation?: boolean; taskId?: string; group?: string; groupSize?: number };

/** Records one message. Called by `toast`, so nothing has to remember to do both. */
export function recordNotice(text: string, kind: NoticeKind, about?: string, details: NoticeDetails = {}) {
  const trimmedAbout = about?.trim();
  const notice: Notice = {
    id: nextId++,
    at: new Date().toISOString(),
    kind,
    text,
    ...(trimmedAbout ? { about: trimmedAbout } : {}),
    ...(details.confirmation ? { confirmation: true as const } : {}),
    ...(details.taskId ? { taskId: details.taskId } : {}),
    ...(details.group ? { group: details.group } : {}),
    ...(details.group && details.groupSize && details.groupSize > 1 ? { groupSize: details.groupSize } : {}),
  };
  const next = withNotice(notices, seenAt, notice);
  if (next === notices) return;
  notices = next;
  save();
  emit();
}

/**
 * The list once one more notice arrives (COD-287). A problem that is already waiting unread, word for word about
 * the same thing, is the same problem still happening: a refresh that keeps failing, or the same action refused
 * again, adds nothing until the person has looked (the list comes back unchanged, the same array). A grouped notice
 * takes the place of its group's unread one.
 */
export function withNotice(list: Notice[], seenSince: number, notice: Notice): Notice[] {
  const repeatsProblem = notice.kind === 'error' && list.some(existing => existing.kind === 'error' && isUnreadNotice(existing, seenSince) && sameNotice(existing, notice));
  if (repeatsProblem) return list;
  const kept = notice.group
    ? list.filter(existing => existing.group !== notice.group || !isUnreadNotice(existing, seenSince))
    : list;
  return [...kept, notice].slice(-LIMIT);
}

/** How many pieces of news a group's unread notice already stands for, so the next one can say the new total. */
export function unreadGroupSize(list: readonly Notice[], seenSince: number, group: string): number {
  const waiting = list.findLast(existing => existing.group === group && isUnreadNotice(existing, seenSince));
  if (!waiting) return 0;
  return waiting.groupSize ?? 1;
}

/** `unreadGroupSize` for the notices kept in this window. */
export function pendingGroupSize(group: string): number {
  return unreadGroupSize(notices, seenAt, group);
}

export function useNotices() {
  return useSyncExternalStore(subscribe, () => notices, () => notices);
}

/** Whether a notice waits for the person: it arrived after `seenSince` and is not a confirmation of their own action. */
export function isUnreadNotice(notice: Notice, seenSince: number) {
  return notice.id > seenSince && !notice.confirmation;
}

/** How many arrived since the list was last opened, which is what the button shows. */
export function useUnreadNotices() {
  return useSyncExternalStore(subscribe, () => notices.filter(notice => isUnreadNotice(notice, seenAt)).length, () => 0);
}

/** The newest notice already seen, read before the centre marks everything seen so it can tell new rows from old. */
export function noticesSeenAt() {
  return seenAt;
}

export function markNoticesSeen() {
  const newest = notices.at(-1)?.id ?? 0;
  if (newest === seenAt) return;
  seenAt = newest;
  try { localStorage.setItem(`${storageKey}.seen`, String(seenAt)); } catch { /* unread count resets next launch */ }
  emit();
}

export function clearNotices() {
  if (!notices.length) return;
  notices = [];
  seenAt = 0;
  save();
  try { localStorage.setItem(`${storageKey}.seen`, '0'); } catch { /* the list is already gone */ }
  emit();
}

/** One row of the centre: the latest of a run of identical notices, with how many there were and when each came. */
export type NoticeRow = { notice: Notice; count: number; times: string[] };

/** Two notices are one thing that happened twice only when they also point at the same chat, if any. */
const sameNotice = (one: Notice, two: Notice) => one.kind === two.kind && one.text === two.text && (one.about ?? '') === (two.about ?? '') && (one.taskId ?? '') === (two.taskId ?? '');

/**
 * Folds consecutive identical notices into one row. Six "Đã lưu · Ngôn ngữ" in a row are one thing that happened
 * six times, not six things (COD-174). The input is in the order the centre lists, newest first, so each row's
 * notice is the latest of its run and its times start with the latest.
 */
export function collapseNotices(newestFirst: Notice[]): NoticeRow[] {
  const rows: NoticeRow[] = [];
  for (const notice of newestFirst) {
    const previous = rows.at(-1);
    if (previous && sameNotice(previous.notice, notice)) {
      previous.count += 1;
      previous.times.push(notice.at);
      continue;
    }
    rows.push({ notice, count: 1, times: [notice.at] });
  }
  return rows;
}

/**
 * Rows in the order the centre lists them: what arrived since it was last opened first, then the rest, each part
 * newest first. A confirmation is never new (COD-255), so a newer "Saved" can sit above an older side-thread answer
 * in time; without this the answer's "new" heading split one day into two (dogfood, 2026-09-26).
 */
export function newNoticesFirst(rows: NoticeRow[], newSince: number | null): NoticeRow[] {
  if (newSince === null) return rows;
  const unread = rows.filter(row => isUnreadNotice(row.notice, newSince));
  const read = rows.filter(row => !isUnreadNotice(row.notice, newSince));
  return [...unread, ...read];
}

/**
 * The heading each row sits under: "new" for what arrived since the centre was last opened, then the day for the
 * rest, so a new notice never hides among old ones (user, 2026-09-23). Give it rows from `newNoticesFirst`, so the
 * new ones lead and each heading shows once.
 */
export function noticeGroupLabels(rows: NoticeRow[], newSince: number | null, newLabel: string, dayOf: (iso: string) => string) {
  return rows.map(row => newSince !== null && isUnreadNotice(row.notice, newSince) ? newLabel : dayOf(row.notice.at));
}
