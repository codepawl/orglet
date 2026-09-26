import { WorkspaceGrantSnapshot } from '../../shared/workspace-access';
import { assertTeamPlan } from '../orchestration/plan';
import { z } from 'zod';
import { ToolCapabilities, snapshotCapabilities } from '../../shared/tool-policy';
import { TeamMessage, TeamReassignment } from '../../shared/team-messages';
import { createHash } from 'node:crypto';
import { Store, now, id } from './database';
import { Id, WorkerInput, SkillInput, TeamInput, TaskInput, Report, Routine, Handoff, RunInput, TeamPlan, PlanAssignment } from '../../shared/contracts';
import { DatasetProfile, DataFormat } from '../../shared/profiles';
import { PreflightRecord } from '../../shared/preflight';
import { SkillPackage } from '../../shared/skill-package';
import { applyReviewPolicy, validateReview } from '../review';
import { EvidenceRequest } from '../../shared/review';
import { preflightScope } from '../orchestration/preflight';
import { Knowledge, RunContext } from '../../shared/knowledge';
import { KnowledgeBase } from '../context/knowledge';
import { DecisionRequest } from '../../shared/work-decisions';
import { WorkFrame } from '../../shared/work-frame';
import { WorkspaceReadEvidence } from '../../shared/workspace-evidence';
import { MessageReaction, turnMessageId } from '../../shared/message-interactions';
import { ImprovementSignals } from '../../shared/self-improvement';
import { CustomConnection, CustomProviderId, MAX_CUSTOM_CONNECTIONS } from '../../shared/custom-connections';
import { readCustomConnections, writeCustomConnections } from './custom-connections';
import { ChatSearch } from './chat-search';
import { McpGrant, McpRunTool } from '../../shared/mcp';
import { ChatQuote, MAX_CHAT_QUOTES, SideOf } from '../../shared/side-threads';
import { BrowserProfileId } from '../../shared/browser';
import { MAX_DESKTOP_APPS } from '../../shared/desktop';
import { BlockedHandIn } from '../../shared/blocked-hand-in';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Revision = z.number().int().positive();
const Worker = WorkerInput.extend({ id: Id, revision: Revision }).strict();
const Skill = SkillInput.extend({ id: Id, revision: Revision, package: SkillPackage.optional() }).strict();
const Team = TeamInput.extend({ id: Id, revision: Revision }).strict();
const Status = z.enum(['queued', 'running', 'pausing', 'paused', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'waiting_budget', 'waiting_input']);
const Task = TaskInput.extend({ id: Id, sourceIds: z.array(Id).max(1000), inputRevision: Integer.optional(), currentInput: RunInput.optional(), messageReactions: z.array(MessageReaction).max(1000).optional(), teamSnapshot: Team.optional(), status: Status, createdAt: z.iso.datetime(), accepted: z.boolean(), pendingStart: z.boolean().optional(), seenStamp: z.string().max(200).optional(), lastArtifactId: Id.optional(), seenAt: z.iso.datetime().optional(), routineId: Id.optional(), pauseReason: z.literal('shift').optional(), handoff: Handoff.optional(), evidenceRequests: z.array(EvidenceRequest).optional(), decisionRequests: z.array(DecisionRequest).max(400).optional(), mcpGrants: z.array(McpGrant).max(200).optional(), sideOf: SideOf.optional(), quotes: z.array(ChatQuote).max(MAX_CHAT_QUOTES).optional(), archivedAt: z.iso.datetime().optional(), deletedAt: z.iso.datetime().optional() }).strict();
const Run = z.object({ id: Id, taskId: Id, stage: z.enum(['plan', 'member', 'synthesis', 'group']).optional(), status: Status, snapshot: z.object({ workspaceGrant: WorkspaceGrantSnapshot.optional(), assignment: PlanAssignment.optional(), reassignment: TeamReassignment.optional(), toolCapabilities: ToolCapabilities.optional(), worker: Worker, skill: Skill, input: RunInput.optional(), context: RunContext.optional(), workFrame: WorkFrame.optional(), inputRevision: Integer.optional(), team: Team.optional(), upstreamArtifactIds: z.array(Id).optional(), preflightId: Id.optional(), scoreProfileIds: z.array(Id).max(20).optional(), model: z.string().optional(), pricingVersion: z.string().optional(), plan: TeamPlan.optional(), improvement: ImprovementSignals.optional(), mcpTools: z.array(McpRunTool).max(20 * 64).optional(), browser: z.object({ profileId: BrowserProfileId }).strict().optional(), desktop: z.object({ programs: z.array(z.string().max(120)).max(MAX_DESKTOP_APPS) }).strict().optional() }).strict(), startedAt: z.iso.datetime(), error: z.string().nullable(), errorCode: z.enum(['unresolved_attempt', 'report_rejected', 'plan_limit', 'hand_in_blocked']).optional(), blockedHandIn: BlockedHandIn.optional(), outOfSteps: z.literal(true).optional() }).strict();
const Event = z.object({ id: Id, runId: Id, sequence: Integer.optional(), message: z.string(), createdAt: z.iso.datetime(), teamMessage: TeamMessage.optional() }).strict();
const UsedMemory = z.object({ id: Id, revision: z.number().int().positive(), text: z.string().min(1).max(500) }).strict();
const Artifact = z.object({ id: Id, runId: Id, report: Report, hash: Hash, createdAt: z.iso.datetime(), replyTo: Id.optional(), usedMemories: z.array(UsedMemory).max(60).optional() }).strict();
const Source = z.object({ id: Id, name: z.string(), bytes: Integer, hash: Hash, revoked: z.boolean(), format: DataFormat.optional(), media: z.enum(['image', 'video', 'audio', 'pdf']).optional() }).strict();
const Profile = z.object({ id: Id, taskId: Id, runId: Id.optional(), createdAt: z.iso.datetime(), sourceHashes: z.record(Id, Hash), result: DatasetProfile }).strict();
const manualScoreAvailable = (profile: z.infer<typeof Profile>, run: z.infer<typeof Run>) => !profile.runId && !!profile.result.exactMatch && profile.createdAt <= run.startedAt
  && !!run.snapshot.scoreProfileIds?.includes(profile.id) && Object.keys(profile.sourceHashes).every(sourceId => run.snapshot.input?.sourceIds.includes(sourceId));
