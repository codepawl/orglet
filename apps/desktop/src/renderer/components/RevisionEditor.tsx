import { useState } from 'react';
import type { Source, TaskDetail, Workspace } from '../../shared/contracts';
import { Button, FieldLabel, MoneyInput } from './ui';
import { MessageSquare, Wallet } from 'lucide-react';
import { formatMoney, toAmount, toMicros } from './money';
import { providerLabel, type Readiness } from './providers';
import { t } from '../i18n';
import { taskWorkers } from '../assignees';
import { orglet } from '../api';

export function RevisionEditor({ detail, workspace, connections, done }: { detail: TaskDetail; workspace: Workspace; connections: Readiness; done: () => void }) {
  const input = detail.task.currentInput ?? detail.task;
  const [brief, setBrief] = useState('');
  const [sources, setSources] = useState<Source[]>(detail.sources.filter(source => input.sourceIds.includes(source.id) && !source.revoked));
  const [budget, setBudget] = useState(toAmount(detail.task.budgetMicros));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const workers = taskWorkers(detail.task, workspace);
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const missing = providers.filter(provider => !connections[provider]);
  return <form className="form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await orglet.call('reviseTask', { taskId: detail.task.id, brief, sourceIds: sources.map(source => source.id), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: toMicros(budget) });
      done();
    } catch (error) { setError(error instanceof Error ? error.message : t('Không gửi được tin nhắn.')); }
    finally { setBusy(false); }
  }}>
    <label><FieldLabel icon={MessageSquare} required>{t('Tin nhắn')}</FieldLabel><textarea value={brief} onChange={event => setBrief(event.target.value)} rows={5} maxLength={16000} required /></label>
    <h3>{t('Tệp đính kèm ({0}/20)', [sources.length])}</h3>
    {!sources.length && <p>{t('Chưa chọn nguồn.')}</p>}
    {sources.map(source => <div className="actions" key={source.id}><span>{source.name}</span><Button type="button" disabled={busy} aria-label={t('Bỏ nguồn {0}', [source.name])} onClick={() => { setSources(current => current.filter(item => item.id !== source.id)); }}>{t('Bỏ nguồn')}</Button></div>)}
    <Button type="button" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const picked = await orglet.pickSources(); const next = [...new Map([...sources, ...picked].map(source => [source.id, source])).values()];
        if (next.length > 20) throw new Error(t('Tối đa 20 tệp cho một tin nhắn. Bỏ bớt tệp rồi chọn lại.'));
        setSources(next);
      } catch (error) { setError(error instanceof Error ? error.message : t('Không thể thêm nguồn.')); }
      finally { setBusy(false); }
    }}>{t('Bổ sung tệp')}</Button>
    <label><FieldLabel icon={Wallet} required>{t('Giới hạn tổng task')}</FieldLabel><MoneyInput type="number" min="0" step="any" required value={budget} onChange={setBudget} /></label>
    <p className="muted">{t('Đã đối soát {0} · giữ chỗ {1}. Giới hạn này tính cả các tin nhắn trước.', [formatMoney(detail.usage.chargedMicros), formatMoney(detail.usage.reservedMicros)])}</p>
    {providers.length ? null : <p className="muted">{t('Demo không gọi model; checker đã cấu hình vẫn chạy trên máy.')}</p>}
    {missing.length > 0 && <p role="status">{t('Cần kết nối hoặc đăng nhập {0} (xem Cài đặt) trước khi chạy.', [missing.map(providerLabel).join(', ')])}</p>}
    <div className="actions">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button variant="primary" disabled={busy || !brief.trim() || missing.length > 0}>{t('Gửi tin nhắn')}</Button>
    </div>
  </form>;
}
