import { useEffect, useRef, useState } from 'react';
import { FileText, Check, RotateCcw, Reply } from 'lucide-react';
import type { Artifact, Run, TaskDetail, TaskStatus } from '../../shared/contracts';
import { Button } from './ui';
import { formatMoney } from './money';
import type { SourceTarget } from './SourcePanel';
import { ReviewSummary } from './ReviewSummary';
import type { Knowledge } from '../../shared/knowledge';
import { ProviderMark } from './ProviderMark';
import { providerName } from './workerModel';
import { Avatar } from './Avatar';
import { toast } from './toast';
import { t } from '../i18n';
import { DocumentCard, DocumentViewer } from './DocumentViewer';
import { FormatAction } from './FormatAction';
import { currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { Markdown } from './Markdown';
import { Attachment } from './Attachment';
import { MessageActions } from './MessageActions';
import { turnMessageId } from '../../shared/message-interactions';
import { ActivityGroup, LiveRun, liveRunOf, savedSteps, useRunProgress } from './LiveRun';
import { LiveIsland, type IslandState } from './LiveIsland';
import { UNASSIGNED_PLAN_ERROR } from '../../shared/contracts';
import { MentionText } from './mentions';
import type { MentionPerson } from '../../shared/mentions';
import { teamProgress } from '../../shared/team-progress';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { workOutcomes } from '../../shared/work-outcomes';

/**
 * What this worker was doing for the team on this turn: assigning the work, doing a share of it, or combining the
 * results. A one-to-one chat and a plain group turn say nothing, because there is no role to tell apart (user,
 * 2026-09-19). The words match the ones the details panel uses for the same stages.
 */
const teamRoleNames: Partial<Record<NonNullable<Run['stage']>, string>> = { plan: 'phân việc', member: 'phần việc', synthesis: 'gộp kết quả' };
function bylineRole(author: Run) {
  const name = author.stage && teamRoleNames[author.stage];
  if (!name || !author.snapshot.team) return null;
  return <span className="byline-role">{t(name)}</span>;
}

export const statusLabel: Record<TaskStatus, string> = translated({ queued: 'Đang chờ', running: 'Đang làm', pausing: 'Đang tạm dừng', paused: 'Đã tạm dừng', completed: 'Hoàn tất', partial: 'Kết quả một phần', failed: 'Cần xem lại', cancelled: 'Đã hủy', interrupted: 'Bị gián đoạn', waiting_budget: 'Đang chờ ngân sách', waiting_input: 'Chờ bổ sung bằng chứng' });

type Turn = { revision: number; runs: Run[]; brief: string; replyTo?: string; sources: TaskDetail['sources']; artifact?: Artifact; author?: Run; replies: { run: Run; artifact: Artifact }[] };

/**
 * A task shown as one chat (user decision 2026-09-17): every message the user sent, oldest first, each followed by the
 * worker's answer. Answers are normal messages; a structured report is shown only when one was asked for or a team
 * checklist requires it. Run controls belong to the latest turn only; token usage and cost live in Chi tiết.
 */

export function TaskThread({ detail, recovery, action, showSources, openMessage, proposals, openKnowledge, mentionPeople, mentionAllNames }: { detail: TaskDetail; recovery?: WorkspaceRecoveryView; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; openMessage: (messageId: string) => void; proposals: Knowledge[]; openKnowledge: (item: Knowledge) => void; mentionPeople?: readonly MentionPerson[]; mentionAllNames?: readonly string[] }) {
  const viewport = useRef<HTMLDivElement>(null); const atBottom = useRef(true);
  const [answeringDecision, setAnsweringDecision] = useState(false);
  const current = detail.task.inputRevision ?? 0;
  const pendingDecision = detail.task.decisionRequests?.findLast(request => request.inputRevision === current && !request.answer && !request.interruptedAt);
  const turns: Turn[] = [...new Set([0, current, ...detail.runs.map(run => run.snapshot.inputRevision ?? 0)])].sort((a, b) => a - b).map(revision => {
    const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
    const input = revision === current ? detail.task.currentInput ?? detail.task : runs.find(run => run.snapshot.input)?.snapshot.input ?? detail.task;
    const artifact = detail.artifacts.findLast(item => runs.some(run => run.id === item.runId && (!detail.task.teamSnapshot || run.stage === 'synthesis')));
    // Group chat: each worker's latest answered run for this message, in the order they answered.
    const replies = runs.filter(run => run.stage === 'group').flatMap(run => { const reply = detail.artifacts.find(item => item.runId === run.id); return reply ? [{ run, artifact: reply }] : []; });
    return { revision, runs, brief: input.brief, replyTo: 'replyTo' in input ? input.replyTo : undefined, sources: input.sourceIds.map(id => detail.sources.find(source => source.id === id)).filter(Boolean) as TaskDetail['sources'], artifact, author: artifact ? detail.runs.find(run => run.id === artifact.runId) : runs.at(-1), replies };
  });
  const replyLabel = (messageId?: string) => {
    if (!messageId) return undefined;
    const userTurn = turns.find(turn => turnMessageId(detail.task.id, turn.revision) === messageId);
    if (userTurn) return t('Bạn: {0}', [userTurn.brief.slice(0, 140)]);
    const artifact = detail.artifacts.find(item => item.id === messageId);
    if (artifact) return t('{0}: {1}', [detail.runs.find(run => run.id === artifact.runId)?.snapshot.worker.name ?? 'Orglet', artifact.report.summary.slice(0, 140)]);
    const event = detail.events.find(item => item.id === messageId && item.teamMessage);
    return event?.teamMessage ? event.teamMessage.body.slice(0, 140) : undefined;
  };
  /**
   * How far each orglet has got, the way a messenger shows it: a face under the last message that orglet has
   * actually worked from (user, 2026-09-20). Nothing new is recorded for this — a run carries the revision of
   * the message it was given, so the highest one a worker has run is exactly how far they have read.
   */
  const readersByRevision = new Map<number, Run[]>();
  const furthest = new Map<string, Run>();
  for (const run of detail.runs) {
    const revision = run.snapshot.inputRevision ?? 0;
    const known = furthest.get(run.snapshot.worker.id);
    if (!known || (known.snapshot.inputRevision ?? 0) < revision) furthest.set(run.snapshot.worker.id, run);
  }
  for (const run of furthest.values()) {
    const revision = run.snapshot.inputRevision ?? 0;
    readersByRevision.set(revision, [...(readersByRevision.get(revision) ?? []), run]);
  }
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const liveRuns = useRunProgress(detail.task.id);
  // Changes whenever streamed text or steps grow, so the view keeps following the newest output.
  const liveLength = Object.values(liveRuns).reduce((total, update) => total + (update.progress ? update.progress.preamble.length + update.progress.answer.length + update.progress.activity.length : 0), 0);
  useEffect(() => { if (atBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [detail.events.length, detail.artifacts.length, turns.length, liveLength]);

  // A face nods when its answer lands, not when an old chat opens: the runs already finished when this chat was
  // opened stay still, and only a run that completes after that is marked `landed` (the Finishing state in styles.css).
  const finishedAtOpen = useRef<Set<string>>(null);
  if (finishedAtOpen.current === null) finishedAtOpen.current = new Set(detail.runs.filter(run => run.status === 'completed').map(run => run.id));
  const landed = (run: Run) => run.status === 'completed' && !finishedAtOpen.current!.has(run.id);
  const bylineClass = (author?: Run, working = false) => working ? 'message-byline working' : author && landed(author) ? 'message-byline landed' : 'message-byline';
  const byline = (author?: Run, working = false) => <div className={bylineClass(author, working)}>{/* Agent marks sit left of the name. */}{author ? <Avatar name={author.snapshot.worker.name} seed={author.snapshot.worker.id} mascot={author.snapshot.worker.avatar?.mascot} defaultMascot hint={author.snapshot.worker.description} color={author.snapshot.worker.avatar?.color} size="md" alive badge={author.snapshot.worker.provider === 'demo' ? undefined : <ProviderMark provider={author.snapshot.worker.provider} size="small" decorative />} /> : <span className="orglet-mark small">o</span>}<strong>{author?.snapshot.worker.name ?? 'Orglet'}</strong>{author && bylineRole(author)}{author && <span className="byline-provider">{providerName(author.snapshot.worker.provider)}</span>}</div>;

  return <div className="thread-scroll" ref={viewport} onScroll={() => { const el = viewport.current!; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
    <div className="thread-content">
      {turns.map(turn => {
        const latest = turn.revision === current;
        const workFrame = turn.runs.find(run => run.stage === 'plan' && run.snapshot.workFrame)?.snapshot.workFrame
          ?? turn.runs.find(run => run.snapshot.workFrame)?.snapshot.workFrame;
        const outcomes = workOutcomes(recovery, new Set(turn.runs.map(run => run.id)));
        const outcomeText = outcomes ? [
          outcomes.passedCommands + outcomes.failedCommands + outcomes.unfinishedCommands > 0
            ? t('Lệnh: {0} thoát 0, {1} lỗi, {2} chưa hoàn tất.', [outcomes.passedCommands, outcomes.failedCommands, outcomes.unfinishedCommands]) : '',
          outcomes.fileConflicts ? t('{0} bản file xung đột hoặc chưa rõ.', [outcomes.fileConflicts]) : '',
          outcomes.uncertainCalls ? t('{0} thao tác chưa rõ kết quả.', [outcomes.uncertainCalls]) : '',
          outcomes.truncated ? t('Chỉ tính bản ghi gần đây.') : '',
        ].filter(Boolean).join(' ') : '';
        const activeRun = turn.runs.find(item => item.status === 'running') ?? turn.runs.find(item => item.status === 'queued');
        const live = latest && busy ? liveRunOf(turn.runs, liveRuns) : undefined;
        const liveUpdate = live?.update;
        const thinkingRun = live?.run ?? activeRun;
        const headline = turn.runs.find(item => item.stage === 'plan' && item.error && item.status !== 'completed')
          ?? turn.runs.filter(item => item.stage === 'member' && item.error && item.error !== UNASSIGNED_PLAN_ERROR).at(-1)
          ?? turn.runs.findLast(item => item.error && item.error !== UNASSIGNED_PLAN_ERROR);
        const failedNames = [...new Set(turn.runs.filter(item => item.stage === 'member' && item.error && item.error !== UNASSIGNED_PLAN_ERROR).map(item => item.snapshot.worker.name))];
        // A run that failed and was then superseded is not news. The task finished, the answer is on screen, and
        // there is nothing to act on, so its error stays out of the thread: it used to surface as a card headed
        // "Hoàn tất" carrying a line of internal validation text (user, 2026-09-19). A paused task keeps its own
        // explanation just below, so it is quiet here too.
        const unresolvedError = latest && !['completed', 'paused'].includes(detail.task.status) ? headline : undefined;
        return <div className="chat-turn" key={turn.revision}>
          {/* The files ride above the bubble in their own sideways row, the way a chat app sends attachments ahead
              of the text, rather than stacking one per line inside it (user, 2026-09-21). */}
          {turn.sources.length > 0 && <ul className="message-files" aria-label={t('Tệp đính kèm')}>
            {turn.sources.map(item => <Attachment key={item.id} name={item.name} bytes={item.bytes} onOpen={() => showSources({ type: 'source', id: item.id })} />)}
          </ul>}
          <div className="user-message" id={`message-${turnMessageId(detail.task.id, turn.revision)}`} tabIndex={-1}>
            {turn.replyTo && <button type="button" className="message-reply-context" onClick={() => openMessage(turn.replyTo!)}>
              <Reply size={13} aria-hidden="true" />{t('Mở tin gốc: {0}', [replyLabel(turn.replyTo) ?? t('Tin nhắn trước không còn hiển thị')])}
            </button>}
            <p><MentionText text={turn.brief} people={mentionPeople ?? []} allNames={mentionAllNames} /></p>
          </div>
          {/* Under the bubble, as a worker's answer carries them, so both sides of the chat act the same way. */}
          <MessageActions taskId={detail.task.id} messageId={turnMessageId(detail.task.id, turn.revision)} author={t('Bạn')} text={turn.brief} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} />
          {latest && workFrame && <p className="muted" role="status">{t('Mục tiêu Tí hiểu: {0}', [workFrame.goal])}</p>}
          {latest && outcomeText && <p className="muted" role="status">{outcomeText}</p>}
          {turn.replies.map(reply => <section key={reply.run.id} className="assistant-message" aria-label={t('Trả lời của {0}', [reply.run.snapshot.worker.name])}>
            {byline(reply.run)}
            <FinishedActivity steps={savedSteps(detail.events, reply.run.id)} />
            {reply.artifact.report.format === 'chat'
              ? <ChatReply artifact={reply.artifact} author={reply.run.snapshot.worker.name} taskId={detail.task.id} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} />
              : <ReportView artifact={reply.artifact} author={reply.run} latest={latest} busy={busy} detail={detail} action={action} showSources={showSources} />}
          </section>)}
          {(!turn.replies.length || (latest && (busy || detail.task.status !== 'completed'))) && <section className={latest && detail.task.status === 'waiting_input' ? 'assistant-message needs-you' : 'assistant-message'} aria-label={t('Trả lời của {0}', [turn.author?.snapshot.worker.name ?? 'Orglet'])}>
            {latest && busy && thinkingRun ? byline(thinkingRun, true) : !(latest && busy) && !turn.replies.length && byline(turn.author)}
            {turn.runs.some(item => item.snapshot.preflightId) && <Button variant="outline" onClick={() => showSources()}>{t('Xem kiểm tra trước review')}</Button>}
            {latest && detail.task.status === 'waiting_input' && pendingDecision && <div role="group" aria-label={t('Quyết định đang chờ')}>
              <p role="status">{pendingDecision.question}</p>
              <div className="actions">{pendingDecision.options.map(option => <Button key={option} variant="outline" disabled={answeringDecision} onClick={() => {
                if (answeringDecision) return;
                setAnsweringDecision(true);
                action(async () => {
                  try { await orglet.call('answerDecision', { taskId: detail.task.id, requestId: pendingDecision.id, answer: option }); }
                  finally { setAnsweringDecision(false); }
                });
              }}>{option}</Button>)}</div>
            </div>}
            {latest && detail.task.status === 'waiting_input' && !pendingDecision && <p role="status">{t('Chờ bổ sung bằng chứng. Đính kèm thêm nguồn để kiểm tra lại, hoặc chấp nhận báo cáo cùng các giới hạn đã nêu.')}</p>}
            {latest && detail.task.pendingStart && <p role="status">{t('Đã lưu yêu cầu mới. Đang dừng lượt cũ rồi sẽ bắt đầu.')}</p>}
            {latest && detail.task.status !== 'completed' && <div className="team-progress" role="status">
              {teamProgress(turn.runs, detail.artifacts).map(({ run, waitingFor }) => {
                const brief = run.snapshot.assignment!.brief;
                const characters = Array.from(brief.replace(/\s+/g, ' ').trim());
                const description = characters.length > 160 ? `${characters.slice(0, 160).join('')}…` : characters.join('');
                const status = <span>{run.snapshot.worker.name} · {statusLabel[run.status]}
                  {waitingFor.length > 0 ? ` · ${t('Chờ {0}', [waitingFor.join(', ')])}` : ''}</span>;
                return characters.length > 160 ? <details className="muted" key={run.id}>
                  <summary>{status} · {description}</summary>
                  <p>{brief}</p>
                </details> : <p className="muted" key={run.id}>{status} · {description}</p>;
              })}
            </div>}
            {latest && busy && thinkingRun && (liveUpdate
              ? <LiveRun update={liveUpdate} pausing={detail.task.status === 'pausing'} />
              : <Thinking worker={thinkingRun.snapshot.worker} stage={thinkingRun.stage} message={detail.events.at(-1)?.message} pausing={detail.task.status === 'pausing'} />)}
            {latest && detail.task.status === 'paused' && <p role="status">{t('Đã tạm dừng. Tiếp tục giữ nguyên thiết lập của lần chạy này; thử lại tạo lần chạy mới.')}</p>}
            {latest && detail.task.handoff && <details><summary>{t('Bàn giao cuối ca')}</summary><p>{t('{0} báo cáo đã lưu · đã đối soát {1} · giữ chỗ {2}', [detail.task.handoff.artifactIds.length, formatMoney(detail.task.handoff.chargedMicros), formatMoney(detail.task.handoff.reservedMicros)])}</p><ul>{detail.task.handoff.artifactIds.map(id => <li key={id}>{detail.artifacts.find(artifact => artifact.id === id)?.report.title ?? id}</li>)}</ul>{detail.task.handoff.blockers.length > 0 && <><h3>{t('Điểm đang chờ')}</h3><ul>{detail.task.handoff.blockers.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></>}<h3>{t('Bước tiếp theo')}</h3><ul>{detail.task.handoff.nextSteps.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></details>}
            {latest && detail.task.status === 'partial' && <p className="run-error">{failedNames.length ? t('{0} chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.', [failedNames.join(', ')]) : t('Một số role chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.')}</p>}
            {!turn.artifact && !turn.replies.length && !(latest && busy) && !unresolvedError && !(latest && pendingDecision) && <p className="muted">{t('Chưa có câu trả lời cho tin nhắn này.')}</p>}
            {turn.artifact && !turn.replies.length && <FinishedActivity steps={savedSteps(detail.events, turn.artifact.runId)} />}
            {turn.artifact && !turn.replies.length && (turn.artifact.report.format === 'chat'
              ? <ChatReply artifact={turn.artifact} author={turn.author?.snapshot.worker.name ?? 'Orglet'} taskId={detail.task.id} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} />
              : <ReportView artifact={turn.artifact} author={turn.author} latest={latest} busy={busy} detail={detail} action={action} showSources={showSources} />)}
            {latest && turn.artifact && proposals.length > 0 && <section className="knowledge-proposals" aria-label={t('Đề xuất knowledge')}><h3>{t('Đề xuất lưu thành knowledge')}</h3><p className="muted">{t('Chỉ được dùng cho lần chạy sau khi bạn duyệt.')}</p><div className="source-links">{proposals.map(item => <Button key={item.id} onClick={() => openKnowledge(item)}>{item.title}</Button>)}</div></section>}
            {unresolvedError?.error && <div className="run-error" role="status"><h3>{statusLabel[detail.task.status]}</h3><p>{unresolvedError.stage === 'plan' ? t('Trưởng phòng: {0}', [tMessage(unresolvedError.error)]) : tMessage(unresolvedError.error)}</p></div>}
            {latest && <div className="actions">
              {!busy && ['paused', 'interrupted', 'waiting_budget'].includes(detail.task.status) && <Button variant="primary" onClick={() => action(() => orglet.call('resume', { id: detail.task.id }))}>{t('Tiếp tục từ checkpoint')}</Button>}
              {!busy && !['completed', 'waiting_input'].includes(detail.task.status) && <Button variant="outline" onClick={() => action(() => orglet.call('retry', { id: detail.task.id }))}><RotateCcw size={16} />{t('Thử lại với thiết lập hiện tại')}</Button>}
            </div>}
          </section>}
          <ReadReceipts readers={readersByRevision.get(turn.revision) ?? []} />
        </div>;
      })}
    </div>
  </div>;
}

/**
 * Work in progress for a run that does not stream: the same island as a streaming run, with the few states the
 * core's own events give (planning, handing out, combining, a read it did itself, waiting for a turn). No receipt
 * line, because nothing finer than these is observed. Details (versions, paths, costs) stay in Chi tiết.
 */
function Thinking({ worker, stage, message, pausing }: { worker: Run['snapshot']['worker']; stage?: Run['stage']; message?: string; pausing: boolean }) {
  const read = message?.match(/^Đã đọc (.+)$/);
  const view: { state: IslandState; label: string } = pausing ? { state: 'pausing', label: t('Đang dừng sau bước này') }
    : stage === 'plan' || message === 'Đang phân việc.' ? { state: 'thinking', label: t('Đang phân việc') }
    : stage === 'member' ? { state: 'thinking', label: t('Đang giao {0}', [worker.name]) }
    : stage === 'synthesis' || message?.startsWith('Đang tổng hợp') ? { state: 'writing', label: t('Đang tổng hợp') }
    : read ? { state: 'reading', label: t('Đang đọc {0}', [read[1]]) }
    : message?.startsWith('Đang chờ lượt') ? { state: 'waiting', label: t('Đang chờ lượt') }
    : message === 'Model đang trả kết quả…' ? { state: 'writing', label: t('Đang viết câu trả lời') }
    : { state: 'thinking', label: t('Đang suy nghĩ') };
  return <LiveIsland state={view.state} label={view.label} />;
}

/** A normal chat answer: the message, with copy and export tucked into a quiet row. */
/** The folded "Read 2 files" line above a finished answer; nothing when the worker read and searched nothing. */
function FinishedActivity({ steps }: { steps: ReturnType<typeof savedSteps> }) {
  if (steps.length === 0) return null;
  return <div className="finished-activity"><ActivityGroup steps={steps} /></div>;
}

function ChatReply({ artifact, author, taskId, reactions, runs, action }: { artifact: Artifact; author: string; taskId: string; reactions: NonNullable<TaskDetail['task']['messageReactions']>; runs: readonly Run[]; action: (fn: () => Promise<unknown>) => void }) {
  return <div className="chat-reply">
    <div className="chat-bubble" id={`message-${artifact.id}`} tabIndex={-1}><Markdown className="prose" text={tMessage(artifact.report.summary)} /></div>
    {artifact.report.limitations.length > 0 && <div className="chat-limitations">
      <strong>{t('Phần chưa hoàn tất hoặc còn giới hạn')}</strong>
      <ul>{artifact.report.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul>
    </div>}
    <MessageActions taskId={taskId} messageId={artifact.id} author={author} text={tMessage(artifact.report.summary)} reactions={reactions} runs={runs} action={action}
      leading={<ArtifactActions artifactId={artifact.id} action={action} />} />
  </div>;
}

/**
 * Who has read this far. Faces sit under the last message each orglet has worked from, the way a messenger
 * shows a reader's avatar at the message they reached (user, 2026-09-20).
 */
function ReadReceipts({ readers }: { readers: readonly Run[] }) {
  if (!readers.length) return null;
  return <p className="read-receipts" aria-label={t('Đã đọc tới đây: {0}', [readers.map(run => run.snapshot.worker.name).join(', ')])}>
    {readers.map(run => <span key={run.id} title={t('{0} đã đọc tới đây', [run.snapshot.worker.name])}>
      <Avatar name={run.snapshot.worker.name} seed={run.snapshot.worker.id} mascot={run.snapshot.worker.avatar?.mascot} defaultMascot hint={run.snapshot.worker.description} color={run.snapshot.worker.avatar?.color} size="xxs" />
    </span>)}
  </p>;
}


/** Copy and download for an answer or document, in the format the user picks or saved as default. */
function ArtifactActions({ artifactId, action }: { artifactId: string; action: (fn: () => Promise<unknown>) => void }) {
  return <>
    <FormatAction kind="copy" onPick={format => action(async () => { await orglet.copyArtifact(artifactId, format); toast(format === 'text' ? t('Đã sao chép văn bản') : t('Đã sao chép Markdown')); })} />
    <FormatAction kind="download" onPick={format => action(() => orglet.exportArtifact(artifactId, format))} />
  </>;
}

/**
 * A structured report is sent like a file a colleague attaches (user decision 2026-09-17): a quiet file card in the chat
 * that opens in a macOS-style document viewer. The Demo sample has no summary worth showing, only its limits.
 */
function ReportView({ artifact, author, latest, busy, detail, action, showSources }: { artifact: Artifact; author?: Run; latest: boolean; busy: boolean; detail: TaskDetail; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void }) {
  const [open, setOpen] = useState(false);
  const report = artifact.report;
  const sample = author?.snapshot.worker.provider === 'demo';
  const name = tMessage(report.title);
  const when = new Date(artifact.createdAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  const meta = [t('Báo cáo'), report.findings.length ? t('{0} phát hiện', [report.findings.length]) : '', latest && detail.task.accepted ? t('Đã chấp nhận') : '', when].filter(Boolean).join(' · ');
  // Evidence links leave the document for the sources panel.
  const openSource = (target?: SourceTarget) => { setOpen(false); showSources(target); };
  return <>
    <div id={`message-${artifact.id}`} tabIndex={-1}><DocumentCard name={name} meta={meta} onOpen={() => setOpen(true)} />
      <MessageActions taskId={detail.task.id} messageId={artifact.id} author={author?.snapshot.worker.name ?? 'Orglet'} text={name} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} />
    </div>
    <DocumentViewer open={open} onClose={() => setOpen(false)} name={name} actions={<>
      {latest && <Button variant="outline" className="doc-action" disabled={detail.task.accepted || busy} onClick={() => action(() => orglet.call('accept', { id: detail.task.id }))}><Check size={15} />{detail.task.accepted ? t('Đã chấp nhận') : t('Chấp nhận báo cáo')}</Button>}
      <ArtifactActions artifactId={artifact.id} action={action} />
    </>}>
      <h1>{name}</h1>
      <p className="doc-meta">{[author?.snapshot.worker.name, when].filter(Boolean).join(' · ')}</p>
      {!sample && <p className="prose">{tMessage(report.summary)}</p>}
      {detail.task.evidenceRequests?.filter(request => request.artifactId === artifact.id).map(request => <section key={request.id}>
        <h2>{t('Bằng chứng còn thiếu')}</h2><ul>{request.checks.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="muted">{t('Các phần đã làm được giữ lại. Ghi nhận giới hạn không chuyển các mục này thành đạt.')}</p>
        {request.state === 'pending' ? <Button variant="outline" disabled={busy} onClick={() => action(() => orglet.call('acknowledgeEvidence', { taskId: detail.task.id, requestId: request.id }))}>{t('Ghi nhận giới hạn')}</Button> : <p role="status">{t('Đã ghi nhận giới hạn bằng chứng.')}</p>}
      </section>)}
      <ReviewSummary key={artifact.id} artifactId={artifact.id} report={report} detail={detail} showSources={openSource} />
      {report.findings.length > 0 && <section><h2>{t('Phát hiện')}</h2>
        {report.findings.map((finding, index) => <section className="finding" key={finding.provenance?.findingId ?? index}>
          <h3>{finding.title} <span className="doc-note">· {finding.severity === 'critical' ? t('Nghiêm trọng') : finding.severity === 'warning' ? t('Cần xem lại') : t('Thông tin')}</span></h3>
          <p className="prose">{finding.detail}</p><p className="muted">{t('Phạm vi: {0}', [finding.coverage])}</p>
          {finding.category && <p className="muted">{t('Hội: {0}', [({ challenge: 'Challenge', data: t('Dữ liệu'), scoring: 'Scoring', runs: t('Lần chạy'), other: t('Khác') } as const)[finding.category]])}</p>}
          {finding.recommendation && <p className="prose"><strong>{t('Khuyến nghị:')}</strong> {finding.recommendation}</p>}
          <div className="source-links">{finding.sourceIds.map(id => <Button key={id} onClick={() => openSource({ type: 'source', id })}><FileText size={14} />{detail.sources.find(source => source.id === id)?.name ?? id}</Button>)}{finding.checkerIds?.map((id, position) => <Button key={id} onClick={() => openSource({ type: 'checker', id })}><FileText size={14} />Xem checker {position + 1}</Button>)}{finding.locations?.map((location, position) => <Button key={`line-${position}`} onClick={() => openSource({ type: 'source', id: location.sourceId, lines: [location.startLine, location.endLine] })}><FileText size={14} />{detail.sources.find(source => source.id === location.sourceId)?.name ?? location.sourceId} · {location.startLine === location.endLine ? t('dòng {0}', [location.startLine]) : t('dòng {0}–{1}', [location.startLine, location.endLine])}</Button>)}</div>
          {finding.workspaceEvidenceIds?.map(id => {
            const evidence = detail.workspaceEvidence.find(item => item.id === id);
            return <p className="muted prose" key={id}>{evidence
              ? t('Tệp workspace: {0} · SHA-256 {1} · {2}', [evidence.path, evidence.hash, evidence.grantCurrent
                ? t('Bằng chứng đã lưu; file hiện tại chưa kiểm tra lại') : t('Quyền workspace không còn; không mở được file hiện tại')])
              : t('Thiếu metadata bằng chứng workspace: {0}', [id])}</p>;
          })}
          {finding.provenance && <details><summary>{t('Nguồn gốc finding')}</summary><p>{t('{0} · Tí v{1}', [author?.snapshot.worker.name, author?.snapshot.worker.revision])}</p><code className="hash">Finding: {finding.provenance.findingId}<br />Worker: {finding.provenance.writerId}<br />Run: {finding.provenance.runId}</code></details>}
        </section>)}
      </section>}
      {report.limitations.length > 0 && <section className="limitations"><h2>{t('Giới hạn của báo cáo')}</h2><ul>{report.limitations.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></section>}
    </DocumentViewer>
  </>;
}
