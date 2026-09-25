import { useState } from 'react';
import { Clock, Copy, Cpu, FileText, ListOrdered, MessageSquare, ShieldCheck, Shuffle, Sparkles, Users, Wallet, Wrench, X } from 'lucide-react';
import { t, currentLocale, tMessage } from '../i18n';
import { Avatar, RosterAvatars } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { ShowMore } from './SidebarTree';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { ContextManifestView } from './KnowledgeLibrary';
import { statusLabel } from './TaskThread';
import { statusMarkLabel } from './SidebarTree';
import { formatMoney } from './money';
import { providerName } from './workerModel';
import { Button, Drawer } from './ui';
import { teamRoster } from '../assignees';
import { orglet } from '../api';
import { toast } from './toast';
import type { Run, TaskDetail, Team, Worker, Workspace } from '../../shared/contracts';
import type { NewChatWorkspaceView, WorkspaceGrantView } from '../../shared/workspace-access';
import type { WorkspaceLevel } from '../../shared/capability-status';
import type { ToolCapability } from '../../shared/tool-policy';
import { PermissionControls } from './PermissionControls';
import { WorkspaceRecovery, type ReadProcessOutput, type ReadPrivateFile, type RecoveryFocus } from './WorkspaceRecovery';
import type { WorkspaceRecoveryView } from '../../shared/workspace-recovery';
import { MessageActions, MessageBadges } from './MessageActions';
import { focusMessage, reactionGroups } from './messageMarks';
import { turnMessageId } from '../../shared/message-interactions';
import { approvalAnswerLabels, McpChatGrants } from './McpApproval';
import { McpApprovalChoice } from '../../shared/mcp';

/*
 * The panel beside a chat: who you are talking to, what this conversation has cost, and what happened in it.
 * It opens for a team or a worker even before anything has been sent (user, 2026-09-19), because who is in a
 * team is worth reading on its own.
 *
 * Plain words on the surface, machine detail underneath: run ids, revisions, model slugs, the context manifest
 * and token counts live in one collapsed block, so the panel reads like a person wrote it.
 */

/** An answer as saved: the person's own words, or for an MCP approval card the choice it stands for (COD-241). */
function decisionAnswer(answer: string, approval: boolean) {
  const choice = McpApprovalChoice.safeParse(answer);
  return approval && choice.success ? approvalAnswerLabels[choice.data] : answer;
}

// Not the bare 'tí trưởng', which the dictionary already uses for the synthesizer role rather than this stage.
const stageNames: Record<string, string> = { plan: 'phân việc', synthesis: 'gộp kết quả', member: 'phần việc', group: 'trả lời' };

/**
 * How long something took, in the shortest form that is still exact enough to be worth reading: two units at most,
 * so a chat open for days reads "5 days 23 h" rather than thousands of minutes.
 */
export function elapsedLabel(fromIso: string, toIso: string) {
  const seconds = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 1) return undefined;
  if (seconds < 60) return t('{0} giây', [seconds]);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? t('{0} phút {1} giây', [minutes, seconds % 60]) : t('{0} phút', [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? t('{0} giờ {1} phút', [hours, minutes % 60]) : t('{0} giờ', [hours]);
  const days = Math.floor(hours / 24);
  return hours % 24 ? t('{0} ngày {1} giờ', [days, hours % 24]) : t('{0} ngày', [days]);
}

/** How many answers the chat has, with its own words for one ("1 reply", never "1 replies"). */
export function replyCountLabel(count: number): string {
  if (count === 1) return t('1 lượt');
  return t('{0} lượt', [count]);
}

/** When a run finished, as far as the panel can tell: the last thing that run reported. */
const runEndedAt = (runId: string, events: { runId?: string; createdAt: string }[]) =>
  events.filter(event => event.runId === runId).at(-1)?.createdAt;

function originalAssignmentOwner(detail: TaskDetail, run: Run): string {
  const originalWorkerId = run.snapshot.reassignment?.assignmentWorkerId;
  return detail.runs.find(candidate => candidate.stage === 'member' && !candidate.snapshot.reassignment
    && candidate.snapshot.worker.id === originalWorkerId)?.snapshot.worker.name ?? originalWorkerId ?? '';
}

/** The text of a saved message in this chat: an answer, a team message or one of the user's turns. */
function messageExcerpt(detail: TaskDetail, messageId: string): string | undefined {
  const artifact = detail.artifacts.find(item => item.id === messageId);
  if (artifact) return artifact.report.summary;
  const teamMessage = detail.events.find(item => item.id === messageId)?.teamMessage;
  if (teamMessage) return teamMessage.body;
  const latestRevision = detail.task.inputRevision ?? 0;
  for (let revision = 0; revision <= latestRevision; revision++) {
    if (turnMessageId(detail.task.id, revision) !== messageId) continue;
    if (revision === latestRevision) return detail.task.currentInput?.brief ?? detail.task.brief;
    return detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision)?.snapshot.input?.brief;
  }
  return undefined;
}

