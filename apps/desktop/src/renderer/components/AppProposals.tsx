import { useState } from 'react';
import { ArrowRight, Check, Crown, ExternalLink, Undo2, X } from 'lucide-react';
import type { AppProposal, AppProposalKind, ProposalChange, ProposalHold, ProposalTarget } from '../../shared/app-proposals';
import type { ImprovementSignalKind } from '../../shared/self-improvement';
import type { Skill, Task, Worker } from '../../shared/contracts';
import { Avatar } from './Avatar';
import { isMascot, mascotIds, type MascotId } from './mascots';
import { autoMascot, distinctMascot } from './mascotSuggest';
import { Button, Drawer } from './ui';
import { formatMoney } from './money';
import { crewMembers, orgletDetailChanges, proposalCards, proposalModelLabel, showChangeValue, workflowName, workerOfProposal, type ProposalContext } from './proposalValues';
import { t, tMessage, translated } from '../i18n';

/**
 * The cards a worker's app-change proposals become in the chat (COD-199, redrawn in COD-212). The new orglets of one
 * reply share one card: a row per orglet with its face, name, one line and its model, and a dialog with the full
 * fields behind the row. A new crew shows its members' faces with the lead marked. Everything else keeps a title, a
 * definition-list diff and Apply / Dismiss. Nothing here knows how to apply: the parent owns the bridge and hands
 * the outcome back through `proposals`, which the card then shows (applied, automatic, undone, or the plain error).
 * A self-improvement (COD-162) is an edit card that also names the chats its feedback came from; `onOpenChat` opens one.
 */
export type ProposalActions = {
  busy: boolean;
  onApply: (proposal: AppProposal) => void;
  onApplyAll: (proposals: AppProposal[]) => void;
  onDismiss: (proposal: AppProposal) => void;
  onDismissAll: (proposals: AppProposal[]) => void;
  onUndo: (proposal: AppProposal) => void;
  onOpen: (target: ProposalTarget) => void;
  onOpenChat: (taskId: string) => void;
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
  self: 'Chờ bạn bấm: đề xuất này đổi cách Tí làm việc.',
});
/** The feedback a self-improvement answers, as a short chip: "Yêu cầu sửa ×2". */
const signalLabels: Record<ImprovementSignalKind, string> = translated({
  revision: 'Yêu cầu sửa', thumbs_down: 'Không ổn', report_rejected: 'Báo cáo bị từ chối', run_failed: 'Lỗi lặp lại',
});
const openLabels: Record<ProposalTarget['kind'], string> = translated({
  worker: 'Mở Tí', team: 'Mở hội', skill: 'Mở skill', routine: 'Mở lịch', settings: 'Mở cài đặt', template: 'Mở hội',
});

function cardTitle(proposal: AppProposal) {
  const kindTitle = proposal.improvement ? t('Rút kinh nghiệm') : proposal.action === 'create' ? createTitles[proposal.kind] : editTitles[proposal.kind];
  if (proposal.kind === 'settings') return kindTitle;
  return `${kindTitle} · ${proposal.title}`;
}

/** What became of a proposal, in one line: undone, applied (on its own or by a click), dismissed, or why it waits. */
function outcomeText(proposal: AppProposal): string | undefined {
  if (proposal.undoneAt) return t('Đã hoàn tác');
  if (proposal.status === 'applied') return proposal.automatic ? t('Đã áp dụng tự động') : t('Đã áp dụng');
  if (proposal.status === 'dismissed') return t('Đã bỏ qua');
  return proposal.heldReason ? holdReasons[proposal.heldReason] : undefined;
}

const isPending = (proposal: AppProposal) => proposal.status === 'pending';
const isUndoable = (proposal: AppProposal) => proposal.status === 'applied' && !!proposal.undo && !proposal.undoneAt;
const openTarget = (proposal: AppProposal) => proposal.status === 'applied' && !proposal.undoneAt ? proposal.target : undefined;

function ChangeList({ changes, context }: { changes: ProposalChange[]; context: ProposalContext }) {
  if (!changes.length) return null;
  return <dl className="app-proposal-changes">
    {changes.map(change => <div key={change.field}>
      <dt>{fieldNames[change.field] ?? change.field}</dt>
      <dd>
        {change.before !== null && <><span className="app-proposal-before">{showChangeValue(change.field, change.before, context)}</span><ArrowRight size={13} aria-hidden="true" /></>}
        <span>{showChangeValue(change.field, change.after, context)}</span>
      </dd>
    </div>)}
  </dl>;
}

/**
 * Why a self-improvement was proposed: the signal, how often, and the chats it came from, each a link to that chat
 * while it still exists (COD-162). One muted line, no field list.
 */
