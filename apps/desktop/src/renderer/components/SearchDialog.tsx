import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, Users, X } from 'lucide-react';
import type { Task, Team } from '../../shared/contracts';
import { Button } from './ui';
import { t } from '../i18n';
import { currentLocale } from '../i18n';
import { StatusMark, taskStatusMark } from './StatusMark';
import { statusLabel } from './TaskThread';
import { taskResultSeen } from '../../shared/task-seen';

/** Vietnamese relative day labels like the reference palette; older items fall back to a short date. */
export function relativeDay(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (now.getTime() - date.getTime() < 60_000) return t('Vừa xong');
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return t('Hôm nay');
  if (days === 1) return t('Hôm qua');
  if (days < 7) return t('{0} ngày trước', [days]);
  return date.toLocaleDateString(currentLocale(), { day: '2-digit', month: '2-digit', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

// Accent- and case-insensitive so "danh gia" finds "đánh giá".
const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase();

export function SearchDialog({ open, onClose, tasks, teams, onOpenTask }: { open: boolean; onClose: () => void; tasks: Task[]; teams: Team[]; onOpenTask: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    return tasks.filter(task => { const text = fold(`${task.brief} ${task.teamSnapshot?.name ?? ''}`); return terms.every(term => text.includes(term)); }).slice(0, 50);
  }, [query, tasks]);
  useEffect(() => { if (!open) { setQuery(''); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const choose = (index: number) => { const task = results[index]; if (!task) return; onClose(); onOpenTask(task.id); };

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className="search-dialog" aria-describedby={undefined}>
        <Dialog.Title className="sr-only">{t('Tìm công việc')}</Dialog.Title>
        <div className="search-dialog-input">
          <Search size={20} aria-hidden="true" />
          <input autoFocus role="combobox" aria-expanded={results.length > 0} aria-controls="search-results" aria-activedescendant={results[active] ? `search-result-${results[active].id}` : undefined} aria-autocomplete="list" aria-label={t('Tìm công việc')} placeholder={t('Tìm công việc và nhóm')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, results.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(active); }
          }} />
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng tìm kiếm')}><X size={18} /></Button></Dialog.Close>
        </div>
        <ul className="search-results" id="search-results" role="listbox" aria-label={t('Kết quả')} ref={list}>
          {results.map((task, index) => {
            const team = task.teamId ? teams.find(item => item.id === task.teamId)?.name ?? task.teamSnapshot?.name : undefined;
            const mark = taskStatusMark(task.status, taskResultSeen(task));
            return <li key={task.id} id={`search-result-${task.id}`} data-index={index} role="option" aria-selected={index === active} className="search-result" onMouseMove={() => setActive(index)} onClick={() => choose(index)}>
              {team ? <Users size={17} aria-hidden="true" /> : <StatusMark variant={mark.variant} tone={mark.tone} label={statusLabel[task.status]} />}
              <span className="search-result-title">{task.brief}{team && <span className="search-result-team"> · {team}</span>}</span>
              {index === active ? <CornerDownLeft size={16} className="search-result-enter" aria-hidden="true" /> : <time className="search-result-time" dateTime={task.createdAt}>{relativeDay(task.createdAt)}</time>}
            </li>;
          })}
        </ul>
        {!results.length && <p className="search-empty">{tasks.length ? t('Không tìm thấy công việc.') : t('Chưa có công việc nào.')}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