/** A section with an icon beside its title, so the panel can be scanned rather than read. */
function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return <section className="details-section">
    <h3><Icon size={15} aria-hidden="true" />{title}</h3>
    {children}
  </section>;
}

/** One fact about this chat: an icon and a value, short enough that several fit on a line. */
function Fact({ icon: Icon, children, title }: { icon: typeof Users; children: React.ReactNode; title: string }) {
  return <span className="details-fact" title={title}><Icon size={13} aria-hidden="true" />{children}</span>;
}

/**
 * Who this chat is with: the face, the name, and the few facts worth knowing, as icons and values on one wrapping
 * line rather than a sentence per fact (user, 2026-09-19).
 */
function ChatSubject({ team, worker, group, members }: { team?: Team; worker?: Worker; group?: readonly Worker[]; members: readonly Worker[] }) {
  if (team) {
    return <div className="details-subject">
      <p className="details-subject-name"><RosterAvatars workers={members} size="sm" max={2} /><strong>{team.name}</strong></p>
      <div className="details-facts">
        <Fact icon={Users} title={t('Số Tí trong hội')}>{members.length}</Fact>
        <Fact icon={team.workflow === 'parallel' ? Shuffle : ListOrdered} title={team.workflow === 'parallel' ? t('làm song song') : t('làm lần lượt')}>
          {team.workflow === 'parallel' ? t('song song') : t('lần lượt')}
        </Fact>
        <Fact icon={Wallet} title={t('Ngân sách tháng')}>{formatMoney(team.monthlyBudgetMicros)}</Fact>
      </div>
    </div>;
  }
  // A group chat that has not started has no name of its own: its faces and their count say who it is.
  if (group) {
    return <div className="details-subject">
      <p className="details-subject-name"><RosterAvatars workers={group} size="sm" max={2} /><strong>{t('Trò chuyện nhóm')}</strong></p>
      <div className="details-facts">
        <Fact icon={Users} title={t('Số Tí trong nhóm')}>{group.length}</Fact>
      </div>
    </div>;
  }
  if (!worker) return null;
  return <div className="details-subject">
    <p className="details-subject-name">
      <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />
      <strong>{worker.name}</strong>
      <span className="details-fact" title={t('Chạy bằng')}>
        {worker.provider !== 'demo' && <ProviderMark provider={worker.provider} size="small" decorative />}
        {providerName(worker.provider)}
      </span>
    </p>
    {(worker.description || worker.taskBudgetMicros != null) && <p className="details-subject-note">
      {worker.description}
      {worker.taskBudgetMicros != null && <Fact icon={Wallet} title={t('Ngân sách mỗi việc')}>{formatMoney(worker.taskBudgetMicros)}</Fact>}
    </p>}
  </div>;
}

// Progress the live view already showed. Once a run has finished these only pad the story out.
const routineChatter = [/^Đang gọi model · bước /, /^Model đang trả kết quả/, /^Đã lưu câu trả lời/, /^Đang chờ lượt/];
const worthKeeping = (message: string) => !routineChatter.some(pattern => pattern.test(message));

