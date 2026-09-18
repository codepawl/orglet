import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import type { TaskDetail, Workspace } from '../../shared/contracts';
import { isHarness } from '../../shared/harness';
import { Button } from './ui';
import { formatMoney } from './money';
import { providerLabel, type Readiness } from './providers';
import { t } from '../i18n';
import { taskWorkers } from '../assignees';
import { orglet } from '../api';

const SINGLE_LINE = 44;

/**
 * ChatGPT-style prompt bar: a one-line pill with the add button, input and send button on one row.
 * It grows into a multi-line box once the text wraps or attachments appear, and stays grown until cleared
 * so the layout does not flip back and forth at the wrap point.
 */
export function Composer({ value, onChange, onSubmit, label, placeholder, sendLabel, leading, trailing, attachments, disabled, sendDisabled, textareaRef }: { value: string; onChange: (value: string) => void; onSubmit: () => void; label: string; placeholder: string; sendLabel: string; leading: ReactNode; /** Sits left of the send button (e.g. who this message goes to). */ trailing?: ReactNode; attachments?: ReactNode; disabled?: boolean; sendDisabled?: boolean; textareaRef?: RefObject<HTMLTextAreaElement | null> }) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownRef;
  const [expanded, setExpanded] = useState(false);
  const canSend = !disabled && !sendDisabled && value.trim().length > 0;
  const hasAttachments = Boolean(attachments);
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
  return <form className={`composer${expanded ? ' expanded' : ''}${trailing ? ' has-trailing' : ''}`} onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }}>
    {attachments && <div className="composer-attachments">{attachments}</div>}
    <div className="composer-leading">{leading}</div>
    <textarea ref={textarea} aria-label={label} placeholder={placeholder} value={value} disabled={disabled} rows={1} maxLength={16000}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) onSubmit(); } }} />
    {trailing && <div className="composer-trailing">{trailing}</div>}
    <Button type="submit" variant="primary" size="icon" className="send" aria-label={sendLabel} disabled={!canSend}><ArrowUp size={19} /></Button>
  </form>;
}

/** Follow-up bar under a task: the text becomes an extra instruction for a new review of the same sources. */
export function FollowUpComposer({ detail, workspace, ready, openRevision, openSettings, action }: { detail: TaskDetail; workspace: Workspace; ready: Readiness; openRevision: () => void; openSettings: () => void; action: (fn: () => Promise<unknown>) => void }) {
  const [text, setText] = useState('');
  const input = detail.task.currentInput ?? detail.task;
  const workers = taskWorkers(detail.task, workspace);
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const paid = providers.some(provider => !isHarness(provider));
  const missing = providers.filter(provider => !ready[provider]);
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const blocked = missing.length > 0;
  const used = detail.usage.chargedMicros + detail.usage.reservedMicros;
  const budget = detail.task.budgetMicros;
  const send = () => {
    const extra = text.trim(); if (!extra || busy || blocked) return;
    setText('');
    action(() => orglet.call('reviseTask', { taskId: detail.task.id, brief: extra, sourceIds: input.sourceIds.filter(id => !detail.sources.find(source => source.id === id)?.revoked), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros }));
  };
  return <div className="thread-composer">
    <Composer value={text} onChange={setText} onSubmit={send} label={t('Tin nhắn')} placeholder={busy ? t('Đang làm việc…') : t('Nhắn tiếp…')} sendLabel={t('Gửi tin nhắn')} disabled={busy} sendDisabled={blocked}
      leading={<Button type="button" size="icon" className="composer-add" aria-label={t('Đính kèm tệp')} title={t('Đính kèm tệp')} disabled={busy} onClick={openRevision}><Plus size={20} /></Button>} />
    {!busy && blocked && <p className="composer-note">{t('Cần kết nối {0} trước khi gửi.', [missing.map(providerLabel).join(t(' và '))])}<button type="button" onClick={openSettings}>{t('Mở Cài đặt')}</button></p>}
    {paid && <p className="composer-note composer-cost" role="status">{detail.usage.reservedMicros > 0
      ? t('Đã dùng {0} / {1} · đang giữ chỗ {2}', [formatMoney(detail.usage.chargedMicros), formatMoney(budget), formatMoney(detail.usage.reservedMicros)])
      : t('Đã dùng {0} / {1}', [formatMoney(used), formatMoney(budget)])}</p>}
    {!paid && providers.length > 0 && <p className="composer-note">{t('Harness trên máy · chi phí theo gói của công cụ, không qua Orglet.')}</p>}
  </div>;
}
