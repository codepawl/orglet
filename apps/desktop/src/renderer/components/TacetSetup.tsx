import { useEffect, useState } from 'react';
import { Download, RotateCw, Trash2, X } from 'lucide-react';
import { Skeleton } from '@codepawl/orglet-ui';
import type { DecisionModelState } from '../../shared/decisions';
import { Button } from './ui';
import { StatusMark } from './StatusMark';
import { fileSize } from './Attachment';
import { confirmAction } from './confirm';
import { toast } from './toast';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';

/**
 * Where Tacet's download stands, kept current by the core's pushes (COD-303). Undefined until the first answer, so the
 * block can draw its shape without guessing a state.
 */
export function useDecisionModel(): DecisionModelState | undefined {
  const [state, setState] = useState<DecisionModelState>();
  useEffect(() => {
    let live = true;
    void orglet.call('decisionModel', {}).then(next => { if (live) setState(next); }, () => undefined);
    const stop = orglet.onDecisionModel?.(next => setState(next));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return state;
}

type Actions = { onDownload: () => void; onCancel: () => void; onRemove: () => void };

/** "120 MB of 319 MB", in the interface language's number format. */
function progressLabel(state: DecisionModelState): string {
  return t('{0} trên {1}', [fileSize(state.receivedBytes), fileSize(state.totalBytes)]);
}

/** The line under the sentence: the size before anything happens, then where it stands. */
function statusLine(state: DecisionModelState) {
  if (state.status === 'ready') {
    return <span className="status-pill logged_in"><StatusMark variant="filled" tone="success" label={t('Đã sẵn sàng')} decorative />{t('Đã sẵn sàng · {0} trên máy', [fileSize(state.totalBytes)])}</span>;
  }
  if (state.status === 'downloading') return <span className="tacet-setup-meta">{t('Đang tải {0}', [progressLabel(state)])}</span>;
  if (state.status === 'verifying') return <span className="tacet-setup-meta">{t('Đang kiểm tra tệp…')}</span>;
  if (state.status === 'failed') {
    const kept = state.receivedBytes > 0 ? ` ${t('Đã có {0}, lần sau tải tiếp từ đó.', [fileSize(state.receivedBytes)])}` : '';
    return <span className="tacet-setup-meta tacet-setup-error" role="alert">{tMessage(state.error ?? 'Không tải được Tacet.')}{kept}</span>;
  }
  return <span className="tacet-setup-meta">{t('{0}, tải một lần', [fileSize(state.totalBytes)])}</span>;
}

/**
 * Tacet's enable block, with no product logic: the title, one sentence on what it does and that it stays on this
 * computer, the size, then Download, the progress with Cancel, or Remove. Settings shows it today; an onboarding step
 * can render the same block (`TacetSetup`) as it is.
 */
export function TacetSetupView({ state, busy = false, onDownload, onCancel, onRemove }: { state: DecisionModelState | undefined; busy?: boolean } & Actions) {
  const titleId = 'tacet-setup-title';
  const moving = state?.status === 'downloading' || state?.status === 'verifying';
  const percent = state && state.totalBytes > 0 ? Math.min(100, Math.round(state.receivedBytes / state.totalBytes * 100)) : 0;
  return <section className="tacet-setup" aria-labelledby={titleId} aria-busy={moving || undefined}>
    <div className="setting-row">
      <div className="setting-text">
        <span id={titleId} className="setting-title">{t('Tacet trên máy')}</span>
        <span className="setting-description">{t('Báo khi lịch chạy hằng giờ có điều mới, gợi ý quyền một tin nhắn cần, chọn Tí trả lời trong trò chuyện nhóm, nạp ghi chú hợp với tin nhắn và hỏi bạn trước một bước trông dễ gây hậu quả trên trang hay ứng dụng. Chạy trên máy này, không gửi gì ra ngoài.')}</span>
        {state ? statusLine(state) : <Skeleton width="30%" />}
        {moving && <span className="tacet-setup-bar" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={state ? progressLabel(state) : undefined}>
          <span style={{ width: `${percent}%` }} />
        </span>}
      </div>
      <div className="setting-control">
        {state && (state.status === 'absent' || state.status === 'failed') && <Button variant="outline" disabled={busy} onClick={onDownload}>
          {state.status === 'failed' ? <RotateCw size={14} /> : <Download size={14} />}{state.status === 'failed' ? t('Thử lại') : t('Tải về')}
        </Button>}
        {moving && <Button variant="ghost" disabled={busy} onClick={onCancel}><X size={14} />{t('Hủy')}</Button>}
        {state?.status === 'ready' && <Button variant="outline" className="danger" disabled={busy} onClick={onRemove}><Trash2 size={14} />{t('Gỡ')}</Button>}
      </div>
    </div>
  </section>;
}

/** The block wired to the core: it reads the state itself, so any screen can drop it in. */
export function TacetSetup() {
  const state = useDecisionModel();
  const [override, setOverride] = useState<DecisionModelState>();
  const [busy, setBusy] = useState(false);
  // A command's own answer shows at once; the next push from the core takes over from it.
  useEffect(() => setOverride(undefined), [state]);
  const run = async (command: () => Promise<DecisionModelState>, done?: string) => {
    setBusy(true);
    try {
      setOverride(await command());
      if (done) toast(done, 'success', t('Tacet trên máy'));
    } catch (error) {
      toast(tMessage((error as Error).message), 'error', t('Tacet trên máy'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const confirmed = await confirmAction({
      title: t('Gỡ Tacet khỏi máy?'),
      description: t('Tệp của mô hình bị xóa và mọi thứ như trước: lịch chạy hằng giờ im lặng khi xong, không có gợi ý quyền, cả nhóm cùng trả lời, ghi chú chỉ nạp khi khớp từ khóa, và chỉ các quy tắc quyết định khi nào hỏi bạn. Bạn có thể tải lại bất cứ lúc nào.'),
      confirmLabel: t('Gỡ'),
      tone: 'danger',
    });
    if (confirmed) await run(() => orglet.call('removeDecisionModel', {}), t('Đã gỡ Tacet'));
  };
  return <TacetSetupView state={override ?? state} busy={busy}
    onDownload={() => void run(() => orglet.call('installDecisionModel', {}))}
    onCancel={() => void run(() => orglet.call('cancelDecisionModel', {}))}
    onRemove={() => void remove()} />;
}