/** One run as a line of the story: who spoke, what part they were doing, how long it took and what it reported. */
function RunEntry({ run, events }: { run: Run; events: { id: string; message: string; createdAt: string }[] }) {
  const person = run.snapshot.worker;
  const stage = run.stage && stageNames[run.stage] ? t(stageNames[run.stage]) : undefined;
  const endedAt = events.at(-1)?.createdAt;
  const took = endedAt && elapsedLabel(run.startedAt, endedAt);
  return <li className="details-run">
    <Avatar name={person.name} seed={person.id} mascot={person.avatar?.mascot} defaultMascot hint={person.description} color={person.avatar?.color} size="xs" />
    <div>
      <p className="details-run-who">
        <strong>{person.name}</strong>
        {stage && <small>{stage}</small>}
        {took && <time className="details-run-took" title={t('Bước này mất bao lâu')}>{took}</time>}
      </p>
      {events.filter(event => worthKeeping(event.message)).map(event => <p key={event.id} className="muted">
        <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
        <span>{tMessage(event.message)}</span>
      </p>)}
    </div>
  </li>;
}

/**
 * One run in the technical dialog. The list numbers them, because when the same orglet answers twice the only
 * thing that told two blocks apart used to be reading their ids (user, 2026-09-20). The id itself is what you
 * take somewhere else to match a log, so it sits quietly on one line with a button that copies it, rather than
 * in the padded box that used to be the loudest thing on screen.
 */
function TechnicalRun({ run, detail, workspace, onExport }: { run: Run; detail: TaskDetail; workspace: Workspace; onExport: (artifactId: string) => void }) {
  const stage = run.stage && stageNames[run.stage] ? t(stageNames[run.stage]) : undefined;
  const setup = [t('Skill {0}', [run.snapshot.skill.name]), providerName(run.snapshot.worker.provider), run.snapshot.model].filter(Boolean).join(' · ');
  const artifacts = detail.artifacts.filter(artifact => artifact.runId === run.id);
  return <li className="technical-run">
    <p className="technical-run-who">
      <strong>{run.snapshot.worker.name}</strong>
      {stage && <small>{stage}</small>}
    </p>
    <p className="technical-run-setup">{setup}</p>
    {run.snapshot.reassignment && <p className="muted">{t('Nhận lại phần việc của {0}', [originalAssignmentOwner(detail, run)])}</p>}
    <p className="technical-run-id">
      <code>{run.id}</code>
      <Button size="icon" aria-label={t('Sao chép mã lần chạy')} title={t('Sao chép mã lần chạy')} onClick={() => void copyRunId(run.id)}><Copy size={13} /></Button>
    </p>
    {run.snapshot.plan && <ul className="technical-run-plan">{run.snapshot.plan.assignments.map(assignment => <li key={assignment.workerId}>
      <strong>{detail.runs.find(item => item.stage === 'member' && item.snapshot.worker.id === assignment.workerId)?.snapshot.worker.name ?? assignment.workerId}</strong>
      {assignment.brief}
    </li>)}</ul>}
    <ContextManifestView run={run} workspace={workspace} />
    {artifacts.map(artifact => <Button key={artifact.id} variant="outline" title={tMessage(artifact.report.title)} onClick={() => onExport(artifact.id)}>
      <FileText size={16} />{artifact.report.format === 'chat' ? t('Xuất câu trả lời') : t('Xuất báo cáo')}
    </Button>)}
  </li>;
}

async function copyRunId(id: string) {
  try {
    await orglet.copyText(id);
    toast(t('Đã sao chép mã'), 'success', t('Mã lượt chạy {0}', [id]));
  } catch {
    toast(t('Không sao chép được mã'), 'error', t('Mã lượt chạy {0}', [id]));
  }
}