function Because({ proposal, tasks, onOpenChat }: { proposal: AppProposal; tasks: readonly Pick<Task, 'id' | 'title'>[]; onOpenChat: (taskId: string) => void }) {
  const improvement = proposal.improvement;
  if (!improvement) return null;
  const total = improvement.because.reduce((sum, cause) => sum + cause.count, 0);
  return <p className="app-proposal-because">
    <span className="badge">{signalLabels[improvement.signal]} ×{total}</span>
    <span>{t('vì')}</span>
    {improvement.because.map(cause => {
      const live = tasks.find(task => task.id === cause.taskId);
      const label = `${live?.title ?? cause.title} ×${cause.count}`;
      return live
        ? <button key={cause.taskId} type="button" className="app-proposal-chat" onClick={() => onOpenChat(cause.taskId)}>{label}</button>
        : <span key={cause.taskId} className="muted">{label}</span>;
    })}
  </p>;
}

/** The outcome line and the error, shared by every card and the orglet dialog. */
function Outcome({ proposal }: { proposal: AppProposal }) {
  const outcome = outcomeText(proposal);
  return <>
    {outcome && <p className="app-proposal-status" role="status">{outcome}</p>}
    {proposal.error && isPending(proposal) && <p className="app-proposal-error" role="status">{tMessage(proposal.error)}</p>}
  </>;
}

/** Apply / Dismiss while pending, Undo after an automatic apply, and Open for what was created. */
function ProposalButtons({ proposal, actions }: { proposal: AppProposal; actions: ProposalActions }) {
  const target = openTarget(proposal);
  return <>
    {isPending(proposal) && <Button variant="primary" disabled={actions.busy} onClick={() => actions.onApply(proposal)}><Check size={15} />{t('Áp dụng')}</Button>}
    {isPending(proposal) && <Button variant="outline" disabled={actions.busy} onClick={() => actions.onDismiss(proposal)}><X size={15} />{t('Bỏ qua')}</Button>}
    {isUndoable(proposal) && <Button variant="outline" disabled={actions.busy} onClick={() => actions.onUndo(proposal)}><Undo2 size={15} />{t('Hoàn tác')}</Button>}
    {target && <Button variant="outline" onClick={() => actions.onOpen(target)}><ExternalLink size={15} />{openLabels[target.kind]}</Button>}
  </>;
}

/** The face an existing orglet shows: the one it was given, or the automatic one for its name and description. */
function shownMascot(worker: Worker): MascotId {
  return isMascot(worker.avatar?.mascot) ? worker.avatar.mascot : autoMascot(mascotIds, worker.id, { name: worker.name, description: worker.description });
}

/**
 * The faces the new orglets proposed in one reply get, in the order they were proposed (COD-265). Each avoids the
 * faces and colours the workspace's other orglets and the earlier proposals of the reply already show, when a close
 * match exists, so orglets proposed together for similar roles do not come out identical. An orglet a proposal
 * already created is not counted against itself, so its face stays what it was before Apply.
 */
function proposedMascots(context: Pick<ProposalContext, 'workers' | 'siblings'>): Map<string, MascotId> {
  const created = new Set(context.siblings.flatMap(item => item.target?.kind === 'worker' ? [item.target.id] : []));
  const taken = context.workers.filter(worker => !created.has(worker.id)).map(shownMascot);
  const faces = new Map<string, MascotId>();
  for (const sibling of context.siblings) {
    if (sibling.kind !== 'orglet' || sibling.action !== 'create') continue;
    const description = sibling.changes.find(change => change.field === 'description')?.after;
    const face = distinctMascot({ name: sibling.title, description }, sibling.id, taken);
    faces.set(sibling.id, face);
    taken.push(face);
  }
  return faces;
}

/**
 * The mascot a proposed new orglet shows before it exists. Applying the card saves this same mascot on the new
 * orglet, so its face does not change once it is created.
 */
export function proposedMascot(proposal: AppProposal, context: Pick<ProposalContext, 'workers' | 'siblings'>) {
  const sameReply = context.siblings.filter(sibling => sibling.runId === proposal.runId);
  const face = proposedMascots({ workers: context.workers, siblings: sameReply }).get(proposal.id);
  if (face) return face;
  const description = proposal.changes.find(change => change.field === 'description')?.after;
  return autoMascot(mascotIds, proposal.id, { name: proposal.title, description });
}

/** The face of a proposed orglet: the real worker once it exists, else the mascot it will be created with. */
function ProposedFace({ proposal, context, size, motion }: { proposal: AppProposal; context: ProposalContext; size: 'md' | 'xl'; motion?: { follow: 'hover' } }) {
  const worker = workerOfProposal(proposal, context);
  if (worker) return <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size={size} motion={motion} />;
  return <Avatar name={proposal.title} seed={proposal.id} mascot={proposedMascot(proposal, context)} defaultMascot size={size} motion={motion} />;
}

