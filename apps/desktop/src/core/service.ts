import { WorkspaceRecovery } from './storage/workspace-recovery';
import type { WorkspaceRuntime } from './tools/workspace-runtime';
import { snapshotCapabilities } from '../shared/tool-policy';
import { WorkspaceGrants } from './storage/workspace-grants';
import type { Knowledge } from '../shared/knowledge';
import { commands, type ApiProvider, type Command, type Worker, type Skill, type Task, type Run, type Artifact, type Source, type Team, type TaskInput, type Routine } from '../shared/contracts';
import { Store, id, now } from './storage/database';
import { BudgetLedger } from './budgets/ledger';
import { Checkpoints } from './storage/checkpoints';
import { Sources } from './tools/sources';
import { Runner } from './orchestration/runner';
import type { ModelAdapter } from './adapters/openai';
import { TeamRunner } from './orchestration/team';
import templates from '../../../../templates/catalog.json';
import type { ProfileExecutor, ProfileRecord } from '../shared/profiles';
import { Backups } from './storage/backup';
import { ReviewPolicy } from '../shared/review';
import { Preflight } from './orchestration/preflight';
import { PreflightPolicy, type PreflightRecord } from '../shared/preflight';
import { TeamTemplates } from './storage/templates';
import { Routines } from './orchestration/routines';
import { WorkPolicy } from './orchestration/work-policy';
import { KnowledgeBase } from './context/knowledge';
import type { HarnessRuntime } from './orchestration/runner';
import type { HarnessInfo } from '../shared/harness';
import { detectHarnesses } from './harness/detect';
import { executeHarness } from './harness/exec';
import { fetchUsdRate, RATE_MAX_AGE_MS, type RateFetcher } from './currency';
import { usdCurrency, type CurrencyCode, type CurrencyState } from '../shared/currency';
import { assertSkillReady, inspectPackage, packageForImport, packageForExport } from './skill-package';
import { taskResultStamp } from '../shared/task-seen';
import { fetchProviderList, withCatalogHint, type ModelListRuntime } from './models/fetch';
import { canStoreModelListRow, dropProviderRow, readModelListCache, writeModelListCache } from './models/cache';
import { emptyModelListCache, MODEL_LIST_CACHE_VERSION, MODEL_LIST_TTL_MS, ModelListProvider, type ModelListProvider as ModelListProviderId, type ModelListResult, type ModelListRow } from '../shared/models';
import { mentionedPeople } from '../shared/mentions';
import { MessageInteractions } from './orchestration/message-interactions';

