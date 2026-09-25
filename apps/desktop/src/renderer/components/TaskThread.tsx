import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Check, RotateCcw, Reply, FolderOpen, MessageSquareQuote } from 'lucide-react';
import type { Artifact, Run, TaskDetail, TaskStatus, Workspace } from '../../shared/contracts';
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
import { filesAddedWith } from '../turnFiles';
import { DocumentCard, DocumentViewer } from './DocumentViewer';
import { FormatAction } from './FormatAction';
import { currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { isHarness, SYSTEM_ACCOUNT_ID, type HarnessInfo } from '../../shared/harness';
import { accountSwitchFor, outOfPlanRun, type AccountSwitch } from '../../shared/account-switch';
import { Markdown } from './Markdown';
import { Attachment } from './Attachment';
import { needsTimeMark, TimeMark } from './TimeMark';
import { MessageActions, MessageBadges } from './MessageActions';
import { turnMessageId } from '../../shared/message-interactions';
import { LiveRun, islandBeforeStreaming, islandOf, liveRunOf, useRunProgress, workingWorkers } from './LiveRun';
import { TurnTrace } from './TurnTrace';
import { traceOf } from '../turnTrace';
import { dockIsland } from './islandDock';
import { knowledgeSuggestionKey, showsKnowledgeIsland } from '../../shared/knowledge-island';
import { UNASSIGNED_PLAN_ERROR } from '../../shared/contracts';
import { MentionText } from './mentions';
import type { MentionPerson } from '../../shared/mentions';
import { teamProgress } from '../../shared/team-progress';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { workOutcomes } from '../../shared/work-outcomes';
import { groupRecoveryAttempts } from '../../shared/recovery-attempts';
import { AppProposalCards, type ProposalActions } from './AppProposals';
import { ChangedFilesLine, DiffDialog } from './DiffViewer';
import type { WorkspaceDiffSummary } from '../../shared/workspace-diff';
import type { AppProposal } from '../../shared/app-proposals';
import type { ChatQuote } from '../../shared/side-threads';
import { McpApprovalCard } from './McpApproval';
import { turnNotices } from './turnNotices';
import { withoutSourceIds } from '../../shared/source-mentions';

/** A turn's notices already in their order (COD-217, `turnNotices`): what goes above the answer and what goes under it. */
type TurnNotices = ReturnType<typeof turnNotices>;

/** The runs of a turn that changed files or folders in their working copy, with the counts the core kept (COD-163). */
export function changedFilesOf(runs: readonly Run[], recovery: WorkspaceRecoveryView | undefined): { run: Run; summary: WorkspaceDiffSummary }[] {
  if (!recovery) return [];
  return runs.flatMap(run => {
    const summary = recovery.copies.find(copy => copy.runId === run.id)?.diff;
    return summary && (summary.files > 0 || (summary.folders ?? 0) > 0) ? [{ run, summary }] : [];
  });
}

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

/** Per chat, the set of knowledge suggestions whose island offer was dismissed (COD-208): UI chrome, so localStorage. */
const dismissedSuggestionsKey = 'orglet.knowledge-island-dismissed';
function readDismissedSuggestions(taskId: string): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(dismissedSuggestionsKey) || '{}') as Record<string, string>;
    return typeof stored[taskId] === 'string' ? stored[taskId] : undefined;
  } catch { return undefined; }
}
function rememberDismissedSuggestions(taskId: string, suggestionKey: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(dismissedSuggestionsKey) || '{}') as Record<string, string>;
    localStorage.setItem(dismissedSuggestionsKey, JSON.stringify({ ...stored, [taskId]: suggestionKey }));
  } catch { /* a blocked store brings the offer back next time, nothing worse */ }
}

/** Per chat, the run whose "account ran out" island offer was dismissed (COD-225): UI chrome, so localStorage. */
const dismissedLimitRunKey = 'orglet.account-island-dismissed';
function readDismissedLimitRun(taskId: string): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(dismissedLimitRunKey) || '{}') as Record<string, string>;
    return typeof stored[taskId] === 'string' ? stored[taskId] : undefined;
  } catch { return undefined; }
}
function rememberDismissedLimitRun(taskId: string, runId: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(dismissedLimitRunKey) || '{}') as Record<string, string>;
    localStorage.setItem(dismissedLimitRunKey, JSON.stringify({ ...stored, [taskId]: runId }));
  } catch { /* a blocked store brings the offer back next time, nothing worse */ }
}

/** How the account picker names an account: its label, or the default account's name. */
function accountLabel(harness: HarnessInfo, accountId: string) {
  if (accountId === SYSTEM_ACCOUNT_ID) return t('Tài khoản mặc định');
  return harness.accounts.find(account => account.id === accountId)?.label ?? t('Tài khoản mặc định');
}

