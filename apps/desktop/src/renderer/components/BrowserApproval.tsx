import { useEffect, useState } from 'react';
import { Check, Keyboard, ListChecks, MousePointerClick, TextCursorInput, Undo2, X, type LucideIcon } from 'lucide-react';
import type { BrowserActKind, BrowserApprovalView } from '../../shared/browser';
import { Button, Drawer } from './ui';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';

const kindIcons: Record<BrowserActKind, LucideIcon> = { click: MousePointerClick, type: TextCursorInput, select: ListChecks, press: Keyboard };

/** "Researcher wants to click “Place order” on shop.example.com." */
function question(approval: BrowserApprovalView): string {
  const { workerName, element, site } = approval;
  if (approval.kind === 'click') return t('{0} muốn bấm “{1}” trên {2}.', [workerName, element, site]);
  if (approval.kind === 'type') return t('{0} muốn gõ vào “{1}” trên {2}.', [workerName, element, site]);
  if (approval.kind === 'select') return t('{0} muốn chọn trong “{1}” trên {2}.', [workerName, element, site]);
  return t('{0} muốn nhấn {1} trong “{2}” trên {3}.', [workerName, approval.key ?? '', element, site]);
}

/** The page as it was when the step was asked about, with the element outlined; kept only while the card shows. */
function useApprovalPicture(taskId: string, screenshotId: string | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!screenshotId) return;
    let live = true;
    let created: string | undefined;
    void orglet.call('browserScreenshot', { taskId, id: screenshotId }).then(shot => {
      if (!live) return;
      created = URL.createObjectURL(new Blob([shot.bytes as BlobPart], { type: shot.mimeType }));
      setUrl(created);
    }).catch(() => undefined);
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [taskId, screenshotId]);
  return url;
}

/**
 * The card a solo chat shows when its orglet wants to take a step on a page that could send, pay, buy or delete
 * something (COD-261): who wants to do what to which element on which site, why Orglet asks, the page with the
 * element outlined, and two answers. There is no "always": the next such step asks again. The answer goes to the
 * waiting run through the core; the orglet never answers it.
 */
export function BrowserApprovalCard({ taskId, approval, busy, held = false, onHandBack, onAnswer }: {
  taskId: string; approval: BrowserApprovalView; busy: boolean;
  /** The person holds the browser: the card waits for the hand-back, its buttons greyed out with the reason (the core refuses an answer too). */
  held?: boolean;
  /** Hands the browser back from the card, where no other Hand back is on screen (the chat, not the large view). */
  onHandBack?: () => void;
  onAnswer: (answer: 'allow' | 'decline') => void;
}) {
  const picture = useApprovalPicture(taskId, approval.screenshotId);
  const [enlarged, setEnlarged] = useState(false);
  const Icon = kindIcons[approval.kind];
  return <div className="browser-approval" role="group" aria-label={t('Cho phép bước trên trình duyệt')}>
    <p role="status" className="mcp-approval-question"><Icon size={16} aria-hidden="true" /><span>{question(approval)}</span></p>
    {approval.text !== undefined && <pre className="mcp-arguments" aria-label={t('Nội dung sẽ gõ')}>{approval.text || t('(để trống)')}</pre>}
    {approval.values && <p className="browser-approval-values">{approval.values.join(', ')}</p>}
    {picture && <button type="button" className="browser-approval-shot" aria-label={t('Xem ảnh trang lớn hơn')} onClick={() => setEnlarged(true)}>
      <img src={picture} alt={t('Trang {0}, phần tử được hỏi có viền đỏ', [approval.site])} />
    </button>}
    {approval.reasons.length > 0 && <p className="muted browser-approval-reasons">{t('Orglet hỏi vì: {0}', [approval.reasons.map(reason => tMessage(reason)).join(' · ')])}</p>}
    {held && <p className="muted browser-approval-held" id={`browser-approval-held-${approval.id}`}>{t('Bạn đang giữ trình duyệt. Trả lại trình duyệt rồi trả lời.')}</p>}
    <div className="actions">
      {held && onHandBack && <Button variant="outline" onClick={onHandBack}><Undo2 size={16} />{t('Trả lại trình duyệt')}</Button>}
      <Button variant="primary" disabled={busy || held} aria-describedby={held ? `browser-approval-held-${approval.id}` : undefined} onClick={() => onAnswer('allow')}><Check size={16} />{t('Cho phép một lần')}</Button>
      <Button variant="ghost" disabled={busy || held} aria-describedby={held ? `browser-approval-held-${approval.id}` : undefined} onClick={() => onAnswer('decline')}><X size={16} />{t('Không cho phép')}</Button>
    </div>
    {enlarged && picture && <Drawer open onClose={() => setEnlarged(false)} title={approval.site}>
      <img className="browser-screenshot" src={picture} alt={t('Trang {0}, phần tử được hỏi có viền đỏ', [approval.site])} />
    </Drawer>}
  </div>;
}
