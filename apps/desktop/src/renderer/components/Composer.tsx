import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Plus, Square } from 'lucide-react';
import type { TaskDetail, Worker, Workspace } from '../../shared/contracts';
import { insertMention, mentionOptions, mentionQueryAt } from '../../shared/mentions';
import { Button } from './ui';
import { Avatar } from './Avatar';
import { MentionText } from './mentions';
import { providerLabel, settingsTabFor, type Readiness } from './providers';
import { t } from '../i18n';import { taskWorkers } from '../assignees';
import { orglet } from '../api';

const SINGLE_LINE = 40;

export type MentionRoster = { people: readonly Worker[]; allNames?: readonly string[] };

/**
 * ChatGPT-style prompt bar: a one-line pill with the add button, input and send button on one row.
 * It grows into a multi-line box once the text wraps or attachments appear, and stays grown until cleared
 * so the layout does not flip back and forth at the wrap point.
 * Team and group chats can pass `mentions` so `@` opens a worker picker.
 */
export function Composer({ value, onChange, onSubmit, label, placeholder, sendLabel, leading, trailing, attachments, disabled, sendDisabled, textareaRef, mentions, onStop }: { value: string; onChange: (value: string) => void; onSubmit: () => void; label: string; placeholder: string; sendLabel: string; leading: ReactNode; /** Sits left of the send button (e.g. who this message goes to). */ trailing?: ReactNode; attachments?: ReactNode; disabled?: boolean; sendDisabled?: boolean; textareaRef?: RefObject<HTMLTextAreaElement | null>; mentions?: MentionRoster;
  /**
   * Set while a run is in progress: the send button becomes the stop button, turning a ring so the eye lands on
   * it (user, 2026-09-19). Stop belongs where send was, because that is where the hand already is, and nothing
   * can be sent while the worker is still answering.
   */
  onStop?: () => void }) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownRef;
  const highlight = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number>();
  const canSend = !disabled && !sendDisabled && value.trim().length > 0;
  const hasAttachments = Boolean(attachments);
  const mentionable = Boolean(mentions && (mentions.people.length > 1 || mentions.allNames?.length));
  const query = mentionable && !disabled ? mentionQueryAt(value, cursor) : undefined;
  const options = query && query.start !== dismissed ? mentionOptions(query.query, mentions!.people) : [];
  const menuOpen = options.length > 0;
  const selected = options[Math.min(active, Math.max(0, options.length - 1))];
  useLayoutEffect(() => { setActive(0); }, [query?.start, query?.query]);
  useLayoutEffect(() => {
    const element = textarea.current; if (!element) return;
    const measure = () => {
      // An empty bar is always one line; measuring then would pick up transient widths while the layout settles.
      if (!element.value) { element.style.height = ''; element.style.overflowY = 'hidden'; setExpanded(hasAttachments); return; }
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 250)}px`;
      element.style.overflowY = element.scrollHeight > 250 ? 'auto' : 'hidden';
      setExpanded(current => hasAttachments || current || element.scrollHeight > SINGLE_LINE);
    };
    measure();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; measure(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, hasAttachments, textarea]);
  const syncCursor = (element: HTMLTextAreaElement) => setCursor(element.selectionStart ?? 0);
  const pick = (option: typeof selected) => {
    if (!option) return;
    const next = insertMention(value, cursor, option.name);
    onChange(next.text);
    setDismissed(query?.start);
    requestAnimationFrame(() => {
      const element = textarea.current; if (!element) return;
      element.focus();
      element.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % options.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + options.length) % options.length); return; }
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(query?.start); return; }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); pick(selected); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) onSubmit(); }
  };
  return <form className={`composer${expanded ? ' expanded' : ''}${trailing ? ' has-trailing' : ''}`} onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }}>
    {menuOpen && <ul id={listId} className="mention-menu" role="listbox" aria-label={t('Gắn thẻ nhân viên')}>
      {options.map((option, index) => {
        const worker = option.kind === 'worker' ? mentions!.people.find(item => item.id === option.id) : undefined;
        const optionId = `${listId}-${option.kind}-${option.name}`;
        return <li key={optionId} role="presentation">
          <button type="button" id={optionId} role="option" aria-selected={option === selected} className={index === Math.min(active, options.length - 1) ? 'active' : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => pick(option)}>
            {worker
              ? <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />
              : <span className="mention-all" aria-hidden="true">@</span>}
            <span><strong>@{option.name}</strong>{(option.kind === 'all' || worker?.description) && <small>{option.kind === 'all' ? t('Tất cả trong cuộc trò chuyện này') : worker?.description}</small>}</span>
          </button>
        </li>;
      })}
    </ul>}
    {attachments && <div className="composer-attachments">{attachments}</div>}
    <div className="composer-leading">{leading}</div>
    {/* The same string, painted above the box, so a tag is coloured while it is typed. The trailing newline gives
        the overlay the extra line a textarea shows for a trailing Enter, so the two never disagree on height. */}
    {mentionable && <div className="composer-highlight" ref={highlight} aria-hidden="true"><MentionText text={value} people={mentions!.people} allNames={mentions!.allNames} />{'\n'}</div>}
    <textarea ref={textarea} className={mentionable ? 'has-highlight' : undefined} aria-label={label} placeholder={placeholder} value={value} disabled={disabled} rows={1} maxLength={16000}
      onScroll={event => { if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop; }}
      aria-autocomplete={mentionable ? 'list' : undefined} aria-controls={menuOpen ? listId : undefined} aria-expanded={mentionable ? menuOpen : undefined} aria-activedescendant={menuOpen && selected ? `${listId}-${selected.kind}-${selected.name}` : undefined}
      onChange={event => { onChange(event.target.value); syncCursor(event.target); setDismissed(undefined); }}
      onKeyUp={event => syncCursor(event.currentTarget)} onClick={event => syncCursor(event.currentTarget)} onSelect={event => syncCursor(event.currentTarget)}
      onKeyDown={onKeyDown} />
    {trailing && <div className="composer-trailing">{trailing}</div>}
    {onStop
      ? <Button type="button" variant="primary" size="icon" className="send stop" aria-label={t('Dừng')} title={t('Dừng')} onClick={onStop}>
        <span className="send-spin" aria-hidden="true" />
        <Square size={11} fill="currentColor" />
      </Button>
      : <Button type="submit" variant="primary" size="icon" className="send" aria-label={sendLabel} disabled={!canSend}><ArrowUp size={19} /></Button>}
  </form>;
}

/** Follow-up bar under a task: the text becomes an extra instruction for a new review of the same sources. */
export function FollowUpComposer({ detail, workspace, ready, openRevision, openSettings, action }: { detail: TaskDetail; workspace: Workspace; ready: Readiness; openRevision: () => void; openSettings: (tab?: 'connections' | 'harness') => void; action: (fn: () => Promise<unknown>) => void }) {
  const [text, setText] = useState('');
  const input = detail.task.currentInput ?? detail.task;
  const workers = taskWorkers(detail.task, workspace);
  const team = detail.task.teamId ? workspace.teams.find(item => item.id === detail.task.teamId) : undefined;
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const missing = providers.filter(provider => !ready[provider]);
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const blocked = missing.length > 0;
  const send = () => {
    const extra = text.trim(); if (!extra || busy || blocked) return;
    setText('');
    action(() => orglet.call('reviseTask', { taskId: detail.task.id, brief: extra, sourceIds: input.sourceIds.filter(id => !detail.sources.find(source => source.id === id)?.revoked), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros }));
  };
  return <div className="thread-composer">
    <Composer value={text} onChange={setText} onSubmit={send} label={t('Tin nhắn')} placeholder={busy ? t('Đang làm việc…') : t('Nhắn tiếp…')} sendLabel={t('Gửi tin nhắn')} disabled={busy} sendDisabled={blocked}
      onStop={busy ? () => action(() => orglet.call('cancel', { id: detail.task.id })) : undefined}
      mentions={workers.length > 1 || team ? { people: workers, ...(team ? { allNames: [team.name] } : {}) } : undefined}
      leading={<Button type="button" size="icon" className="composer-add" aria-label={t('Đính kèm tệp')} title={t('Đính kèm tệp')} disabled={busy} onClick={openRevision}><Plus size={20} /></Button>} />
    {!busy && blocked && <p className="composer-note">{t('Cần kết nối {0} trước khi gửi.', [missing.map(providerLabel).join(t(' và '))])}<button type="button" onClick={() => openSettings(settingsTabFor(missing))}>{t('Mở Cài đặt')}</button></p>}
  </div>;
}