export const statusLabel: Record<TaskStatus, string> = translated({ queued: 'Đang chờ', running: 'Đang làm', pausing: 'Đang tạm dừng', paused: 'Đã tạm dừng', completed: 'Hoàn tất', partial: 'Kết quả một phần', failed: 'Cần xem lại', cancelled: 'Đã hủy', interrupted: 'Bị gián đoạn', waiting_budget: 'Đang chờ ngân sách', waiting_input: 'Chờ bổ sung bằng chứng' });

type Turn = { revision: number; runs: Run[]; sentAt: string; brief: string; replyTo?: string; sources: TaskDetail['sources']; artifact?: Artifact; author?: Run; replies: { run: Run; artifact: Artifact }[] };

/**
 * A task shown as one chat (user decision 2026-09-17): every message the user sent, oldest first, each followed by the
 * worker's answer. Answers are normal messages; a structured report is shown only when one was asked for or a team
 * checklist requires it. Run controls belong to the latest turn only; token usage and cost live in Chi tiết.
 */

export function TaskThread({ detail, workspace, recovery, action, showSources, reviewRecovery, openMessage, proposals, openKnowledge, reviewKnowledge, proposalActions, mentionPeople, mentionAllNames, openMemories, openChat, openMainChat, scheduleRun }: { detail: TaskDetail; /** The live workers, skills and chats, so the app-change cards can name what an id or a same-reply ref points at (COD-212) and open the chats a self-improvement came from (COD-162). */ workspace: Pick<Workspace, 'workers' | 'skills' | 'tasks'>; recovery?: WorkspaceRecoveryView; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; reviewRecovery?: (runId?: string) => void; openMessage: (messageId: string) => void; proposals: Knowledge[]; openKnowledge: (item: Knowledge) => void; reviewKnowledge: () => void; /** Apply, dismiss, undo and open for the app-change cards (COD-199); the parent owns the bridge. */ proposalActions: ProposalActions; mentionPeople?: readonly MentionPerson[]; mentionAllNames?: readonly string[]; /** Opens a worker's Memory tab from the trace above its answer (COD-220). */ openMemories?: (workerId: string) => void;
  /** Opens another chat: the side thread a quote came from, or the main chat an answer was brought into (COD-247). */ openChat?: (taskId: string) => void;
  /** Opens an orglet's main chat from one of its side threads. */ openMainChat?: (workerId: string) => void;
  /** Set on a schedule's run: the schedule's name, who ran it, and the way to the schedule (COD-258). */ scheduleRun?: { name: string; owner: string; openSchedule: () => void } }) {
  const viewport = useRef<HTMLDivElement>(null); const atBottom = useRef(true);
  const [answeringDecision, setAnsweringDecision] = useState(false);
  // The run whose working-copy changes are open in the diff viewer (COD-163).
  const [diffRun, setDiffRun] = useState<Run>();
  // A member's saved report open in the document viewer from the card that says to see it (COD-256).
  const [savedReportId, setSavedReportId] = useState<string>();
  const savedReport = savedReportId ? detail.artifacts.find(artifact => artifact.id === savedReportId) : undefined;
  const current = detail.task.inputRevision ?? 0;
  const pendingDecision = detail.task.decisionRequests?.findLast(request => request.inputRevision === current && !request.answer && !request.interruptedAt);
  const turns: Turn[] = [...new Set([0, current, ...detail.runs.map(run => run.snapshot.inputRevision ?? 0)])].sort((a, b) => a - b).map(revision => {
    const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
    const input = revision === current ? detail.task.currentInput ?? detail.task : runs.find(run => run.snapshot.input)?.snapshot.input ?? detail.task;
    const artifact = detail.artifacts.findLast(item => runs.some(run => run.id === item.runId && (!detail.task.teamSnapshot || run.stage === 'synthesis')));
    // Group chat: each worker's latest answered run for this message, in the order they answered.
    const replies = runs.filter(run => run.stage === 'group').flatMap(run => { const reply = detail.artifacts.find(item => item.runId === run.id); return reply ? [{ run, artifact: reply }] : []; });
    return { revision, runs, sentAt: runs[0]?.startedAt ?? detail.task.createdAt, brief: input.brief, replyTo: 'replyTo' in input ? input.replyTo : undefined, sources: input.sourceIds.map(id => detail.sources.find(source => source.id === id)).filter(Boolean) as TaskDetail['sources'], artifact, author: artifact ? detail.runs.find(run => run.id === artifact.runId) : runs.at(-1), replies };
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
  // Side threads (COD-247): which answers were already brought into a main chat, and what the threads are called.
  const broughtIn = new Set(workspace.tasks.flatMap(task => (task.quotes ?? []).map(quote => quote.artifactId)));
  const threadName = (taskId: string) => {
    const thread = workspace.tasks.find(task => task.id === taskId && !task.deletedAt);
    return thread ? thread.title || thread.brief.split('\n')[0].trim() : undefined;
  };
  const sideThreadOrglet = detail.runs[0]?.snapshot.worker.name ?? workspace.workers.find(worker => worker.id === detail.task.workerId)?.name ?? 'Orglet';
  const liveRuns = useRunProgress(detail.task.id);
  // Changes whenever streamed text or steps grow, so the view keeps following the newest output.
  const liveLength = Object.values(liveRuns).reduce((total, update) => total + (update.progress ? update.progress.preamble.length + update.progress.answer.length + update.progress.activity.length : 0), 0);
  useEffect(() => { if (atBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [detail.events.length, detail.artifacts.length, turns.length, liveLength]);

  // What the worker is doing now, shown as the island on the prompt bar (COD-167) rather than in the thread: the
  // latest turn's streaming run, or the run the core's own events describe before anything has streamed.
  const latestTurn = turns.find(turn => turn.revision === current);
  const latestLive = busy && latestTurn ? liveRunOf(latestTurn.runs, liveRuns) : undefined;
  const latestActiveRun = latestTurn ? latestTurn.runs.find(item => item.status === 'running') ?? latestTurn.runs.find(item => item.status === 'queued') : undefined;
  const dockedRun = busy ? latestLive?.run ?? latestActiveRun : undefined;
  const pausing = detail.task.status === 'pausing';
  // Who the island names (COD-169): the workers whose runs of this turn are really running, never the roster; while
  // none is yet (the run is still queued for a turn), the run the island is about.
  const working = latestTurn ? workingWorkers(latestTurn.runs, liveRuns) : [];
  const islandWorkers = working.length > 0 ? working : dockedRun ? [dockedRun.snapshot.worker] : [];
  const dockedIsland = dockedRun
    ? latestLive?.update.progress
      ? islandOf(latestLive.update.progress, pausing, islandWorkers)
      : islandBeforeStreaming({ workers: islandWorkers, stage: dockedRun.stage, message: detail.events.at(-1)?.message, pausing })
    : undefined;
  const islandWorkerKey = islandWorkers.map(worker => worker.id).join(',');
  // Once no run is on, the island offers this chat's knowledge suggestions instead (COD-208). Dismissing hides the
  // offer for that set only, remembered per chat in localStorage; the notes themselves stay in Thư viện → Knowledge.
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => readDismissedSuggestions(detail.task.id));
  const suggestionKey = knowledgeSuggestionKey(proposals.map(item => item.id));
  const knowledgeShown = showsKnowledgeIsland({ runLive: dockedIsland !== undefined, suggestionIds: proposals.map(item => item.id), dismissedKey: dismissedSuggestions });
  // The dock keeps the actions it was first given for a set; delegating through a ref keeps them current.
  const knowledgeActions = useRef({ review: () => {}, dismiss: () => {} });
  knowledgeActions.current = {
    review: () => proposals.length === 1 ? openKnowledge(proposals[0]) : reviewKnowledge(),
    dismiss: () => { setDismissedSuggestions(suggestionKey); rememberDismissedSuggestions(detail.task.id, suggestionKey); },
  };
  // A harness account that ran out of plan usage (COD-225): the latest turn's run the core marked `plan_limit`, once
  // no run is on. Usage is read fresh, because the account in use has just run out, and the island offers the account
  // with the most room; switching selects it and runs the turn again. It takes the tab before the knowledge offer.
  const limitRun = !busy && latestTurn ? outOfPlanRun(latestTurn.runs) : undefined;
  const limitProvider = limitRun?.snapshot.worker.provider;
  const limitHarness = limitProvider && isHarness(limitProvider) ? limitProvider : undefined;
  const [dismissedLimitRun, setDismissedLimitRun] = useState(() => readDismissedLimitRun(detail.task.id));
  const [accountOffer, setAccountOffer] = useState<{ runId: string; harness: HarnessInfo; offer: AccountSwitch }>();
  useEffect(() => {
    if (!limitRun || !limitHarness || dismissedLimitRun === limitRun.id) return;
    let live = true;
    const runId = limitRun.id;
    void Promise.all([orglet.call('harnesses', { refresh: false }), orglet.call('harnessUsage', { refresh: true })]).then(([harnesses, usage]) => {
      const harness = harnesses.find(item => item.id === limitHarness);
      if (live && harness) setAccountOffer({ runId, harness, offer: accountSwitchFor(harness, usage[limitHarness]) });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [limitRun?.id, limitHarness, dismissedLimitRun]);
  const accountShown = !dockedIsland && limitRun && accountOffer?.runId === limitRun.id && dismissedLimitRun !== limitRun.id ? accountOffer : undefined;
  const switchTarget = accountShown?.offer.kind === 'switch' ? { accountId: accountShown.offer.accountId, label: accountLabel(accountShown.harness, accountShown.offer.accountId), usedPercent: accountShown.offer.usedPercent } : undefined;
  const switchResetsAt = accountShown?.offer.kind === 'wait' ? accountShown.offer.resetsAt : undefined;
  const accountActions = useRef({ switchAccount: () => {}, dismiss: () => {} });
  accountActions.current = {
    switchAccount: () => {
      if (!accountShown || !switchTarget) return;
      action(async () => {
        await orglet.call('selectHarnessAccount', { harness: accountShown.harness.id, id: switchTarget.accountId });
        await orglet.call('retry', { id: detail.task.id });
      });
    },
    dismiss: () => {
      if (!limitRun) return;
      setDismissedLimitRun(limitRun.id);
      rememberDismissedLimitRun(detail.task.id, limitRun.id);
    },
  };
  useEffect(() => {
    if (dockedIsland) dockIsland({ kind: 'run', ...dockedIsland });
    else if (accountShown) dockIsland({
      kind: 'account', key: accountShown.runId, harnessName: accountShown.harness.name,
      ...(switchTarget ? { target: { label: switchTarget.label, usedPercent: switchTarget.usedPercent } } : {}),
      ...(switchResetsAt ? { resetsAt: switchResetsAt } : {}),
      switchAccount: () => accountActions.current.switchAccount(), dismiss: () => accountActions.current.dismiss(),
    });
    else if (knowledgeShown) dockIsland({ kind: 'knowledge', key: suggestionKey, count: proposals.length, review: () => knowledgeActions.current.review(), dismiss: () => knowledgeActions.current.dismiss() });
    else dockIsland(undefined);
  }, [dockedIsland?.state, dockedIsland?.label, dockedIsland?.receipt, islandWorkerKey, knowledgeShown, suggestionKey, accountShown?.runId, switchTarget?.accountId, switchTarget?.label, switchTarget?.usedPercent, switchResetsAt]);
  useEffect(() => () => dockIsland(undefined), []);

  // A face nods when its answer lands, not when an old chat opens: the runs already finished when this chat was
  // opened stay still, and only a run that completes after that is marked `landed` (the Finishing state in styles.css).
  const finishedAtOpen = useRef<Set<string>>(null);
  if (finishedAtOpen.current === null) finishedAtOpen.current = new Set(detail.runs.filter(run => run.status === 'completed').map(run => run.id));
  const landed = (run: Run) => run.status === 'completed' && !finishedAtOpen.current!.has(run.id);
  const bylineClass = (author?: Run, working = false) => working ? 'message-byline working' : author && landed(author) ? 'message-byline landed' : 'message-byline';
  const byline = (author?: Run, working = false) => <div className={bylineClass(author, working)}>{/* Agent marks sit left of the name. */}{author ? <Avatar name={author.snapshot.worker.name} seed={author.snapshot.worker.id} mascot={author.snapshot.worker.avatar?.mascot} defaultMascot hint={author.snapshot.worker.description} color={author.snapshot.worker.avatar?.color} size="md" alive badge={author.snapshot.worker.provider === 'demo' ? undefined : <ProviderMark provider={author.snapshot.worker.provider} size="small" decorative />} /> : <span className="orglet-mark small">o</span>}<strong>{author?.snapshot.worker.name ?? 'Orglet'}</strong>{author && bylineRole(author)}{author && <span className="byline-provider">{providerName(author.snapshot.worker.provider)}</span>}</div>;

  // One line per run of the turn that changed files in its working copy (COD-163); `named` says whose line carries
  // the worker's name. Each opens the diff viewer.
  const changedFilesLines = (runs: readonly Run[], named: (run: Run) => boolean) => changedFilesOf(runs, recovery).map(({ run, summary }) =>
    <ChangedFilesLine key={run.id} summary={summary} workerName={named(run) ? run.snapshot.worker.name : undefined} onOpen={() => setDiffRun(run)} />);
  // The cards for app changes the workers proposed, each with what became of it; historical turns keep theirs.
  const proposalCards = (proposals: AppProposal[]) => proposals.length > 0
    ? <AppProposalCards key="proposals" proposals={proposals} workers={workspace.workers} skills={workspace.skills} tasks={workspace.tasks} actions={proposalActions} />
    : undefined;
  /**
   * One worker's answer with every notice in its slot (COD-217, the order lives in `turnNotices`). `runs` are the runs
   * whose changes belong with this answer: a crew turn's members each work in their own copy, so their lines are
   * named, while the author's own line is not; the same runs give a crew answer its handoff rows in the trace
   * (COD-220). `proposals` are the cards this answer's run proposed.
   */
  const answer = (artifact: Artifact, author: Run | undefined, runs: readonly Run[], proposals: AppProposal[], latest: boolean) => {
    const authorName = author?.snapshot.worker.name ?? 'Orglet';
    const chat = artifact.report.format === 'chat';
    // A source id the model copied into its message reads as the file's name, here and in what is copied (COD-257).
    const replyText = withoutSourceIds(tMessage(artifact.report.summary), detail.sources);
    const trace = traceOf({ memories: artifact.usedMemories, context: author?.snapshot.context, runId: artifact.runId, events: detail.events, crew: author?.stage === 'synthesis' ? runs : [] });
    const workerId = author?.snapshot.worker.id;
    const notices = turnNotices({
      trace: trace.length > 0 ? <TurnTrace key="trace" entries={trace} onOpenMemories={openMemories && workerId ? () => openMemories(workerId) : undefined} /> : undefined,
      changes: changedFilesLines(runs, run => run.id !== artifact.runId),
      proposals: proposalCards(proposals),
      // A chat answer copies and downloads from its row; a report keeps those in its viewer's toolbar.
      actions: <MessageActions key="actions" taskId={detail.task.id} messageId={artifact.id} author={authorName} reactions={detail.task.messageReactions ?? []} action={action}
        text={chat ? replyText : tMessage(artifact.report.title)}
        leading={<>
          {chat && <ArtifactActions artifactId={artifact.id} about={t('Câu trả lời của {0}', [authorName])} action={action} />}
          {detail.task.sideOf && <BringIntoMainChat artifactId={artifact.id} brought={broughtIn.has(artifact.id)} about={t('Câu trả lời của {0}', [authorName])} action={action} openChat={openChat} />}
        </>} />,
    });
    // The reactions ride on the answer's own corner, whichever shape it takes (COD-219).
    const badges = <MessageBadges taskId={detail.task.id} messageId={artifact.id} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} align="end" />;
    return chat
      ? <ChatReply artifact={artifact} text={replyText} notices={notices} badges={badges} />
      : <ReportView artifact={artifact} author={author} latest={latest} busy={busy} detail={detail} action={action} showSources={showSources} notices={notices} badges={badges} />;
  };

  return <div className="thread-scroll" ref={viewport} onScroll={() => { const el = viewport.current!; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
    <div className="thread-content">
      {detail.task.sideOf && <p className="side-thread-origin">
        <span>{t('Chat phụ với {0}. Chat chính vẫn như cũ.', [sideThreadOrglet])}</span>
        {openMainChat && <button type="button" onClick={() => openMainChat(detail.task.workerId)}>{t('Mở chat chính')}</button>}
      </p>}
      {scheduleRun && <p className="side-thread-origin">
        <span>{t('Lần chạy của lịch {0}, do {1} làm.', [scheduleRun.name, scheduleRun.owner])}</span>
        <button type="button" onClick={scheduleRun.openSchedule}>{t('Mở lịch')}</button>
      </p>}
      {turns.map((turn, index) => {
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
        const live = latest ? latestLive : undefined;
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
        // A member that handed in a blocker still saved its report; the card's message points at it, so it opens from here.
        const blockerReport = unresolvedError?.stage === 'member' ? detail.artifacts.find(artifact => artifact.runId === unresolvedError.id) : undefined;
        const previousSentAt = turns[index - 1]?.sentAt;
        const addedFiles = filesAddedWith(turn.sources, turns[index - 1]?.sources);
        // A group-chat reply carries the cards its own run proposed; the rest of the turn's cards sit with the turn.
        const turnProposals = detail.appProposals.filter(proposal => proposal.inputRevision === turn.revision);
        const replyRunIds = new Set(turn.replies.map(reply => reply.run.id));
        const remainingProposals = turnProposals.filter(proposal => !replyRunIds.has(proposal.runId));
        const answered = !!turn.artifact && !turn.replies.length;
        return <div className="chat-turn" key={turn.revision}>
          {needsTimeMark(previousSentAt, turn.sentAt) && <TimeMark at={turn.sentAt} />}
          {/* The files ride above the bubble in their own sideways row, the way a chat app sends attachments ahead
              of the text, rather than stacking one per line inside it (user, 2026-09-21). */}
          {addedFiles.length > 0 && <ul className="message-files" aria-label={t('Tệp đính kèm')}>
            {addedFiles.map(item => <Attachment key={item.id} name={item.name} bytes={item.bytes} onOpen={() => showSources({ type: 'source', id: item.id })} />)}
          </ul>}
          <div className="user-message" id={`message-${turnMessageId(detail.task.id, turn.revision)}`} tabIndex={-1}>
            {turn.replyTo && <button type="button" className="message-reply-context" onClick={() => openMessage(turn.replyTo!)}>
              <Reply size={13} aria-hidden="true" />{t('Mở tin gốc: {0}', [replyLabel(turn.replyTo) ?? t('Tin nhắn trước không còn hiển thị')])}
            </button>}
            <p><MentionText text={turn.brief} people={mentionPeople ?? []} allNames={mentionAllNames} /></p>
            {/* On the bubble's start corner: the bubble is right-aligned, so that corner faces the thread. */}
            <MessageBadges taskId={detail.task.id} messageId={turnMessageId(detail.task.id, turn.revision)} reactions={detail.task.messageReactions ?? []} runs={detail.runs} action={action} align="start" />
          </div>
          {/* Under the bubble, as a worker's answer carries them, so both sides of the chat act the same way. */}
          <MessageActions taskId={detail.task.id} messageId={turnMessageId(detail.task.id, turn.revision)} author={t('Bạn')} text={turn.brief} reactions={detail.task.messageReactions ?? []} action={action} />
          {latest && workFrame && <p className="muted" role="status">{t('Mục tiêu Tí hiểu: {0}', [workFrame.goal])}</p>}
          {latest && outcomeText && <p className="muted" role="status">{outcomeText}</p>}
          {turn.replies.map(reply => <section key={reply.run.id} className="assistant-message" aria-label={t('Trả lời của {0}', [reply.run.snapshot.worker.name])}>
            {byline(reply.run)}
            {answer(reply.artifact, reply.run, [reply.run], turnProposals.filter(proposal => proposal.runId === reply.run.id), latest)}
          </section>)}
          {(!turn.replies.length || (latest && (busy || detail.task.status !== 'completed'))) && <section className={latest && detail.task.status === 'waiting_input' ? 'assistant-message needs-you' : 'assistant-message'} aria-label={t('Trả lời của {0}', [turn.author?.snapshot.worker.name ?? 'Orglet'])}>
            {latest && busy && thinkingRun ? byline(thinkingRun, true) : !(latest && busy) && !turn.replies.length && byline(turn.author)}
            {turn.runs.some(item => item.snapshot.preflightId) && <Button variant="outline" onClick={() => showSources()}>{t('Xem kiểm tra trước review')}</Button>}
            {latest && detail.task.status === 'waiting_input' && pendingDecision?.approval && <McpApprovalCard approval={pendingDecision.approval} busy={answeringDecision} sideThread={Boolean(detail.task.sideOf)}
              workerName={detail.runs.find(run => run.id === pendingDecision.runId)?.snapshot.worker.name ?? 'Orglet'}
              onAnswer={choice => {
                if (answeringDecision) return;
                setAnsweringDecision(true);
                action(async () => {
                  try { await orglet.call('answerDecision', { taskId: detail.task.id, requestId: pendingDecision.id, answer: choice }); }
                  finally { setAnsweringDecision(false); }
                });
              }} />}
            {latest && detail.task.status === 'waiting_input' && pendingDecision && !pendingDecision.approval && <div role="group" aria-label={t('Quyết định đang chờ')}>
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
            {latest && busy && liveUpdate && <LiveRun update={liveUpdate} memories={live?.run.snapshot.context?.memories} />}
            {latest && detail.task.status === 'paused' && <p role="status">{t('Đã tạm dừng. Tiếp tục giữ nguyên thiết lập của lần chạy này; thử lại tạo lần chạy mới.')}</p>}
            {latest && detail.task.handoff && <details><summary>{t('Bàn giao cuối ca')}</summary><p>{t('{0} báo cáo đã lưu · đã đối soát {1} · giữ chỗ {2}', [detail.task.handoff.artifactIds.length, formatMoney(detail.task.handoff.chargedMicros), formatMoney(detail.task.handoff.reservedMicros)])}</p><ul>{detail.task.handoff.artifactIds.map(id => <li key={id}>{detail.artifacts.find(artifact => artifact.id === id)?.report.title ?? id}</li>)}</ul>{detail.task.handoff.blockers.length > 0 && <><h3>{t('Điểm đang chờ')}</h3><ul>{detail.task.handoff.blockers.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></>}<h3>{t('Bước tiếp theo')}</h3><ul>{detail.task.handoff.nextSteps.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></details>}
            {latest && detail.task.status === 'partial' && <p className="run-error">{failedNames.length ? t('{0} chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.', [failedNames.join(', ')]) : t('Một số role chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.')}</p>}
            {!turn.artifact && !turn.replies.length && !(latest && busy) && !unresolvedError && !(latest && pendingDecision) && <p className="muted">{t('Chưa có câu trả lời cho tin nhắn này.')}</p>}
            {answered
              ? answer(turn.artifact!, turn.author, turn.runs, remainingProposals, latest)
              /* No answer of its own to hang them on (still running, failed, or a group turn whose replies carry
                 theirs), so what the turn's runs produced still reads in the same order under the turn. */
              : turnNotices({ changes: turn.replies.length ? undefined : changedFilesLines(turn.runs, () => true), proposals: proposalCards(remainingProposals) }).after}
            {unresolvedError?.error && <div className="run-error" role="status"><h3>{statusLabel[detail.task.status]}</h3>
              {/* A run refused by the unknown-outcome guard (COD-191) says what to do, not which guard fired: the
                  attempt to review sits in Details, and the button below opens it there. */}
              <p>{unresolvedError.errorCode === 'unresolved_attempt' ? t('Một thay đổi file trước đó chưa rõ kết quả. Kiểm tra trong Chi tiết rồi giữ file hiện tại, sau đó Tí mới ghi tiếp được.')
                : unresolvedError.stage === 'plan' ? t('Trưởng phòng: {0}', [tMessage(unresolvedError.error)]) : tMessage(unresolvedError.error)}</p>
            </div>}
            {latest && <div className="actions">
              {!busy && unresolvedError?.errorCode === 'unresolved_attempt' && reviewRecovery && <Button variant="primary" onClick={() => reviewRecovery(groupRecoveryAttempts(recovery, detail.runs).blocking?.runId)}><FolderOpen size={16} />{t('Xem trong Chi tiết')}</Button>}
              {blockerReport && unresolvedError && <Button variant="primary" onClick={() => setSavedReportId(blockerReport.id)}><FileText size={16} />{t('Mở báo cáo của {0}', [unresolvedError.snapshot.worker.name])}</Button>}
              {!busy && ['paused', 'interrupted', 'waiting_budget'].includes(detail.task.status) && <Button variant="primary" onClick={() => action(() => orglet.call('resume', { id: detail.task.id }))}>{t('Tiếp tục từ checkpoint')}</Button>}
              {!busy && !['completed', 'waiting_input'].includes(detail.task.status) && <Button variant="outline" onClick={() => action(() => orglet.call('retry', { id: detail.task.id }))}><RotateCcw size={16} />{t('Thử lại với thiết lập hiện tại')}</Button>}
            </div>}
          </section>}
          <ReadReceipts readers={readersByRevision.get(turn.revision) ?? []} />
          {(detail.task.quotes ?? []).filter(quote => quote.afterRevision === turn.revision).map(quote =>
            <BroughtInQuote key={quote.id} quote={quote} threadName={threadName(quote.fromTaskId)} onOpen={openChat && threadName(quote.fromTaskId) ? () => openChat(quote.fromTaskId) : undefined} />)}
        </div>;
      })}
    </div>
    {diffRun && <DiffDialog taskId={detail.task.id} run={diffRun} onClose={() => setDiffRun(undefined)} />}
    {savedReport && <ReportDocument artifact={savedReport} author={detail.runs.find(run => run.id === savedReport.runId)} detail={detail} open onClose={() => setSavedReportId(undefined)} busy={busy} action={action} showSources={showSources}
      actions={<ArtifactActions artifactId={savedReport.id} about={tMessage(savedReport.report.title)} action={action} />} />}
  </div>;
}

/**
 * A normal chat answer: the message as a bubble, its limitations, and the turn's notices around it in their order
 * (COD-217): what was loaded before writing above, what came out of it and the action row below.
 */
function ChatReply({ artifact, text, notices, badges }: { artifact: Artifact; /** The message as shown, already translated and with source ids named. */ text: string; notices: TurnNotices; badges: ReactNode }) {
  return <div className="chat-reply">
    {notices.before}
    <div className="chat-bubble" id={`message-${artifact.id}`} tabIndex={-1}><Markdown className="prose" text={text} />{badges}</div>
    {artifact.report.limitations.length > 0 && <div className="chat-limitations">
      <strong>{t('Phần chưa hoàn tất hoặc còn giới hạn')}</strong>
      <ul>{artifact.report.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul>
    </div>}
    {notices.after}
  </div>;
}

/**
 * An answer from a side thread that the person brought into this main chat (COD-247). It sits on the person's side,
 * like their own messages, because they put it here; the line above it says where it came from and opens that thread.
 * It is a quote, not a message sent: nothing ran when it arrived.
 */
function BroughtInQuote({ quote, threadName, onOpen }: { quote: ChatQuote; threadName?: string; onOpen?: () => void }) {
  const origin = threadName ? t('{0} trong chat phụ “{1}”', [quote.author, threadName]) : t('{0} trong một chat phụ đã xóa', [quote.author]);
  return <div className="brought-in" id={`message-${quote.id}`} tabIndex={-1}>
    {onOpen
      ? <button type="button" className="message-reply-context" onClick={onOpen}><MessageSquareQuote size={13} aria-hidden="true" />{origin}</button>
      : <p className="message-reply-context"><MessageSquareQuote size={13} aria-hidden="true" />{origin}</p>}
    <Markdown className="prose" text={tMessage(quote.text)} />
  </div>;
}

/** "Bring into main chat" on a side thread's answer: copies it there as a quote and starts nothing (COD-247). */
function BringIntoMainChat({ artifactId, brought, about, action, openChat }: { artifactId: string; brought: boolean; about: string; action: (fn: () => Promise<unknown>) => void; openChat?: (taskId: string) => void }) {
  const label = brought ? t('Đã đưa vào chat chính') : t('Đưa vào chat chính');
  const bring = () => action(async () => {
    const mainTaskId = await orglet.call('bringIntoMainChat', { artifactId });
    toast(t('Đã đưa vào chat chính'), 'success', about, openChat ? { action: { label: t('Mở'), onSelect: () => openChat(mainTaskId) } } : {});
  });
  return <Button size="icon" aria-label={label} title={label} disabled={brought} onClick={bring}>{brought ? <Check size={15} /> : <MessageSquareQuote size={15} />}</Button>;
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


/** Copy and download for an answer or document, in the format the user picks or saved as default; `about` names it for the notice. */
function ArtifactActions({ artifactId, about, action }: { artifactId: string; about: string; action: (fn: () => Promise<unknown>) => void }) {
  return <>
    <FormatAction kind="copy" onPick={format => action(async () => { await orglet.copyArtifact(artifactId, format); toast(format === 'text' ? t('Đã sao chép văn bản') : t('Đã sao chép Markdown'), 'success', about); })} />
    <FormatAction kind="download" onPick={format => action(() => orglet.exportArtifact(artifactId, format))} />
  </>;
}

/**
 * A structured report is sent like a file a colleague attaches (user decision 2026-09-17): a quiet file card in the chat
 * that opens in a macOS-style document viewer. The Demo sample has no summary worth showing, only its limits.
 */
function ReportView({ artifact, author, latest, busy, detail, action, showSources, notices, badges }: { artifact: Artifact; author?: Run; latest: boolean; busy: boolean; detail: TaskDetail; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; notices: TurnNotices; badges: ReactNode }) {
  const [open, setOpen] = useState(false);
  const report = artifact.report;
  const name = tMessage(report.title);
  const when = new Date(artifact.createdAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  const meta = [t('Báo cáo'), report.findings.length ? t('{0} phát hiện', [report.findings.length]) : '', latest && detail.task.accepted ? t('Đã chấp nhận') : '', when].filter(Boolean).join(' · ');
  return <>
    <div className="report-turn" id={`message-${artifact.id}`} tabIndex={-1}>
      {notices.before}
      {/* The card is a button, so the badges sit beside it in a wrapper the size of the card, not inside it. */}
      <div className="report-card"><DocumentCard name={name} meta={meta} onOpen={() => setOpen(true)} />{badges}</div>
      {notices.after}
    </div>
    <ReportDocument artifact={artifact} author={author} detail={detail} open={open} onClose={() => setOpen(false)} busy={busy} action={action} showSources={showSources} actions={<>
      {latest && <Button variant="outline" className="doc-action" disabled={detail.task.accepted || busy} onClick={() => action(() => orglet.call('accept', { id: detail.task.id }))}><Check size={15} />{detail.task.accepted ? t('Đã chấp nhận') : t('Chấp nhận báo cáo')}</Button>}
      <ArtifactActions artifactId={artifact.id} about={name} action={action} />
    </>} />
  </>;
}

/**
 * A saved report open in the document viewer: its name, who wrote it and when, the summary, the checks, the findings
 * and its limitations. A crew answer opens here from its card; a member's blocker report opens here from the card
 * that says to see it (COD-256).
 */
function ReportDocument({ artifact, author, detail, open, onClose, busy, action, showSources, actions }: { artifact: Artifact; author?: Run; detail: TaskDetail; open: boolean; onClose: () => void; busy: boolean; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; actions: ReactNode }) {
  const report = artifact.report;
  const sample = author?.snapshot.worker.provider === 'demo';
  const name = tMessage(report.title);
  const when = new Date(artifact.createdAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  // Evidence links leave the document for the sources panel.
  const openSource = (target?: SourceTarget) => { onClose(); showSources(target); };
  return <DocumentViewer open={open} onClose={onClose} name={name} actions={actions}>
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
  </DocumentViewer>;
}