const ProcessEvidence = z.object({ id: Id, runId: Id, exitCode: z.number().int() }).strict();
const Reservation = z.object({ id: Id, run_id: Id, task_id: Id, provider: z.union([z.enum(['openai', 'anthropic', 'xai', 'openrouter']), CustomProviderId]), month: z.string().regex(/^\d{4}-\d{2}$/), amount: Integer, state: z.enum(['held', 'unknown', 'settled']) }).strict();
const Ledger = z.object({ id: Id, reservation_id: Id, amount: Integer, input_tokens: Integer, output_tokens: Integer, pricing_version: z.string() }).strict();
const ReservationReview = z.object({ reservation_id: Id, reason: z.enum(['missing_usage', 'request_failed', 'interrupted', 'legacy']), noted_at: z.iso.datetime(), actual_amount: Integer.nullable(), verified_source: z.enum(['provider_dashboard', 'invoice']).nullable(), resolved_at: z.iso.datetime().nullable() }).strict();
const RevisionRow = z.object({ entity_id: Id, revision: Revision, data: z.union([Worker, Skill, Team]) }).strict();
const Settings = z.object({ theme: z.enum(['system', 'light', 'dark']), connectionLimitMicros: z.number().int().min(1000).max(1_000_000_000) }).strict();
const KnowledgeRevision = z.object({ id: Id, revision: Revision, data: Knowledge }).strict();
const Payload = z.object({
  routines: z.array(Routine).max(100).optional(),
  // A custom connection's name and address travel with the orglets that use it; its key never does.
  customConnections: z.array(CustomConnection).max(MAX_CUSTOM_CONNECTIONS).optional(),
  knowledge: z.array(Knowledge).max(10_000).optional(), knowledgeRevisions: z.array(KnowledgeRevision).max(100_000).optional(),
  workers: z.array(Worker), skills: z.array(Skill), teams: z.array(Team), tasks: z.array(Task), runs: z.array(Run), events: z.array(Event), artifacts: z.array(Artifact), sources: z.array(Source), profiles: z.array(Profile), processEvidence: z.array(ProcessEvidence).optional(), workspaceEvidence: z.array(WorkspaceReadEvidence).optional(), preflights: z.array(PreflightRecord).optional(), revisions: z.array(RevisionRow), reservations: z.array(Reservation), ledger: z.array(Ledger), reservationReviews: z.array(ReservationReview).optional(), settings: Settings,
}).strict();
type Payload = z.infer<typeof Payload>;
const Envelope = z.object({ format: z.literal('orglet-backup'), version: z.literal(1), createdAt: z.iso.datetime(), checksum: Hash, payload: Payload }).strict();
export type BackupSummary = { token: string; workers: number; teams: number; tasks: number; reports: number; createdAt: string };
const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const fail = (message: string): never => { throw new Error(`Bản sao lưu không hợp lệ: ${message}`); };

