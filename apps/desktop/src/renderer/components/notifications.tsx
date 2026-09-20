import { useSyncExternalStore } from 'react';
import { translated } from '../i18n';

/**
 * Everything the app has told you, kept after the toast has gone.
 *
 * A toast says something once and disappears, which is right for "Đã lưu" and wrong for a failure you were not
 * looking at — the owner hit exactly that with a red banner they could only dismiss (2026-09-20). Every message
 * raised anywhere is recorded here, so the toast can stay brief and nothing is lost by missing it.
 *
 * Stored in the browser, not in the workspace: these are notes about this machine's session, not work. They are
 * capped so the list cannot grow without bound, and a blocked store costs a note rather than an error.
 */

export type NoticeKind = 'error' | 'done' | 'info';
export type Notice = { id: number; at: string; kind: NoticeKind; text: string };

export const noticeKindNames: Record<NoticeKind, string> = translated({ error: 'Lỗi', done: 'Đã xong', info: 'Thông tin' });
/** The order the filter offers, with everything first. */
export const noticeKinds: NoticeKind[] = ['error', 'done', 'info'];

const storageKey = 'orglet.notices';
const LIMIT = 200;

function read(): Notice[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]') as Notice[];
    return Array.isArray(value) ? value.slice(-LIMIT) : [];
  } catch { return []; }
}

let notices = read();
let nextId = notices.reduce((highest, notice) => Math.max(highest, notice.id), 0) + 1;
let seenAt = Number(localStorage.getItem(`${storageKey}.seen`) ?? 0);
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const save = () => {
  try { localStorage.setItem(storageKey, JSON.stringify(notices)); } catch { /* a blocked store costs the note, not the app */ }
};

/** Records one message. Called by `toast`, so nothing has to remember to do both. */
export function recordNotice(text: string, kind: NoticeKind) {
  notices = [...notices, { id: nextId++, at: new Date().toISOString(), kind, text }].slice(-LIMIT);
  save();
  emit();
}

export function useNotices() {
  return useSyncExternalStore(subscribe, () => notices, () => notices);
}

/** How many arrived since the list was last opened, which is what the button shows. */
export function useUnreadNotices() {
  return useSyncExternalStore(subscribe, () => notices.filter(notice => notice.id > seenAt).length, () => 0);
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