export function DetailsPanel({ workspace, team, worker, group, detail, workerStatus, onClose, onOpenSources, onExport, tools, recovery, recoveryFocus, onRetireWorkspace, onRestoreFile, readProcessOutput, readPrivateFile }: {
  workspace: Workspace;
  team?: Team;
  worker?: Worker;
  /** The orglets of a group chat that has not started yet (COD-215), in the order they were picked. */
  group?: readonly Worker[];
  detail?: TaskDetail;
  recovery?: WorkspaceRecoveryView;
  /** Set when the chat asked to review an attempt: Details scrolls to that attempt (or to the blocking one). */
  recoveryFocus?: RecoveryFocus;
  onRetireWorkspace?: (runId: string, reviewToken: string) => void;
  onRestoreFile?: (runId: string, path: string) => void;
  readProcessOutput?: ReadProcessOutput;
  readPrivateFile?: ReadPrivateFile;
  workerStatus: (id: string) => StatusMarkState;
  onClose: () => void;
  onOpenSources: () => void;
  onExport: (artifactId: string) => void;
  /**
   * The chat's permissions; the parent owns the bridge calls. `grant` is undefined while it is still being read.
   * An empty chat has them too: `capabilities` is then the set its first message will start with (COD-178) and
   * `pending` the folder waiting for it (COD-186).
   */
  tools?: {
    workers: Worker[];
    connectedProviders: Worker['provider'][];
    onConfigure: (provider: Exclude<Worker['provider'], 'demo'>) => void;
    capabilities?: ToolCapability[];
    grant: WorkspaceGrantView | null | undefined;
    pending?: NewChatWorkspaceView;
    busy: boolean;
    onCapability: (capability: ToolCapability, enabled: boolean) => void;
    onWorkspace: (level: WorkspaceLevel) => void;
  };
}) {
  const [technical, setTechnical] = useState(false);
  const members = team ? teamRoster(team, workspace.workers) : [...group ?? []];
  const spent = detail ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0;
  const tokens = detail ? detail.usage.inputTokens + detail.usage.outputTokens : 0;
  const firstRun = detail?.runs[0];
  const lastRun = detail?.runs.at(-1);
  // What the answers actually ran on, which used to be readable only inside the technical block (user, 2026-09-19).
  const model = lastRun?.snapshot.model;
  const finishedAt = lastRun && detail ? runEndedAt(lastRun.id, detail.events) : undefined;
  const took = firstRun && finishedAt ? elapsedLabel(firstRun.startedAt, finishedAt) : undefined;

  return <aside className="details-pane" aria-label={t('Chi tiết')}>
    <div className="details-head">
      <h2>{t('Chi tiết')}</h2>
      <Button size="icon" aria-label={t('Đóng panel')} onClick={onClose}><X size={18} /></Button>
    </div>
    <div className="details-body">
      <ChatSubject team={team} worker={worker} group={group} members={members} />

      {(team || group) && <Section icon={Users} title={t('Thành viên')}>
        <ShowMore items={members} empty={t('Hội chưa có Tí nào.')} render={member => {
          const mark = workerStatus(member.id);
          return <div key={member.id} className="details-member">
            <StatusMark variant={mark.variant} tone={mark.tone} label={statusMarkLabel(mark)} decorative />
            <Avatar name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size="xs"
              badge={member.provider === 'demo' ? undefined : <ProviderMark provider={member.provider} size="small" decorative />} />
            <div>
              <p className="details-member-name">{member.name}{member.id === team?.synthesizerId && <small>{t('tí trưởng')}</small>}</p>
              {member.description && <p className="muted">{member.description}</p>}
            </div>
          </div>;
        }} />
      </Section>}

      {detail && <section className="details-section details-chat">
        <p className="details-status">{detail.task.status === 'waiting_input' && detail.task.decisionRequests?.some(request => request.inputRevision === (detail.task.inputRevision ?? 0) && !request.answer && !request.interruptedAt) ? t('Chờ quyết định') : statusLabel[detail.task.status]}</p>
        <div className="details-facts">
          <Fact icon={Wallet} title={t('Đã tiêu cho cuộc trò chuyện này')}>{formatMoney(spent)}</Fact>
          {took && <Fact icon={Clock} title={t('Tổng thời gian chạy')}>{took}</Fact>}
          {tokens > 0 && <Fact icon={Cpu} title={t('Token đã dùng')}>{t('{0} token', [tokens.toLocaleString(currentLocale())])}</Fact>}
          {model && <Fact icon={Sparkles} title={t('Model đã trả lời')}>{model}</Fact>}
          <Fact icon={MessageSquare} title={t('Số lượt trả lời')}>{replyCountLabel(detail.artifacts.length)}</Fact>
        </div>
        {detail.sources.length > 0 && <>
          <ShowMore items={detail.sources} limit={3} empty="" render={source => <p key={source.id} className="details-source"><FileText size={14} aria-hidden="true" />{source.name}</p>} />
          <Button variant="outline" onClick={onOpenSources}><FileText size={16} />{t('Xem nguồn')}</Button>
        </>}
      </section>}

      {tools && <section className="details-section task-tools" aria-labelledby="task-tools-heading">
        <h3 id="task-tools-heading"><ShieldCheck size={15} aria-hidden="true" />{t('Quyền công cụ')}</h3>
        <PermissionControls workers={tools.workers.map(person => ({ id: person.id, name: person.name, provider: person.provider, connected: tools.connectedProviders.includes(person.provider) }))}
          capabilities={detail ? detail.task.toolCapabilities : tools.capabilities} grant={tools.grant} taskId={detail?.task.id} sourceCount={detail?.sources.length ?? 0}
          busy={tools.busy} pending={tools.pending}
          // A side thread takes its permissions from its main chat and can never be wider (COD-247).
          locked={detail?.task.sideOf ? t('Chat phụ dùng quyền của chat chính. Đổi quyền ở chat chính.') : undefined}
          onCapability={tools.onCapability} onWorkspace={tools.onWorkspace} onConfigure={tools.onConfigure} />
        {detail && <McpChatGrants detail={detail} workers={tools.workers} workspace={workspace} />}
      </section>}
      {detail && recovery?.taskId === detail.task.id && onRetireWorkspace && readProcessOutput && readPrivateFile && <WorkspaceRecovery view={recovery} runs={detail.runs} focus={recoveryFocus}
        busy={!!tools?.busy || ['running', 'queued', 'pausing'].includes(detail.task.status)} onRetire={onRetireWorkspace} onRestore={onRestoreFile}
        readOutput={readProcessOutput} readFile={readPrivateFile} />}

      {detail && detail.runs.some(run => run.snapshot.workFrame) && <Section icon={MessageSquare} title={t('Mục tiêu của lượt')}>
        {detail.runs.filter(run => run.snapshot.workFrame).map(run => {
          const frame = run.snapshot.workFrame!;
          return <div key={run.id} className="details-run">
            <div>
              <p><strong>{frame.goal}</strong></p>
              {frame.statedConstraints.length > 0 && <p className="muted">{t('Tí hiểu là ràng buộc được nói rõ: {0}', [frame.statedConstraints.join('; ')])}</p>}
              {frame.assumptions.length > 0 && <p className="muted">{t('Giả định chưa xác nhận: {0}', [frame.assumptions.join('; ')])}</p>}
              {frame.plannedChecks.length > 0 && <p className="muted">{t('Dự định kiểm tra, chưa phải kết quả: {0}', [frame.plannedChecks.join('; ')])}</p>}
            </div>
          </div>;
        })}
      </Section>}

      {detail && Boolean(detail.task.decisionRequests?.length) && <Section icon={MessageSquare} title={t('Quyết định trong chat')}>
        {detail.task.decisionRequests!.map(request => <div key={request.id} className="details-run">
          <div>
            {/* An approval card's question is the core's own sentence, so it is translated; a worker's question is shown as asked. */}
            <p><strong>{request.approval ? tMessage(request.question) : request.question}</strong></p>
            <p className="muted">{request.answer ? decisionAnswer(request.answer, Boolean(request.approval)) : request.interruptedAt ? t('Không thể tiếp tục từ bản sao lưu') : t('Đang chờ trả lời')}</p>
          </div>
        </div>)}
      </Section>}

      {detail && detail.events.some(event => event.teamMessage) && <Section icon={MessageSquare} title={t('Tin nhắn giữa các Tí')}>
        {detail.events.filter(event => event.teamMessage).map(event => {
          const message = event.teamMessage!;
          const sender = detail.runs.find(run => run.snapshot.worker.id === message.senderId)?.snapshot.worker.name ?? message.senderId;
          const recipient = detail.runs.find(run => run.snapshot.worker.id === message.recipientId)?.snapshot.worker.name ?? message.recipientId;
          const parent = detail.events.find(item => item.id === message.replyTo)?.teamMessage;
          const reactionAction = (fn: () => Promise<unknown>) => { void fn().catch(error => toast(tMessage(String(error)), 'error', t('Tin của {0}', [sender]))); };
          return <div className="details-team-message" key={event.id} id={`message-${event.id}`} tabIndex={-1}>
            <p><strong>{sender}</strong> → {recipient} · {t(message.kind === 'question' ? 'Câu hỏi' : message.kind === 'response' ? 'Phản hồi' : message.kind === 'blocker' ? 'Điểm chặn' : 'Bàn giao')}</p>
            {parent && <p className="muted">{t('Trả lời tin: {0}', [parent.body.slice(0, 140)])}</p>}
            <p>{message.body}</p>
            <MessageBadges taskId={detail.task.id} messageId={event.id} reactions={detail.task.messageReactions ?? []} runs={detail.runs} align="inline" action={reactionAction} />
            <MessageActions taskId={detail.task.id} messageId={event.id} author={sender} text={message.body} reactions={detail.task.messageReactions ?? []} action={reactionAction} />
          </div>;
        })}
      </Section>}

      {detail && Boolean(detail.task.messageReactions?.length) && <Section icon={MessageSquare} title={t('Tương tác')}>
        {[...new Set(detail.task.messageReactions!.map(mark => mark.messageId))].map(messageId => {
          const marks = detail.task.messageReactions!.filter(mark => mark.messageId === messageId);
          const excerpt = messageExcerpt(detail, messageId);
          return <div className="details-team-message" key={messageId}>
            {excerpt === undefined
              ? <p className="muted">{t('Tin nhắn trước không còn hiển thị')}</p>
              : <button type="button" className="message-reply-context" onClick={() => focusMessage(messageId)}><span className="details-reaction-source">{t('Mở tin gốc: {0}', [excerpt.slice(0, 200)])}</span></button>}
            {reactionGroups(marks, detail.runs).map(group => <p key={group.emoji}>{group.label}</p>)}
          </div>;
        })}
      </Section>}

      {detail && detail.runs.length > 0 && <Section icon={Clock} title={t('Diễn biến')}>
        <ol className="details-runs">
          {detail.runs.map(run => <RunEntry key={run.id} run={run} events={detail.events.filter(event => event.runId === run.id)} />)}
        </ol>
      </Section>}

      {detail && <Button variant="outline" className="details-technical-open" onClick={() => setTechnical(true)}>
        <Wrench size={16} />{t('Chi tiết kỹ thuật')}
      </Button>}

      {detail && technical && <Drawer open onClose={() => setTechnical(false)} title={t('Chi tiết kỹ thuật')} description={t('Từng lần chạy: ai trả lời, đọc gì, và mã để đối chiếu.')}>
        <ol className="technical-runs">
          {detail.runs.map(run => <TechnicalRun key={run.id} run={run} detail={detail} workspace={workspace} onExport={onExport} />)}
        </ol>
      </Drawer>}
    </div>
  </aside>;
}
