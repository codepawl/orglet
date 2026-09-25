import { useState } from 'react';
import type { FolderIntake, Source, TaskDetail, Workspace } from '../../shared/contracts';
import { attachIntake } from '../../shared/incoming';
import { Button, FieldLabel } from './ui';
import { Attachment } from './Attachment';
import { MessageSquare } from 'lucide-react';
import { formatMoney } from './money';
import { providerLabel, type Readiness } from './providers';
import { t, tMessage } from '../i18n';
import { taskWorkers } from '../assignees';
import { orglet } from '../api';
import { Textarea } from '@codepawl/orglet-ui';

/**
 * The next message of a chat that already has one, with its files. `added` are files sent from Explorer (COD-246):
 * they join the chat's current files the way picked files do, and the ones that did not fit are listed as skipped.
 * `initialText` is a draft carried over from the empty chat the window left (COD-246).
 */
export function RevisionEditor({ detail, workspace, connections, added, initialText, done }: { detail: TaskDetail; workspace: Workspace; connections: Readiness; added?: FolderIntake; initialText?: string; done: () => void }) {
  const input = detail.task.currentInput ?? detail.task;
  const [brief, setBrief] = useState(initialText ?? '');
  const current = detail.sources.filter(source => input.sourceIds.includes(source.id) && !source.revoked);
  const [initial] = useState(() => added ? attachIntake(current, added) : { sources: current, skipped: [] });
  const [sources, setSources] = useState<Source[]>(initial.sources);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const workers = taskWorkers(detail.task, workspace);
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const missing = providers.filter(provider => !connections[provider]);
  return <form className="form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await orglet.call('reviseTask', { taskId: detail.task.id, brief, sourceIds: sources.map(source => source.id), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros });
      done();
    } catch (error) { setError(error instanceof Error ? error.message : t('Không gửi được tin nhắn.')); }
    finally { setBusy(false); }
  }}>
    <label><FieldLabel icon={MessageSquare} required>{t('Tin nhắn')}</FieldLabel><Textarea value={brief} onChange={event => setBrief(event.target.value)} rows={5} maxLength={16000} required /></label>
    <h3>{t('Tệp đính kèm ({0}/20)', [sources.length])}</h3>
    {!sources.length && <p>{t('Chưa chọn nguồn.')}</p>}
    {sources.length > 0 && <ul className="attachment-list">{sources.map(source => <Attachment key={source.id} name={source.name} bytes={source.bytes} removeLabel={t('Bỏ nguồn {0}', [source.name])} onRemove={busy ? undefined : () => { setSources(current => current.filter(item => item.id !== source.id)); }} />)}</ul>}
    {initial.skipped.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [initial.skipped.length])}</summary><ul>{initial.skipped.map((item, index) => <li key={index}>{item.name}: {tMessage(item.reason)}</li>)}</ul></details>}
    <Button type="button" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const picked = await orglet.pickSources(); const next = [...new Map([...sources, ...picked].map(source => [source.id, source])).values()];
        if (next.length > 20) throw new Error(t('Tối đa 20 tệp cho một tin nhắn. Bỏ bớt tệp rồi chọn lại.'));
        setSources(next);
      } catch (error) { setError(error instanceof Error ? error.message : t('Không thể thêm nguồn.')); }
      finally { setBusy(false); }
    }}>{t('Bổ sung tệp')}</Button>
    {/* The limit is the crew's or orglet's Limit per task; core reads it on every turn, so there is no field to edit here. */}
    <p className="muted">{t('Giới hạn {0} · đã đối soát {1} · giữ chỗ {2}. Giới hạn này tính cả các tin nhắn trước.', [formatMoney(detail.task.budgetMicros), formatMoney(detail.usage.chargedMicros), formatMoney(detail.usage.reservedMicros)])}</p>
    {providers.length ? null : <p className="muted">{t('Demo không gọi model; checker đã cấu hình vẫn chạy trên máy.')}</p>}
    {missing.length > 0 && <p role="status">{t('Cần kết nối hoặc đăng nhập {0} (xem Cài đặt) trước khi chạy.', [missing.map(providerLabel).join(', ')])}</p>}
    <div className="actions">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button variant="primary" disabled={busy || !brief.trim() || missing.length > 0}>{t('Gửi tin nhắn')}</Button>
    </div>
  </form>;
}