function validateRelations(data: Payload) {
  const map = <T extends { id: string }>(rows: T[]) => { const result = new Map(rows.map(row => [row.id, row])); if (result.size !== rows.length) fail('ID bị trùng.'); return result; };
  const workers = map(data.workers); const skills = map(data.skills); const teams = map(data.teams);
  const tasks = map(data.tasks); const runs = map(data.runs); const sources = map(data.sources); const artifacts = map(data.artifacts);
  for (const run of runs.values()) {
    const scoreIds = run.snapshot.scoreProfileIds ?? [];
    if (new Set(scoreIds).size !== scoreIds.length || scoreIds.some(id => {
      const profile = data.profiles.find(item => item.id === id);
      return !profile || profile.taskId !== run.taskId || !manualScoreAvailable(profile, run);
    })) fail('Checker accuracy không thuộc lượt chạy.');
  }
  const routines = map(data.routines ?? []);
  for (const routine of routines.values()) if (!workers.has(routine.task.workerId) || (routine.task.teamId && !teams.has(routine.task.teamId)) || routine.task.sourceIds.some(id => !sources.has(id)) || (routine.lastTaskId && tasks.get(routine.lastTaskId)?.routineId !== routine.id)) fail('Lịch thiếu Tí, hội, nguồn hoặc task.');
  for (const task of tasks.values()) {
    if (task.currentInput?.sourceIds.some(id => !task.sourceIds.includes(id))) fail('Đầu vào hiện tại tham chiếu nguồn ngoài task.');
    const decisions = task.decisionRequests ?? [];
    if (new Set(decisions.map(request => request.id)).size !== decisions.length) fail('Câu hỏi quyết định bị trùng.');
    for (const request of decisions) {
      const run = runs.get(request.runId);
      if (!run || run.taskId !== task.id || (run.snapshot.inputRevision ?? 0) !== request.inputRevision
        || Boolean(request.answer) !== Boolean(request.answeredAt) || (request.interruptedAt && request.answer)) fail('Câu hỏi quyết định không khớp lượt.');
    }
    const requests = task.evidenceRequests ?? [];
    if (new Set(requests.map(request => request.id)).size !== requests.length) fail('Yêu cầu bằng chứng bị trùng.');
    for (const request of requests) {
      const artifact = artifacts.get(request.artifactId);
      if (!artifact || runs.get(artifact.runId)?.taskId !== task.id) fail('Yêu cầu bằng chứng tham chiếu báo cáo ngoài task.');
      const missing = artifact!.report.review?.checks.filter(check => check.status === 'not_assessed').map(check => check.name) ?? [];
      if (JSON.stringify(missing) !== JSON.stringify(request.checks)) fail('Yêu cầu bằng chứng không khớp mục chưa đánh giá.');
    }
    if (task.routineId && !routines.has(task.routineId)) fail('Task thiếu lịch.');
    // A side thread belongs to one orglet's main chat (COD-247). That chat may have been deleted since, and then it
    // is not in the backup; when it is, it has to be a main chat of the same orglet.
    const parent = task.sideOf ? tasks.get(task.sideOf.taskId) : undefined;
    if (task.sideOf && (task.teamId || task.assignees || task.routineId)) fail('Chat phụ chỉ thuộc về một Tí.');
    if (parent && (parent.workerId !== task.workerId || parent.teamId || parent.assignees || parent.sideOf)) fail('Chat phụ không khớp chat chính.');
    if (task.handoff?.artifactIds.some(id => runs.get(artifacts.get(id)?.runId ?? '')?.taskId !== task.id)) fail('Handoff tham chiếu báo cáo ngoài task.');
  }
  map(data.events); map(data.profiles); const processEvidence = map(data.processEvidence ?? []); const workspaceEvidence = map(data.workspaceEvidence ?? []); const reservations = map(data.reservations); map(data.ledger);
  for (const process of processEvidence.values()) if (!runs.has(process.runId)) fail('Bằng chứng tiến trình tham chiếu run không tồn tại.');
  const readCalls = new Set<string>();
  for (const evidence of workspaceEvidence.values()) {
    const grant = runs.get(evidence.runId)?.snapshot.workspaceGrant;
    const key = `${evidence.runId}:${evidence.callId}`;
    if (!grant || grant.id !== evidence.grantId || grant.revision !== evidence.grantRevision || readCalls.has(key)) fail('Bằng chứng workspace không khớp lượt hoặc quyền.');
    readCalls.add(key);
  }
  const preflights = map(data.preflights ?? []);
  const preflightScopes = new Set<string>();
  for (const record of preflights.values()) {
    const task = tasks.get(record.taskId);
    const scope = `${record.taskId}:${preflightScope(record)}`;
    if (!task || preflightScopes.has(scope) || record.profileIds.some(profileId => !data.profiles.some(profile => profile.id === profileId && profile.taskId === record.taskId)) || Object.entries(record.sourceHashes).some(([id, hash]) => !task.sourceIds.includes(id) || sources.get(id)?.hash !== hash)) fail('Preflight không khớp task/checker/nguồn.');
    preflightScopes.add(scope);
  }
  for (const run of runs.values()) if (run.snapshot.preflightId && preflights.get(run.snapshot.preflightId)?.taskId !== run.taskId) fail('Run thiếu preflight.');
  for (const worker of workers.values()) if (!skills.has(worker.skillId)) fail('Tí thiếu skill.');
  for (const team of teams.values()) if ([...team.memberIds, team.synthesizerId].some(id => !workers.has(id))) fail('Hội thiếu Tí.');
  for (const task of tasks.values()) if (!workers.has(task.workerId) || task.sourceIds.some(id => !sources.has(id)) || (task.teamId && (!teams.has(task.teamId) || task.teamSnapshot?.id !== task.teamId))) fail('Task thiếu Tí, hội hoặc nguồn.');
  for (const run of runs.values()) if (!tasks.has(run.taskId) || run.snapshot.worker.skillId !== run.snapshot.skill.id || run.snapshot.upstreamArtifactIds?.some(id => !artifacts.has(id))) fail('Snapshot hoặc task của run không hợp lệ.');
  for (const run of runs.values()) {
    if (run.snapshot.assignment && (run.stage !== 'member' || (!run.snapshot.reassignment && run.snapshot.assignment.workerId !== run.snapshot.worker.id))) {
      fail('Người nhận không khớp phần việc.');
    }
    const reassignment = run.snapshot.reassignment;
    if (reassignment) {
      const source = runs.get(reassignment.sourceRunId);
      const decision = runs.get(reassignment.decisionRunId);
      const team = run.snapshot.team;
      const revision = run.snapshot.inputRevision ?? 0;
      if (!source || !decision || !team || run.stage !== 'member' || !run.snapshot.assignment
        || source.id === run.id || source.stage !== 'member' || source.taskId !== run.taskId || decision.taskId !== run.taskId
        || source.snapshot.team?.id !== team.id || decision.snapshot.team?.id !== team.id
        || (source.snapshot.inputRevision ?? 0) !== revision || (decision.snapshot.inputRevision ?? 0) !== revision
        || decision.stage !== 'synthesis' || decision.snapshot.worker.id !== team.synthesizerId
        || reassignment.newWorkerId !== run.snapshot.worker.id || !team.memberIds.includes(reassignment.newWorkerId)
        || reassignment.assignmentWorkerId !== run.snapshot.assignment.workerId
        || (source.snapshot.assignment?.workerId ?? source.snapshot.worker.id) !== reassignment.assignmentWorkerId
        || (source.snapshot.assignment && digest(source.snapshot.assignment) !== digest(run.snapshot.assignment))) {
        fail('Quyết định giao lại việc không hợp lệ.');
      }
      const peers = [...runs.values()].filter(candidate => candidate.taskId === run.taskId
        && (candidate.snapshot.inputRevision ?? 0) === revision && candidate.snapshot.reassignment);
      if (peers.filter(candidate => candidate.snapshot.reassignment!.assignmentWorkerId === reassignment.assignmentWorkerId).length > 2
        || peers.filter(candidate => candidate.snapshot.reassignment!.decisionRunId === reassignment.decisionRunId
          && candidate.snapshot.reassignment!.callId === reassignment.callId).length !== 1) fail('Quyết định giao lại việc không hợp lệ.');
      const ancestry = new Set([run.id]);
      let ancestor = source;
      while (ancestor) {
        if (ancestry.has(ancestor.id)) fail('Quyết định giao lại việc không hợp lệ.');
        ancestry.add(ancestor.id);
        ancestor = ancestor.snapshot.reassignment ? runs.get(ancestor.snapshot.reassignment.sourceRunId) : undefined;
      }
      const recipient = [...runs.values()].find(candidate => candidate.taskId === run.taskId && candidate.stage === 'member'
        && (candidate.snapshot.inputRevision ?? 0) === revision && candidate.snapshot.team?.id === team!.id
        && !candidate.snapshot.reassignment && candidate.snapshot.worker.id === reassignment.newWorkerId);
      const plan = [...runs.values()].findLast(candidate => candidate.taskId === run.taskId && candidate.stage === 'plan'
        && candidate.status === 'completed' && (candidate.snapshot.inputRevision ?? 0) === revision && candidate.snapshot.team?.id === team!.id)?.snapshot.plan;
      const assignment = plan?.assignments.find(candidate => candidate.workerId === reassignment.assignmentWorkerId);
      if (!recipient || !assignment || digest(assignment) !== digest(run.snapshot.assignment)) fail('Quyết định giao lại việc không hợp lệ.');
      const capabilities = run.snapshot.toolCapabilities ?? snapshotCapabilities(run.snapshot.worker.provider);
      for (const original of [source!, recipient!]) {
        const allowed = original.snapshot.toolCapabilities ?? snapshotCapabilities(original.snapshot.worker.provider);
        if (capabilities.some(capability => !allowed.includes(capability))) fail('Quyết định giao lại việc không hợp lệ.');
        const grant = run.snapshot.workspaceGrant;
        const originalGrant = original.snapshot.workspaceGrant;
        if (grant && (!originalGrant || grant.id !== originalGrant.id || grant.taskId !== originalGrant.taskId
          || grant.revision !== originalGrant.revision || grant.permissions.some(permission => !originalGrant.permissions.includes(permission)))) {
          fail('Quyết định giao lại việc không hợp lệ.');
        }
      }
    }
    const plan = run.snapshot.plan;
    if (!plan) continue;
    if (run.stage !== 'plan' || !run.snapshot.team) fail('Phân việc không thuộc lần chạy trưởng phòng.');
    assertTeamPlan(run.snapshot.team!, plan);
  }
  // Validate the whole join graph, including runs that never committed an artifact.
  // Kahn's traversal avoids recursive stack growth on a large imported history.
  const dependencies = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const run of runs.values()) {
    const ids = run.snapshot.upstreamArtifactIds ?? [];
    if (new Set(ids).size !== ids.length) fail('Join có tham chiếu trùng.');
    dependencies.set(run.id, ids.length);
    for (const id of ids) {
      const parent = runs.get(artifacts.get(id)!.runId);
      if (!parent || parent.taskId !== run.taskId) return fail('Join tham chiếu artifact ngoài task.');
      const children = dependents.get(parent.id) ?? [];
      children.push(run.id); dependents.set(parent.id, children);
    }
  }
  const ready = [...dependencies].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < ready.length; index++) {
    for (const child of dependents.get(ready[index]) ?? []) {
      const remaining = dependencies.get(child)! - 1;
      dependencies.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  if (ready.length !== runs.size) fail('Join có vòng lặp giữa các báo cáo.');
  for (const run of runs.values()) if (run.snapshot.input?.sourceIds.some(id => !tasks.get(run.taskId)!.sourceIds.includes(id))) fail('Snapshot tham chiếu nguồn ngoài task.');
  // A file a forward carried is one of that turn's own files (COD-257).
  const carriesOwnFiles = (input: { sourceIds: string[]; forwarded?: { files: { sourceId?: string }[] } } | undefined) =>
    (input?.forwarded?.files ?? []).every(file => !file.sourceId || input!.sourceIds.includes(file.sourceId));
  for (const task of tasks.values()) if (!carriesOwnFiles(task.currentInput)) fail('Tin chuyển tiếp tham chiếu tệp ngoài lượt.');
  for (const run of runs.values()) if (!carriesOwnFiles(run.snapshot.input)) fail('Tin chuyển tiếp tham chiếu tệp ngoài lượt.');
  const events = new Map(data.events.map(event => [event.id, event]));
  const messageScope = new Map<string, { taskId: string; revision: number; kind: 'user' | 'answer' | 'team' }>();
  const addMessage = (id: string, taskId: string, revision: number, kind: 'user' | 'answer' | 'team') => {
    if (messageScope.has(id)) fail('ID tin nhắn bị trùng.');
    messageScope.set(id, { taskId, revision, kind });
  };
  for (const task of tasks.values()) for (let revision = 0; revision <= (task.inputRevision ?? 0); revision++) {
    if (revision === 0 || (revision === (task.inputRevision ?? 0) && task.currentInput)
      || [...runs.values()].some(run => run.taskId === task.id && (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)) {
      addMessage(turnMessageId(task.id, revision), task.id, revision, 'user');
    }
  }
  for (const artifact of artifacts.values()) {
    const owner = runs.get(artifact.runId);
    if (!owner) fail('Artifact thiếu run.');
    addMessage(artifact.id, owner!.taskId, owner!.snapshot.inputRevision ?? 0, 'answer');
    if (artifact.replyTo && (artifact.replyTo !== turnMessageId(owner!.taskId, owner!.snapshot.inputRevision ?? 0)
      || !messageScope.has(artifact.replyTo))) fail('Câu trả lời tham chiếu sai tin người dùng.');
  }
  for (const event of data.events) if (event.teamMessage) {
    const owner = runs.get(event.runId);
    if (!owner) fail('Thông điệp thiếu run.');
    addMessage(event.id, owner!.taskId, event.teamMessage.inputRevision, 'team');
  }
  for (const task of tasks.values()) {
    const current = task.currentInput?.replyTo;
    if (current && (messageScope.get(current)?.taskId !== task.id || messageScope.get(current)!.revision >= (task.inputRevision ?? 0))) fail('Tin trả lời tham chiếu ngoài cuộc trò chuyện.');
    const keys = new Set<string>();
    for (const reaction of task.messageReactions ?? []) {
      const target = messageScope.get(reaction.messageId);
      const key = `${reaction.messageId}:${reaction.actor}:${reaction.workerId ?? ''}:${reaction.emoji}`;
      if (target?.taskId !== task.id || keys.has(key)) fail('Tương tác tham chiếu tin ngoài cuộc trò chuyện hoặc bị trùng.');
      keys.add(key);
      if (reaction.actor === 'user' ? reaction.workerId || reaction.runId || reaction.callId
        : !reaction.workerId || !reaction.runId || !reaction.callId || runs.get(reaction.runId)?.taskId !== task.id
          || runs.get(reaction.runId)?.snapshot.worker.id !== reaction.workerId
          || target!.revision > (runs.get(reaction.runId)?.snapshot.inputRevision ?? -1)) fail('Người thả tương tác không khớp lượt.');
    }
  }
  for (const run of runs.values()) if (run.snapshot.input?.replyTo &&
    (messageScope.get(run.snapshot.input.replyTo)?.taskId !== run.taskId
      || messageScope.get(run.snapshot.input.replyTo)!.revision >= (run.snapshot.inputRevision ?? 0))) fail('Run tham chiếu tin ngoài cuộc trò chuyện.');
  for (const event of data.events) {
    const run = runs.get(event.runId);
    if (!run) fail('Event thiếu run.');
    const message = event.teamMessage;
    if (!message) continue;
    const team = run!.snapshot.team;
    if (!team || message.teamId !== team.id || message.senderId !== run!.snapshot.worker.id
      || message.inputRevision !== (run!.snapshot.inputRevision ?? 0)
      || ![...team.memberIds, team.synthesizerId].includes(message.recipientId)) fail('Thông điệp không khớp team hoặc lượt.');
    if (message.assignmentWorkerId && message.assignmentWorkerId !== (run!.snapshot.assignment?.workerId ?? run!.snapshot.worker.id)) {
      fail('Thông điệp không khớp phần việc.');
    }
    if ((message.state === 'resolved') !== !!message.resolution) fail('Thông điệp thiếu quyết định xử lý hợp lệ.');
    if (message.resolution) {
      const decision = runs.get(message.resolution.runId);
      if (!decision || decision.stage !== 'synthesis' || decision.taskId !== run!.taskId
        || decision.snapshot.team?.id !== team!.id || decision.snapshot.worker.id !== team!.synthesizerId
        || (decision.snapshot.inputRevision ?? 0) !== message.inputRevision
        || !['question', 'blocker'].includes(message.kind)) fail('Quyết định xử lý không thuộc trưởng nhóm trong lượt.');
    }
    if (message.replyTo) {
      const parent = events.get(message.replyTo);
      const parentRun = parent && runs.get(parent.runId);
      if (!parent?.teamMessage || parentRun?.taskId !== run!.taskId || parent.teamMessage.teamId !== message.teamId
        || parent.teamMessage.inputRevision !== message.inputRevision || parent.teamMessage.kind !== 'question'
        || parent.teamMessage.senderId !== message.recipientId || parent.teamMessage.recipientId !== message.senderId
        || message.kind !== 'response') fail('Phản hồi không khớp thông điệp gốc.');
    } else if (message.kind === 'response') fail('Phản hồi thiếu thông điệp gốc.');
  }
  const artifactRuns = new Set<string>();
  const findingIds = new Set<string>();
  for (const artifact of artifacts.values()) {
    if (!runs.has(artifact.runId) || artifactRuns.has(artifact.runId) || digest(artifact.report) !== artifact.hash) fail('Artifact bị trùng hoặc checksum sai.');
    const task = tasks.get(runs.get(artifact.runId)!.taskId)!;
    const owner = runs.get(artifact.runId)!;
    const artifactSourceIds = owner.snapshot.input?.sourceIds ?? task.sourceIds;
    const upstream = (owner.snapshot.upstreamArtifactIds ?? []).map(id => artifacts.get(id)!);
    if (owner.stage === 'synthesis' && owner.snapshot.team?.reviewPolicy) {
      const profiles = data.profiles.filter(profile => profile.taskId === task.id && (profile.runId === owner.id || (owner.snapshot.preflightId && preflights.get(owner.snapshot.preflightId)?.profileIds.includes(profile.id)) || manualScoreAvailable(profile, owner)));
      if (JSON.stringify(applyReviewPolicy(artifact.report, owner.snapshot.team.reviewPolicy, profiles, upstream)) !== JSON.stringify(artifact.report)) fail('Review bỏ qua checklist bắt buộc của snapshot.');
    }
    if (upstream.some(item => item.runId === owner.id || runs.get(item.runId)?.taskId !== task.id)) fail('Join tham chiếu artifact ngoài task hoặc chính nó.');
    validateReview(artifact.report, upstream, new Set(artifactSourceIds), (id, sourceIds) => {
      const profile = data.profiles.find(item => item.id === id);
      if (!profile || profile.taskId !== task.id || (profile.runId !== owner.id && !(owner.snapshot.preflightId && preflights.get(owner.snapshot.preflightId)?.profileIds.includes(id)) && !manualScoreAvailable(profile, owner)) || !sourceIds.some(sourceId => Object.hasOwn(profile.sourceHashes, sourceId))) fail('Review tham chiếu checker ngoài phạm vi.');
    }, (id, status) => {
      const process = processEvidence.get(id);
      if (!owner.snapshot.workspaceGrant || !process || process.runId !== owner.id
        || (status === 'pass' && process.exitCode !== 0)
        || (status === 'fail' && process.exitCode === 0)) fail('Review tham chiếu tiến trình ngoài phạm vi hoặc không khớp kết quả.');
    });
    if (artifact.report.findings.some(finding => finding.sourceIds.some(id => !artifactSourceIds.includes(id)))) fail('Artifact trích nguồn ngoài task.');
    for (const finding of artifact.report.findings) {
      const evidenceIds = finding.workspaceEvidenceIds ?? [];
      if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some(id => workspaceEvidence.get(id)?.runId !== artifact.runId)) fail('Finding trích bằng chứng workspace ngoài lượt.');
      if (finding.locations?.some(location => !finding.sourceIds.includes(location.sourceId))) fail('Vị trí dòng tham chiếu nguồn ngoài finding.');
      const provenance = finding.provenance;
      if (provenance) {
        if (provenance.runId !== artifact.runId || provenance.writerId !== runs.get(artifact.runId)!.snapshot.worker.id || findingIds.has(provenance.findingId)) fail('Nguồn gốc finding không khớp writer/run hoặc ID bị trùng.');
        findingIds.add(provenance.findingId);
      }
      for (const checkerId of finding.checkerIds ?? []) {
        const profile = data.profiles.find(item => item.id === checkerId);
        const preflightId = runs.get(artifact.runId)!.snapshot.preflightId;
        if (!profile || profile.taskId !== task.id || (profile.runId !== artifact.runId && !(preflightId && preflights.get(preflightId)?.profileIds.includes(checkerId)) && !manualScoreAvailable(profile, owner)) || !finding.sourceIds.some(id => Object.hasOwn(profile.sourceHashes, id))) fail('Finding tham chiếu checker ngoài phạm vi.');
      }
    }
    artifactRuns.add(artifact.runId);
  }
  for (const profile of data.profiles) {
    const task = tasks.get(profile.taskId);
    if (!task || (profile.runId && runs.get(profile.runId)?.taskId !== profile.taskId) || Object.entries(profile.sourceHashes).some(([id, hash]) => sources.get(id)?.hash !== hash || !task.sourceIds.includes(id))) fail('Checker thiếu nguồn hoặc checksum sai.');
    const ids = profile.result.datasets.map(dataset => dataset.sourceId);
    if (new Set(ids).size !== ids.length || ids.length !== Object.keys(profile.sourceHashes).length || ids.some(id => !Object.hasOwn(profile.sourceHashes, id))) fail('Checker không khớp nguồn đã kiểm tra.');
  }
  const settled = new Set<string>();
  for (const entry of data.ledger) { if (!reservations.has(entry.reservation_id) || settled.has(entry.reservation_id)) fail('Ledger thiếu reservation hoặc bị trùng.'); settled.add(entry.reservation_id); }
  for (const reservation of reservations.values()) if (runs.get(reservation.run_id)?.taskId !== reservation.task_id || (reservation.state === 'settled') !== settled.has(reservation.id)) fail('Reservation không khớp run/ledger.');
  const reviewed = new Set<string>();
  for (const review of data.reservationReviews ?? []) {
    const reservation = reservations.get(review.reservation_id);
    const entry = data.ledger.find(item => item.reservation_id === review.reservation_id);
    if (!reservation) fail('Đối soát ngân sách thiếu reservation.');
    if (reviewed.has(review.reservation_id)) fail('Đối soát ngân sách bị trùng.');
    const reservationState = reservation?.state;
    if (review.actual_amount === null) {
      if (review.verified_source !== null || review.resolved_at !== null || reservationState === 'settled') fail('Đối soát ngân sách chưa hoàn tất không hợp lệ.');
    } else if (review.verified_source === null || review.resolved_at === null || reservationState !== 'settled'
      || entry?.amount !== review.actual_amount || entry.pricing_version !== 'manual-reconciliation') {
      fail('Đối soát ngân sách không khớp ledger.');
    }
    reviewed.add(review.reservation_id);
  }
  const revisions = new Set<string>();
  for (const row of data.revisions) { const key = `${row.entity_id}:${row.revision}`; if (row.entity_id !== row.data.id || row.revision !== row.data.revision || revisions.has(key)) fail('Revision không hợp lệ.'); revisions.add(key); }
  const knowledgeRevisions = new Map<string, z.infer<typeof Knowledge>>();
  for (const row of data.knowledgeRevisions ?? []) {
    const key = `${row.id}:${row.revision}`;
    if (row.id !== row.data.id || row.revision !== row.data.revision || knowledgeRevisions.has(key)) fail('Revision knowledge không hợp lệ.');
    knowledgeRevisions.set(key, row.data);
  }
  for (const item of [...map(data.knowledge ?? []).values(), ...knowledgeRevisions.values()]) {
    if ((item.scope.type === 'team' && !teams.has(item.scope.id)) || (item.scope.type === 'worker' && !workers.has(item.scope.id))) fail('Knowledge tham chiếu hội/Tí không tồn tại.');
    const origin = item.provenance.kind === 'run' ? item.provenance : undefined;
    if (origin && (runs.get(origin.runId)?.taskId !== origin.taskId || artifacts.get(origin.artifactId)?.runId !== origin.runId)) fail('Knowledge tham chiếu lần chạy ngoài lịch sử.');
  }
  for (const item of data.knowledge ?? []) if (digest(knowledgeRevisions.get(`${item.id}:${item.revision}`)) !== digest(item)) fail('Knowledge hiện tại thiếu revision tương ứng.');
}

function snapshot(store: Store): Payload {
  const artifacts = store.all<z.infer<typeof Artifact>>('artifacts');
  const citedWorkspaceEvidenceIds = new Set(artifacts.flatMap(artifact => artifact.report.findings
    .flatMap(finding => finding.workspaceEvidenceIds ?? [])));
  return Payload.parse({
    routines: store.all('routines'),
    customConnections: readCustomConnections(store),
    knowledge: store.all('knowledge'),
    knowledgeRevisions: store.db.prepare('SELECT * FROM knowledge_revisions ORDER BY rowid').all().map(row => ({ id: row.id, revision: row.revision, data: JSON.parse(String(row.data)) })),
    workers: store.all('workers'), skills: store.all('skills'), teams: store.all('teams'), tasks: store.all('tasks'), runs: store.all('runs'), events: store.all('events'), artifacts, sources: store.all('sources'), profiles: store.all('profiles'),
    processEvidence: store.db.prepare('SELECT id,run_id AS runId,exit_code AS exitCode FROM process_evidence').all(),
    workspaceEvidence: store.db.prepare('SELECT data FROM workspace_read_evidence').all()
      .map(row => WorkspaceReadEvidence.parse(JSON.parse(String(row.data))))
      .filter(evidence => citedWorkspaceEvidenceIds.has(evidence.id)),
    preflights: store.all('preflights'),
    revisions: store.db.prepare('SELECT * FROM revisions ORDER BY rowid').all().map(row => ({ ...row, data: JSON.parse(String(row.data)) })),
    reservations: store.db.prepare('SELECT * FROM reservations ORDER BY rowid').all(), ledger: store.db.prepare('SELECT * FROM ledger ORDER BY rowid').all(),
    reservationReviews: store.db.prepare('SELECT * FROM reservation_reviews ORDER BY rowid').all(),
    // Keys, reviewedSkills and modelLists stay on this machine; they are derived from local credentials/CLIs.
    settings: { theme: store.setting('theme', 'system'), connectionLimitMicros: store.setting('connectionLimitMicros', 5_000_000) },
  });
}

/**
 * Adds the backup's connections this machine does not have, keeping the ones it does. A restored orglet points at its
 * connection by id, so the id is kept; a name already taken here gets a number so the pickers can still tell them apart.
 * Keys are not in a backup: a restored connection that needs one waits for it in Settings.
 */
export function mergeCustomConnections(current: CustomConnection[], incoming: CustomConnection[]): CustomConnection[] {
  const merged = [...current];
  for (const connection of incoming) {
    if (merged.some(existing => existing.id === connection.id)) continue;
    merged.push({ ...connection, name: freeConnectionName(merged, connection.name) });
  }
  return merged;
}

function freeConnectionName(taken: CustomConnection[], name: string): string {
  const used = new Set(taken.map(connection => connection.name.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let number = 2; ; number++) {
    const suffix = ` (${number})`;
    const candidate = `${name.slice(0, 60 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A backup carries no browser profile, no site list and no desktop app (COD-261): a profile is a folder of sign-ins on this computer,
 * and like a chat's other permissions the list is set again after a restore.
 */
function withoutBrowser(payload: Payload): Payload {
  const tasks = payload.tasks.map(({ browser: _browser, desktop: _desktop, ...task }) => task);
  const routines = payload.routines?.map(routine => {
    const { browser: _browser, desktop: _desktop, ...task } = routine.task;
    return { ...routine, task };
  });
  const runs = payload.runs.map(run => {
    const { browser: _browser, desktop: _desktop, ...snapshot } = run.snapshot;
    return { ...run, snapshot };
  });
  return { ...payload, tasks, runs, ...(routines ? { routines } : {}) };
}

export class Backups {
  private pending?: { token: string; expires: number; payload: Payload };
  constructor(private store: Store, private busy: () => boolean, private notify: () => void) {}
  export(): string {
    return this.store.transaction(() => {
      const payload = withoutBrowser(snapshot(this.store)); validateRelations(payload);
      const text = JSON.stringify({ format: 'orglet-backup', version: 1, createdAt: now(), checksum: digest(payload), payload });
      if (Buffer.byteLength(text) > 50 * 1024 * 1024) throw new Error('Bản sao lưu vượt 50 MB.');
      return text;
    });
  }
  preview(text: string): BackupSummary {
    if (Buffer.byteLength(text) > 50 * 1024 * 1024) throw new Error('Bản sao lưu vượt 50 MB.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return fail('Tệp JSON bị hỏng.'); }
    const envelope = Envelope.parse(parsed);
    if (digest(envelope.payload) !== envelope.checksum) fail('Checksum không khớp.');
    validateRelations(envelope.payload);
    const token = id(); this.pending = { token, expires: Date.now() + 300_000, payload: envelope.payload };
    return { token, workers: envelope.payload.workers.length, teams: envelope.payload.teams.length, tasks: envelope.payload.tasks.length, reports: envelope.payload.artifacts.length, createdAt: envelope.createdAt };
  }
  restore(token: string) {
    const pending = this.pending;
    if (!pending || pending.token !== token || pending.expires < Date.now()) throw new Error('Phiên khôi phục đã hết hạn. Chọn lại bản sao lưu.');
    if (this.busy()) throw new Error('Chờ hoặc hủy các task/checker đang chạy trước khi khôi phục.');
    const incoming = pending.payload;
    this.store.transaction(() => {
      const current = snapshot(this.store);
      // Older runs derive their original input from their own backup's task.
      // Compare that scope with the later backfill, never with the merged task's source history.
      const comparableSnapshot = (run: Payload['runs'][number], payload: Payload) => {
        const task = payload.tasks.find(task => task.id === run.taskId)!;
        // The browser profile a run used never travels in a backup (COD-261), so it is not part of what must match.
        const { input, inputRevision, browser: _browser, desktop: _desktop, ...rest } = run.snapshot;
        return { ...rest, inputRevision: inputRevision ?? 0, input: RunInput.parse(input ?? { brief: task.brief, sourceIds: task.sourceIds, excludedSources: task.excludedSources }) };
      };
      for (const run of incoming.runs) {
        const existing = current.runs.find(item => item.id === run.id);
        if (existing && (existing.taskId !== run.taskId || digest(comparableSnapshot(existing, current)) !== digest(comparableSnapshot(run, incoming)))) fail('Snapshot của run xung đột.');
      }
      const merge = <T extends { id: string }>(existing: T[], added: T[], immutable = false): T[] => {
        const rows = new Map(added.map(row => [row.id, row]));
        for (const row of existing) { if (immutable && rows.has(row.id) && digest(row) !== digest(rows.get(row.id))) fail('Dữ liệu bất biến xung đột với workspace.'); rows.set(row.id, row); }
        return [...rows.values()];
      };
      const restoredSources = incoming.sources.map(source => ({ ...source, revoked: true }));
      const restoredRoutines = (incoming.routines ?? []).map(routine => ({ ...routine, enabled: false, approvedConfig: '', pending: null, task: { ...routine.task, toolCapabilities: [], browser: undefined, desktop: undefined, consent: false, providerScopes: [] } }));
      const pendingDecisionRuns = new Set(incoming.tasks.flatMap(task => (task.decisionRequests ?? [])
        .filter(request => !request.answer && !request.interruptedAt).map(request => request.runId)));
      const restoredTasks = incoming.tasks.map(task => {
        const decisionRequests = task.decisionRequests?.map(request => pendingDecisionRuns.has(request.runId)
          ? { ...request, interruptedAt: now() } : request);
        const pendingDecision = (task.decisionRequests ?? []).some(request => pendingDecisionRuns.has(request.runId));
        // Like tool permissions, a chat's standing MCP permissions never come back with a backup (COD-241).
        return { ...task, decisionRequests, toolCapabilities: [], mcpGrants: [], browser: undefined, desktop: undefined, consent: false, providerScopes: [],
          status: pendingDecision || ['running', 'queued', 'pausing', 'paused'].includes(task.status) ? 'interrupted' as const : task.status };
      });
      const restoredRuns = incoming.runs.map(run => ({ ...run, snapshot: comparableSnapshot(run, incoming),
        status: pendingDecisionRuns.has(run.id) || ['running', 'queued', 'pausing', 'paused'].includes(run.status) ? 'interrupted' as const : run.status }));
      const mergedTasks = merge(current.tasks, restoredTasks).map(task => {
        const imported = restoredTasks.find(item => item.id === task.id);
        if (!imported || imported === task) return task;
        const reactions = [...(task.messageReactions ?? [])];
        for (const reaction of imported.messageReactions ?? []) {
          if (!reactions.some(item => item.messageId === reaction.messageId && item.actor === reaction.actor
            && item.workerId === reaction.workerId && item.emoji === reaction.emoji)) reactions.push(reaction);
        }
        if (reactions.length > 1000) fail('Cuộc trò chuyện vượt giới hạn tương tác.');
        return { ...task, messageReactions: reactions };
      });
      const merged: Payload = { ...current,
        routines: merge(current.routines ?? [], restoredRoutines),
        workers: merge(current.workers, incoming.workers), skills: merge(current.skills, incoming.skills), teams: merge(current.teams, incoming.teams),
        tasks: mergedTasks, runs: merge(current.runs, restoredRuns), sources: merge(current.sources, restoredSources),
        events: merge(current.events, incoming.events, true), artifacts: merge(current.artifacts, incoming.artifacts, true), profiles: merge(current.profiles, incoming.profiles, true),
        processEvidence: merge(current.processEvidence ?? [], incoming.processEvidence ?? [], true),
        workspaceEvidence: merge(current.workspaceEvidence ?? [], incoming.workspaceEvidence ?? [], true),
        preflights: merge(current.preflights ?? [], incoming.preflights ?? []),
        ledger: merge(current.ledger, incoming.ledger, true), reservations: merge(current.reservations, incoming.reservations),
      };
      // Financial facts cannot be rolled back by importing an older snapshot.
      for (const row of incoming.reservations) {
        const existing = current.reservations.find(item => item.id === row.id);
        if (existing && digest({ ...existing, state: '' }) !== digest({ ...row, state: '' })) fail('Reservation xung đột.');
      }
      for (const row of merged.reservations) row.state = merged.ledger.some(entry => entry.reservation_id === row.id) ? 'settled' : 'unknown';
      const reviews = new Map((incoming.reservationReviews ?? []).map(review => [review.reservation_id, review]));
      for (const review of current.reservationReviews ?? []) {
        const imported = reviews.get(review.reservation_id);
        if (!imported || review.actual_amount !== null) {
          if (imported?.actual_amount !== null && imported && digest(imported) !== digest(review)) fail('Đối soát ngân sách xung đột.');
          reviews.set(review.reservation_id, review);
        }
      }
      for (const reservation of merged.reservations) {
        if (reservation.state === 'unknown' && !reviews.has(reservation.id)) {
          reviews.set(reservation.id, { reservation_id: reservation.id, reason: 'legacy', noted_at: now(), actual_amount: null, verified_source: null, resolved_at: null });
        }
      }
      merged.reservationReviews = [...reviews.values()];
      const revisions = new Map(incoming.revisions.map(row => [`${row.entity_id}:${row.revision}`, row]));
      for (const row of current.revisions) { const key = `${row.entity_id}:${row.revision}`; if (revisions.has(key) && digest(revisions.get(key)) !== digest(row)) fail('Revision xung đột.'); revisions.set(key, row); }
      merged.revisions = [...revisions.values()];
      merged.knowledge = merge(current.knowledge ?? [], incoming.knowledge ?? []);
      const knowledgeRevisions = new Map((incoming.knowledgeRevisions ?? []).map(row => [`${row.id}:${row.revision}`, row]));
      for (const row of current.knowledgeRevisions ?? []) { const key = `${row.id}:${row.revision}`; if (knowledgeRevisions.has(key) && digest(knowledgeRevisions.get(key)) !== digest(row)) fail('Revision knowledge xung đột.'); knowledgeRevisions.set(key, row); }
      merged.knowledgeRevisions = [...knowledgeRevisions.values()];
      validateRelations(merged);
      if ((merged.routines?.length ?? 0) > 100) fail('Tổng số lịch sau khôi phục vượt 100.');
      const connections = mergeCustomConnections(readCustomConnections(this.store), incoming.customConnections ?? []);
      if (connections.length > MAX_CUSTOM_CONNECTIONS) fail(`Tổng số kết nối tùy chỉnh sau khôi phục vượt ${MAX_CUSTOM_CONNECTIONS}.`);
      writeCustomConnections(this.store, connections);
      for (const routine of merged.routines ?? []) this.store.put('routines', routine);
      for (const table of ['skills', 'workers', 'teams', 'tasks'] as const) for (const row of merged[table]) this.store.put(table, row);
      for (const source of merged.sources) {
        const path = this.store.db.prepare('SELECT path FROM sources WHERE id=?').get(source.id)?.path;
        this.store.put('sources', source, { column: 'path', value: typeof path === 'string' ? path : '' });
      }
      for (const run of merged.runs) this.store.put('runs', run, { column: 'task_id', value: run.taskId });
      for (const event of merged.events) this.store.put('events', event, { column: 'run_id', value: event.runId });
      for (const artifact of merged.artifacts) this.store.put('artifacts', artifact, { column: 'run_id', value: artifact.runId });
      for (const profile of merged.profiles) this.store.put('profiles', profile, { column: 'task_id', value: profile.taskId });
      for (const process of merged.processEvidence ?? []) this.store.db.prepare('INSERT OR IGNORE INTO process_evidence(id,run_id,exit_code) VALUES(?,?,?)').run(process.id, process.runId, process.exitCode);
      for (const evidence of merged.workspaceEvidence ?? []) this.store.db.prepare('INSERT OR IGNORE INTO workspace_read_evidence(id,run_id,call_id,data) VALUES(?,?,?,?)')
        .run(evidence.id, evidence.runId, evidence.callId, JSON.stringify(evidence));
      for (const record of merged.preflights ?? []) this.store.put('preflights', record, { column: 'task_id', value: record.taskId });
      for (const row of merged.revisions) this.store.db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?)').run(row.entity_id, row.revision, JSON.stringify(row.data));
      for (const row of merged.reservations) this.store.db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(row.id, row.run_id, row.task_id, row.provider, row.month, row.amount, row.state);
      for (const row of merged.ledger) this.store.db.prepare('INSERT OR IGNORE INTO ledger VALUES(?,?,?,?,?,?)').run(row.id, row.reservation_id, row.amount, row.input_tokens, row.output_tokens, row.pricing_version);
      for (const row of merged.reservationReviews ?? []) this.store.db.prepare(`INSERT INTO reservation_reviews
        (reservation_id,reason,noted_at,actual_amount,verified_source,resolved_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(reservation_id) DO UPDATE SET actual_amount=excluded.actual_amount,
        verified_source=excluded.verified_source,resolved_at=excluded.resolved_at`)
        .run(row.reservation_id, row.reason, row.noted_at, row.actual_amount, row.verified_source, row.resolved_at);
      for (const row of merged.knowledgeRevisions ?? []) this.store.db.prepare('INSERT OR IGNORE INTO knowledge_revisions VALUES(?,?,?)').run(row.id, row.revision, JSON.stringify(row.data));
      const knowledge = new KnowledgeBase(this.store);
      for (const item of merged.knowledge ?? []) { this.store.put('knowledge', item); knowledge.index(item); }
      new ChatSearch(this.store).rebuild();
    });
    this.pending = undefined; this.notify();
  }
}