/** One line of state on an orglet row; the reason a held row waits sits in its tooltip and in the dialog. */
function rowState(proposal: AppProposal): { text: string; tone: 'success' | 'muted'; title?: string } | undefined {
  if (proposal.undoneAt) return { text: t('Đã hoàn tác'), tone: 'muted' };
  if (proposal.status === 'applied') return { text: proposal.automatic ? t('Đã áp dụng tự động') : t('Đã áp dụng'), tone: 'success' };
  if (proposal.status === 'dismissed') return { text: t('Đã bỏ qua'), tone: 'muted' };
  if (proposal.heldReason) return { text: t('Chờ bạn bấm'), tone: 'muted', title: holdReasons[proposal.heldReason] };
  return undefined;
}

function OrgletRow({ proposal, context, actions, onOpen }: { proposal: AppProposal; context: ProposalContext; actions: ProposalActions; onOpen: () => void }) {
  const description = proposal.changes.find(change => change.field === 'description')?.after;
  const state = rowState(proposal);
  const target = openTarget(proposal);
  const pending = isPending(proposal);
  return <li className={`proposal-orglet${pending ? '' : ' proposal-orglet-settled'}`}>
    <button type="button" className="proposal-orglet-open" onClick={() => target ? actions.onOpen(target) : onOpen()} aria-label={target ? t('Mở {0}', [proposal.title]) : t('Xem {0}', [proposal.title])}>
      <ProposedFace proposal={proposal} context={context} size="md" />
      <span className="proposal-orglet-text">
        <strong>{proposal.title}</strong>
        {description && <span className="proposal-orglet-description">{description}</span>}
      </span>
      <span className="badge">{proposalModelLabel(proposal)}</span>
    </button>
    {state && <span className={`proposal-orglet-state ${state.tone}`} title={state.title}>{state.text}</span>}
    {pending && <Button size="icon" className="proposal-row-action" disabled={actions.busy} aria-label={t('Áp dụng {0}', [proposal.title])} title={t('Áp dụng')} onClick={() => actions.onApply(proposal)}><Check size={16} /></Button>}
    {pending && <Button size="icon" className="proposal-row-action" disabled={actions.busy} aria-label={t('Bỏ qua {0}', [proposal.title])} title={t('Bỏ qua')} onClick={() => actions.onDismiss(proposal)}><X size={16} /></Button>}
    {isUndoable(proposal) && <Button size="icon" className="proposal-row-action" disabled={actions.busy} aria-label={t('Hoàn tác {0}', [proposal.title])} title={t('Hoàn tác')} onClick={() => actions.onUndo(proposal)}><Undo2 size={16} /></Button>}
    {proposal.error && pending && <p className="app-proposal-error proposal-orglet-error" role="status">{tMessage(proposal.error)}</p>}
  </li>;
}

/** The full fields of one proposed orglet, opened from its row; Apply and Dismiss sit in the header like a form's actions. */
function OrgletDialog({ proposal, context, actions, onClose }: { proposal: AppProposal; context: ProposalContext; actions: ProposalActions; onClose: () => void }) {
  const description = proposal.changes.find(change => change.field === 'description')?.after;
  return <Drawer open onClose={onClose} title={proposal.title} description={description ?? t('Tí mới')} actions={<ProposalButtons proposal={proposal} actions={actions} />}>
    <div className="proposal-dialog-face">
      <ProposedFace proposal={proposal} context={context} size="xl" motion={{ follow: 'hover' }} />
      <span className="muted">{proposalModelLabel(proposal)}</span>
    </div>
    <ChangeList changes={orgletDetailChanges(proposal)} context={context} />
    <Outcome proposal={proposal} />
  </Drawer>;
}

/** Every new orglet of one reply on one card: a row each, Apply and Dismiss for all of them at once underneath. */
function OrgletGroupCard({ proposals, context, actions }: { proposals: AppProposal[]; context: ProposalContext; actions: ProposalActions }) {
  const [openId, setOpenId] = useState<string>();
  const open = proposals.find(proposal => proposal.id === openId);
  const pending = proposals.filter(isPending);
  const title = proposals.length > 1 ? t('{0} Tí mới', [proposals.length]) : t('Tí mới');
  return <section className="app-proposal app-proposal-orglets" aria-label={title}>
    <h4>{title}</h4>
    <ul className="proposal-orglet-list">
      {proposals.map(proposal => <OrgletRow key={proposal.id} proposal={proposal} context={context} actions={actions} onOpen={() => setOpenId(proposal.id)} />)}
    </ul>
    {pending.length > 1 && <div className="app-proposal-actions">
      <Button variant="primary" disabled={actions.busy} onClick={() => actions.onApplyAll(pending)}><Check size={15} />{t('Áp dụng {0} Tí', [pending.length])}</Button>
      <Button variant="outline" disabled={actions.busy} onClick={() => actions.onDismissAll(pending)}><X size={15} />{t('Bỏ qua {0} Tí', [pending.length])}</Button>
    </div>}
    {open && <OrgletDialog proposal={open} context={context} actions={actions} onClose={() => setOpenId(undefined)} />}
  </section>;
}

