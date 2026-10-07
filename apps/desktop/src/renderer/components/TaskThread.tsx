import { chatTurnRevisions, chatTurnInput, chatTurnMessageId, chatTurnCreatedAt } from '../../shared/chat-turns';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Check, RotateCcw, Reply, FolderOpen, MessageSquareQuote, Wrench, Forward, FileX, Hourglass, StepForward, Route, ChevronRight, ListTodo, Play, UserRound, TriangleAlert } from 'lucide-react';
import { unfinishedWork } from '../unfinishedWork';
import { answersWithPlan, canFollowPlan } from '../../shared/approval-mode';
import { setPlanFirst } from '../planFirst';
import { taskDraftKey } from '../drafts';
import { routeOfTurn, type TurnRoute } from '../../shared/turn-routing';
import type { Artifact, Run, TaskDetail, TaskStatus, Workspace } from '../../shared/contracts';
import { Button } from './ui';
import { Skeleton, SkeletonGroup } from '@codepawlhq/orglet-ui';
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
import { pausedAfter } from '../../shared/paused-turn';
import { DocumentCard, DocumentViewer } from './DocumentViewer';
import { FormatAction } from './FormatAction';
import { currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { isHarness, type HarnessInfo } from '../../shared/harness';
import { harnessAccountLabel } from './PlanUsage';
import { accountSwitchFor, outOfPlanRun, type AccountSwitch } from '../../shared/account-switch';
import { ChartAskContext, Markdown } from './Markdown';
import { replyToChartPoint } from './messageMarks';
import { Attachment } from './Attachment';
import { clockLabel, needsTimeMark, TimeMark } from './TimeMark';
import { MessageActions, MessageBadges, hasReactions } from './MessageActions';
import { messageGrouping, personAuthorKey, workerAuthorKey } from '../messageGroups';
import { MAIN_DOCK } from './islandDock';
import { LiveRun, ProgressNotes, RunStatusLine, browsingSiteOf, islandBeforeStreaming, islandOf, liveRunOf, runStepLine, useRunProgress, runEventMessage, waitingStepLine, withBrowserControls, withDesktopApproval, workingWorkers } from './LiveRun';
import { BrowserApprovalCard } from './BrowserApproval';
import { BrowserLiveViewer, openBrowserViewer, takeOverBrowser } from './BrowserLiveView';
import { DesktopApprovalCard } from './DesktopApps';
import { WorkLog } from './WorkLog';
import { traceOf } from '../turnTrace';
import { dockIsland } from './islandDock';
import { knowledgeSuggestionKey, showsKnowledgeIsland } from '../../shared/knowledge-island';
import { UNASSIGNED_PLAN_ERROR } from '../../shared/contracts';
import { MentionMarkdown } from './mentions';
import type { MentionPerson } from '../../shared/mentions';
import { teamProgress } from '../../shared/team-progress';
import { crewPlanDiagram } from '../../shared/crew-plan';
import { CrewPlanFlow } from './CrewPlanFlow';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { changedFilesOf } from '../changedFiles';
import { useDiffReview } from './ChangesView';
import { groupRecoveryAttempts } from '../../shared/recovery-attempts';
import { AppProposalCards, type ProposalActions } from './AppProposals';
import { ChangedFilesLine } from './DiffViewer';
import type { AppProposal } from '../../shared/app-proposals';
import type { ChatQuote } from '../../shared/side-threads';
import { chatHeadline, type ForwardedMessage } from '../../shared/forward';
import { overflowAttributes, useStripOverflow } from '../stripOverflow';
import type { ForwardRequest } from '../forward';
import { McpApprovalCard } from './McpApproval';
import { turnNotices } from './turnNotices';
import { withoutSourceIds } from '../../shared/source-mentions';
import { BlockedCommandLine, CommandOutputDialog, askToFixText } from './BlockedHandIn';
import type { BlockingCommand } from '../../shared/blocked-hand-in';
import { canContinueRun } from '../../shared/out-of-steps';
import { needsPersonKey, useThreadFollow } from '../threadFollow';
import { unansweredTurnLine } from '../turnOutcome';

/** A turn's notices already in their order (COD-217, `turnNotices`): what goes above the answer and what goes under it. */
type TurnNotices = ReturnType<typeof turnNotices>;

export { changedFilesOf };

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

export const statusLabel: Record<TaskStatus, string> = translated({ queued: 'Đang chờ', running: 'Đang làm', pausing: 'Đang tạm dừng', paused: 'Đã tạm dừng', completed: 'Hoàn tất', partial: 'Kết quả một phần', failed: 'Cần xem lại', cancelled: 'Đã hủy', interrupted: 'Bị gián đoạn', waiting_budget: 'Đang chờ ngân sách', waiting_input: 'Chờ bổ sung bằng chứng' });

type Turn = { missingInput: boolean; revision: number; runs: Run[]; sentAt: string; brief: string; replyTo?: string; forwarded?: ForwardedMessage; sources: TaskDetail['sources']; artifact?: Artifact; author?: Run; replies: { run: Run; artifact: Artifact }[] };

/**
 * A task shown as one chat (user decision 2026-09-17): every message the user sent, oldest first, each followed by the
 * worker's answer. Answers are normal messages; a structured report is shown only when one was asked for or a team
 * checklist requires it. Run controls belong to the latest turn only; token usage and cost live in Chi tiết.
 */

export function TaskThread({ start, detail, workspace, recovery, action, showSources, reviewRecovery, openMessage, proposals, openKnowledge, reviewKnowledge, proposalActions, mentionPeople, mentionAllNames, openMemories, openChat, openMainChat, scheduleRun, askToFix, forward, islandDock = MAIN_DOCK, embedded = false }: {
  /** The prompt bar this chat's island docks on: the main chat's, or a side thread's in the right panel (COD-365). */ islandDock?: string;
  /** Drawn inside the right panel beside its main chat (COD-365): the panel's own head says what the thread is. */ embedded?: boolean; /** Where the chat begins: who it is with, shown above the first message the way a messenger starts a chat. */ start?: ThreadStartInfo; detail: TaskDetail; /** The live workers, skills and chats, so the app-change cards can name what an id or a same-reply ref points at (COD-212) and open the chats a self-improvement came from (COD-162). */ workspace: Pick<Workspace, 'workers' | 'skills' | 'tasks'> & Partial<Pick<Workspace, 'showWork'>>; recovery?: WorkspaceRecoveryView; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; reviewRecovery?: (runId?: string) => void; openMessage: (messageId: string) => void; proposals: Knowledge[]; openKnowledge: (item: Knowledge) => void; reviewKnowledge: () => void; /** Apply, dismiss, undo and open for the app-change cards (COD-199); the parent owns the bridge. */ proposalActions: ProposalActions; mentionPeople?: readonly MentionPerson[]; mentionAllNames?: readonly string[]; /** Opens a worker's Memory tab from the trace above its answer (COD-220). */ openMemories?: (workerId: string) => void;
  /** Opens another chat: the side thread a quote came from, or the main chat an answer was brought into (COD-247). */ openChat?: (taskId: string) => void;
  /** Opens an orglet's main chat from one of its side threads. */ openMainChat?: (workerId: string) => void;
  /** Set on a schedule's run: the schedule's name, who ran it, and the way to the schedule (COD-258). */ scheduleRun?: { name: string; owner: string; openSchedule?: () => void };
  /** Puts a reply in this chat's composer without sending it: "Nhờ sửa" on a blocked hand-in (COD-270). */ askToFix?: (text: string) => void;
  /** Opens the forward picker for one message of this chat (COD-257). */ forward?: (request: ForwardRequest) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const threadContent = useRef<HTMLDivElement>(null);
  const [answeringDecision, setAnsweringDecision] = useState(false);
  // A consequential browser step waiting on the person, answered from the card in the latest turn (COD-261).
  const browserApproval = detail.browser?.approval;
  const [answeringBrowser, setAnsweringBrowser] = useState(false);
  // And one waiting in a desktop app (COD-261, phase 2a).
  const desktopApproval = detail.desktop?.approval;
  const [answeringDesktop, setAnsweringDesktop] = useState(false);
  // A command that blocked a hand-in, its output open in the viewer, and whether "Vẫn áp dụng" is on its way (COD-270).
  const [outputCommand, setOutputCommand] = useState<BlockingCommand>();
  const [applyingHandIn, setApplyingHandIn] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [following, setFollowing] = useState(false);
  // A member's saved report open in the document viewer from the card that says to see it (COD-256).
  const [savedReportId, setSavedReportId] = useState<string>();
  const savedReport = savedReportId ? detail.artifacts.find(artifact => artifact.id === savedReportId) : undefined;
  const current = detail.task.inputRevision ?? 0;
  const unfinished = unfinishedWork(detail);
  const pendingDecision = detail.task.decisionRequests?.findLast(request => request.inputRevision === current && !request.answer && !request.interruptedAt);
  const turns: Turn[] = chatTurnRevisions(detail).map(revision => {
    const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
    const input = chatTurnInput(detail, revision);
    // In a channel with a principal, its answer comes from the check that follows members' work, or from the plan step when
    // it answered by itself (owner, 2026-10-07).
    const artifact = detail.artifacts.findLast(item => runs.some(run => run.id === item.runId && (!detail.task.teamSnapshot || run.stage === 'synthesis' || run.stage === 'plan')));
    // Group chat: each worker's latest answered run for this message, in the order they answered.
    const replies = runs.filter(run => run.stage === 'group').flatMap(run => { const reply = detail.artifacts.find(item => item.runId === run.id); return reply ? [{ run, artifact: reply }] : []; });
    return { missingInput: input === undefined, revision, runs, sentAt: chatTurnCreatedAt(detail, revision), brief: input?.brief ?? '', replyTo: input?.replyTo, forwarded: input?.forwarded, sources: (input?.sourceIds ?? []).map(id => detail.sources.find(source => source.id === id)).filter(Boolean) as TaskDetail['sources'], artifact, author: artifact ? detail.runs.find(run => run.id === artifact.runId) : runs.at(-1), replies };
  });
  const replyLabel = (messageId?: string) => {
    if (!messageId) return undefined;
    const userTurn = turns.find(turn => chatTurnMessageId(detail, turn.revision) === messageId);
    if (userTurn) return userTurn.missingInput ? t('Nội dung tin nhắn gốc không còn được lưu.') : t('Bạn: {0}', [userTurn.brief.slice(0, 140)]);
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
  const readersByRevision = readersByTurn(detail);
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  // The diff viewer for a run's working-copy changes (COD-163), with Apply and Discard while they wait (COD-279).
  const diff = useDiffReview({ detail, recovery, action, busy });
  // Side threads (COD-247): which answers were already brought into a main chat, and what the threads are called.
  const broughtIn = new Set(workspace.tasks.flatMap(task => (task.quotes ?? []).map(quote => quote.artifactId)));
  const threadName = (taskId: string) => {
    const thread = workspace.tasks.find(task => task.id === taskId && !task.deletedAt);
    return thread ? thread.title || chatHeadline(thread) : undefined;
  };
  const sideThreadOrglet = detail.runs[0]?.snapshot.worker.name ?? workspace.workers.find(worker => worker.id === detail.task.workerId)?.name ?? 'Orglet';
  const liveRuns = useRunProgress(detail.task.id);

  // What the worker is doing now, shown as the island on the prompt bar (COD-167) rather than in the thread: the
  // latest turn's streaming run, or the run the core's own events describe before anything has streamed.
  const latestTurn = turns.find(turn => turn.revision === current);
  // The thread keeps to its end while the reader is there, and brings what needs the person into view (COD-290).
  const waitingDecision = detail.task.status === 'waiting_input' ? pendingDecision?.id : undefined;
  const needKey = needsPersonKey({ status: detail.task.status, turn: current, lastRunId: latestTurn?.runs.at(-1)?.id, waitingIds: [browserApproval?.id, desktopApproval?.id, waitingDecision] });
  useThreadFollow(viewport, threadContent, { needKey, turnCount: turns.length });
  const latestLive = busy && latestTurn ? liveRunOf(latestTurn.runs, liveRuns) : undefined;
  const latestActiveRun = latestTurn ? latestTurn.runs.find(item => item.status === 'running') ?? latestTurn.runs.find(item => item.status === 'queued') : undefined;
  const dockedRun = busy ? latestLive?.run ?? latestActiveRun : undefined;
  const pausing = detail.task.status === 'pausing';
  // Who the island names (COD-169): the workers whose runs of this turn are really running, never the roster; while
  // none is yet (the run is still queued for a turn), the run the island is about.
  const working = latestTurn ? workingWorkers(latestTurn.runs, liveRuns) : [];
  const islandWorkers = working.length > 0 ? working : dockedRun ? [dockedRun.snapshot.worker] : [];
  // A run that ended while the person held its browser keeps its tabs open for them (COD-261), so the island stays
  // with Hand back until they give it back.
  const heldRun = !dockedRun && detail.browser?.takenOver ? latestTurn?.runs.at(-1) : undefined;
  const dockedRunMessage = dockedRun ? runEventMessage(detail.events, dockedRun.id) : undefined;
  const runIsland = dockedRun
    ? latestLive?.update.progress
      ? islandOf(latestLive.update.progress, pausing, islandWorkers)
      : islandBeforeStreaming({ workers: islandWorkers, stage: dockedRun.stage, message: dockedRunMessage, pausing,
        site: browsingSiteOf(detail.events.filter(event => event.runId === dockedRun.id).map(event => event.message)) })
    : heldRun ? islandBeforeStreaming({ workers: [heldRun.snapshot.worker], pausing: true }) : undefined;
  // The same state as one line in the chat, until the answer's text starts arriving; while a card waits for the
  // person, or they hold the browser, it says that instead of the step the run stopped on (COD-290).
  const waitingLine = waitingStepLine(detail.browser, detail.desktop);
  const runStatus = dockedRun && !latestLive?.update.progress?.answer
    ? waitingLine ?? runStepLine({ progress: latestLive?.update.progress, stage: dockedRun.stage, message: dockedRunMessage, pausing })
    : undefined;
  // While a run uses Orglet's browser the island carries Watch, and Hand back once taken over, and waits with the card
  // (COD-261). Watch opens the live view, where the person takes the browser over.
  const browserWorkers = dockedRun ? islandWorkers : heldRun ? [heldRun.snapshot.worker] : [];
  const browserIsland = runIsland && withBrowserControls(runIsland, detail.browser, browserWorkers, {
    watch: () => openBrowserViewer(detail.task.id), handBack: () => takeOverBrowser(detail.task.id, false),
  });
  // A desktop step waiting on its card waits the same way (COD-261, phase 2a).
  const desktopIsland = browserIsland && withDesktopApproval(browserIsland, detail.desktop, browserWorkers);
  // A run at work carries when it started, so a long wait shows its time; a run waiting on the person does not.
  const dockedIsland = desktopIsland && dockedRun && desktopIsland.state !== 'waiting' && !pausing ? { ...desktopIsland, since: Date.parse(dockedRun.startedAt) } : desktopIsland;
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
  const switchTarget = accountShown?.offer.kind === 'switch' ? { accountId: accountShown.offer.accountId, label: harnessAccountLabel(accountShown.harness, accountShown.offer.accountId), usedPercent: accountShown.offer.usedPercent } : undefined;
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
  // A question an orglet stopped to ask is answered from the island (user, 2026-10-07): its choices, or the person's
  // own words. MCP approvals keep their card in the chat, since their four choices carry a scope to read first.
  const decisionShown = detail.task.status === 'waiting_input' && pendingDecision && !pendingDecision.approval ? pendingDecision : undefined;
  const decisionAsker = decisionShown ? detail.runs.find(run => run.id === decisionShown.runId)?.snapshot.worker : undefined;
  const decisionActions = useRef({ answer: (_text: string) => {} });
  decisionActions.current = {
    answer: text => {
      if (!decisionShown || answeringDecision) return;
      setAnsweringDecision(true);
      action(async () => {
        try { await orglet.call('answerDecision', { taskId: detail.task.id, requestId: decisionShown.id, answer: text }); }
        finally { setAnsweringDecision(false); }
      });
    },
  };
  useEffect(() => {
    if (decisionShown) dockIsland({
      kind: 'decision', key: decisionShown.id, question: decisionShown.question, options: decisionShown.options,
      workers: decisionAsker ? [decisionAsker] : [], busy: answeringDecision, answer: text => decisionActions.current.answer(text),
    }, islandDock);
    else if (dockedIsland) dockIsland({ kind: 'run', ...dockedIsland }, islandDock);
    else if (accountShown) dockIsland({
      kind: 'account', key: accountShown.runId, harnessName: accountShown.harness.name,
      ...(switchTarget ? { target: { label: switchTarget.label, usedPercent: switchTarget.usedPercent } } : {}),
      ...(switchResetsAt ? { resetsAt: switchResetsAt } : {}),
      switchAccount: () => accountActions.current.switchAccount(), dismiss: () => accountActions.current.dismiss(),
    }, islandDock);
    else if (knowledgeShown) dockIsland({ kind: 'knowledge', key: suggestionKey, count: proposals.length, review: () => knowledgeActions.current.review(), dismiss: () => knowledgeActions.current.dismiss() }, islandDock);
    else dockIsland(undefined, islandDock);
  }, [islandDock, dockedIsland?.state, dockedIsland?.label, dockedIsland?.receipt, dockedIsland?.since, dockedIsland?.actions?.map(control => control.kind).join(','), islandWorkerKey, knowledgeShown, suggestionKey, accountShown?.runId, switchTarget?.accountId, switchTarget?.label, switchTarget?.usedPercent, switchResetsAt, decisionShown?.id, decisionAsker?.id, answeringDecision]);
  useEffect(() => () => dockIsland(undefined, islandDock), [islandDock]);

  // A face nods when its answer lands, not when an old chat opens: the runs already finished when this chat was
  // opened stay still, and only a run that completes after that is marked `landed` (the Finishing state in styles.css).
  const finishedAtOpen = useRef<Set<string>>(null);
  if (finishedAtOpen.current === null) finishedAtOpen.current = new Set(detail.runs.filter(run => run.status === 'completed').map(run => run.id));
  const landed = (run: Run) => run.status === 'completed' && !finishedAtOpen.current!.has(run.id);
  const bylineClass = (author?: Run, working = false) => working ? 'message-byline working' : author && landed(author) ? 'message-byline landed' : 'message-byline';
  /**
   * The head of an orglet's message (COD-365): its face in the gutter, carrying the state the face plays (thinking
   * while the run works, a nod when the answer lands), and on the line beside it the name, the role it played for a
   * crew and the model that wrote it.
   */
  const workerHeader = (author?: Run, working = false): MessageHeader => ({
    face: <span className={bylineClass(author, working)}>{author
      ? <Avatar name={author.snapshot.worker.name} seed={author.snapshot.worker.id} mascot={author.snapshot.worker.avatar?.mascot} defaultMascot hint={author.snapshot.worker.description} color={author.snapshot.worker.avatar?.color} size="md" alive badge={author.snapshot.worker.provider === 'demo' ? undefined : <ProviderMark provider={author.snapshot.worker.provider} size="small" decorative />} />
      : <span className="orglet-mark small">o</span>}</span>,
    name: <><strong>{author?.snapshot.worker.name ?? 'Orglet'}</strong>{author && bylineRole(author)}{author && <span className="byline-provider">{providerName(author.snapshot.worker.provider)}</span>}</>,
  });
  const personHeader: MessageHeader = { face: <PersonFace />, name: <strong>{t('Bạn')}</strong> };
  /** A schedule's post: the orglet that ran it, and the schedule it came from beside the name (owner, 2026-10-07). */
  const scheduleHeader = (quote: ChatQuote): MessageHeader => {
    const worker = workspace.workers.find(item => item.id === quote.authorId);
    return {
      face: <span className="byline">{worker
        ? <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="md" />
        : <span className="orglet-mark small">o</span>}</span>,
      name: <><strong>{quote.author}</strong><span className="byline-role">{t('Lịch · {0}', [quote.schedule ?? ''])}</span></>,
    };
  };
  const reactions = detail.task.messageReactions ?? [];
  /** A message's reactions for its foot row, or nothing when nobody reacted, so the row is left out. */
  const badgesFor = (messageId: string) => hasReactions(reactions, messageId)
    ? <MessageBadges taskId={detail.task.id} messageId={messageId} reactions={reactions} runs={detail.runs} action={action} />
    : undefined;
  /** The faces of who has read this far, or nothing when no orglet stopped at this turn. */
  const receiptsFor = (revision: number) => {
    const readers = readersByRevision.get(revision) ?? [];
    return readers.length > 0 ? <ReadReceipts readers={readers} /> : undefined;
  };
  // Who wrote each message in drawing order, so a run of messages from one author shares one head (COD-365).
  const grouping = messageGrouping();

  // One line per run of the turn that changed files in its working copy (COD-163); `named` says whose line carries
  // the worker's name. Each opens the diff viewer.
  const changedFilesLines = (runs: readonly Run[], named: (run: Run) => boolean) => changedFilesOf(runs, recovery).map(({ run, summary, review, restored }) =>
    <ChangedFilesLine key={run.id} summary={summary} review={review} restored={restored} workerName={named(run) ? run.snapshot.worker.name : undefined} onOpen={() => diff.open(run)} />);
  // A step that changed a file opens that file's changes, but only for a run that kept a working copy with changes.
  const diffRunOf = (run: Run | undefined) => run && changedFilesOf([run], recovery).length > 0 ? { taskId: detail.task.id, runId: run.id } : undefined;
  // One line per command that kept a failed run's changes out of the folder (COD-270); a crew member's line is named.
  const blockedLinesOf = (runs: readonly Run[]) => runs.flatMap(run => run.status === 'failed' && run.errorCode === 'hand_in_blocked'
    ? (run.blockedHandIn?.commands ?? []).map(command => <BlockedCommandLine key={command.processId} command={command}
      workerName={run.stage ? run.snapshot.worker.name : undefined} onOpen={() => setOutputCommand(command)} />)
    : []);
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
  const answer = (artifact: Artifact, author: Run | undefined, runs: readonly Run[], proposals: AppProposal[], latest: boolean, limitationsOnBar: boolean, receipts?: ReactNode) => {
    const authorName = author?.snapshot.worker.name ?? 'Orglet';
    const chat = artifact.report.format === 'chat';
    // A source id the model copied into its message reads as the file's name, here and in what is copied (COD-257).
    const replyText = withoutSourceIds(tMessage(artifact.report.summary), detail.sources);
    const trace = traceOf({ memories: artifact.usedMemories, context: author?.snapshot.context, runId: artifact.runId, events: detail.events, crew: author?.stage === 'synthesis' ? runs : [] });
    const workerId = author?.snapshot.worker.id;
    const canContinue = latest && !busy && !detail.task.pendingStart && author !== undefined && canContinueRun(author);
    const notices = turnNotices({
      trace: workspace.showWork && trace.length > 0 ? <WorkLog key="trace" entries={trace} diffRun={diffRunOf(author)} onOpenMemories={openMemories && workerId ? () => openMemories(workerId) : undefined} /> : undefined,
      outOfSteps: author?.outOfSteps && author.stage === undefined
        ? <OutOfStepsLine key="out-of-steps" busy={continuing} onContinue={canContinue ? () => continueRun(author) : undefined} />
        : undefined,
      plan: answersWithPlan(author)
        ? <PlanLine key="plan" busy={following} onFollow={canFollowPlan(author, { latest, busy, pendingStart: Boolean(detail.task.pendingStart) }) ? () => followPlan(artifact) : undefined} />
        : undefined,
      // A crew's answer names each member whose changes a failed command kept out of the folder (COD-270).
      handIn: author?.stage === 'synthesis' ? blockedLinesOf(runs) : undefined,
      changes: changedFilesLines(runs, run => run.id !== artifact.runId),
      proposals: proposalCards(proposals),
    });
    // A chat answer copies and downloads from its toolbar; a report keeps those in its viewer's toolbar.
    const toolbar = <MessageActions taskId={detail.task.id} messageId={artifact.id} author={authorName} reactions={reactions} action={action}
      text={chat ? replyText : tMessage(artifact.report.title)}
      onForward={forward ? () => forward({ taskId: detail.task.id, messageId: artifact.id, author: authorName, text: chat ? replyText : `${tMessage(artifact.report.title)}\n\n${tMessage(artifact.report.summary)}`, files: [] }) : undefined}
      leading={<>
        {chat && <ArtifactActions artifactId={artifact.id} about={t('Câu trả lời của {0}', [authorName])} action={action} />}
        {detail.task.sideOf && <BringIntoMainChat artifactId={artifact.id} brought={broughtIn.has(artifact.id)} about={t('Câu trả lời của {0}', [authorName])} action={action} openChat={openChat} />}
      </>} />;
    // The reactions sit under the answer, whichever shape it takes (COD-219, COD-365).
    const badges = badgesFor(artifact.id);
    return chat
      ? <ChatReply artifact={artifact} text={replyText} notices={notices} badges={badges} receipts={receipts} toolbar={toolbar} limitationsOnBar={limitationsOnBar}
          onAskChartPoint={quote => replyToChartPoint(detail.task.id, artifact.id, authorName, quote)} />
      : <ReportView artifact={artifact} author={author} latest={latest} busy={busy} detail={detail} action={action} showSources={showSources} notices={notices} badges={badges} toolbar={toolbar} />;
  };
  /**
   * The answer a blocked hand-in kept (COD-270): the orglet's words as it wrote them, then why its changes did not
   * reach the folder, the files it changed and its proposals. It is not a saved answer yet, so it has no copy,
   * reply or reaction row; applying it anyway saves it and it then reads like any other answer.
   */
  const heldAnswer = (run: Run, proposals: AppProposal[]) => {
    const blocked = run.blockedHandIn!;
    const held = blocked.answer!;
    const text = withoutSourceIds(tMessage(held.report.summary), detail.sources);
    const memories = run.snapshot.context?.memories?.map(memory => ({ id: memory.id, revision: memory.revision, text: memory.text }));
    const trace = traceOf({ memories, context: run.snapshot.context, runId: run.id, events: detail.events });
    const workerId = run.snapshot.worker.id;
    const notices = turnNotices({
      trace: workspace.showWork && trace.length > 0 ? <WorkLog key="trace" entries={trace} diffRun={diffRunOf(run)} onOpenMemories={openMemories ? () => openMemories(workerId) : undefined} /> : undefined,
      handIn: blocked.commands.map(command => <BlockedCommandLine key={command.processId} command={command} onOpen={() => setOutputCommand(command)} />),
      changes: changedFilesLines([run], () => false),
      proposals: proposalCards(proposals),
    });
    return <HeldReply runId={run.id} title={held.report.format === 'report' ? tMessage(held.report.title) : undefined} text={text} limitations={held.report.limitations} notices={notices} />;
  };
  /**
   * Continue under an answer cut short by the step limit (COD-257): the next message, carrying the chat's files, whose
   * run starts from this run's calls and results. The core checks again that this is still the latest turn.
   */
  const continueRun = (run: Run) => {
    if (continuing) return;
    setContinuing(true);
    const input = detail.task.currentInput ?? detail.task;
    const sourceIds = input.sourceIds.filter(sourceId => !detail.sources.find(source => source.id === sourceId)?.revoked);
    const provider = workspace.workers.find(worker => worker.id === detail.task.workerId)?.provider ?? run.snapshot.worker.provider;
    action(async () => {
      try {
        await orglet.call('reviseTask', { taskId: detail.task.id, brief: t('Tiếp tục từ chỗ đã dừng.'), continueFrom: run.id, sourceIds, excludedSources: input.excludedSources,
          consent: true, providerScopes: provider === 'demo' ? [] : [provider], budgetMicros: detail.task.budgetMicros });
      } finally { setContinuing(false); }
    });
  };
  /**
   * Follow the plan under a Plan first answer (COD-367): the go-ahead as the chat's next message, replying to the plan,
   * with the chat's files and in the chat's own mode (Ask before applying or Apply changes), so the bar leaves Plan
   * first. The message carries no Plan first, so its run is offered the edit and command tools the chat allows.
   */
  const followPlan = (plan: Artifact) => {
    if (following) return;
    setFollowing(true);
    const input = detail.task.currentInput ?? detail.task;
    const sourceIds = input.sourceIds.filter(sourceId => !detail.sources.find(source => source.id === sourceId)?.revoked);
    // Who answered the plan's turn answers the go-ahead too, so their providers are the ones this send consents to.
    const planRevision = detail.runs.find(run => run.id === plan.runId)?.snapshot.inputRevision ?? 0;
    const turnRuns = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === planRevision);
    const providers = [...new Set(turnRuns.map(run => run.snapshot.worker.provider).filter(provider => provider !== 'demo'))];
    setPlanFirst(taskDraftKey(detail.task.id), false);
    action(async () => {
      try {
        await orglet.call('reviseTask', { taskId: detail.task.id, brief: t('Làm theo kế hoạch trên.'), replyTo: plan.id, sourceIds, excludedSources: input.excludedSources,
          consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros });
      } finally { setFollowing(false); }
    });
  };
  const applyHandIn = (run: Run) => {
    if (applyingHandIn) return;
    setApplyingHandIn(true);
    action(async () => {
      try { await orglet.call('applyBlockedHandIn', { taskId: detail.task.id, runId: run.id }); }
      finally { setApplyingHandIn(false); }
    });
  };

  return <div className="thread-scroll" ref={viewport}>
    <div className="thread-edge thread-edge-top" aria-hidden="true" />
    <div className="thread-content" ref={threadContent}>
      {start && !embedded && !detail.task.sideOf && <ThreadStart start={start} />}
      {detail.task.sideOf && !embedded && <p className="side-thread-origin">
        {/* Once an answer was brought in, the main chat did change; the line then says only what this chat is. */}
        <span>{detail.artifacts.some(artifact => broughtIn.has(artifact.id)) ? t('Chat phụ với {0}.', [sideThreadOrglet]) : t('Chat phụ với {0}. Chat chính vẫn như cũ.', [sideThreadOrglet])}</span>
        {openMainChat && <button type="button" onClick={() => openMainChat(detail.task.workerId)}>{t('Mở chat chính')}</button>}
      </p>}
      {scheduleRun && <p className="side-thread-origin">
        {/* A deleted schedule has nothing to open; its runs say so and keep its name (COD-283). */}
        <span>{scheduleRun.openSchedule
          ? t('Lần chạy của lịch {0}, do {1} làm.', [scheduleRun.name, scheduleRun.owner])
          : t('Lần chạy của lịch {0} đã xóa, do {1} làm.', [scheduleRun.name, scheduleRun.owner])}</span>
        {scheduleRun.openSchedule && <button type="button" onClick={scheduleRun.openSchedule}>{t('Mở lịch')}</button>}
      </p>}
      {turns.map((turn, index) => {
        const latest = turn.revision === current;
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
        const unresolvedError = (latest && !['completed', 'paused'].includes(detail.task.status))
          || (turn.missingInput && headline && headline.status !== 'completed') ? headline : undefined;
        // A member that handed in a blocker still saved its report; the card's message points at it, so it opens from here.
        const blockerReport = unresolvedError?.stage === 'member' ? detail.artifacts.find(artifact => artifact.runId === unresolvedError.id) : undefined;
        // The crew answer already records this failure as `Role chưa hoàn tất: …`. A second card would repeat the
        // same sentence. A blocker keeps the card, because that is where its saved report opens.
        const answerAlreadyRecords = Boolean(turn.artifact && unresolvedError?.error && !blockerReport
          && unresolvedError.errorCode !== 'hand_in_blocked' && unresolvedError.errorCode !== 'unresolved_attempt'
          && turn.artifact.report.limitations.some(limitation => limitation === unresolvedError.error || limitation.endsWith(`: ${unresolvedError.error}`)));
        const previousSentAt = turns[index - 1]?.sentAt;
        const addedFiles = filesAddedWith(turn.sources, turns[index - 1]?.sources);
        // A group-chat reply carries the cards its own run proposed; the rest of the turn's cards sit with the turn.
        const turnProposals = detail.appProposals.filter(proposal => proposal.inputRevision === turn.revision);
        const replyRunIds = new Set(turn.replies.map(reply => reply.run.id));
        const remainingProposals = turnProposals.filter(proposal => !replyRunIds.has(proposal.runId));
        const answered = !!turn.artifact && !turn.replies.length;
        // A hand-in a failed command refused (COD-270): the turn's last run, when it kept the orglet's answer to decide on.
        const lastRun = turn.runs.at(-1);
        const heldRun = !answered && !turn.replies.length && lastRun?.status === 'failed' && lastRun.errorCode === 'hand_in_blocked'
          && lastRun.blockedHandIn?.answer ? lastRun : undefined;
        // A crew member's or group reply's refused hand-in keeps only the reason, which its error card names.
        const blockedCommands = !heldRun && unresolvedError?.errorCode === 'hand_in_blocked' ? unresolvedError.blockedHandIn?.commands : undefined;
        // Without that card (an earlier turn), the reason still sits under the turn.
        const blockedLines = heldRun || unresolvedError ? [] : blockedLinesOf(turn.runs);
        // A question waits under the run that asked it: in a crew that is the lead's plan, not the combining step the
        // turn is otherwise signed by.
        const askingRun = latest && detail.task.status === 'waiting_input' && pendingDecision
          ? detail.runs.find(run => run.id === pendingDecision.runId)
          : undefined;
        // A paused crew turn is signed by whoever took the last step before the pause, not by the combining step
        // that has not started (COD-287); before anyone started, by the lead who hands out the work.
        const pausedCrewTurn = latest && detail.task.status === 'paused' && turn.runs.some(run => run.snapshot.team);
        const stoppedAfter = pausedCrewTurn ? pausedAfter(turn.runs, detail.events) : undefined;
        const pausedAuthor = pausedCrewTurn ? stoppedAfter ?? turn.runs.find(run => run.stage === 'plan') : undefined;
        const waitingAuthor = askingRun ?? pausedAuthor ?? turn.author;
        // A crew turn's plan as a flow diagram (COD-331); it takes the place of the plain progress lines below.
        const crewPlan = crewPlanDiagram(turn.runs, detail.artifacts);
        const retryButton = latest && !busy && !['completed', 'waiting_input'].includes(detail.task.status)
          ? <Button className="limit-retry" variant="outline" onClick={() => action(() => orglet.call('retry', { id: detail.task.id }))}><RotateCcw size={16} />{t('Thử lại với thiết lập hiện tại')}</Button>
          : null;
        // Each message of the turn is placed in drawing order, so a run of messages from one author shares one head.
        const timeMarked = needsTimeMark(previousSentAt, turn.sentAt);
        if (timeMarked) grouping.breakHere();
        const personMessageId = chatTurnMessageId(detail, turn.revision);
        const personContinued = grouping.place({ key: personAuthorKey, at: turn.sentAt });
        const replyHeads = turn.replies.map(reply => grouping.place({ key: workerAuthorKey(reply.run.snapshot.worker.id), at: reply.artifact.createdAt }) ? undefined : workerHeader(reply.run));
        const sectionShown = !turn.replies.length || (latest && (busy || detail.task.status !== 'completed'));
        // Who signs the turn's own message: the run thinking right now, or whoever answered or stopped. A crew turn that
        // already shows its replies, or a run not started yet, signs nothing and reads as part of the message above.
        const sectionAuthor = latest && busy ? thinkingRun : turn.replies.length ? undefined : waitingAuthor;
        const sectionSigned = latest && busy ? thinkingRun !== undefined : !turn.replies.length;
        const sectionAt = turn.artifact?.createdAt ?? sectionAuthor?.startedAt;
        const sectionContinued = sectionShown && sectionSigned
          ? grouping.place({ key: sectionAuthor ? workerAuthorKey(sectionAuthor.snapshot.worker.id) : 'orglet', at: sectionAt })
          : true;
        const sectionHeader = sectionSigned && !sectionContinued ? workerHeader(sectionAuthor, latest && busy) : undefined;
        const chatAnswered = answered && turn.artifact?.report.format === 'chat';
        // While the turn is at work or asking, its header already names who is on it; a face saying they read it would repeat that.
        const standaloneReceipts = chatAnswered || (latest && (busy || detail.task.status === 'waiting_input')) ? undefined : receiptsFor(turn.revision);
        const turnQuotes = (detail.task.quotes ?? []).filter(quote => quote.afterRevision === turn.revision);
        // A schedule's post is its orglet speaking, under the schedule's name (owner, 2026-10-07), so it never folds into the
        // orglet's own replies around it; anything else the person brought in from a side thread.
        const quoteHeads = turnQuotes.map(quote => quote.schedule
          ? grouping.place({ key: `schedule:${quote.authorId}:${quote.schedule}`, at: quote.createdAt }) ? undefined : scheduleHeader(quote)
          : grouping.place({ key: personAuthorKey, at: quote.createdAt }) ? undefined : personHeader);
        return <div className="chat-turn" key={personMessageId}>
          {timeMarked && <TimeMark at={turn.sentAt} />}
          <Message className="person-message" label={t('Tin của bạn')} header={personContinued ? undefined : personHeader} at={turn.sentAt}>
            {turn.forwarded
              ? <ForwardedTurn forwarded={turn.forwarded} elementId={`message-${personMessageId}`} mentionPeople={mentionPeople} mentionAllNames={mentionAllNames}
                openOrigin={openChat && workspace.tasks.some(task => task.id === turn.forwarded!.fromTaskId) ? () => openChat(turn.forwarded!.fromTaskId) : undefined} />
              : <>
                {turn.replyTo && <button type="button" className="message-reply-context" onClick={() => openMessage(turn.replyTo!)}>
                  <Reply size={13} aria-hidden="true" />{t('Mở tin gốc: {0}', [replyLabel(turn.replyTo) ?? t('Tin nhắn trước không còn hiển thị')])}
                </button>}
                <RoutedLine route={routeOfTurn(detail.task.routedTurns, turn.revision)} nameOf={workerId => workspace.workers.find(worker => worker.id === workerId)?.name
                  ?? detail.runs.find(run => run.snapshot.worker.id === workerId)?.snapshot.worker.name} />
                <div className="user-message" id={`message-${personMessageId}`} tabIndex={-1}>
                  {turn.missingInput ? <p className="muted">{t('Nội dung tin nhắn gốc không còn được lưu.')}</p> : <MentionMarkdown text={turn.brief} people={mentionPeople ?? []} allNames={mentionAllNames} />}
                </div>
              </>}
            {/* The files follow the text in their own sideways row, the way Slack lists a message's attachments. */}
            {addedFiles.length > 0 && <MessageFiles files={addedFiles} onOpen={sourceId => showSources({ type: 'source', id: sourceId })} />}
            <MessageFoot badges={badgesFor(personMessageId)} />
            {!turn.missingInput && <MessageActions taskId={detail.task.id} messageId={personMessageId} author={t('Bạn')} text={turn.forwarded ? turn.forwarded.note ?? turn.forwarded.text : turn.brief} reactions={reactions} action={action}
              onForward={forward ? () => forward({ taskId: detail.task.id, messageId: personMessageId, author: turn.forwarded ? forwardedAuthor(turn.forwarded) : t('Bạn'), text: turn.forwarded ? turn.forwarded.text : turn.brief, files: addedFiles }) : undefined} />}
          </Message>
          {turn.replies.map((reply, replyIndex) => <Message key={reply.run.id} className="assistant-message" label={t('Trả lời của {0}', [reply.run.snapshot.worker.name])} header={replyHeads[replyIndex]} at={reply.artifact.createdAt}>
            {answer(reply.artifact, reply.run, [reply.run], turnProposals.filter(proposal => proposal.runId === reply.run.id), latest, false)}
          </Message>)}
          {sectionShown && <Message className={latest && (detail.task.status === 'waiting_input' || browserApproval || desktopApproval) ? 'assistant-message needs-you' : 'assistant-message'} label={t('Trả lời của {0}', [waitingAuthor?.snapshot.worker.name ?? 'Orglet'])} header={sectionHeader} at={sectionAt}>
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
            {latest && browserApproval && <BrowserApprovalCard taskId={detail.task.id} approval={browserApproval} busy={answeringBrowser} held={detail.browser?.takenOver ?? false} onHandBack={() => takeOverBrowser(detail.task.id, false)}
              onAnswer={answer => {
                if (answeringBrowser) return;
                setAnsweringBrowser(true);
                action(async () => {
                  try { await orglet.call('answerBrowserApproval', { taskId: detail.task.id, requestId: browserApproval.id, answer }); }
                  finally { setAnsweringBrowser(false); }
                });
              }} />}
            {latest && desktopApproval && <DesktopApprovalCard taskId={detail.task.id} approval={desktopApproval} busy={answeringDesktop}
              onAnswer={answer => {
                if (answeringDesktop) return;
                setAnsweringDesktop(true);
                action(async () => {
                  try { await orglet.call('answerDesktopApproval', { taskId: detail.task.id, requestId: desktopApproval.id, answer }); }
                  finally { setAnsweringDesktop(false); }
                });
              }} />}
            {/* The question reads as the orglet's message; its choices and a free answer sit in the island. */}
            {latest && decisionShown && <p className="decision-question">{decisionShown.question}</p>}
            {latest && detail.task.status === 'waiting_input' && !pendingDecision && <p role="status">{t('Chờ bổ sung bằng chứng. Đính kèm thêm nguồn để kiểm tra lại, hoặc chấp nhận báo cáo cùng các giới hạn đã nêu.')}</p>}
            {latest && detail.task.pendingStart && <p role="status">{t('Đã lưu yêu cầu mới. Đang dừng lượt cũ rồi sẽ bắt đầu.')}</p>}
            {workspace.showWork && crewPlan && <CrewPlanFlow diagram={crewPlan} live={latest && busy} statusLabel={statusLabel} />}
            {workspace.showWork && latest && detail.task.status !== 'completed' && !crewPlan && <TeamJobs runs={turn.runs} artifacts={detail.artifacts} namedRunId={busy && thinkingRun ? thinkingRun.id : undefined} />}
            <ProgressNotes events={detail.events} runs={turn.runs} />
            {latest && busy && runStatus && <RunStatusLine line={runStatus} waiting={runStatus === waitingLine} />}
            {latest && busy && liveUpdate && <LiveRun update={liveUpdate} memories={live?.run.snapshot.context?.memories} showWork={workspace.showWork === true} />}
            {latest && detail.task.status === 'paused' && <p role="status">{stoppedAfter
              ? t('Đã tạm dừng sau bước của {0}, chờ bạn tiếp tục. Tiếp tục giữ nguyên thiết lập của lần chạy này; thử lại tạo lần chạy mới.', [stoppedAfter.snapshot.worker.name])
              : t('Đã tạm dừng. Tiếp tục giữ nguyên thiết lập của lần chạy này; thử lại tạo lần chạy mới.')}</p>}
            {latest && detail.task.handoff && <details><summary>{t('Bàn giao cuối ca')}</summary><p>{t('{0} báo cáo đã lưu · đã đối soát {1} · giữ chỗ {2}', [detail.task.handoff.artifactIds.length, formatMoney(detail.task.handoff.chargedMicros), formatMoney(detail.task.handoff.reservedMicros)])}</p><ul>{detail.task.handoff.artifactIds.map(id => <li key={id}>{detail.artifacts.find(artifact => artifact.id === id)?.report.title ?? id}</li>)}</ul>{detail.task.handoff.blockers.length > 0 && <><h3>{t('Điểm đang chờ')}</h3><ul>{detail.task.handoff.blockers.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></>}<h3>{t('Bước tiếp theo')}</h3><ul>{detail.task.handoff.nextSteps.map((text, index) => <li key={index}>{tMessage(text)}</li>)}</ul></details>}
            {latest && detail.task.status === 'partial' && !turn.artifact?.report.limitations.length && <p className="run-error">{failedNames.length ? t('{0} chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.', [failedNames.join(', ')]) : t('Một số role chưa hoàn tất. Kết quả đã lưu vẫn được giữ; thử lại để tiếp tục phần thiếu.')}</p>}
            {/* A turn that ended without an answer keeps what became of it, also once newer messages follow (COD-290);
                the latest turn's pause already says so in its own line. */}
            {!turn.artifact && !turn.replies.length && !heldRun && !(latest && busy) && !unresolvedError && !(latest && pendingDecision) && !(latest && detail.task.status === 'paused') && !answeredByLaterTurn(turn, turns) && <TurnOutcomeLine outcome={unansweredTurnLine(turn.runs, headline)} />}
            {answered
              ? answer(turn.artifact!, turn.author, turn.runs, remainingProposals, latest, Boolean(retryButton) && turn.artifact!.report.format === 'chat' && turn.artifact!.report.limitations.length > 0, turn.artifact!.report.format === 'chat' ? receiptsFor(turn.revision) : undefined)
              : heldRun
                ? heldAnswer(heldRun, remainingProposals)
                /* No answer of its own to hang them on (still running, failed, or a group turn whose replies carry
                   theirs), so what the turn's runs produced still reads in the same order under the turn. */
                : turnNotices({ handIn: blockedLines, changes: turn.replies.length ? undefined : changedFilesLines(turn.runs, () => true), proposals: proposalCards(remainingProposals) }).after}
            {/* A held answer says itself why nothing was applied, under the answer; it needs no error card. */}
            {unresolvedError?.error && !heldRun && !answerAlreadyRecords && <div className="run-error" role="status"><h3>{statusLabel[detail.task.status]}</h3>
              {/* A run refused by the unknown-outcome guard (COD-191) says what to do, not which guard fired: the
                  attempt to review sits in Details, and the button below opens it there. */}
              {/* A plain stop on a connection that never charges says only what the heading already says. */}
              {blockedCommands
                ? <div className="run-error-commands">{blockedCommands.map(command => <BlockedCommandLine key={command.processId} command={command}
                  workerName={unresolvedError.stage ? unresolvedError.snapshot.worker.name : undefined} onOpen={() => setOutputCommand(command)} />)}</div>
                : unresolvedError.error === 'Đã hủy.' ? null : <p>{unresolvedError.errorCode === 'unresolved_attempt' ? t('Một thay đổi file trước đó chưa rõ kết quả. Kiểm tra trong Chi tiết rồi giữ file hiện tại, sau đó Tí mới ghi tiếp được.')
                  : unresolvedError.stage === 'plan' ? t('Trưởng phòng: {0}', [tMessage(unresolvedError.error)]) : tMessage(unresolvedError.error)}</p>}
            </div>}
            {latest && <div className="actions">
              {!busy && heldRun && <Button variant="primary" disabled={applyingHandIn} onClick={() => applyHandIn(heldRun)}><Check size={16} />{t('Vẫn áp dụng')}</Button>}
              {!busy && heldRun && askToFix && <Button variant="outline" onClick={() => askToFix(askToFixText(heldRun.blockedHandIn!.commands))}><Wrench size={16} />{t('Nhờ sửa')}</Button>}
              {!busy && unresolvedError?.errorCode === 'unresolved_attempt' && reviewRecovery && <Button variant="primary" onClick={() => reviewRecovery(groupRecoveryAttempts(recovery, detail.runs).blocking?.runId)}><FolderOpen size={16} />{t('Xem trong Chi tiết')}</Button>}
              {blockerReport && unresolvedError && <Button variant="primary" onClick={() => setSavedReportId(blockerReport.id)}><FileText size={16} />{t('Mở báo cáo của {0}', [unresolvedError.snapshot.worker.name])}</Button>}
              {!busy && ['paused', 'interrupted', 'waiting_budget'].includes(detail.task.status) && <Button variant="primary" onClick={() => action(() => orglet.call('resume', { id: detail.task.id }))}>{t('Tiếp tục từ checkpoint')}</Button>}
              {retryButton && !(answered && turn.artifact?.report.format === 'chat' && turn.artifact.report.limitations.length > 0) && retryButton}
            </div>}
          </Message>}
          {/* A turn whose answer is not a chat message keeps its read faces on a line of their own at the turn's end. */}
          {standaloneReceipts && <div className="turn-receipts">{standaloneReceipts}</div>}
          {turnQuotes.map((quote, quoteIndex) => quote.schedule
            ? <Message key={quote.id} className="assistant-message schedule-post" label={t('Lịch {0} của {1}', [quote.schedule, quote.author])} header={quoteHeads[quoteIndex]} at={quote.createdAt}>
              <div className="chat-bubble" id={`message-${quote.id}`} tabIndex={-1}><Markdown className="prose" text={tMessage(quote.text)} /></div>
            </Message>
            : <Message key={quote.id} className="person-message brought-in-message" label={t('Tin của bạn')} header={quoteHeads[quoteIndex]} at={quote.createdAt}>
              <BroughtInQuote quote={quote} threadName={threadName(quote.fromTaskId)} onOpen={openChat && threadName(quote.fromTaskId) ? () => openChat(quote.fromTaskId) : undefined} />
            </Message>)}
        </div>;
      })}
      {/* The chat's state, not something an orglet said: it ends the thread as a card of its own, under the last
          message and outside it, and scrolls with the thread. */}
      {unfinished && <UnfinishedWork limitations={unfinished.limitations} onRetry={() => action(() => orglet.call('retry', { id: detail.task.id }))} />}
    </div>
    <div className="thread-edge thread-edge-bottom" aria-hidden="true" />
    {diff.dialog}
    {outputCommand && <CommandOutputDialog taskId={detail.task.id} command={outputCommand} onClose={() => setOutputCommand(undefined)} />}
    {savedReport && <ReportDocument artifact={savedReport} author={detail.runs.find(run => run.id === savedReport.runId)} detail={detail} open onClose={() => setSavedReportId(undefined)} busy={busy} action={action} showSources={showSources}
      actions={<ArtifactActions artifactId={savedReport.id} about={tMessage(savedReport.report.title)} action={action} />} />}
    <BrowserLiveViewer detail={detail} />
  </div>;
}

/**
 * Unfinished assignments on this turn. The worker and its state are one line; the brief is the line under them, and a
 * long brief stays on that one line until the row is opened. The worker already named in the byline, with nothing to
 * wait for, is not named again.
 */
function TeamJobs({ runs, artifacts, namedRunId }: { runs: Run[]; artifacts: Artifact[]; namedRunId?: string }) {
  const jobs = teamProgress(runs, artifacts);
  if (!jobs.length) return null;
  const hideWho = jobs.length === 1 && jobs[0].waitingFor.length === 0 && jobs[0].run.id === namedRunId;
  return <div className="team-progress">
    {jobs.map(job => <TeamJob key={job.run.id} run={job.run} waitingFor={job.waitingFor} hideWho={hideWho} />)}
  </div>;
}

/** Past this, the brief leaves the row and the row keeps one line of it. A line break folds too. */
const JOB_LINE = 96;

function TeamJob({ run, waitingFor, hideWho }: { run: Run; waitingFor: string[]; hideWho: boolean }) {
  const brief = run.snapshot.assignment?.brief ?? '';
  // The run's own state stays even while it waits on others: an interrupted job waiting on its upstream is still interrupted.
  const waiting = waitingFor.length > 0 ? t('Chờ {0}', [waitingFor.join(', ')]) : undefined;
  const state = waiting ? `${statusLabel[run.status]} · ${waiting}` : statusLabel[run.status];
  const who = hideWho ? null : <span className="team-job-who"><strong>{run.snapshot.worker.name}</strong><span className="team-job-state">{state}</span></span>;
  const folded = Array.from(brief.trim()).length > JOB_LINE || /[\r\n]/.test(brief);
  // One line per job, shaped like the trace row under it: the chevron leads, then who, the state and the brief, so
  // the rows above an answer share one left edge instead of each having its own layout.
  if (!folded) return <div className="team-job"><span className="team-job-line">{who}{brief.trim() && <span className="team-job-brief">{brief}</span>}</span></div>;
  return <details className="team-job">
    <summary className="activity-summary team-job-line">
      <ChevronRight size={14} aria-hidden="true" className="activity-chevron" />
      {who}
      <span className="team-job-preview">{brief.replace(/\s+/g, ' ').trim()}</span>
    </summary>
    <p className="team-job-brief">{brief}</p>
  </details>;
}

/** What became of a turn without an answer, one muted line; a long error is cut and kept whole in the tooltip. */
function TurnOutcomeLine({ outcome }: { outcome: ReturnType<typeof unansweredTurnLine> }) {
  return <p className="muted turn-outcome" title={outcome.detail ? outcome.text : undefined}>{outcome.text}</p>;
}

/**
 * Under an answer the orglet handed in because its steps ran out (COD-257): says so, and on the latest turn offers
 * Continue, which sends the next message and starts its run from this run's calls and results.
 */
function OutOfStepsLine({ busy, onContinue }: { busy: boolean; onContinue?: () => void }) {
  return <div className="out-of-steps">
    <p><Hourglass size={14} aria-hidden="true" />{t('Hết số bước trước khi xong; đây là phần đã làm được.')}</p>
    {onContinue && <Button type="button" variant="outline" disabled={busy} onClick={onContinue}><StepForward size={16} />{t('Tiếp tục')}</Button>}
  </div>;
}

/** A chat on its way: the shape of two messages, a short one and an answer, each a face beside its lines. */
export function ThreadSkeleton() {
  return <SkeletonGroup className="thread-skeleton" label={t('Đang mở cuộc trò chuyện…')}>
    <div className="thread-skeleton-message">
      <Skeleton shape="circle" className="thread-skeleton-face" />
      <div><Skeleton width="38%" /></div>
    </div>
    <div className="thread-skeleton-message">
      <Skeleton shape="circle" className="thread-skeleton-face" />
      <div><Skeleton width="92%" /><Skeleton width="78%" delay={0.08} /><Skeleton width="46%" delay={0.16} /></div>
    </div>
  </SkeletonGroup>;
}

/** The head of a message: the face for the gutter and the name line beside it. */
type MessageHeader = { face: ReactNode; name: ReactNode };

/**
 * Under a Plan first answer (COD-367): says that nothing changed yet, and on the latest turn offers Follow the plan,
 * which sends the go-ahead in the chat's own mode.
 */
function PlanLine({ busy, onFollow }: { busy: boolean; onFollow?: () => void }) {
  return <div className="out-of-steps plan-line">
    <p><ListTodo size={14} aria-hidden="true" />{t('Kế hoạch, chưa thay đổi gì.')}</p>
    {onFollow && <Button type="button" variant="outline" disabled={busy} onClick={onFollow}><Play size={15} aria-hidden="true" />{t('Làm theo kế hoạch')}</Button>}
  </div>;
}

/**
 * One message in the flat list (COD-365, after Slack): the face in a narrow gutter and, beside it, the name and the
 * time over everything the message carries. A message that continues its author's group has no head; its gutter
 * shows the time while the pointer is over it. The toolbar inside floats at the message's top right.
 */
function Message({ className, label, header, at, children }: { className: string; label: string; header?: MessageHeader; at?: string; children: ReactNode }) {
  return <section className={className} aria-label={label} data-continued={header ? undefined : 'true'}>
    <div className="message-gutter">{header ? header.face : at && <MessageTime at={at} className="message-hover-time" />}</div>
    <div className="message-main">
      {header && <div className="message-head">{header.name}{at && <MessageTime at={at} className="message-time" />}</div>}
      {children}
    </div>
  </section>;
}

/** When a message was sent: the time of day, and the whole date and time in the tooltip. */
function MessageTime({ at, className }: { at: string; className: string }) {
  const full = new Date(at).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  return <time className={className} dateTime={at} title={full}>{clockLabel(at)}</time>;
}

/** The person's face: there is no picture to show, so a quiet figure in the size of an orglet's face. */
function PersonFace() {
  return <span className="avatar md person-face" aria-hidden="true"><UserRound size={16} /></span>;
}

/** Under a message: the reactions it wears and, at the line's end, the faces of who has read this far. */
function MessageFoot({ badges, receipts }: { badges?: ReactNode; receipts?: ReactNode }) {
  if (!badges && !receipts) return null;
  return <div className="message-foot">{badges}{receipts}</div>;
}

/**
 * A normal chat answer: the text, what came out of it, its limitations, then its reactions and read faces.
 * Notices stay in their order (COD-217): what was loaded before writing above the text, what came out of it below.
 * While the chat still waits on the unfinished parts they end the thread as a card of their own with Retry
 * (`unfinishedWork`), not here: that is the chat's state, and inside the thread it read as part of what the orglet said.
 */
function ChatReply({ artifact, text, notices, badges, receipts, toolbar, limitationsOnBar, onAskChartPoint }: { onAskChartPoint?: (quote: string) => void; artifact: Artifact; /** The message as shown, already translated and with source ids named. */ text: string; notices: TurnNotices; badges?: ReactNode; receipts?: ReactNode; toolbar: ReactNode; limitationsOnBar: boolean }) {
  return <div className="chat-reply">
    {notices.before}
    <div className="chat-bubble" id={`message-${artifact.id}`} tabIndex={-1}>
      <ChartAskContext.Provider value={onAskChartPoint}><Markdown className="prose" text={text} /></ChartAskContext.Provider>
    </div>
    {notices.after}
    {artifact.report.limitations.length > 0 && !limitationsOnBar && <div className="chat-limitations">
      <strong>{t('Phần chưa hoàn tất hoặc còn giới hạn')}</strong>
      {artifact.report.limitations.map((limitation, index) => <p key={index}>{tMessage(limitation)}</p>)}
    </div>}
    <MessageFoot badges={badges} receipts={receipts} />
    {toolbar}
  </div>;
}

/**
 * An answer a failed command kept out of the folder (COD-270): the same bubble as a chat answer, a report's title
 * above its summary, and the notices around it. Nothing here is saved yet, so it carries no reactions.
 */
function HeldReply({ runId, title, text, limitations, notices }: { runId: string; title?: string; text: string; limitations: readonly string[]; notices: TurnNotices }) {
  return <div className="chat-reply held-reply">
    {notices.before}
    <div className="chat-bubble" id={`held-${runId}`} tabIndex={-1}>
      <Markdown className="prose" text={title ? `**${title}**\n\n${text}` : text} />
    </div>
    {notices.after}
    {limitations.length > 0 && <div className="chat-limitations">
      <strong>{t('Phần chưa hoàn tất hoặc còn giới hạn')}</strong>
      {limitations.map((limitation, index) => <p key={index}>{tMessage(limitation)}</p>)}
    </div>}
  </div>;
}

/**
 * What the latest answer left unfinished, with the way to try again. It leads with a warning mark, so it is told
 * from an answer at a glance.
 */
function UnfinishedWork({ limitations, onRetry }: { limitations: readonly string[]; onRetry: () => void }) {
  return <div className="unfinished-work" role="status">
    <TriangleAlert className="unfinished-work-mark" size={18} aria-hidden="true" />
    <div className="unfinished-work-text">
      <strong>{t('Phần chưa hoàn tất hoặc còn giới hạn')}</strong>
      {limitations.map((limitation, index) => <p key={index}>{tMessage(limitation)}</p>)}
    </div>
    <Button className="limit-retry" variant="outline" onClick={onRetry}><RotateCcw size={16} />{t('Thử lại với thiết lập hiện tại')}</Button>
  </div>;
}

export type ThreadStartInfo = { name: string; about?: string; faces: ReactNode };

/**
 * The top of a chat's history (user, 2026-10-04): the faces, the name in large type, what the orglet does, and one
 * line saying the chat begins here. It is the same block an empty chat shows, kept above the first message.
 */
function ThreadStart({ start }: { start: ThreadStartInfo }) {
  return <header className="thread-start">
    <div className="thread-start-faces">{start.faces}</div>
    <h2 className="thread-start-name">{start.name}</h2>
    {start.about && <p className="thread-start-about">{start.about}</p>}
    <p className="thread-start-line">{t('Đây là khởi đầu cuộc trò chuyện của bạn với {0}.', [start.name])}</p>
  </header>;
}

/** Who wrote a forwarded message, as the chat names them. */
function forwardedAuthor(forwarded: ForwardedMessage): string {
  return forwarded.authorKind === 'person' ? t('Bạn') : forwarded.author ?? 'Orglet';
}

/**
 * A turn that is a forward (COD-257): the forwarded message on the quiet surface, so it is not mistaken for
 * something the person typed, headed by where it came from (which opens that chat while it exists), then the note,
 * if any, as the person's own text. Files that were not sent along are named under the forwarded text; the ones that
 * were are this turn's files and follow the message like any attachment.
 */
/**
 * Who answers a group-chat message that tagged nobody, when the decision model picked one orglet for it (COD-305). It sits where a
 * reply names the message it answers, so a narrower turn is never silent; the tooltip says why and how to ask everyone.
 */
export function RoutedLine({ route, nameOf }: { route?: TurnRoute; nameOf: (workerId: string) => string | undefined }) {
  if (!route) return null;
  const names = route.workerIds.map(workerId => nameOf(workerId)).filter((name): name is string => Boolean(name));
  if (!names.length) return null;
  const why = t('Tin nhắn không gắn thẻ ai, nên model quyết định chọn Tí hợp nhất để trả lời (chắc {0}%). Gắn @all để hỏi cả nhóm.', [Math.round(route.probability * 100)]);
  return <p className="message-reply-context message-routed" title={why}>
    <Route size={13} aria-hidden="true" />{t('Model quyết định chọn {0} trả lời', [names.join(', ')])}
  </p>;
}

function ForwardedTurn({ forwarded, elementId, openOrigin, mentionPeople, mentionAllNames }: { forwarded: ForwardedMessage; elementId: string; openOrigin?: () => void; mentionPeople?: readonly MentionPerson[]; mentionAllNames?: readonly string[] }) {
  const author = forwardedAuthor(forwarded);
  const sameName = forwarded.authorKind === 'orglet' && author === forwarded.from;
  let origin = t('Chuyển tiếp từ {0} · {1} viết', [forwarded.from, author]);
  if (sameName) origin = t('Chuyển tiếp từ {0}', [forwarded.from]);
  // "You" starts a sentence elsewhere; mid-line it reads "written by you".
  else if (forwarded.authorKind === 'person') origin = t('Chuyển tiếp từ {0} · bạn viết', [forwarded.from]);
  const unshared = forwarded.files.filter(file => !file.sourceId).map(file => file.name);
  return <>
    <div className="forwarded-message" id={elementId} tabIndex={-1}>
      {openOrigin
        ? <button type="button" className="message-reply-context" onClick={openOrigin}><Forward size={13} aria-hidden="true" />{origin}</button>
        : <p className="message-reply-context"><Forward size={13} aria-hidden="true" />{origin}</p>}
      {forwarded.authorKind === 'orglet' ? <Markdown className="prose" text={forwarded.text} /> : <p>{forwarded.text}</p>}
      {unshared.length > 0 && <p className="forwarded-files"><FileX size={13} aria-hidden="true" />{t('Không gửi kèm: {0}', [unshared.join(', ')])}</p>}
    </div>
    {forwarded.note && <div className="user-message forward-note"><MentionMarkdown text={forwarded.note} people={mentionPeople ?? []} allNames={mentionAllNames} /></div>}
  </>;
}

/**
 * An answer from a side thread that the person brought into this main chat (COD-247). It is signed by the person,
 * because they put it here, and sits on the quiet surface as a quote; the line above it says where it came from and
 * opens that thread. It is a quote, not a message sent: nothing ran when it arrived.
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
 * The orglets to show as having read each turn, by the turn's revision. A run carries the revision of the message it
 * was given, so the highest one an orglet has run is how far it has read. An orglet whose answer ends that turn has
 * shown it read it; its face under its own answer only repeated that (dogfood round 5, COD-287), so faces stay for
 * readers with no answer there yet: working, stopped or failed. A crew's lead plans in one run and answers in another,
 * so the check is per orglet and turn, not per run.
 */
export function readersByTurn(detail: Pick<TaskDetail, 'runs' | 'artifacts'>): Map<number, Run[]> {
  const readersByRevision = new Map<number, Run[]>();
  const furthest = new Map<string, Run>();
  for (const run of detail.runs) {
    const revision = run.snapshot.inputRevision ?? 0;
    const known = furthest.get(run.snapshot.worker.id);
    if (!known || (known.snapshot.inputRevision ?? 0) < revision) furthest.set(run.snapshot.worker.id, run);
  }
  const answeredRuns = new Set(detail.artifacts.map(artifact => artifact.runId));
  const answered = new Set(detail.runs.filter(run => answeredRuns.has(run.id)).map(run => `${run.snapshot.worker.id}:${run.snapshot.inputRevision ?? 0}`));
  for (const run of furthest.values()) {
    const revision = run.snapshot.inputRevision ?? 0;
    if (answered.has(`${run.snapshot.worker.id}:${revision}`)) continue;
    readersByRevision.set(revision, [...(readersByRevision.get(revision) ?? []), run]);
  }
  return readersByRevision;
}

/**
 * A sent message's files, as the same sideways strip the composer uses: an end with cards scrolled past it fades out, so
 * a card cut at the edge reads as "there is more this way" (dogfood round 7, COD-295).
 */
function MessageFiles({ files, onOpen }: { files: TaskDetail['sources']; onOpen: (sourceId: string) => void }) {
  const strip = useRef<HTMLUListElement>(null);
  const overflow = useStripOverflow(strip, files.length);
  return <ul className="message-files" ref={strip} aria-label={t('Tệp đính kèm')} {...overflowAttributes(overflow)}>
    {files.map(item => <Attachment key={item.id} name={item.name} bytes={item.bytes} revoked={item.revoked} onOpen={() => onOpen(item.id)} />)}
  </ul>;
}

/**
 * Who has read this far. On a chat answer the faces sit at the end of the line under it, beside its reactions
 * (user, 2026-09-20; COD-365 moved the buttons into the floating toolbar).
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
function ReportView({ artifact, author, latest, busy, detail, action, showSources, notices, badges, toolbar }: { artifact: Artifact; author?: Run; latest: boolean; busy: boolean; detail: TaskDetail; action: (fn: () => Promise<unknown>) => void; showSources: (target?: SourceTarget) => void; notices: TurnNotices; badges?: ReactNode; toolbar: ReactNode }) {
  const [open, setOpen] = useState(false);
  const report = artifact.report;
  const name = tMessage(report.title);
  const when = new Date(artifact.createdAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  const meta = [t('Báo cáo'), report.findings.length ? t('{0} phát hiện', [report.findings.length]) : '', latest && detail.task.accepted ? t('Đã chấp nhận') : '', when].filter(Boolean).join(' · ');
  return <>
    <div className="report-turn" id={`message-${artifact.id}`} tabIndex={-1}>
      {notices.before}
      <div className="report-card"><DocumentCard name={name} meta={meta} onOpen={() => setOpen(true)} /></div>
      {notices.after}
      <MessageFoot badges={badges} />
      {toolbar}
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

/**
 * A message sent while the turn before it was still stopping has no run of its own: the run of the message after it
 * read both and answers them together (user, 2026-10-07). It reads as one of two messages in a row, with no "not
 * answered" line under it.
 */
function answeredByLaterTurn(turn: Turn, turns: readonly Turn[]): boolean {
  return turn.runs.length === 0 && turns.some(later => later.revision > turn.revision && later.runs.length > 0);
}
