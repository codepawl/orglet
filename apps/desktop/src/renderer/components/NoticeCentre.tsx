import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Info, Trash } from 'lucide-react';
import { Button, Drawer } from './ui';
import { clearNotices, collapseNotices, markNoticesSeen, noticeKindNames, noticeKinds, useNotices, type NoticeKind, type NoticeRow } from './notifications';
import { clockLabel, dayLabel } from './TimeMark';
import { t, tMessage } from '../i18n';

const kindIcons: Record<NoticeKind, typeof Info> = { error: CircleAlert, done: CircleCheck, info: Info };

/**
 * Everything the app has said, after the toast has gone. Opened from the sidebar, filtered by what kind of thing
 * it was, newest first and grouped by day. A toast is the right shape for a message you are looking at, and the
 * wrong one for a failure that arrived while you were somewhere else (user, 2026-09-20).
 *
 * Each row says what happened and what it was about, and a run of identical notices is one row with a count
 * (COD-174): the owner opened this to twelve rows reading "Saved" and "Command not allowed." and nothing else.
 */
export function NoticeCentre({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notices = useNotices();
  const [kind, setKind] = useState<NoticeKind | 'all'>('all');
  useEffect(() => { if (open) markNoticesSeen(); }, [open, notices.length]);

  const rows = useMemo(() => {
    const newestFirst = [...notices].reverse().filter(notice => kind === 'all' || notice.kind === kind);
    return collapseNotices(newestFirst);
  }, [notices, kind]);
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
    {rows.length === 0
      ? <p className="muted notice-empty">{notices.length === 0 ? t('Chưa có thông báo nào.') : t('Không có thông báo nào thuộc mục này.')}</p>
      : <ol className="notice-list">
        {rows.map((row, index) => {
          const day = dayLabel(row.notice.at);
          const newDay = index === 0 || dayLabel(rows[index - 1].notice.at) !== day;
          return <li key={row.notice.id} className={`notice notice-${row.notice.kind}`}>
            {newDay && <p className="notice-day">{day}</p>}
            <NoticeItem row={row} />
          </li>;
        })}
      </ol>}
  </Drawer>;
}

/**
 * One row: the icon carries the kind's colour, the message reads in full, the line under it says what it was
 * about, and the time on the right is the latest. A repeated notice says how many times and opens to the times.
 */
function NoticeItem({ row }: { row: NoticeRow }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = kindIcons[row.notice.kind];
  const repeated = row.count > 1;
  const content = <>
    <Icon size={15} aria-hidden="true" />
    <span className="notice-text">
      <span className="notice-line">
        <span className="notice-message">{tMessage(row.notice.text)}</span>
        {repeated && <span className="notice-count">{t('{0} lần', [row.count])}<ChevronDown size={13} aria-hidden="true" /></span>}
      </span>
      {row.notice.about && <span className="notice-about">{tMessage(row.notice.about)}</span>}
    </span>
    <time dateTime={row.notice.at}>{clockLabel(row.notice.at)}</time>
  </>;
  if (!repeated) return <div className="notice-body">{content}</div>;
  return <>
    <button type="button" className="notice-body" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{content}</button>
    {expanded && <ol className="notice-times" aria-label={t('Các lần xuất hiện')}>
      {row.times.map(at => <li key={at}><time dateTime={at}>{clockLabel(at)}</time></li>)}
    </ol>}
  </>;
}
