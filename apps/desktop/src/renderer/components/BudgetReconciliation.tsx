import { useState } from 'react';
import { FileCheck2, Wallet } from 'lucide-react';
import type { BudgetReservationView, Workspace } from '../../shared/contracts';
import { amountToMicros, usdCurrency } from '../../shared/currency';
import { t } from '../i18n';
import { Button, FieldLabel, MoneyInput } from './ui';
import { Checkbox } from './Checkbox';
import { Select } from './Select';

type Source = 'provider_dashboard' | 'invoice';

function reasonLabel(reason: BudgetReservationView['reason']) {
  if (reason === 'missing_usage') return t('Provider không trả usage');
  if (reason === 'request_failed') return t('Request lỗi hoặc chưa rõ kết quả');
  if (reason === 'interrupted') return t('App đóng khi request đang chạy');
  return t('Lịch sử cũ không ghi lý do');
}

function usd(micros: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000);
}

export function BudgetReconciliation({ workspace, busy, onReconcile }: {
  workspace: Workspace;
  busy: boolean;
  onReconcile: (reservationId: string, amountMicros: number, source: Source) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<Source>('provider_dashboard');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const unknown = workspace.budgetReservations.filter(item => item.resolvedAt === null);
  const resolved = workspace.budgetReservations.filter(item => item.resolvedAt !== null);
  const taskName = (item: BudgetReservationView) => {
    const task = workspace.tasks.find(candidate => candidate.id === item.taskId);
    return task?.title || task?.brief || item.taskId;
  };
  const reset = () => {
    setSelectedId(null);
    setAmount('');
    setSource('provider_dashboard');
    setVerified(false);
    setError('');
  };
  const submit = async (item: BudgetReservationView) => {
    const text = amount.trim();
    const micros = amountToMicros(text, usdCurrency);
    if (!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text) || !Number.isSafeInteger(micros) || micros < 0) {
      setError(t('Nhập số tiền USD từ hóa đơn hoặc trang usage, tối đa 6 chữ số thập phân.'));
      return;
    }
    if (!verified) {
      setError(t('Xác nhận đã kiểm tra khoản phí trên provider.'));
      return;
    }
    setError('');
    await onReconcile(item.id, micros, source);
    reset();
  };

  return <section className="budget-reviews" aria-labelledby="budget-reviews-title">
    <h3 id="budget-reviews-title">{t('Khoản cần đối soát')}</h3>
    <p className="muted">{t('Orglet giữ nguyên khoản dự phòng cho đến khi bạn kiểm tra phí thực tế trên provider. Nhập 0 chỉ khi provider xác nhận không tính phí.')}</p>
    {unknown.length === 0 ? <p className="muted">{t('Không có khoản chưa rõ chi phí.')}</p> : <ul className="budget-review-list">{unknown.map(item => <li key={item.id} className="budget-review-item">
      <div className="budget-review-heading">
        <div><strong>{item.provider} · {taskName(item)}</strong><p className="muted">{reasonLabel(item.reason)} · {item.month} · {t('Giữ chỗ {0}', [usd(item.originalMicros)])} · {t('Lượt {0}', [item.runId.slice(0, 8)])}</p></div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { if (selectedId === item.id) reset(); else { reset(); setSelectedId(item.id); } }}>
          <FileCheck2 size={14} aria-hidden="true" />{t('Đối soát')}
        </Button>
      </div>
      {selectedId === item.id && <form className="budget-review-form" onSubmit={event => { event.preventDefault(); void submit(item).catch(() => {}); }}>
        <label><FieldLabel icon={Wallet} required>{t('Phí thực tế (USD)')}</FieldLabel><MoneyInput currencyCode="USD" aria-label={t('Phí thực tế (USD)')} value={amount} onChange={setAmount} disabled={busy} autoFocus /></label>
        <label><FieldLabel icon={FileCheck2} required>{t('Nguồn đã kiểm tra')}</FieldLabel><Select ariaLabel={t('Nguồn đã kiểm tra')} value={source} disabled={busy} onChange={value => setSource(value as Source)} options={[{ value: 'provider_dashboard', label: t('Trang usage của provider') }, { value: 'invoice', label: t('Hóa đơn provider') }]} /></label>
        <Checkbox required checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)}>{t('Tôi đã kiểm tra phí thực tế trên provider')}</Checkbox>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}><FileCheck2 size={14} aria-hidden="true" />{t('Lưu đối soát')}</Button>
      </form>}
    </li>)}</ul>}
    {resolved.length > 0 && <details className="budget-review-history"><summary>{t('Lịch sử đối soát ({0})', [resolved.length])}</summary><ul>{resolved.map(item => <li key={item.id}>
      <strong>{item.provider} · {taskName(item)}</strong>
      <span>{t('Giữ chỗ {0} → phí thực tế {1}', [usd(item.originalMicros), usd(item.actualMicros ?? 0)])} · {item.verifiedSource === 'invoice' ? t('Hóa đơn provider') : t('Trang usage của provider')}</span>
    </li>)}</ul></details>}
  </section>;
}
