import { ArrowRight, Check, ExternalLink, Undo2, X } from 'lucide-react';
import type { AppProposal, AppProposalKind, ProposalHold, ProposalTarget } from '../../shared/app-proposals';
import { Button } from './ui';
import { formatMoney } from './money';
import { t, tMessage, translated } from '../i18n';

/**
 * The cards a worker's app-change proposals become in the chat (COD-199): a title, the fields a creation sets or
 * the before → after of an edit, and Apply / Dismiss. Nothing here knows how to apply: the parent owns the bridge
 * and hands the outcome back through `proposals`, which the card then shows (applied, automatic, undone, or the
 * plain error under the buttons).
 */
export type ProposalActions = {
  busy: boolean;
  onApply: (proposal: AppProposal) => void;
  onApplyAll: (proposals: AppProposal[]) => void;
  onDismiss: (proposal: AppProposal) => void;
  onUndo: (proposal: AppProposal) => void;
  onOpen: (target: ProposalTarget) => void;
};

const createTitles: Record<AppProposalKind, string> = translated({
  orglet: 'Tí mới', crew: 'Hội mới', crew_template: 'Xuất template', skill: 'Skill mới', schedule: 'Lịch mới', settings: 'Cài đặt',
});
const editTitles: Record<AppProposalKind, string> = translated({
  orglet: 'Sửa Tí', crew: 'Sửa hội', crew_template: 'Xuất template', skill: 'Skill · bản mới', schedule: 'Sửa lịch', settings: 'Cài đặt',
});
const fieldNames: Record<string, string> = translated({
  name: 'Tên', description: 'Mô tả', instructions: 'Hướng dẫn', provider: 'Model', modelId: 'ID model', skillId: 'Kỹ năng', taskBudgetMicros: 'Giới hạn mỗi task',
  memberIds: 'Thành viên', synthesizerId: 'Tí trưởng', workflow: 'Cách chạy', monthlyBudgetMicros: 'Ngân sách tháng', content: 'Nội dung',
  brief: 'Tin nhắn', schedule: 'Lịch', target: 'Giao cho', enabled: 'Bật lịch', team: 'Hội được xuất',
  theme: 'Giao diện', language: 'Ngôn ngữ', accentColor: 'Màu nhấn', logoColor: 'Màu logo', interfaceFont: 'Font giao diện', codeFont: 'Font code',
  copyFormat: 'Định dạng sao chép', downloadFormat: 'Định dạng tải xuống', autoTitles: 'Tự đặt tên chat', confirmOpenTask: 'Hỏi trước khi mở công việc',
});
const holdReasons: Record<ProposalHold, string> = translated({
  untrusted: 'Chờ bạn bấm: lượt này đã đọc web, tệp hoặc tin của Tí khác.',
  budget: 'Chờ bạn bấm: đề xuất nâng một giới hạn chi tiêu.',
  template: 'Chờ bạn bấm: cần chọn nơi lưu tệp template.',
});
const openLabels: Record<ProposalTarget['kind'], string> = translated({
  worker: 'Mở Tí', team: 'Mở hội', skill: 'Mở skill', routine: 'Mở lịch', settings: 'Mở cài đặt', template: 'Mở hội',
});
const moneyFields = new Set(['taskBudgetMicros', 'monthlyBudgetMicros']);

/** A stored value as the person reads it: money in the display currency, flags as words, anything else as written. */
function showValue(field: string, value: string) {
  if (moneyFields.has(field) && /^\d+$/.test(value)) return formatMoney(Number(value));
  if (value === 'true') return t('Bật');
  if (value === 'false') return t('Tắt');
  // A member list mixes existing names with refs to orglets proposed in the same reply.
  return value.split(', ').map(part => part.startsWith('ref:') ? t('{0} (mới, cùng lượt này)', [part.slice(4)]) : part).join(', ');
}

function cardTitle(proposal: AppProposal) {
  const kindTitle = proposal.action === 'create' ? createTitles[proposal.kind] : editTitles[proposal.kind];
  if (proposal.kind === 'settings') return kindTitle;
  return `${kindTitle} · ${proposal.title}`;
}

function ProposalCard({ proposal, actions }: { proposal: AppProposal; actions: ProposalActions }) {
  const pending = proposal.status === 'pending';
  const applied = proposal.status === 'applied';
  const undoable = applied && !!proposal.undo && !proposal.undoneAt;
  const status = proposal.undoneAt ? t('Đã hoàn tác')
    : applied ? (proposal.automatic ? t('Đã áp dụng tự động') : t('Đã áp dụng'))
    : proposal.status === 'dismissed' ? t('Đã bỏ qua')
    : proposal.heldReason ? holdReasons[proposal.heldReason] : undefined;
  return <section className={`app-proposal${pending ? '' : ' app-proposal-settled'}`} aria-label={cardTitle(proposal)}>
    <h4>{cardTitle(proposal)}</h4>
    <dl className="app-proposal-changes">
      {proposal.changes.map(change => <div key={change.field}>
        <dt>{fieldNames[change.field] ?? change.field}</dt>
        <dd>
          {change.before !== null && <><span className="app-proposal-before">{showValue(change.field, change.before)}</span><ArrowRight size={13} aria-hidden="true" /></>}
          <span>{showValue(change.field, change.after)}</span>
        </dd>
      </div>)}
    </dl>
    {status && <p className="app-proposal-status" role="status">{status}</p>}
    {proposal.error && pending && <p className="app-proposal-error" role="status">{tMessage(proposal.error)}</p>}
    <div className="app-proposal-actions">
      {pending && <Button variant="primary" disabled={actions.busy} onClick={() => actions.onApply(proposal)}><Check size={15} />{t('Áp dụng')}</Button>}
      {pending && <Button variant="outline" disabled={actions.busy} onClick={() => actions.onDismiss(proposal)}><X size={15} />{t('Bỏ qua')}</Button>}
      {undoable && <Button variant="outline" disabled={actions.busy} onClick={() => actions.onUndo(proposal)}><Undo2 size={15} />{t('Hoàn tác')}</Button>}
      {applied && !proposal.undoneAt && proposal.target && <Button variant="outline" onClick={() => actions.onOpen(proposal.target!)}><ExternalLink size={15} />{openLabels[proposal.target.kind]}</Button>}
    </div>
  </section>;
}

export function AppProposalCards({ proposals, actions }: { proposals: AppProposal[]; actions: ProposalActions }) {
  if (!proposals.length) return null;
  const pending = proposals.filter(proposal => proposal.status === 'pending');
  return <div className="app-proposals" role="group" aria-label={t('Đề xuất thay đổi trong app')}>
    {proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} actions={actions} />)}
    {pending.length > 1 && <div className="app-proposal-actions app-proposals-all">
      <Button variant="primary" disabled={actions.busy} onClick={() => actions.onApplyAll(pending)}><Check size={15} />{t('Áp dụng tất cả ({0})', [pending.length])}</Button>
    </div>}
  </div>;
}