export class CoreService {
  feedbackText(artifactId: string): string {
    const artifact = this.store.get<Artifact>('artifacts', artifactId);
    const text = artifact.report.review?.draftFeedback;
    if (!text) throw new Error('Báo cáo này chưa có feedback nháp.');
    return text;
  }
  readonly sources: Sources;
  readonly workspaceGrants: WorkspaceGrants;
  readonly runner: Runner;
  readonly teams: TeamRunner;
  readonly backups: Backups;
  readonly templates: TeamTemplates;
  readonly routines: Routines;
  readonly policy: WorkPolicy;
  readonly knowledge: KnowledgeBase;
  private harnessCache?: { at: number; value: Promise<HarnessInfo[]> };
  private modelListMemory = emptyModelListCache();
  private modelListLoaded = false;
  private modelListInflight = new Map<ModelListProviderId, Promise<ModelListRow>>();
  private modelListEpoch = new Map<ModelListProviderId, number>();
  private modelListFailed = new Set<ModelListProviderId>();
  constructor(readonly store: Store, private notify: () => void, adapter: (provider: string, model?: string) => Promise<ModelAdapter>, profiler?: ProfileExecutor, private clock: () => Date = () => new Date(), private harness: HarnessRuntime = { detect: () => detectHarnesses(), execute: executeHarness }, private fetchRate: RateFetcher = fetchUsdRate, private modelListRuntime: ModelListRuntime = {}, private workspaceRuntime?: WorkspaceRuntime) {
    this.policy = new WorkPolicy(store, clock);
    this.knowledge = new KnowledgeBase(store);
    this.notify = () => { if (!this.store.db.isOpen) return; this.policy.captureHandoffs(); notify(); };
    this.sources = new Sources(store, profiler);
    this.workspaceGrants = new WorkspaceGrants(store);
    this.runner = new Runner(store, this.sources, this.notify, adapter, task => this.policy.allowed(task), { detect: () => this.harnesses(false), execute: harness.execute }, workspaceRuntime);
    this.teams = new TeamRunner(store, this.runner, this.notify, new Preflight(store, this.sources, this.notify), task => this.policy.allowed(task));
    this.backups = new Backups(store, () => this.routines.isBusy() || this.sources.isChecking() || store.all<Task>('tasks').some(task => this.runner.isActive(task.id) || this.teams.isActive(task.id)), this.notify);
    this.templates = new TeamTemplates(store, this.notify);
    this.routines = new Routines(store, this.sources, this.notify, (input, next) => this.createTask(input, next), clock);
    this.policy.captureHandoffs();
  }
  async grantWorkspace(raw: unknown) {
    const grant = await this.workspaceGrants.grant(raw);
    this.teams.cancel(grant.taskId);
    this.runner.cancel(grant.taskId);
    this.notify();
    return grant;
  }
  async command(command: Command, raw: unknown): Promise<unknown> {
    if (!Object.hasOwn(commands, command)) throw new Error('IPC command không được phép.');
    const args = commands[command].parse(raw);
    switch (command) {
      case 'workspace': {
        const workspace = this.store.workspace();
        const reviewed = this.store.setting<string[]>('reviewedSkills', []);
        workspace.skills = workspace.skills.map(skill => skill.package ? { ...skill, package: { ...skill.package, reviewedHash: reviewed.includes(`${skill.id}:${skill.package.hash}`) ? skill.package.hash : undefined } } : skill);
        return workspace;
      }
      case 'task': {
        const id = (args as { id: string }).id;
        this.markTaskSeen(id);
        return this.store.detail(this.liveTask(id).id);
      }
      case 'reconcileBudget': {
        const input = commands.reconcileBudget.parse(args);
        new BudgetLedger(this.store).reconcile(input.reservationId, input.amountMicros, input.source);
        this.notify();
        return;
      }
      case 'saveWorker': {
        const input = commands.saveWorker.parse(args);
        assertSkillReady(this.store.get<Skill>('skills', input.skillId), this.store);
        if (input.id) this.store.get<Worker>('workers', input.id);
        const { modelId, ...fields } = input;
        const worker: Worker = {
          ...fields,
          id: input.id ?? id(),
          revision: input.id ? this.store.nextRevision(input.id) : 1,
          ...(fields.provider !== 'demo' && modelId ? { modelId } : {}),
        };
        this.store.version('workers', worker); this.notify(); return worker;
      }
      case 'saveSkill': {
        const input = commands.saveSkill.parse(args);
        if (input.id && this.store.get<Skill>('skills', input.id).package) throw new Error('Gói skill giữ nguyên nội dung đã nhập. Sửa thư mục gốc rồi nhập lại để tạo gói mới.');
        const skill: Skill = { ...input, id: input.id ?? id(), revision: input.id ? this.store.nextRevision(input.id) : 1 };
        this.store.version('skills', skill); this.notify(); return skill;
      }
      case 'saveTeam': {
        const input = commands.saveTeam.parse(args);
        for (const workerId of [...input.memberIds, input.synthesizerId]) this.assertAssignable('worker', workerId);
        if (input.id) this.store.get<Team>('teams', input.id);
        const team: Team = { ...input, id: input.id ?? id(), revision: input.id ? this.store.nextRevision(input.id) : 1 };
        this.store.version('teams', team); this.notify(); return team;
      }
      case 'inspectSkill': {
        const skill = this.store.get<Skill>('skills', (args as { id: string }).id);
        if (!skill.package) throw new Error('Skill này không có gói nhập.');
        const { metadata, hash, blockers, files } = inspectPackage(skill.package);
        return { metadata, hash, blockers, files };
      }
      case 'reviewSkill': {
        const input = commands.reviewSkill.parse(args);
        const skill = this.store.get<Skill>('skills', input.id);
        if (!skill.package) throw new Error('Skill này không có gói nhập.');
        const result = inspectPackage(skill.package);
        if (result.hash !== input.hash || result.hash !== skill.package.hash) throw new Error('Gói skill đã thay đổi. Mở lại để review.');
        if (result.blockers.length) throw new Error(result.blockers.join(' '));
        this.store.setSetting('reviewedSkills', [...new Set([...this.store.setting<string[]>('reviewedSkills', []), `${skill.id}:${result.hash}`])]);
        this.notify(); return;
      }
      case 'createTemplate': {
        const input = commands.createTemplate.parse(args);
        const template = templates.find(item => item.id === input.templateId)!;
        const skill: Skill = { id: id(), name: `${template.name} evidence policy`, content: template.instructions, revision: 1 };
        const workers: Worker[] = [...template.members, template.synthesizer].map(role => ({ ...role, id: id(), provider: input.provider, skillId: skill.id, revision: 1 }));
        const team: Team = { id: id(), name: template.name, instructions: template.instructions, memberIds: workers.slice(0, -1).map(w => w.id), synthesizerId: workers.at(-1)!.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000, revision: 1, ...(template.preflight ? { preflight: PreflightPolicy.parse(template.preflight) } : {}), ...(template.reviewPolicy ? { reviewPolicy: ReviewPolicy.parse(template.reviewPolicy) } : {}) };
        this.store.versionMany([{ table: 'skills', value: skill }, ...workers.map(value => ({ table: 'workers' as const, value })), { table: 'teams', value: team }]);
        this.notify(); return team;
      }
      case 'createTask': return this.createTask(commands.createTask.parse(args));
      case 'setMessageReaction': {
        new MessageInteractions(this.store).userReaction(commands.setMessageReaction.parse(args));
        this.notify(); return;
      }
      case 'reviseTask': {
        const input = commands.reviseTask.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        if (input.replyTo) new MessageInteractions(this.store).target(task.id, input.replyTo);
        if (task.pendingStart) throw new Error('Đã lưu tin nhắn mới; chờ lượt trước dừng hẳn.');
        if (this.sources.isChecking()) throw new Error('Đợi checker kết thúc trước khi tạo revision.');
        const active = this.runner.isActive(task.id) || this.teams.isActive(task.id);
        if (!active && ['queued', 'running', 'pausing'].includes(task.status)) throw new Error('Task chưa dừng ở ranh giới an toàn.');
        const prepared = this.prepareTask({ ...input, workerId: task.workerId, ...(task.teamId ? { teamId: task.teamId } : {}), ...(task.assignees ? { assignees: task.assignees } : {}) });
        const sourceIds = [...new Set([...task.sourceIds, ...input.sourceIds])];
        if (sourceIds.length > 1000) throw new Error('Lịch sử task đã đủ 1.000 nguồn. Tạo task mới để tiếp tục.');
        this.policy.assertStart(task.teamId, task.id);
        const revised: Task = { ...task, sourceIds, currentInput: { brief: input.brief, sourceIds: [...new Set(input.sourceIds)], excludedSources: input.excludedSources, replyTo: input.replyTo }, inputRevision: (task.inputRevision ?? 0) + 1, consent: input.consent, providerScopes: input.providerScopes, budgetMicros: input.budgetMicros, teamSnapshot: prepared.teamSnapshot, workerId: prepared.workerId, accepted: false, status: active ? 'pausing' : 'queued', pendingStart: active || undefined, pauseReason: undefined, handoff: undefined,
          decisionRequests: task.decisionRequests?.map(request => request.inputRevision === (task.inputRevision ?? 0) && !request.answer && !request.interruptedAt
            ? { ...request, interruptedAt: now() } : request) };
        this.store.transaction(() => {
          // Preserve readable input for older runs before expanding the task's history scope.
          for (const run of this.store.detail(task.id).runs) if (!run.snapshot.input) this.store.update('runs', { ...run, snapshot: { ...run.snapshot, input: { brief: task.brief, sourceIds: task.sourceIds, excludedSources: task.excludedSources } } });
          this.store.update('tasks', revised);
        });
        if (active) { this.teams.cancel(task.id); this.runner.cancel(task.id); this.notify(); return; }
        this.start(revised, true); return;
      }
      case 'answerDecision': {
        const input = commands.answerDecision.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id)) throw new Error('Đợi lần chạy dừng trước khi trả lời câu hỏi.');
        if (task.status !== 'waiting_input') throw new Error('Lượt này không chờ quyết định.');
        const request = task.decisionRequests?.find(item => item.id === input.requestId);
        if (!request || request.answer || request.interruptedAt || request.inputRevision !== (task.inputRevision ?? 0)) throw new Error('Câu hỏi quyết định không còn hiệu lực.');
        const run = this.store.get<Run>('runs', request.runId);
        if (run.taskId !== task.id || run.status !== 'waiting_input') throw new Error('Lần chạy không còn chờ quyết định.');
        const checkpoints = new Checkpoints(this.store);
        const checkpoint = checkpoints.get(run.id);
        if (!checkpoint || checkpoint.phase !== 'ready') throw new Error('Checkpoint chưa sẵn sàng để tiếp tục.');
        this.policy.assertStart(task.teamId, task.id);
        this.runner.assertResumable(run);
        const answeredAt = now();
        this.store.transaction(() => {
          checkpoints.save({ ...checkpoint, messages: [...checkpoint.messages, { role: 'user', content: JSON.stringify({ decisionRequestId: request.id, answer: input.answer, instruction: 'This is the user\'s decision for the pending question in this turn. It does not grant new workspace or network permissions. Continue only within the tools and grants actually available.' }) }] });
          this.store.update('tasks', { ...task, status: 'paused', decisionRequests: task.decisionRequests!.map(item => item.id === request.id ? { ...item, answer: input.answer, answeredAt } : item) });
          this.store.update('runs', { ...run, status: 'paused' });
        });
        this.notify();
        return this.command('resume', { id: task.id });
      }
      case 'saveRoutine': {
        const input = commands.saveRoutine.parse(args);
        if (input.enabled) this.prepareTask(input.task);
        return this.routines.save(input);
      }
      case 'dismissRoutine': this.routines.dismiss((args as { id: string }).id); return;
      case 'catchUpRoutine': return this.routines.catchUp((args as { id: string }).id);
      case 'cancel': {
        const taskId = (args as { id: string }).id;
        this.teams.cancel(taskId); this.runner.cancel(taskId);
        const task = this.store.get<Task>('tasks', taskId);
        if (task.pendingStart) this.store.update('tasks', { ...task, pendingStart: undefined, status: 'cancelled' });
        this.notify(); return;
      }
      case 'pause': {
        const task = this.store.get<Task>('tasks', (args as { id: string }).id);
        if (!this.runner.isActive(task.id) && !this.teams.isActive(task.id)) throw new Error('Task không đang chạy.');
        this.teams.pause(task.id); this.runner.pause(task.id);
        this.store.update('tasks', { ...task, status: 'pausing' }); this.notify(); return;
      }
      case 'resume': {
        const task = this.store.get<Task>('tasks', (args as { id: string }).id);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id)) throw new Error('Task đang chạy.');
        if (task.pendingStart) {
          if (task.status !== 'interrupted') throw new Error('Yêu cầu mới đang chờ lượt trước dừng.');
          if (this.store.detail(task.id).runs.some(run => (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0))) {
            this.store.update('tasks', { ...task, pendingStart: undefined });
            return this.command('resume', { id: task.id });
          }
          this.prepareTask({ ...task, ...(task.currentInput ?? {}), workerId: task.workerId });
          this.policy.assertStart(task.teamId, task.id);
          this.dispatchPendingRevision(task);
          return;
        }
        if (!['paused', 'interrupted', 'waiting_budget'].includes(task.status)) throw new Error('Task không ở trạng thái có thể tiếp tục.');
        this.policy.assertStart(task.teamId, task.id);
        if (task.teamSnapshot) {
          this.teams.assertResumable(task.id);
          task.pauseReason = undefined; task.handoff = undefined; this.store.update('tasks', task);
          void this.teams.run(task, task.teamSnapshot, true);
        }
        else if (this.groupWorkers(task)) {
          this.teams.assertResumable(task.id);
          task.pauseReason = undefined; task.handoff = undefined; this.store.update('tasks', task);
          void this.teams.chat(task, this.groupTurnWorkers(task)!, true);
        }
        else {
          const run = this.store.detail(task.id).runs.at(-1);
          if (!run) throw new Error('Không có lần chạy để tiếp tục.');
          this.runner.assertResumable(run);
          task.pauseReason = undefined; task.handoff = undefined; this.store.update('tasks', task);
          void this.runner.run(task, run).catch(() => { this.store.status(task.id, run.id, 'interrupted', 'Core không thể hoàn tất ghi trạng thái.'); this.notify(); });
        }
        return;
      }
      case 'retry': {
        const task = this.store.get<Task>('tasks', (args as { id: string }).id);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id)) throw new Error('Task đang chạy.');
        if (task.status === 'completed') throw new Error('Task đã hoàn tất. Tạo task mới để chạy lại.');
        if (task.decisionRequests?.some(request => request.inputRevision === (task.inputRevision ?? 0) && !request.answer && !request.interruptedAt)) throw new Error('Trả lời câu hỏi đang chờ hoặc gửi yêu cầu mới trước khi thử lại.');
        this.start(task); return;
      }
      case 'workspaceRecovery': return new WorkspaceRecovery(this.store).view(commands.workspaceRecovery.parse(args).taskId);
      case 'recoveryFile': {
        if (!this.workspaceRuntime) throw new Error('Workspace runtime chưa được cấu hình.');
        return this.workspaceRuntime.inspectFile(args, taskId => this.runner.isActive(taskId) || this.teams.isActive(taskId));
      }
      case 'recoveryProcessOutput': return new WorkspaceRecovery(this.store).output(args);
      case 'retireWorkspaceAttempt': {
        new WorkspaceRecovery(this.store).retire(args, taskId => this.runner.isActive(taskId) || this.teams.isActive(taskId));
        this.notify();
        return;
      }
      case 'workspaceAccess': return this.workspaceGrants.view(commands.workspaceAccess.parse(args).taskId);
      case 'revokeWorkspace': {
        const { taskId } = commands.revokeWorkspace.parse(args);
        this.workspaceGrants.revoke(taskId);
        this.teams.cancel(taskId);
        this.runner.cancel(taskId);
        this.notify();
        return;
      }
      case 'setToolCapabilities': {
        const input = commands.setToolCapabilities.parse(args);
        const task = this.liveTask(input.taskId);
        const workers = task.teamSnapshot
          ? [...new Set([...task.teamSnapshot.memberIds, task.teamSnapshot.synthesizerId])]
          : task.assignees === 'all' ? this.store.all<Worker>('workers').map(worker => worker.id)
          : task.assignees ?? [task.workerId];
        for (const workerId of workers) snapshotCapabilities(this.store.get<Worker>('workers', workerId).provider, input.capabilities);
        const reduced = this.store.detail(task.id).runs.some(run =>
          (run.snapshot.toolCapabilities ?? snapshotCapabilities(run.snapshot.worker.provider)).some(capability => !input.capabilities.includes(capability)));
        this.store.update('tasks', { ...task, toolCapabilities: input.capabilities });
        if (reduced) {
          this.teams.cancel(task.id);
          this.runner.cancel(task.id);
        }
        this.notify();
        return;
      }
      case 'revoke': {
        const source = this.store.get<Source>('sources', (args as { id: string }).id);
        this.store.update('sources', { ...source, revoked: true }); this.notify(); return;
      }
      case 'previewSource': {
        const input = commands.previewSource.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        const text = await this.sources.read(input.id, task.sourceIds);
        const source = this.store.get<Source>('sources', input.id);
        return { name: source.name, text, hash: source.hash };
      }
      case 'sourceMetadata': return commands.sourceMetadata.parse(args).ids.map(id => this.store.get<Source>('sources', id));
      case 'profileSources': {
        const input = commands.profileSources.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        const result = await this.sources.profile(input.sourceIds, task.sourceIds, input.idColumn, undefined, { taskId: task.id });
        this.notify(); return result;
      }
      case 'auditRunLog': {
        const input = commands.auditRunLog.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        const result = await this.sources.profile([input.sourceId], task.sourceIds, null, undefined, { taskId: task.id }, { direction: input.direction });
        this.notify(); return result;
      }
      case 'scoreExactMatch': {
        const { taskId, ...request } = commands.scoreExactMatch.parse(args);
        const task = this.store.get<Task>('tasks', taskId);
        const result = await this.sources.profile([request.predictionSourceId, request.answerSourceId], task.sourceIds,
          request.idColumn, undefined, { taskId: task.id }, undefined, request);
        this.notify(); return result;
      }
      case 'cancelCheckers': this.sources.cancelChecks((args as { id: string }).id); return;
      case 'accept': {
        const task = this.store.get<Task>('tasks', (args as { id: string }).id);
        if (!['completed', 'partial', 'waiting_input'].includes(task.status)) throw new Error('Chỉ chấp nhận báo cáo đã hoàn tất hoặc có kết quả một phần.');
        const detail = this.store.detail(task.id);
        if (!detail.artifacts.some(artifact => detail.runs.some(run => run.id === artifact.runId && (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0) && (!task.teamSnapshot || run.stage === 'synthesis')))) throw new Error('Chưa có báo cáo tổng hợp để chấp nhận. Xem kết quả từng role và tiếp tục phần còn thiếu.');
        this.store.put('tasks', { ...task, accepted: true, status: task.status === 'waiting_input' ? 'completed' : task.status });
        this.markTaskSeen(task.id);
        this.notify(); return;
      }
      case 'markTaskSeen': {
        const task = this.markTaskSeen(commands.markTaskSeen.parse(args).id);
        this.notify();
        return task;
      }
      case 'acknowledgeEvidence': {
        const input = commands.acknowledgeEvidence.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id)) throw new Error('Đợi lần chạy kết thúc trước khi ghi nhận giới hạn.');
        const request = task.evidenceRequests?.find(request => request.id === input.requestId);
        if (!request || request.state !== 'pending') throw new Error('Yêu cầu bằng chứng không còn chờ xử lý.');
        const artifact = this.store.get<Artifact>('artifacts', request.artifactId);
        this.store.transaction(() => {
          this.store.update('tasks', { ...task, evidenceRequests: task.evidenceRequests!.map(item => item.id === request.id ? { ...item, state: 'acknowledged' } : item) });
          this.store.event(artifact.runId, 'Người dùng đã ghi nhận giới hạn bằng chứng; các mục chưa đánh giá vẫn giữ nguyên.');
        });
        this.notify(); return;
      }
      case 'saveKnowledge': { const item = this.knowledge.save(args); this.notify(); return item; }
      case 'reviewKnowledge': {
        const input = commands.reviewKnowledge.parse(args);
        this.knowledge.review(input.id, input.revision, input.decision); this.notify(); return;
      }
      case 'searchKnowledge': return this.knowledge.search(commands.searchKnowledge.parse(args).query);
      case 'harnesses': return this.harnesses(commands.harnesses.parse(args).refresh);
      case 'modelList': return this.modelList(commands.modelList.parse(args));
      case 'renameTask': {
        const input = commands.renameTask.parse(args);
        this.store.get<Task>('tasks', input.id);
        const titles = { ...this.store.setting<Record<string, string>>('taskTitles', {}) };
        if (input.title) titles[input.id] = input.title; else delete titles[input.id];
        this.store.setSetting('taskTitles', titles); this.notify(); return;
      }
      case 'archiveTask': {
        const input = commands.archiveTask.parse(args);
        const task = this.liveTask(input.id);
        if (input.archived) this.assertIdle(task, 'Công việc đang chạy. Dừng trước khi lưu trữ.');
        const { archivedAt: _archivedAt, ...rest } = task;
        this.store.update('tasks', input.archived ? { ...rest, archivedAt: this.clock().toISOString() } : rest);
        this.notify(); return;
      }
      case 'deleteTask': this.deleteTask(commands.deleteTask.parse(args).id); this.notify(); return;
      case 'archiveEntity': {
        const input = commands.archiveEntity.parse(args);
        if (!this.entity(input.kind, input.id)) throw new Error('Không tìm thấy mục này.');
        if (input.archived) this.assertRemovable(input.kind, input.id);
        this.setEntityState(input.kind, input.id, input.archived ? { archivedAt: this.clock().toISOString() } : {});
        this.notify(); return;
      }
      case 'deleteEntity': {
        const input = commands.deleteEntity.parse(args);
        this.deleteEntity(input.kind, input.id); this.notify(); return;
      }
      case 'updateTask': {
        const input = commands.updateTask.parse(args);
        const task = this.store.get<Task>('tasks', input.id);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id) || ['queued', 'running', 'pausing'].includes(task.status)) throw new Error('Công việc đang chạy. Đợi xong rồi hãy đổi thiết lập.');
        const { assignee } = input;
        const team = assignee.kind === 'team' ? this.store.get<Team>('teams', assignee.teamId) : undefined;
        const workerIds = assignee.kind === 'workers' ? [...new Set(assignee.workerIds)] : undefined;
        for (const workerId of workerIds ?? []) this.assertAssignable('worker', workerId);
        if (team) this.assertAssignable('team', team.id);
        const first = team?.synthesizerId ?? workerIds?.[0] ?? this.store.workspace().workers[0]?.id;
        if (!first) throw new Error('Chưa có Tí nào để giao việc.');
        const { teamId: _teamId, teamSnapshot: _snapshot, assignees: _assignees, ...rest } = task;
        const updated: Task = { ...rest, workerId: first, ...(team ? { teamId: team.id, teamSnapshot: team } : {}), ...(assignee.kind === 'all' ? { assignees: 'all' as const } : workerIds && workerIds.length > 1 ? { assignees: workerIds } : {}), budgetMicros: input.budgetMicros };
        const titles = { ...this.store.setting<Record<string, string>>('taskTitles', {}) };
        if (input.title) titles[task.id] = input.title; else delete titles[task.id];
        this.store.transaction(() => { this.store.update('tasks', updated); this.store.setSetting('taskTitles', titles); });
        this.notify(); return;
      }
      case 'reorder': {
        const input = commands.reorder.parse(args);
        this.store.setSetting('sidebarOrder', { ...this.store.setting<Record<string, string[]>>('sidebarOrder', {}), [input.kind]: input.ids }); this.notify(); return;
      }
      case 'saveAvatarColors': {
        this.store.setSetting('avatarColors', commands.saveAvatarColors.parse(args).colors); this.notify(); return;
      }
      case 'setCurrency': return this.updateCurrency(commands.setCurrency.parse(args).code, true);
      case 'refreshCurrency': return this.updateCurrency(this.store.setting<CurrencyState>('currency', usdCurrency).code, true);
      case 'settings': {
        const input = commands.settings.parse(args);
        this.store.setSetting('theme', input.theme);
        if (input.language) this.store.setSetting('language', input.language);
        if (input.autoTitles !== undefined) this.store.setSetting('autoTitles', input.autoTitles);
        if (input.copyFormat) this.store.setSetting('copyFormat', input.copyFormat);
        if (input.downloadFormat) this.store.setSetting('downloadFormat', input.downloadFormat);
        if (input.confirmOpenTask !== undefined) this.store.setSetting('confirmOpenTask', input.confirmOpenTask);
        if (input.archiveRetentionDays !== undefined) this.store.setSetting('archiveRetentionDays', input.archiveRetentionDays);
        if (input.accentColor !== undefined) this.store.setSetting('accentColor', input.accentColor);
        this.store.setSetting('connectionLimitMicros', input.connectionLimitMicros);
        if (input.providerConcurrency) this.store.setSetting('providerConcurrency', input.providerConcurrency);
        // Standing per-provider permission (plan §12: consent scoped by connection); backups never restore it.
        if (input.providerConsent) this.store.setSetting('providerConsent', input.providerConsent);
        this.notify(); return;
      }
    }
  }
  private currencyRefresh?: Promise<CurrencyState>;
  private currencyAttemptAt = 0;
  /**
   * Fetches the latest USD rate for a display currency. A failed refresh keeps the previous rate for the same code and
   * records the error; switching to a new code only succeeds with a real rate.
   */
  updateCurrency(code: CurrencyCode, strict: boolean): Promise<CurrencyState> {
    this.currencyRefresh ??= (async () => {
      const previous = this.store.setting<CurrencyState>('currency', usdCurrency);
      try {
        const { rate, updatedAt } = await this.fetchRate(code);
        const next: CurrencyState = { code, rate, updatedAt };
        this.store.setSetting('currency', next); this.notify(); return next;
      } catch (error) {
        const message = `Không lấy được tỷ giá ${code}: ${error instanceof Error ? error.message : 'lỗi mạng'}`.slice(0, 300);
        if (previous.code === code) { this.store.setSetting('currency', { ...previous, error: message }); this.notify(); }
        if (strict) throw new Error(message);
        return previous;
      }
    })().finally(() => { this.currencyRefresh = undefined; });
    return this.currencyRefresh;
  }
  /** Probing spawns each CLI, so results are reused for a minute unless the user asks to detect again. */
  harnesses(refresh: boolean): Promise<HarnessInfo[]> {
    if (refresh) for (const id of ['claude-code', 'codex', 'cursor'] as const) this.invalidateModelList(id);
    if (refresh || !this.harnessCache || Date.now() - this.harnessCache.at > 60_000) {
      const value = this.harness.detect().catch(() => [] as HarnessInfo[]);
      this.harnessCache = { at: Date.now(), value };
    }
    return this.harnessCache.value;
  }
  /**
   * Native or alias model list for one connection. Returns the last cache immediately when present;
   * refreshes in the background when older than 24h. A typed custom ID is always valid (`customIdOk`).
   */
  async modelList(input: { provider: string; refresh?: boolean }): Promise<ModelListResult> {
    if (input.provider === 'demo') {
      return { models: [], fetchedAt: this.clock().toISOString(), stale: false, customIdOk: true, source: 'catalog-hint' };
    }
    const provider = ModelListProvider.parse(input.provider);
    this.hydrateModelLists();
    const row = this.modelListMemory.byProvider[provider];
    const stale = !row || this.clock().getTime() - new Date(row.fetchedAt).getTime() > MODEL_LIST_TTL_MS;
    if (row && !input.refresh) {
      if (stale && !this.modelListFailed.has(provider)) this.scheduleModelListRefresh(provider);
      return this.toModelListResult(row, stale);
    }
    return this.toModelListResult(await this.refreshModelList(provider), false);
  }
  /** Drop one provider's cached list (API key change, harness Dò lại, or cache-shape bump). */
  invalidateModelList(provider: ApiProvider | ModelListProviderId) {
  const parsed = ModelListProvider.safeParse(provider);
  if (!parsed.success) return;
  const id = parsed.data;
    this.hydrateModelLists();
    this.modelListEpoch.set(id, (this.modelListEpoch.get(id) ?? 0) + 1);
    this.modelListFailed.delete(id);
    this.modelListMemory = dropProviderRow(this.modelListMemory, id);
    writeModelListCache(this.store, this.modelListMemory);
  }
  /** Tests wait for a stale-while-revalidate fetch to finish. */
  waitForModelListRefresh(provider?: ModelListProviderId) {
    if (provider) return this.modelListInflight.get(provider) ?? Promise.resolve();
    return Promise.all(this.modelListInflight.values());
  }
  private hydrateModelLists() {
    if (this.modelListLoaded) return;
    this.modelListMemory = readModelListCache(this.store);
    this.modelListLoaded = true;
  }
  private toModelListResult(row: ModelListRow, stale: boolean): ModelListResult {
    return { models: row.models, fetchedAt: row.fetchedAt, stale, customIdOk: true, source: row.source, ...(row.error ? { error: row.error } : {}) };
  }
  private scheduleModelListRefresh(provider: ModelListProviderId) {
    void this.refreshModelList(provider).then(() => this.notify()).catch(() => {});
  }
  private refreshModelList(provider: ModelListProviderId): Promise<ModelListRow> {
    const existing = this.modelListInflight.get(provider);
    if (existing) return existing;
    const epoch = this.modelListEpoch.get(provider) ?? 0;
    const previous = this.modelListMemory.byProvider[provider];
    const work = fetchProviderList(provider, this.modelListFetchOptions()).then(row => {
      if ((this.modelListEpoch.get(provider) ?? 0) !== epoch) return previous ?? row;
      this.modelListFailed.delete(provider);
      this.writeModelListRow(provider, row);
      return this.modelListMemory.byProvider[provider] ?? row;
    }).catch(error => {
      this.modelListFailed.add(provider);
      if (previous) return { ...previous, error: error instanceof Error ? error.message.slice(0, 500) : previous.error };
      const message = error instanceof Error ? error.message.slice(0, 500) : `Không tải được danh sách model (${0}). Vẫn có thể gõ ID tùy chỉnh.`;
      const row: ModelListRow = { fetchedAt: this.clock().toISOString(), ...withCatalogHint(provider, [], 'native', message) };
      this.writeModelListRow(provider, row);
      return this.modelListMemory.byProvider[provider] ?? row;
    }).finally(() => {
      if (this.modelListInflight.get(provider) === work) this.modelListInflight.delete(provider);
    });
    this.modelListInflight.set(provider, work);
    return work;
  }
  private writeModelListRow(provider: ModelListProviderId, row: ModelListRow) {
    if (!canStoreModelListRow(row)) {
      const previous = this.modelListMemory.byProvider[provider];
      if (previous) return;
      const compact: ModelListRow = { fetchedAt: row.fetchedAt, source: 'catalog-hint', models: row.models.slice(0, 1), ...(row.error ? { error: row.error } : {}) };
      if (!canStoreModelListRow(compact)) return;
      this.modelListMemory = { version: MODEL_LIST_CACHE_VERSION, byProvider: { ...this.modelListMemory.byProvider, [provider]: compact } };
      writeModelListCache(this.store, this.modelListMemory);
      return;
    }
    this.modelListMemory = { version: MODEL_LIST_CACHE_VERSION, byProvider: { ...this.modelListMemory.byProvider, [provider]: row } };
    writeModelListCache(this.store, this.modelListMemory);
  }
  private modelListFetchOptions() {
    return {
      readKey: this.modelListRuntime.readKey ?? (async () => null),
      fetch: this.modelListRuntime.fetch,
      endpoints: this.modelListRuntime.endpoints,
      probe: this.modelListRuntime.probe,
      timeoutMs: this.modelListRuntime.timeoutMs,
      harnesses: () => this.harnesses(false),
      now: this.clock,
    };
  }
  /** A worker or team that is neither archived nor deleted, or undefined. */
  private entity(kind: 'worker' | 'team', entityId: string) {
    const state = this.store.entityState()[`${kind}s`][entityId];
    const row = this.store.get<Worker | Team>(`${kind}s`, entityId);
    return state?.deletedAt ? undefined : { row, archived: Boolean(state?.archivedAt) };
  }
  private setEntityState(kind: 'worker' | 'team', entityId: string, next: { archivedAt?: string; deletedAt?: string }) {
    const state = this.store.entityState();
    const group = { ...state[`${kind}s`] };
    if (next.archivedAt || next.deletedAt) group[entityId] = next; else delete group[entityId];
    this.store.setSetting('entityState', { ...state, [`${kind}s`]: group });
  }
  /** Refuses to archive or delete a worker or team that something still depends on, naming what to change first. */
  private assertRemovable(kind: 'worker' | 'team', entityId: string) {
    const found = this.entity(kind, entityId);
    if (!found) throw new Error('Không tìm thấy mục này.');
    const workspace = this.store.workspace();
    const name = found.row.name;
    if (kind === 'worker') {
      if (!found.archived && workspace.workers.length <= 1) throw new Error('Cần giữ ít nhất một Tí.');
      const team = workspace.teams.find(item => [...item.memberIds, item.synthesizerId].includes(entityId));
      if (team) throw new Error(`Bỏ ${name} khỏi hội ${team.name} trước.`);
    }
    const uses = (task: { workerId: string; teamId?: string; assignees?: 'all' | string[] }) => kind === 'team' ? task.teamId === entityId : !task.teamId && (task.workerId === entityId || (Array.isArray(task.assignees) && task.assignees.includes(entityId)));
    const routine = workspace.routines.find(item => item.enabled && uses(item.task));
    if (routine) throw new Error(`Tắt hoặc đổi lịch chạy ${routine.name} trước.`);
    if (this.store.all<Task>('tasks').some(task => !task.deletedAt && ['queued', 'running', 'pausing'].includes(task.status) && (uses(task) || (kind === 'worker' && task.assignees === 'all')))) throw new Error('Đợi công việc đang chạy xong rồi thử lại.');
  }
  private deleteEntity(kind: 'worker' | 'team', entityId: string) {
    this.assertRemovable(kind, entityId);
    this.setEntityState(kind, entityId, { deletedAt: this.clock().toISOString() });
  }
  /** Workers and teams chosen for new work must be active. */
  private assertAssignable(kind: 'worker' | 'team', entityId: string) {
    const found = this.entity(kind, entityId);
    if (!found || found.archived) throw new Error(`${found?.row.name ?? (kind === 'worker' ? 'Tí' : 'Hội')} đã được lưu trữ hoặc xóa. Đổi người nhận trong Thiết lập công việc.`);
  }
  private liveTask(taskId: string) {
    const task = this.store.get<Task>('tasks', taskId);
    if (task.deletedAt) throw new Error('Không tìm thấy mục này.');
    return task;
  }
  /** Record that the user opened this task's current result; unread returns when the stamp changes. */
  private markTaskSeen(taskId: string) {
    const detail = this.store.detail(this.liveTask(taskId).id);
    const latest = [...detail.artifacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    const lastArtifactId = latest?.id ?? detail.task.lastArtifactId;
    const task = lastArtifactId && detail.task.lastArtifactId !== lastArtifactId
      ? this.store.patchTask(taskId, { lastArtifactId })
      : detail.task;
    const stamp = taskResultStamp(task);
    if (task.seenStamp === stamp) return task;
    return this.store.patchTask(taskId, { seenStamp: stamp, seenAt: now(), ...(lastArtifactId ? { lastArtifactId } : {}) });
  }
  private assertIdle(task: Task, message: string) {
    if (this.runner.isActive(task.id) || this.teams.isActive(task.id) || ['queued', 'running', 'pausing'].includes(task.status)) throw new Error(message);
  }
  /**
   * Deletes a task's chat: messages, answers, activity, checkpoints, checker results and its name. A task that already
   * cost money keeps an empty record of its runs so the cost ledger, monthly limits and backups stay correct. Knowledge
   * proposed from it and not yet approved is deleted; approved knowledge keeps the answers it was learned from.
   */
  private deleteTask(taskId: string) {
    const task = this.liveTask(taskId);
    this.assertIdle(task, 'Công việc đang chạy. Dừng trước khi xóa.');
    const db = this.store.db;
    const runs = this.store.detail(task.id).runs;
    const charged = Number(db.prepare('SELECT COUNT(*) AS count FROM reservations WHERE task_id=?').get(task.id)!.count) > 0;
    const learned = this.store.all<Knowledge>('knowledge').filter(item => item.provenance.kind === 'run' && item.provenance.taskId === task.id);
    const proposed = learned.filter(item => item.status === 'proposed');
    const keptIds = learned.filter(item => item.status !== 'proposed').map(item => item.id);
    const origins = keptIds.flatMap(itemId => db.prepare('SELECT data FROM knowledge_revisions WHERE id=?').all(itemId).map(row => (JSON.parse(String(row.data)) as Knowledge).provenance));
    const keepArtifacts = new Set(origins.flatMap(origin => origin.kind === 'run' ? [origin.artifactId] : []));
    const tombstone = charged || keepArtifacts.size > 0;
    const removed = '(đã xóa)';
    this.store.transaction(() => {
      for (const run of runs) {
        db.prepare('DELETE FROM events WHERE run_id=?').run(run.id);
        db.prepare('DELETE FROM artifacts WHERE run_id=? AND id NOT IN (SELECT value FROM json_each(?))').run(run.id, JSON.stringify([...keepArtifacts]));
        db.prepare('DELETE FROM checkpoints WHERE id=?').run(run.id);
        db.prepare('DELETE FROM tool_calls WHERE run_id=?').run(run.id);
        db.prepare('DELETE FROM workspace_copies WHERE run_id=?').run(run.id);
        db.prepare('DELETE FROM workspace_processes WHERE run_id=?').run(run.id);
        db.prepare('DELETE FROM settings WHERE id=?').run(`workspace-retired:${run.id}`);
        db.prepare('DELETE FROM leases WHERE run_id=?').run(run.id);
      }
      db.prepare('DELETE FROM profiles WHERE task_id=?').run(task.id);
      db.prepare('DELETE FROM preflights WHERE task_id=?').run(task.id);
      db.prepare('DELETE FROM task_search WHERE id=?').run(task.id);
      db.prepare('DELETE FROM workspace_grants WHERE task_id=?').run(task.id);
      for (const item of proposed) for (const table of ['knowledge', 'knowledge_revisions', 'knowledge_search']) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(item.id);
      if (tombstone) {
        for (const run of runs) this.store.update('runs', { ...run, snapshot: { ...run.snapshot,
          ...(run.snapshot.input ? { input: { ...run.snapshot.input, brief: removed, replyTo: undefined } } : {}),
          context: undefined, preflightId: undefined, upstreamArtifactIds: undefined } });
        const { currentInput: _input, messageReactions: _reactions, handoff: _handoff, evidenceRequests: _requests, archivedAt: _archived, ...rest } = task;
        this.store.update('tasks', { ...rest, brief: removed, deletedAt: this.clock().toISOString() });
      } else {
        for (const run of runs) db.prepare('DELETE FROM step_attempts WHERE run_id=?').run(run.id);
        db.prepare('DELETE FROM runs WHERE task_id=?').run(task.id);
        db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
      }
      const titles = { ...this.store.setting<Record<string, string>>('taskTitles', {}) };
      if (titles[task.id]) { delete titles[task.id]; this.store.setSetting('taskTitles', titles); }
      for (const routine of this.store.all<Routine>('routines')) if (routine.lastTaskId === task.id) { const { lastTaskId: _last, ...kept } = routine; this.store.update('routines', kept); }
    });
  }
  /** Workers of a group chat in sidebar order, or undefined when one worker (or a team) handles the task. */
  private groupWorkers(task: Pick<Task, 'assignees'>) {
    if (!task.assignees) return undefined;
    const workers = this.store.workspace().workers.filter(worker => task.assignees === 'all' || task.assignees!.includes(worker.id));
    return task.assignees === 'all' || workers.length > 1 ? workers : undefined;
  }
  /** Assignees who should answer this group-chat turn: @tagged workers, or the whole group when nobody was tagged. */
  private groupTurnWorkers(task: Task) {
    const group = this.groupWorkers(task);
    if (!group) return undefined;
    const brief = (task.currentInput ?? task).brief;
    return mentionedPeople(brief, group) ?? group;
  }
  private prepareTask(input: TaskInput): Task {
    if (input.teamId) this.assertAssignable('team', input.teamId);
    const team = input.teamId ? this.store.get<Team>('teams', input.teamId) : undefined;
    if (!input.assignees) for (const workerId of team ? [...team.memberIds, team.synthesizerId] : [input.workerId]) this.assertAssignable('worker', workerId);
    const worker = this.store.get<Worker>('workers', team?.synthesizerId ?? input.workerId);
    const allWorkers = team ? [...team.memberIds, team.synthesizerId].map(workerId => this.store.get<Worker>('workers', workerId)) : this.groupWorkers({ assignees: input.assignees }) ?? [worker];
    for (const item of allWorkers) assertSkillReady(this.store.get<Skill>('skills', item.skillId), this.store);
    const scopes = input.providerScopes ?? (input.consent ? ['openai'] : []);
    if (allWorkers.some(item => item.provider !== 'demo' && (!input.consent || !scopes.includes(item.provider)))) throw new Error('Cần cho phép gửi brief và nguồn đã chọn đến từng provider của task.');
    for (const sourceId of input.sourceIds) if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Nguồn đã bị thu hồi quyền đọc.');
    const task: Task = { ...input, workerId: worker.id, ...(team ? { teamSnapshot: team } : {}), sourceIds: [...new Set(input.sourceIds)], id: id(), status: 'queued', createdAt: now(), accepted: false };
    return task;
  }
  private createTask(input: TaskInput, routine?: Routine): string {
    const task = this.prepareTask(input);
    const workerIds = task.teamSnapshot ? [...task.teamSnapshot.memberIds, task.teamSnapshot.synthesizerId] : task.assignees === 'all' ? this.store.all<Worker>('workers').map(worker => worker.id) : task.assignees ?? [task.workerId];
    for (const workerId of workerIds) snapshotCapabilities(this.store.get<Worker>('workers', workerId).provider, task.toolCapabilities);
    this.policy.assertStart(task.teamId);
    if (routine) task.routineId = routine.id;
    this.store.transaction(() => {
      this.store.put('tasks', task);
      this.store.db.prepare('INSERT INTO task_search VALUES(?,?)').run(task.id, task.brief);
      if (routine) this.store.update('routines', { ...routine, lastTaskId: task.id });
    });
    this.start(task, true); return task.id;
  }
  importSkill(raw: unknown): Skill {
    const skill: Skill = { ...packageForImport(raw), id: id(), revision: 1 };
    this.store.version('skills', skill); this.notify(); return skill;
  }
  exportSkill(skillId: string) {
    const skill = this.store.get<Skill>('skills', skillId);
    return packageForExport(skill);
  }
  async tick() {
    for (const task of this.store.all<Task>('tasks')) {
      if (!task.pendingStart || task.status === 'interrupted' || this.runner.isActive(task.id) || this.teams.isActive(task.id)) continue;
      const previous = this.store.detail(task.id).runs.filter(run => (run.snapshot.inputRevision ?? 0) < (task.inputRevision ?? 0));
      if (previous.some(run => ['running', 'queued', 'pausing'].includes(run.status))) continue;
      try {
        this.prepareTask({ ...task, ...(task.currentInput ?? {}), workerId: task.workerId });
        this.policy.assertStart(task.teamId, task.id);
        this.dispatchPendingRevision(task);
      } catch (error) {
        this.store.update('tasks', { ...this.store.get<Task>('tasks', task.id), status: 'interrupted' });
        const lastRun = previous.at(-1);
        if (lastRun) this.store.event(lastRun.id, error instanceof Error ? error.message : 'Không thể bắt đầu yêu cầu mới.');
        this.notify();
      }
    }
    let changed = false;
    // Archived tasks past the retention period are deleted; a task that cannot be deleted right now is tried again later.
    const retention = this.store.setting<number>('archiveRetentionDays', 30);
    if (retention) for (const kind of ['worker', 'team'] as const) for (const [entityId, state] of Object.entries(this.store.entityState()[`${kind}s`])) {
      if (!state.archivedAt || state.deletedAt || this.clock().getTime() - new Date(state.archivedAt).getTime() < retention * 86_400_000) continue;
      try { this.deleteEntity(kind, entityId); changed = true; } catch { /* still in use: retry on a later tick */ }
    }
    if (retention) for (const task of this.store.all<Task>('tasks')) {
      if (!task.archivedAt || task.deletedAt || this.clock().getTime() - new Date(task.archivedAt).getTime() < retention * 86_400_000) continue;
      try { this.deleteTask(task.id); changed = true; } catch { /* running or busy: retry on a later tick */ }
    }
    for (const task of this.store.all<Task>('tasks')) {
      if ((this.runner.isActive(task.id) || this.teams.isActive(task.id)) && task.status !== 'pausing' && !this.policy.allowed(task)) {
        this.teams.pause(task.id); this.runner.pause(task.id);
        this.store.update('tasks', { ...this.store.get<Task>('tasks', task.id), status: 'pausing' }); changed = true;
      }
    }
    if (changed) this.notify();
    const currency = this.store.setting<CurrencyState>('currency', usdCurrency);
    // Background refresh retries at most every 10 minutes so an offline machine does not poll every tick.
    if (currency.code !== 'USD' && !this.currencyRefresh && Date.now() - this.currencyAttemptAt > 600_000 && (!currency.updatedAt || this.clock().getTime() - new Date(currency.updatedAt).getTime() > RATE_MAX_AGE_MS)) { this.currencyAttemptAt = Date.now(); void this.updateCurrency(currency.code, false); }
    await this.routines.tick();
  }
  private start(task: Task, startChecked = false) {
    if (!startChecked) this.policy.assertStart(task.teamId, task.id);
    task = { ...task, pauseReason: undefined, handoff: undefined };
    this.store.update('tasks', task);
    if (task.teamSnapshot) { void this.teams.run(task, task.teamSnapshot); return; }
    const group = this.groupTurnWorkers(task);
    if (group) { void this.teams.chat(task, group); return; }
    const worker = this.store.get<Worker>('workers', task.workerId);
    const skill = this.store.get<Skill>('skills', worker.skillId);
    const run: Run = { id: id(), taskId: task.id, status: 'queued', snapshot: { workspaceGrant: this.workspaceGrants.snapshot(task.id), toolCapabilities: snapshotCapabilities(worker.provider, task.toolCapabilities), worker, skill, inputRevision: task.inputRevision ?? 0, input: task.currentInput ?? { brief: task.brief, sourceIds: [...task.sourceIds], excludedSources: task.excludedSources } }, startedAt: now(), error: null };
    this.store.put('runs', run, { column: 'task_id', value: task.id });
    // Runner records terminal failures itself; never launch an unobserved provider promise.
    void this.runner.run(task, run).catch(() => {
      this.store.status(task.id, run.id, 'interrupted', 'Core không thể hoàn tất ghi trạng thái.'); this.notify();
    });
  }
  private dispatchPendingRevision(task: Task) {
    if (!task.pendingStart) return;
    const currentRuns = this.store.detail(task.id).runs.filter(run => (run.snapshot.inputRevision ?? 0) === (task.inputRevision ?? 0));
    if (currentRuns.length) {
      this.store.update('tasks', { ...task, pendingStart: undefined });
      this.notify();
      return;
    }
    this.start({ ...task, status: 'queued' }, true);
    const started = this.store.get<Task>('tasks', task.id);
    this.store.update('tasks', { ...started, pendingStart: undefined });
    this.notify();
  }
  exportMarkdown(artifactId: string): string {
    const artifact = this.store.get<Artifact>('artifacts', artifactId);
    const run = this.store.get<Run>('runs', artifact.runId);
    const task = this.store.get<Task>('tasks', run.taskId);
    const report = artifact.report;
    // A chat answer exports as the message itself.
    if (report.format === 'chat') return [report.summary,
      ...(report.limitations.length ? ['## Limitations', ...report.limitations.map(limitation => `- ${limitation}`)] : [])].join('\n\n');
    const findings = report.findings.map(finding => [
      `## ${finding.title}`, `${finding.severity} — ${finding.detail}`, `Coverage: ${finding.coverage}`,
      finding.category ? `Category: ${finding.category}` : '',
      finding.recommendation ? `Recommendation: ${finding.recommendation}` : '',
      `Sources: ${finding.sourceIds.join(', ')}`,
      finding.locations?.length ? `Lines: ${finding.locations.map(location => `${location.sourceId}:${location.startLine}-${location.endLine}`).join(', ')}` : '',
      finding.checkerIds?.length ? `Checkers: ${finding.checkerIds.map(id => `[${id}](#checker-${id})`).join(', ')}` : '',
      finding.provenance ? `Finding: ${finding.provenance.findingId}\nWriter: ${finding.provenance.writerId}\nRun: ${finding.provenance.runId}` : '',
    ].filter(Boolean).join('\n\n'));
    const preflight = run.snapshot.preflightId ? this.store.get<PreflightRecord>('preflights', run.snapshot.preflightId) : undefined;
    const profiles = this.store.all<ProfileRecord>('profiles').filter(profile => profile.runId === run.id || preflight?.profileIds.includes(profile.id));
    const checks = profiles.length ? ['## Trusted checker results', 'These describe the checks performed, not approval of the dataset, scoring or challenge.', ...profiles.map(profile => `### Checker ${profile.id}\n\n\`\`\`json\n${JSON.stringify({ sourceHashes: profile.sourceHashes, ...profile.result }, null, 2)}\n\`\`\``)] : [];
    const review = report.review ? ['## Review recommendation', report.review.recommendation, '## Check coverage', ...report.review.checks.map(check => `### ${check.name}: ${check.status}\n\n${check.coverage}\n\nSources: ${check.sourceIds.join(', ')}\nCheckers: ${check.checkerIds.map(id => `[${id}](#checker-${id})`).join(', ')}`), '## Unresolved disagreements', ...report.review.conflicts.map(conflict => `${conflict.reason}\n\nFindings: ${conflict.findingIds.join(', ')}`), '## Draft feedback', report.review.draftFeedback, `Upstream findings: ${report.review.upstreamFindingIds.join(', ')}`] : [];
    return [`# ${report.title}`, report.summary, ...review, ...findings, '## Limitations', ...report.limitations.map(l => `- ${l}`), '## Sources', ...(run.snapshot.input?.sourceIds ?? task.sourceIds).map(sourceId => { const s = this.store.get<Source>('sources', sourceId); return `- ${s.id}: ${s.name} (SHA-256 ${s.hash})`; }), ...checks, `Run: ${run.id}\nWorker revision: ${run.snapshot.worker.revision}\nSkill revision: ${run.snapshot.skill.revision}\nProvider: ${run.snapshot.worker.provider}\nArtifact SHA-256: ${artifact.hash}`].join('\n\n');
  }
}
