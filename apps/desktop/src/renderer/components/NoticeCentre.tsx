import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Info, Trash } from 'lucide-react';
import { Button, Drawer } from './ui';
import { clearNotices, markNoticesSeen, noticeKindNames, noticeKinds, useNotices, type NoticeKind } from './notifications';
import { currentLocale, t, tMessage } from '../i18n';

const kindIcons: Record<NoticeKind, typeof Info> = { error: CircleAlert, done: CircleCheck, info: Info };

/** Today, yesterday, or the date — a wall of identical timestamps is not a list anyone reads. */
function dayLabel(iso: string) {
  const at = new Date(iso);
  const today = new Date();
  const sameDay = (one: Date, two: Date) => one.toDateString() === two.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(at, today)) return t('Hôm nay');
  if (sameDay(at, yesterday)) return t('Hôm qua');
  return at.toLocaleDateString(currentLocale(), { day: '2-digit', month: '2-digit' });
}

/**
 * Everything the app has said, after the toast has gone. Opened from the sidebar, filtered by what kind of thing
 * it was, newest first and grouped by day. A toast is the right shape for a message you are looking at, and the
 * wrong one for a failure that arrived while you were somewhere else (user, 2026-09-20).
 */
export function NoticeCentre({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notices = useNotices();
  const [kind, setKind] = useState<NoticeKind | 'all'>('all');
  useEffect(() => { if (open) markNoticesSeen(); }, [open, notices.length]);

  const shown = useMemo(() => [...notices].reverse().filter(notice => kind === 'all' || notice.kind === kind), [notices, kind]);
  const counts = useMemo(() => {
    const total: Record<string, number> = { all: notices.length };
    for (const name of noticeKinds) total[name] = notices.filter(notice => notice.kind === name).length;
    return total;
  }, [notices]);

  if (!open) return null;
  return <Drawer open onClose={onClose} title={t('Thông báo')} description={t('Mọi thông báo đã hiện, giữ lại ở đây.')}
    actions={notices.length > 0 ? <Button variant="outline" onClick={() => clearNotices()}><Trash size={15} />{t('Xóa hết')}</Button> : undefined}>
    <div className="notice-filters" role="group" aria-label={t('Lọc thông báo')}>
      {(['all', ...noticeKinds] as const).map(name => <button key={name} type="button" className={kind === name ? 'notice-filter on' : 'notice-filter'}
        aria-pressed={kind === name} onClick={() => setKind(name)}>
        {name === 'all' ? t('Tất cả') : noticeKindNames[name]}<span>{counts[name] ?? 0}</span>
      </button>)}
    </div>
    {shown.length === 0
      ? <p className="muted">{notices.length === 0 ? t('Chưa có thông báo nào.') : t('Không có thông báo nào thuộc mục này.')}</p>
      : <ol className="notice-list">
        {shown.map((notice, index) => {
          const Icon = kindIcons[notice.kind];
          const day = dayLabel(notice.at);
          const newDay = index === 0 || dayLabel(shown[index - 1].at) !== day;
          return <li key={notice.id} className={`notice notice-${notice.kind}`}>
            {newDay && <p className="notice-day">{day}</p>}
            <div className="notice-body">
              <Icon size={15} aria-hidden="true" />
              <span className="notice-text">{tMessage(notice.text)}</span>
              <time dateTime={notice.at}>{new Date(notice.at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          </li>;
        })}
      </ol>}
  </Drawer>;
}
