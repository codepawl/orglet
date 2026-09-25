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

/** Records one message. Called by `toast`, so nothing has to remember to do both. */
export function recordNotice(text: string, kind: NoticeKind, about?: string, confirmation = false) {
  const trimmedAbout = about?.trim();
  const notice: Notice = {
    id: nextId++,
    at: new Date().toISOString(),
    kind,
    text,
    ...(trimmedAbout ? { about: trimmedAbout } : {}),
    ...(confirmation ? { confirmation: true as const } : {}),
  };
  notices = [...notices, notice].slice(-LIMIT);
  save();
  emit();
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

const sameNotice = (one: Notice, two: Notice) => one.kind === two.kind && one.text === two.text && (one.about ?? '') === (two.about ?? '');

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
 * The heading each row sits under: "new" for what arrived since the centre was last opened, then the day for the
 * rest, so a new notice never hides among old ones (user, 2026-09-23). Rows are newest first, so new ones lead.
 */
export function noticeGroupLabels(rows: NoticeRow[], newSince: number | null, newLabel: string, dayOf: (iso: string) => string) {
  return rows.map(row => newSince !== null && isUnreadNotice(row.notice, newSince) ? newLabel : dayOf(row.notice.at));
}