/** A new crew as its people: the members' faces with the lead marked, then how it runs and what it may spend. */
function CrewBody({ proposal, context }: { proposal: AppProposal; context: ProposalContext }) {
  const members = crewMembers(proposal, context);
  const after = (field: string) => proposal.changes.find(change => change.field === field)?.after;
  const workflow = after('workflow');
  const monthly = after('monthlyBudgetMicros');
  const perTask = after('taskBudgetMicros');
  return <>
    <ul className="proposal-crew-members" aria-label={t('Thành viên')}>
      {members.map(member => <li key={member.key} className="proposal-crew-member">
        {member.worker
          ? <Avatar name={member.worker.name} seed={member.worker.id} mascot={member.worker.avatar?.mascot} defaultMascot hint={member.worker.description} color={member.worker.avatar?.color} size="sm" badge={member.lead ? <span className="proposal-crew-lead"><Crown size={9} aria-hidden="true" /></span> : undefined} />
          : <Avatar name={member.name} seed={member.proposal?.id ?? member.key} mascot={member.proposal ? proposedMascot(member.proposal, context) : undefined} defaultMascot hint={member.description} size="sm" badge={member.lead ? <span className="proposal-crew-lead"><Crown size={9} aria-hidden="true" /></span> : undefined} />}
        <span>{member.name}</span>
        {member.lead && <span className="visually-hidden">{t('Tí trưởng')}</span>}
      </li>)}
    </ul>
    <div className="proposal-crew-chips">
      {workflow && <span className="badge">{workflowName(workflow)}</span>}
      {monthly && /^\d+$/.test(monthly) && <span className="badge">{t('{0}/tháng', [formatMoney(Number(monthly))])}</span>}
      {perTask && /^\d+$/.test(perTask) && <span className="badge">{t('{0} mỗi task', [formatMoney(Number(perTask))])}</span>}
    </div>
  </>;
}

/** The lines of a creation minus the name, which is already the title; an edit keeps every line it changes. */
function cardChanges(proposal: AppProposal): ProposalChange[] {
  if (proposal.action !== 'create') return proposal.changes;
  return proposal.changes.filter(change => !(change.field === 'name' && change.after === proposal.title));
}

function ProposalCard({ proposal, context, tasks, actions }: { proposal: AppProposal; context: ProposalContext; tasks: readonly Pick<Task, 'id' | 'title'>[]; actions: ProposalActions }) {
  const newCrew = proposal.kind === 'crew' && proposal.action === 'create';
  return <section className={`app-proposal${isPending(proposal) ? '' : ' app-proposal-settled'}`} aria-label={cardTitle(proposal)}>
    <h4>{cardTitle(proposal)}</h4>
    {newCrew ? <CrewBody proposal={proposal} context={context} /> : <ChangeList changes={cardChanges(proposal)} context={context} />}
    <Because proposal={proposal} tasks={tasks} onOpenChat={actions.onOpenChat} />
    <Outcome proposal={proposal} />
    <div className="app-proposal-actions"><ProposalButtons proposal={proposal} actions={actions} /></div>
  </section>;
}

export function AppProposalCards({ proposals, workers, skills, tasks = [], actions }: { proposals: AppProposal[]; workers: readonly Worker[]; skills: readonly Pick<Skill, 'id' | 'name'>[]; tasks?: readonly Pick<Task, 'id' | 'title'>[]; actions: ProposalActions }) {
  if (!proposals.length) return null;
  const context: ProposalContext = { workers, skills, siblings: proposals };
  const pending = proposals.filter(isPending);
  const cards = proposalCards(proposals);
  // The orglet card applies its own rows; the turn's Apply all is for a reply that also proposes something else.
  const onlyNewOrglets = cards.length === 1 && cards[0].kind === 'orglets';
  return <div className="app-proposals" role="group" aria-label={t('Đề xuất thay đổi trong app')}>
    {cards.map(card => card.kind === 'orglets'
      ? <OrgletGroupCard key={card.proposals[0].id} proposals={card.proposals} context={context} actions={actions} />
      : <ProposalCard key={card.proposal.id} proposal={card.proposal} context={context} tasks={tasks} actions={actions} />)}
    {pending.length > 1 && !onlyNewOrglets && <div className="app-proposal-actions app-proposals-all">
      <Button variant="primary" disabled={actions.busy} onClick={() => actions.onApplyAll(pending)}><Check size={15} />{t('Áp dụng tất cả ({0})', [pending.length])}</Button>
    </div>}
  </div>;
}
