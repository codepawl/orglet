import { useEffect } from 'react';
import type { AppChangeNotice } from '../shared/app-proposals';
import { toast } from './components/toast';
import { t } from './i18n';

const seenStorageKey = 'orglet.app-change-notices-seen';
const SEEN_LIMIT = 200;

/**
 * Every change a worker made to the app is announced once, whether the user clicked Apply or the orglet applied it
 * on its own, so nothing about the app changes without the person hearing of it (user, 2026-09-23). The first time
 * this runs it only remembers what already happened, so opening the app does not replay old changes.
 */
export function useAppChangeNotices(changes: AppChangeNotice[] | undefined) {
  useEffect(() => {
    if (!changes) return;
    const seen = readSeen();
    if (seen === null) {
      writeSeen(changes.map(change => change.id));
      return;
    }
    const fresh = unannouncedChanges(changes, seen);
    if (!fresh.length) return;
    // A change the orglet applied by itself is news; one the person applied with a click was read as it happened (COD-255).
    for (const change of [...fresh].reverse()) toast(appChangeMessage(change), 'success', change.title, { unread: change.automatic });
    writeSeen([...fresh.map(change => change.id), ...seen]);
  }, [changes]);
}

/** Changes not announced yet, newest first, as the core lists them. */
export function unannouncedChanges(changes: AppChangeNotice[], seen: readonly string[]) {
  const known = new Set(seen);
  return changes.filter(change => !known.has(change.id));
}

export function appChangeMessage(change: AppChangeNotice) {
  const worker = change.workerName || t('Một Tí');
  const what = changeDescription(change);
  return change.automatic ? t('{0} đã tự áp dụng: {1}', [worker, what]) : t('{0}: đã áp dụng {1}', [worker, what]);
}

function changeDescription(change: AppChangeNotice) {
  if (change.kind === 'settings') return t('đổi cài đặt');
  if (change.kind === 'crew_template') return t('xuất template hội');
  const creating = change.action === 'create';
  if (change.kind === 'orglet') return creating ? t('tạo Tí mới') : t('sửa Tí');
  if (change.kind === 'crew') return creating ? t('tạo hội mới') : t('sửa hội');
  if (change.kind === 'skill') return creating ? t('tạo skill mới') : t('sửa skill');
  return creating ? t('tạo lịch chạy mới') : t('sửa lịch chạy');
}

function readSeen(): string[] | null {
  try {
    const stored = localStorage.getItem(seenStorageKey);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return null;
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(seenStorageKey, JSON.stringify(ids.slice(0, SEEN_LIMIT)));
  } catch {
    /* a blocked store only means a change may be announced again next launch */
  }
}
