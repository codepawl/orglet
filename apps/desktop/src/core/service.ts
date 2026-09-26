import { WorkspaceRecovery } from './storage/workspace-recovery';
import type { WorkspaceRuntime } from './tools/workspace-runtime';
import { snapshotCapabilities, type ToolCapability } from '../shared/tool-policy';
import { liveTeamTask, liveWorkerTask, newChatKey, newChatKeyNames } from '../shared/live-task';
import { withoutSourceIds } from '../shared/source-mentions';
import { WorkspaceGrants, replacesGrant, type PendingWorkspace, type ResolvedDirectory } from './storage/workspace-grants';
import { GrantWorkspace, type NewChatTarget } from '../shared/workspace-access';
import type { Knowledge } from '../shared/knowledge';
import { z } from 'zod';
import { commands, Id, type CredentialProvider, type Command, type Worker, type Skill, type Task, type Run, type Artifact, type Source, type Team, type TaskInput, type Routine } from '../shared/contracts';
import { Store, id, now } from './storage/database';
import { BudgetLedger } from './budgets/ledger';
import { Checkpoints } from './storage/checkpoints';
import { Sources } from './tools/sources';
import type { PdfTextExtractor } from './tools/pdf-text';
import { Runner } from './orchestration/runner';
import type { ModelAdapter } from './adapters/openai';
import { TeamRunner } from './orchestration/team';
import templates from '../../../../templates/catalog.json';
import type { ProfileExecutor, ProfileRecord } from '../shared/profiles';
import { Backups } from './storage/backup';
import { ChatSearch } from './storage/chat-search';
import { ReviewPolicy } from '../shared/review';
import { Preflight } from './orchestration/preflight';
import { PreflightPolicy, type PreflightRecord } from '../shared/preflight';
import { TeamTemplates } from './storage/templates';
import { Routines, SCHEDULE_NEVER_ACTS, SCHEDULE_NO_DESKTOP } from './orchestration/routines';
import { FolderTriggers } from './orchestration/folder-triggers';
import { RoutineFolders } from './storage/routine-folders';
import type { WatchFolderView } from '../shared/routine-triggers';
import { WorkPolicy } from './orchestration/work-policy';
import { runningView } from './orchestration/running';
import type { RunningItem } from '../shared/running';
import { KnowledgeBase } from './context/knowledge';
import type { HarnessRuntime } from './orchestration/runner';
import { harnessCatalog, SYSTEM_ACCOUNT_ID, type HarnessAccountUsage, type HarnessCatalogId, type HarnessInfo, type HarnessUsage } from '../shared/harness';
import { detectHarnesses, probe } from './harness/detect';
import { readHarnessUsage } from './harness/usage';
import { HarnessAccounts } from './harness/accounts';
import { executeHarness } from './harness/exec';
import { eraseEverything, eraseKnowledge, eraseMemory, eraseSources } from './storage/erase';
import { ERASE_CONFIRMATION, type EraseScope, type EraseSummary } from '../shared/erase';
import { fetchUsdRate, RATE_MAX_AGE_MS, type RateFetcher } from './currency';
import { usdCurrency, type CurrencyCode, type CurrencyState } from '../shared/currency';
import { assertSkillReady, inspectPackage, packageForImport, packageForExport } from './skill-package';
import { taskResultStamp } from '../shared/task-seen';
import { fetchProviderList, withCatalogHint, type ModelListRuntime } from './models/fetch';
import { canStoreModelListRow, dropProviderRow, readModelListCache, writeModelListCache } from './models/cache';
import { emptyModelListCache, MODEL_LIST_CACHE_VERSION, MODEL_LIST_TTL_MS, ModelListProvider, type ModelListProvider as ModelListProviderId, type ModelListResult, type ModelListRow } from '../shared/models';
import { mentionedPeople, parseMentions } from '../shared/mentions';
import { assertOpenCodeModel, isOpenCodePlan } from '../shared/opencode';
import { MessageInteractions, type MessageTarget } from './orchestration/message-interactions';
import { AppProposals, type CurrentSettings, type ProposalApplier } from './orchestration/app-proposals';
import { SideThreads } from './orchestration/side-threads';
import { Forwards, type ForwardSource } from './orchestration/forwards';
import { ForwardedMessage, ForwardMessageArgs, forwardBrief, forwardText, ownWords, type ForwardResult, type ForwardTarget } from '../shared/forward';
import type { Args } from '../shared/contracts';
import { customProviderId, findCustomConnection, isCustomProvider } from '../shared/custom-connections';
import { deleteCustomConnection, readCustomConnections, requireCustomConnection, saveCustomConnection } from './storage/custom-connections';
import { McpServers, type McpRuntime } from './tools/mcp';
import { grantsAfterApproval, McpApprovalChoice, McpGrant } from '../shared/mcp';
import type { WebSearchRuntime, WebSearchSettings } from './tools/web-search';
import { WebTools } from './tools/web-tools';
import { webNetwork } from './tools/web-network';
import { WEB_SEARCH_TEST_QUERY, type WebSearchTest } from '../shared/web-tools';
import { BrowserTools } from './tools/browser-tools';
import { DesktopTools } from './tools/desktop-tools';
import type { DesktopHost } from '../shared/desktop-host';
import { neverDesktopProgram } from '../shared/desktop';
import type { BrowserHost } from '../shared/browser-host';

/**
 * The harness runtime a real Orglet runs on. `accountRoot` is the folder holding one subfolder per harness
 * account; without it only the system account exists, which is what the tests want.
 */
export const localHarnessRuntime = (accountRoot?: string): HarnessRuntime => ({
  detect: (accounts, only) => detectHarnesses(process.env, process.platform, probe, accounts, only),
  execute: executeHarness,
  usage: (harness, executable, configDir) => readHarnessUsage(harness, executable, configDir),
  ...(accountRoot ? { accountRoot } : {}),
});

/** The Limit per task of a chat whose orglet or crew never set one, as the composer and the terminal command use. */
const DEFAULT_TASK_BUDGET_MICROS = 500_000;

/** A folder waiting for a chat's first message, checked again at that moment (COD-186). */
type NewChatFolder = { pending: PendingWorkspace; resolved: ResolvedDirectory; failure?: undefined } | { pending: PendingWorkspace; resolved?: undefined; failure: string };

/** The empty chat a command names: one worker, a team, or the orglets of a group chat that has not started (COD-215). */
function newChatTargetOf(input: { workerId: string } | { teamId: string } | { workerIds: string[] }): NewChatTarget {
  if ('teamId' in input) return { teamId: input.teamId };
  if ('workerIds' in input) return { workerIds: input.workerIds };
  return { workerId: input.workerId };
}

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
  /** Folders routines watch, granted through main's picker (COD-245). */
  readonly routineFolders: RoutineFolders;
  /** "When a file arrives" routines; they watch only while the app is open. */
  readonly folderTriggers: FolderTriggers;
  readonly policy: WorkPolicy;
  readonly knowledge: KnowledgeBase;
  /** App changes workers propose in chats, applied through this service's own commands (COD-199). */
  readonly appProposals: AppProposals;
  /** MCP servers the person added and the connections to them (COD-241). */
  readonly mcp: McpServers;
  /** Side threads of orglets' main chats and how their permissions follow the main chat (COD-247). */
  readonly sideThreads: SideThreads;
  /** Reads the message a forward carries out of saved history (COD-257). */
  readonly forwards: Forwards;
  /** Search across every message, answer and name (COD-267). */
  readonly chatSearch: ChatSearch;
  /** The core side of Orglet's browser: site rules, the journal and screenshots (COD-261). */
  readonly browser: BrowserTools;
  /** The core side of desktop apps: granted programs, the journal and window pictures (COD-261, phase 2a). */
  readonly desktop: DesktopTools;
  private harnessCache?: { at: number; value: Promise<HarnessInfo[]> };
  private harnessUsageCache?: { at: number; value: Promise<HarnessUsage> };
  readonly harnessAccounts: HarnessAccounts;
  private modelListMemory = emptyModelListCache();
  private modelListLoaded = false;
  private modelListInflight = new Map<ModelListProviderId, Promise<ModelListRow>>();
  private modelListEpoch = new Map<ModelListProviderId, number>();
  private modelListFailed = new Set<ModelListProviderId>();
  constructor(readonly store: Store, private notify: () => void, adapter: (provider: string, model?: string) => Promise<ModelAdapter>, profiler?: ProfileExecutor, private clock: () => Date = () => new Date(), private harness: HarnessRuntime = localHarnessRuntime(), private fetchRate: RateFetcher = fetchUsdRate, private modelListRuntime: ModelListRuntime = {}, private workspaceRuntime?: WorkspaceRuntime, mcpRuntime: McpRuntime = {}, pdfText?: PdfTextExtractor, private webSearchRuntime: WebSearchRuntime = {}, browserHost?: BrowserHost, desktopHost?: DesktopHost, private ownPrograms: readonly string[] = []) {
    this.policy = new WorkPolicy(store, clock);
    this.knowledge = new KnowledgeBase(store);
    this.chatSearch = new ChatSearch(store);
    this.harnessAccounts = new HarnessAccounts(store, harness.accountRoot);
    this.notify = () => { if (!this.store.db.isOpen) return; this.policy.captureHandoffs(); notify(); };
    this.sources = new Sources(store, profiler, pdfText);
    this.workspaceGrants = new WorkspaceGrants(store);
    this.sideThreads = new SideThreads(store, this.workspaceGrants);
    this.forwards = new Forwards(store);
    this.templates = new TeamTemplates(store, this.notify);
    this.appProposals = new AppProposals(store, this.proposalApplier());
    this.mcp = new McpServers(store, this.notify, mcpRuntime);
    this.browser = new BrowserTools(store, browserHost, () => this.notify());
    this.desktop = new DesktopTools(store, desktopHost, () => this.notify(), ownPrograms);
    this.runner = new Runner(store, this.sources, this.notify, adapter, task => this.policy.allowed(task), { detect: () => this.harnesses(false), execute: harness.execute }, workspaceRuntime, this.appProposals, this.mcp, () => this.webSearchSettings(), this.browser, this.desktop);
    this.teams = new TeamRunner(store, this.runner, this.notify, new Preflight(store, this.sources, this.notify), task => this.policy.allowed(task));
    this.backups = new Backups(store, () => this.isBusy(), this.notify);
    this.routineFolders = new RoutineFolders(store);
    this.routines = new Routines(store, this.sources, this.notify, (input, next) => this.createTask(input, next), clock, this.routineFolders);
    this.folderTriggers = new FolderTriggers(store, this.routineFolders, this.routines, this.sources, clock);
    this.policy.captureHandoffs();
  }
  /**
   * Saves a server main has already split: the shape arrives here, the secret values stay in main (COD-241). Only
   * main calls this; the window's command list has no way to reach it.
   */
  saveMcpServer(raw: unknown) {
    return this.mcp.save(raw);
  }
  removeMcpServer(raw: unknown) {
    return this.mcp.remove(Id.parse(raw));
  }
  /** Path of a task's source for the main process to open in the default app; the renderer only ever sends ids. */
  sourcePath(raw: unknown): string {
    const input = commands.sourceBytes.parse(raw);
    const task = this.store.get<Task>('tasks', input.taskId);
    return this.sources.pathOf(input.id, task.sourceIds);
  }
  /**
   * Keeps a folder main's picker chose. For a chat that has not started it waits under the worker or team until
   * the first message (COD-186). For a chat row, a folder where there was none, or more permissions on the same
   * folder, leaves active and queued work running: queued runs read the grant when they start, and a run already
   * working keeps the snapshot it froze. Another folder or fewer permissions stops active work, since a worker
   * may be mid-edit in the old copy.
   */
  async grantWorkspace(raw: unknown): Promise<unknown> {
    const input = GrantWorkspace.parse(raw);
    if ('watch' in input) return this.grantWatchFolder(input.directory);
    if (!('taskId' in input)) {
      const chat = newChatTargetOf(input);
      if ('teamId' in chat) this.assertAssignable('team', chat.teamId);
      else for (const workerId of this.newChatWorkerIds(chat)) this.assertAssignable('worker', workerId);
      const view = await this.workspaceGrants.setPending(chat, input.directory, input.permissions);
      this.notify();
      return view;
    }
    if (this.store.get<Task>('tasks', input.taskId).sideOf) throw new Error('Chat phụ dùng thư mục của chat chính. Đổi thư mục ở chat chính.');
    const previous = this.workspaceGrants.view(input.taskId);
    const grant = await this.workspaceGrants.grant(input);
    if (replacesGrant(previous, grant)) {
      this.teams.cancel(grant.taskId);
      this.runner.cancel(grant.taskId);
    }
    this.narrowSideThreadFolders(grant.taskId);
    this.notify();
    return grant;
  }
  /** Keeps a folder main's picker chose for a routine to watch; the renderer gets its id and name, never the path. */
  private async grantWatchFolder(directory: string): Promise<WatchFolderView> {
    const resolved = await this.workspaceGrants.resolve(directory);
    return this.routineFolders.add(resolved);
  }
  /**
   * `orglet run` (COD-245): starts an existing, enabled routine that was approved as it is now, with the files the
   * command attached. Only main's CLI server calls this; the window's Run now (`runRoutineNow`) attaches no files.
   */
  async runRoutine(raw: unknown): Promise<string> {
    const input = z.object({ id: Id, sourceIds: z.array(Id).max(20) }).strict().parse(raw);
    return this.routines.runCalled(input.id, input.sourceIds);
  }
  async command(command: Command, raw: unknown): Promise<unknown> {
    if (!Object.hasOwn(commands, command)) throw new Error(`Bản Orglet đang chạy không có lệnh "${command}": giao diện và phần lõi đang khác phiên bản. Tải lại cửa sổ (Ctrl+R) hoặc khởi động lại app.`);
    const args = commands[command].parse(raw);
    switch (command) {
      case 'workspace': {
        const workspace = this.store.workspace();
        const reviewed = this.store.setting<string[]>('reviewedSkills', []);
        workspace.skills = workspace.skills.map(skill => skill.package ? { ...skill, package: { ...skill.package, reviewedHash: reviewed.includes(`${skill.id}:${skill.package.hash}`) ? skill.package.hash : undefined } } : skill);
        // The stored servers with whether each one is running right now; never a secret value (COD-241).
        workspace.mcpServers = this.mcp.views();
        workspace.running = this.running();
        return workspace;
      }
      case 'task': {
        const id = (args as { id: string }).id;
        this.markTaskSeen(id);
        const taskId = this.liveTask(id).id;
        // The browser card, take-over and whether a run uses the browser live in memory, beside the saved chat (COD-261).
        return { ...this.store.detail(taskId), browser: this.browser.live(taskId), desktop: this.desktop.live(taskId) };
      }
      case 'reconcileBudget': {
        const input = commands.reconcileBudget.parse(args);
        new BudgetLedger(this.store).reconcile(input.reservationId, input.amountMicros, input.source);
        this.notify();
        return;
      }
      case 'saveWorker': {
        const worker = this.saveWorker(commands.saveWorker.parse(args));
        this.notify();
        return worker;
      }
      case 'saveSkill': {
        const skill = this.saveSkill(commands.saveSkill.parse(args));
        this.notify();
        return skill;
      }
      case 'saveTeam': {
        const team = this.saveTeam(commands.saveTeam.parse(args));
        this.notify();
        return team;
      }
      case 'applyAppProposal': {
        const request = commands.applyAppProposal.parse(args);
        const applied = this.appProposals.apply(request.id, false, request.avatar);
        this.notify();
        return applied;
      }
      case 'dismissAppProposal': {
        this.appProposals.dismiss(commands.dismissAppProposal.parse(args).id);
        this.notify();
        return;
      }
      case 'undoAppProposal': {
        const undone = this.appProposals.undo(commands.undoAppProposal.parse(args).id);
        this.notify();
        return undone;
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
      case 'createTask': {
        const input = commands.createTask.parse(args);
        return this.createTask(input, undefined, await this.resolveNewChatWorkspace(input));
      }
      case 'startSideThread': return this.startSideThread(commands.startSideThread.parse(args));
      case 'forwardMessage': return this.forwardMessage(args);
      case 'bringIntoMainChat': {
        const mainTaskId = this.sideThreads.bringIn(commands.bringIntoMainChat.parse(args).artifactId);
        this.notify();
        return mainTaskId;
      }
      case 'setMessageReaction': {
        new MessageInteractions(this.store).userReaction(commands.setMessageReaction.parse(args));
        this.notify(); return;
      }
      case 'reviseTask': return this.reviseTask(commands.reviseTask.parse(args));
      case 'testMcpServer': return this.mcp.test(commands.testMcpServer.parse(args).id);
      case 'testWebSearch': {
        commands.testWebSearch.parse(args);
        return this.testWebSearch();
      }
      case 'setMcpServerEnabled': {
        const input = commands.setMcpServerEnabled.parse(args);
        await this.mcp.setEnabled(input.id, input.enabled);
        return;
      }
      case 'setMcpGrant': {
        const input = commands.setMcpGrant.parse(args);
        const task = this.liveTask(input.taskId);
        const grant = McpGrant.parse({ serverId: input.serverId, tool: input.tool });
        if (input.allowed && task.sideOf) this.sideThreads.assertMcpGrantWithin(task, grant);
        const others = (task.mcpGrants ?? []).filter(item => !(item.serverId === input.serverId && item.tool === input.tool));
        const grants = input.allowed ? [...others, grant] : others;
        if (grants.length > 200) throw new Error('Chat đã có quá nhiều quyền MCP.');
        // Taking a grant away stops nothing: the next call of that tool asks again (COD-241). The main chat's side
        // threads lose it too (COD-247).
        const updated = this.store.patchTask(task.id, { mcpGrants: grants });
        if (!input.allowed) this.sideThreads.narrowMcpGrants(updated);
        this.notify();
        return;
      }
      case 'setBrowser': {
        const input = commands.setBrowser.parse(args);
        const task = this.liveTask(input.taskId);
        // A side thread always uses its main chat's browser, narrowed to it (COD-247, COD-261).
        if (task.sideOf) throw new Error('Chat phụ dùng trình duyệt của chat chính. Đổi ở chat chính.');
        const before = this.browser.choiceFor(task);
        const updated = this.store.patchTask(task.id, { browser: input.browser });
        // A run keeps the profile it started with, so switching profile stops the running ones, as a revoke does. A
        // shorter list needs no stop: every step is checked against the list as it is now.
        if (before.profileId !== input.browser.profileId) {
          this.teams.cancel(task.id);
          this.runner.cancel(task.id);
          for (const side of this.sideThreads.of(task.id)) this.stopRuns(side.id);
        }
        this.sideThreads.narrowBrowser(updated);
        this.notify();
        return;
      }
      case 'browserActions': return this.browser.actions(this.liveTask(commands.browserActions.parse(args).taskId).id);
      case 'answerBrowserApproval': {
        // The person's answer to a card that asks about one step; only a click in the window sends it (COD-261).
        const input = commands.answerBrowserApproval.parse(args);
        this.browser.person.answer(this.liveTask(input.taskId).id, input.requestId, input.answer);
        this.notify();
        return;
      }
      case 'browserTakeOver': {
        const input = commands.browserTakeOver.parse(args);
        const taskId = this.liveTask(input.taskId).id;
        if (input.taken) return this.browser.takeOver(taskId, input.inChrome ?? false);
        await this.browser.handBack(taskId);
        return false;
      }
      case 'browserScreenshot': {
        const input = commands.browserScreenshot.parse(args);
        return this.browser.screenshot(this.liveTask(input.taskId).id, input.id);
      }
      case 'setDesktop': {
        const input = commands.setDesktop.parse(args);
        const task = this.liveTask(input.taskId);
        // A side thread always uses its main chat's apps, narrowed to them (COD-247, COD-261).
        if (task.sideOf) throw new Error('Chat phụ dùng ứng dụng của chat chính. Đổi ở chat chính.');
        if (input.desktop.apps.some(app => neverDesktopProgram(app.program, this.ownPrograms))) throw new Error('Orglet không bao giờ dùng ứng dụng này.');
        // Nothing stops here: a run keeps the apps it started with, and every step checks that the chat still grants them.
        const updated = this.store.patchTask(task.id, { desktop: input.desktop });
        this.sideThreads.narrowDesktop(updated);
        this.notify();
        return;
      }
      case 'desktopWindows': {
        commands.desktopWindows.parse(args);
        return this.desktop.pickerWindows();
      }
      case 'desktopActions': return this.desktop.actions(this.liveTask(commands.desktopActions.parse(args).taskId).id);
      case 'desktopScreenshot': {
        const input = commands.desktopScreenshot.parse(args);
        return this.desktop.screenshot(this.liveTask(input.taskId).id, input.id);
      }
      case 'answerDesktopApproval': {
        // The person's answer to a card that asks about one desktop step; only a click in the window sends it.
        const input = commands.answerDesktopApproval.parse(args);
        this.desktop.person.answer(this.liveTask(input.taskId).id, input.requestId, input.answer);
        this.notify();
        return;
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
        if (request.approval) {
          // An approval card: the answer is one of four choices, and "always" is saved on the chat before the call
          // runs. The runner reads the answer from the chat, so the checkpoint keeps the call as it was (COD-241).
          const choice = McpApprovalChoice.parse(input.answer);
          if (!checkpoint.pendingApproval || checkpoint.pendingApproval.requestId !== request.id) throw new Error('Lần chạy không còn chờ quyết định.');
          // A standing grant on a side thread would be wider than its main chat's, which did not give it (COD-247).
          if (task.sideOf && (choice === 'tool' || choice === 'server')) throw new Error('Chat phụ chỉ cho phép một lần. Cho phép luôn ở chat chính.');
          this.store.transaction(() => {
            this.store.update('tasks', { ...task, status: 'paused', mcpGrants: grantsAfterApproval(task.mcpGrants, request.approval!, choice),
              decisionRequests: task.decisionRequests!.map(item => item.id === request.id ? { ...item, answer: choice, answeredAt } : item) });
            this.store.update('runs', { ...run, status: 'paused' });
          });
          this.notify();
          return this.command('resume', { id: task.id });
        }
        this.store.transaction(() => {
          checkpoints.save({ ...checkpoint, messages: [...checkpoint.messages, { role: 'user', content: JSON.stringify({ decisionRequestId: request.id, answer: input.answer, instruction: 'This is the user\'s decision for the pending question in this turn. It does not grant new workspace or network permissions. Continue only within the tools and grants actually available.' }) }] });
          this.store.update('tasks', { ...task, status: 'paused', decisionRequests: task.decisionRequests!.map(item => item.id === request.id ? { ...item, answer: input.answer, answeredAt } : item) });
          this.store.update('runs', { ...run, status: 'paused' });
        });
        this.notify();
        return this.command('resume', { id: task.id });
      }
      case 'saveRoutine': return this.saveRoutine(commands.saveRoutine.parse(args));
      case 'dismissRoutine': this.routines.dismiss((args as { id: string }).id); return;
      case 'catchUpRoutine': return this.routines.catchUp((args as { id: string }).id);
      case 'runRoutineNow': return this.routines.runCalled((args as { id: string }).id, []);
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
        task.budgetMicros = this.currentTaskLimit(task) ?? task.budgetMicros;
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
          void this.runner.run(task, run).catch(() => this.markInterrupted(task.id, run.id));
        }
        return;
      }
      case 'retry': {
        const task = this.store.get<Task>('tasks', (args as { id: string }).id);
        if (this.runner.isActive(task.id) || this.teams.isActive(task.id)) throw new Error('Task đang chạy.');
        if (task.status === 'completed') throw new Error('Task đã hoàn tất. Tạo task mới để chạy lại.');
        if (task.decisionRequests?.some(request => request.inputRevision === (task.inputRevision ?? 0) && !request.answer && !request.interruptedAt)) throw new Error('Trả lời câu hỏi đang chờ hoặc gửi yêu cầu mới trước khi thử lại.');
        this.start({ ...task, budgetMicros: this.currentTaskLimit(task) ?? task.budgetMicros }); return;
      }
      case 'workspaceRecovery': return new WorkspaceRecovery(this.store).view(commands.workspaceRecovery.parse(args).taskId);
      case 'recoveryFile': {
        if (!this.workspaceRuntime) throw new Error('Workspace runtime chưa được cấu hình.');
        return this.workspaceRuntime.inspectFile(args, taskId => this.runner.isActive(taskId) || this.teams.isActive(taskId));
      }
      case 'workspaceDiff': {
        if (!this.workspaceRuntime) throw new Error('Workspace runtime chưa được cấu hình.');
        return this.workspaceRuntime.diff(args);
      }
      case 'applyBlockedHandIn': {
        const input = commands.applyBlockedHandIn.parse(args);
        if (this.teams.isActive(input.taskId)) throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
        await this.runner.applyBlockedHandIn(input.taskId, input.runId);
        return;
      }
      case 'recoveryProcessOutput': return new WorkspaceRecovery(this.store).output(args);
      case 'retireWorkspaceAttempt': {
        new WorkspaceRecovery(this.store).retire(args, taskId => this.runner.isActive(taskId) || this.teams.isActive(taskId));
        this.notify();
        return;
      }
      case 'restoreWorkspaceFile': {
        if (!this.workspaceRuntime) throw new Error('Workspace runtime chưa được cấu hình.');
        await this.workspaceRuntime.restore(args, taskId => this.runner.isActive(taskId) || this.teams.isActive(taskId));
        this.notify();
        return;
      }
      case 'workspaceAccess': return this.workspaceGrants.view(commands.workspaceAccess.parse(args).taskId);
      case 'revokeWorkspace': {
        const input = commands.revokeWorkspace.parse(args);
        if (!('taskId' in input)) {
          this.workspaceGrants.takePending(newChatTargetOf(input));
          this.notify();
          return;
        }
        this.workspaceGrants.revoke(input.taskId);
        this.teams.cancel(input.taskId);
        this.runner.cancel(input.taskId);
        this.narrowSideThreadFolders(input.taskId);
        this.notify();
        return;
      }
      case 'setToolCapabilities': {
        const input = commands.setToolCapabilities.parse(args);
        if (!('taskId' in input)) { this.setNewChatCapabilities(input); return; }
        const task = this.liveTask(input.taskId);
        const workers = task.teamSnapshot
          ? [...new Set([...task.teamSnapshot.memberIds, task.teamSnapshot.synthesizerId])]
          : task.assignees === 'all' ? this.store.all<Worker>('workers').map(worker => worker.id)
          : task.assignees ?? [task.workerId];
        for (const workerId of workers) snapshotCapabilities(this.store.get<Worker>('workers', workerId).provider, input.capabilities);
        if (task.routineId && input.capabilities.includes('browser.act')) throw new Error(SCHEDULE_NEVER_ACTS);
        if (task.routineId && input.capabilities.includes('desktop.read')) throw new Error(SCHEDULE_NO_DESKTOP);
        if (task.sideOf) this.sideThreads.assertCapabilitiesWithin(task, input.capabilities);
        const reduced = this.store.detail(task.id).runs.some(run =>
          (run.snapshot.toolCapabilities ?? snapshotCapabilities(run.snapshot.worker.provider)).some(capability => !input.capabilities.includes(capability)));
        const updated = this.store.patchTask(task.id, { toolCapabilities: input.capabilities });
        if (reduced) {
          this.teams.cancel(task.id);
          this.runner.cancel(task.id);
        }
        // What the main chat no longer has, its side threads lose at once, and their running work stops (COD-247).
        for (const sideTaskId of this.sideThreads.narrowCapabilities(updated)) this.stopRuns(sideTaskId);
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
      case 'sourceBytes': {
        const input = commands.sourceBytes.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        return this.sources.readPreview(input.id, task.sourceIds);
      }
      case 'sourceOrigins': {
        const input = commands.sourceOrigins.parse(args);
        const task = this.store.get<Task>('tasks', input.taskId);
        return this.sources.origins(task.sourceIds);
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
      case 'searchChats': return this.chatSearch.search(commands.searchChats.parse(args).query);
      case 'updateMemory': {
        const input = commands.updateMemory.parse(args);
        const item = this.knowledge.updateMemory(input.id, { text: input.text, pinned: input.pinned }); this.notify(); return item;
      }
      case 'deleteMemory': { this.knowledge.deleteMemory(commands.deleteMemory.parse(args).id); this.notify(); return; }
      case 'harnesses': return this.harnesses(commands.harnesses.parse(args).refresh);
      case 'harnessUsage': return this.harnessUsage(commands.harnessUsage.parse(args).refresh);
      case 'saveHarnessAccount': {
        const input = commands.saveHarnessAccount.parse(args);
        // A new name is a label only; a new account is selected, so that harness signs in from another folder.
        if (input.id) return this.harnessAccount(input.harness, 'label', () => this.harnessAccounts.rename(input.harness, input.id!, input.label));
        return this.harnessAccount(input.harness, 'sign-in', () => this.harnessAccounts.add(input.harness, input.label));
      }
      case 'removeHarnessAccount': {
        const input = commands.removeHarnessAccount.parse(args);
        // Removing the account in use hands the harness back to the default account; any other is a list change.
        const active = this.harnessAccounts.selection(input.harness).accountId === input.id;
        return this.harnessAccount(input.harness, active ? 'sign-in' : 'label', () => this.harnessAccounts.remove(input.harness, input.id));
      }
      case 'selectHarnessAccount': {
        const input = commands.selectHarnessAccount.parse(args);
        return this.harnessAccount(input.harness, 'sign-in', () => this.harnessAccounts.select(input.harness, input.id));
      }
      case 'eraseData': {
        const input = commands.eraseData.parse(args);
        return this.eraseData(input.scope, input.confirm);
      }
      case 'modelList': return this.modelList(commands.modelList.parse(args));
      case 'saveCustomConnection': {
        const connection = saveCustomConnection(this.store, commands.saveCustomConnection.parse(args), id);
        // A new address lists different models; the old list must not linger under the same connection.
        this.invalidateModelList(customProviderId(connection.id));
        this.notify();
        return connection;
      }
      case 'deleteCustomConnection': {
        const connectionId = commands.deleteCustomConnection.parse(args).id;
        deleteCustomConnection(this.store, connectionId, this.store.workspace().workers);
        this.invalidateModelList(customProviderId(connectionId));
        this.notify();
        return;
      }
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
        if (task.sideOf) throw new Error('Chat phụ luôn thuộc Tí của chat chính. Đổi tên chat phụ trong menu của nó.');
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
        this.applySettings(commands.settings.parse(args));
        this.notify(); return;
      }
    }
  }
  /** Creates a worker or a new revision of one, validated the way the worker dialog is. */
  private saveWorker(input: Args<'saveWorker'>): Worker {
    assertSkillReady(this.store.get<Skill>('skills', input.skillId), this.store);
    if (input.id) this.store.get<Worker>('workers', input.id);
    const { modelId, mcpServerIds, ...fields } = input;
    if (isOpenCodePlan(fields.provider)) assertOpenCodeModel(fields.provider, modelId);
    if (isCustomProvider(fields.provider)) {
      const connection = requireCustomConnection(this.store, fields.provider);
      if (!modelId?.trim()) throw new Error(`Chọn hoặc gõ ID model cho ${connection.name}.`);
    }
    // A server removed since the dialog opened is dropped rather than refused, so an edit never fails on it.
    const servers = new Set(this.mcp.list().map(server => server.id));
    const allowedServers = (mcpServerIds ?? []).filter(serverId => servers.has(serverId));
    const worker: Worker = {
      ...fields,
      ...(allowedServers.length ? { mcpServerIds: allowedServers } : {}),
      id: input.id ?? id(),
      revision: input.id ? this.store.nextRevision(input.id) : 1,
      ...(fields.provider !== 'demo' && modelId ? { modelId } : {}),
    };
    this.store.version('workers', worker);
    return worker;
  }
  private saveSkill(input: Args<'saveSkill'>): Skill {
    if (input.id && this.store.get<Skill>('skills', input.id).package) throw new Error('Gói skill giữ nguyên nội dung đã nhập. Sửa thư mục gốc rồi nhập lại để tạo gói mới.');
    const skill: Skill = { ...input, id: input.id ?? id(), revision: input.id ? this.store.nextRevision(input.id) : 1 };
    this.store.version('skills', skill);
    return skill;
  }
  private saveTeam(input: Args<'saveTeam'>): Team {
    for (const workerId of [...input.memberIds, input.synthesizerId]) this.assertAssignable('worker', workerId);
    if (input.id) this.store.get<Team>('teams', input.id);
    const team: Team = { ...input, id: input.id ?? id(), revision: input.id ? this.store.nextRevision(input.id) : 1 };
    this.store.version('teams', team);
    return team;
  }
  private saveRoutine(input: Args<'saveRoutine'>): Routine {
    if (input.enabled) this.prepareTask(input.task);
    const routine = this.routines.save(input);
    // A new or changed folder starts watching now, not at the next tick, so files already there stay the baseline.
    void this.folderTriggers.sync().catch(() => {});
    return routine;
  }
  /** Writes the settings given; a key left out keeps its value. The settings dialog and an applied proposal share this. */
  private applySettings(input: Partial<Args<'settings'>>) {
    if (input.theme) this.store.setSetting('theme', input.theme);
    if (input.language) this.store.setSetting('language', input.language);
    if (input.autoTitles !== undefined) this.store.setSetting('autoTitles', input.autoTitles);
    if (input.copyFormat) this.store.setSetting('copyFormat', input.copyFormat);
    if (input.downloadFormat) this.store.setSetting('downloadFormat', input.downloadFormat);
    if (input.confirmOpenTask !== undefined) this.store.setSetting('confirmOpenTask', input.confirmOpenTask);
    if (input.archiveRetentionDays !== undefined) this.store.setSetting('archiveRetentionDays', input.archiveRetentionDays);
    if (input.accentColor !== undefined) this.store.setSetting('accentColor', input.accentColor);
    if (input.logoColor !== undefined) this.store.setSetting('logoColor', input.logoColor);
    // null puts a font back to the one the app ships with; absent leaves the current choice alone.
    const saveFont = (key: 'interfaceFont' | 'codeFont', family: string | null | undefined) => {
      if (family === undefined) return;
      if (family) this.store.setSetting(key, family); else this.store.clearSetting(key);
    };
    saveFont('interfaceFont', input.interfaceFont);
    saveFont('codeFont', input.codeFont);
    if (input.autoUpdate !== undefined) this.store.setSetting('autoUpdate', input.autoUpdate);
    if (input.backgroundNotifications !== undefined) this.store.setSetting('backgroundNotifications', input.backgroundNotifications);
    if (input.connectionLimitMicros !== undefined) this.store.setSetting('connectionLimitMicros', input.connectionLimitMicros);
    if (input.providerConcurrency) this.store.setSetting('providerConcurrency', input.providerConcurrency);
    // Standing per-provider permission (plan §12: consent scoped by connection); backups never restore it.
    if (input.providerConsent) this.store.setSetting('providerConsent', input.providerConsent);
    if (input.webSearchProvider) this.store.setSetting('webSearchProvider', input.webSearchProvider);
  }
  /** Where `web_search` goes right now, and how it reaches main for the saved key (COD-266). */
  private webSearchSettings(): WebSearchSettings {
    return { provider: this.store.webSearchProvider(), readKey: this.webSearchRuntime.readKey };
  }
  /** One real query through the saved provider for Settings → Web search → Test; a failure is the plain error a worker would get. */
  private async testWebSearch(): Promise<WebSearchTest> {
    const settings = this.webSearchSettings();
    // Under main's 30-second wait for any command, so a slow provider gets its own message instead of "core not answering".
    const deadline = AbortSignal.timeout(25_000);
    let found;
    try {
      found = await new WebTools(webNetwork, settings).search({ query: WEB_SEARCH_TEST_QUERY }, deadline);
    } catch (error) {
      if (deadline.aborted) throw new Error('Tìm kiếm thử quá 25 giây vẫn chưa xong. Thử lại sau.');
      throw error;
    }
    const first = found.results[0];
    return { provider: settings.provider, title: first?.title ?? null, url: first?.url ?? null };
  }
  /** The settings a worker may propose, as the app holds them now; the same reads `workspace()` makes. */
  private currentSettings(): CurrentSettings {
    const workspace = this.store.workspace();
    return {
      theme: workspace.theme, language: workspace.language, accentColor: workspace.accentColor, logoColor: workspace.logoColor,
      interfaceFont: workspace.interfaceFont ?? null, codeFont: workspace.codeFont ?? null,
      copyFormat: workspace.copyFormat, downloadFormat: workspace.downloadFormat, autoTitles: workspace.autoTitles, confirmOpenTask: workspace.confirmOpenTask,
    };
  }
  /**
   * What Apply on a proposal card runs: this service's own save commands, so a proposal can do nothing the dialogs
   * cannot and meets the same validation (COD-199). Deleting is only for taking an automatic apply back.
   */
  private proposalApplier(): ProposalApplier {
    return {
      saveWorker: input => this.saveWorker(commands.saveWorker.parse(input)),
      saveTeam: input => this.saveTeam(commands.saveTeam.parse(input)),
      saveSkill: input => this.saveSkill(commands.saveSkill.parse(input)),
      saveRoutine: input => this.saveRoutine(commands.saveRoutine.parse(input)),
      templateText: teamId => this.templates.export(teamId),
      currentSettings: () => this.currentSettings(),
      applySettings: patch => this.applySettings(patch),
      deleteEntity: (kind, entityId) => this.deleteEntity(kind, entityId),
    };
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
  /** Every run working, waiting or stopped at a checkpoint, for the Running view (COD-244). */
  running(): RunningItem[] {
    return runningView(this.store, {
      activeRun: runId => this.runner.activeRun(runId),
      slotWaits: () => this.runner.slotWaits(),
      teamWaits: taskId => this.teams.waitsOf(taskId),
    });
  }
  /** A task, routine or checker in flight would write rows back while they are being removed. */
  private isBusy() {
    return this.routines.isBusy() || this.sources.isChecking()
      || this.store.all<Task>('tasks').some(task => this.runner.isActive(task.id) || this.teams.isActive(task.id));
  }

  /**
   * Removes one kind of stored data. Chats go through the same deletion a single chat uses, so one that cost money
   * still leaves its cost row behind and knowledge it taught keeps the artifact it cites. API keys live outside the
   * database, in the credential store, and no scope here touches them.
   */
  eraseData(scope: EraseScope, confirm?: string): EraseSummary {
    if (this.isBusy()) throw new Error('Chờ hoặc hủy các task/checker đang chạy trước khi xóa.');
    if (scope === 'everything' && confirm !== ERASE_CONFIRMATION) throw new Error(`Gõ ${ERASE_CONFIRMATION} để xác nhận xóa toàn bộ.`);
    const summary: EraseSummary = { scope, chats: 0, knowledge: 0, memory: 0, sources: 0, sourcesForgotten: 0, entities: 0 };
    if (scope === 'chats' || scope === 'everything') {
      // A deleted chat that cost money leaves a tombstone row, which a full erase then drops with its table.
      for (const task of this.store.all<Task>('tasks')) {
        if (task.deletedAt) continue;
        this.deleteTask(task.id);
        summary.chats++;
      }
    }
    if (scope === 'knowledge') summary.knowledge = eraseKnowledge(this.store);
    if (scope === 'memory') summary.memory = eraseMemory(this.store);
    if (scope === 'sources') Object.assign(summary, eraseSources(this.store));
    if (scope === 'everything') {
      summary.memory = this.knowledge.memories().length;
      summary.knowledge = this.store.all('knowledge').length - summary.memory;
      summary.sources = this.store.all('sources').length;
      Object.assign(summary, eraseEverything(this.store));
      // Settings went with the tables, so the model lists cached in memory no longer have a row behind them.
      this.modelListMemory = emptyModelListCache();
      this.modelListLoaded = false;
    }
    this.notify();
    return summary;
  }

  /**
   * A run that failed past the runner's own handling is marked interrupted, unless the store has closed under it:
   * the app quitting mid-run, or a test tearing down. Then there is nothing left to record into, and writing anyway
   * threw a second time from this handler, as an unhandled rejection.
   */
  private markInterrupted(taskId: string, runId: string) {
    if (!this.store.db.isOpen) return;
    this.store.status(taskId, runId, 'interrupted', 'Core không thể hoàn tất ghi trạng thái.');
    this.notify();
  }

  /** Probing spawns each CLI, so results are reused for a minute unless the user asks to detect again. */
  harnesses(refresh: boolean): Promise<HarnessInfo[]> {
    if (refresh) for (const id of harnessCatalog) this.invalidateModelList(id);
    if (refresh || !this.harnessCache || Date.now() - this.harnessCache.at > 60_000) {
      const value = this.harness.detect(this.harnessAccounts.map()).catch(() => [] as HarnessInfo[]);
      this.harnessCache = { at: Date.now(), value };
    }
    return this.harnessCache.value;
  }

  /**
   * Plan usage of every account of every installed harness, not only the active one, so the account picker can
   * show which one still has room. Kept apart from detection because it goes over the network and runs slower;
   * reused for a minute like detection.
   */
  harnessUsage(refresh: boolean): Promise<HarnessUsage> {
    if (refresh || !this.harnessUsageCache || Date.now() - this.harnessUsageCache.at > 60_000) {
      const value = this.readHarnessUsage().catch(() => ({}));
      this.harnessUsageCache = { at: Date.now(), value };
    }
    return this.harnessUsageCache.value;
  }

  /** Reads against the detection already cached: Dò lại has just refreshed it, and a second pass would spawn every CLI again. */
  private async readHarnessUsage(): Promise<HarnessUsage> {
    const read = this.harness.usage;
    if (!read) return {};
    const installed = (await this.harnesses(false)).filter(item => item.executable);
    const perHarness = await Promise.all(installed.map(async item => {
      const accountIds = [SYSTEM_ACCOUNT_ID, ...item.accounts.map(account => account.id)];
      const rows: HarnessAccountUsage[] = [];
      // One account at a time: every Codex read starts its own app server.
      for (const accountId of accountIds) {
        const found = await read(item.id, item.executable, this.harnessAccounts.configDir(item.id, accountId));
        rows.push({ ...found, accountId, checkedAt: this.clock().toISOString() });
      }
      return [item.id, rows] as const;
    }));
    return Object.fromEntries(perHarness);
  }

  /**
   * Adds, renames, removes or selects one harness account, then detects again: a different account means a
   * different sign-in, so the cached status and model list no longer describe it.
   */
  private async harnessAccount(harness: HarnessCatalogId, effect: 'label' | 'sign-in', change: () => void | Promise<unknown>): Promise<HarnessInfo[]> {
    await change();
    const found = effect === 'label' ? await this.withStoredAccounts() : await this.detectAgain(harness);
    if (effect === 'sign-in') this.harnessUsageCache = undefined;
    this.notify();
    return found;
  }

  /**
   * The detected rows as they are, with each harness's account list read again from the store. A rename, or removing
   * an account nobody signs in from, changes nothing a CLI would report, so no CLI runs (COD-229): this used to detect
   * all three harnesses again, one CLI after another, and took seconds.
   */
  private async withStoredAccounts(): Promise<HarnessInfo[]> {
    const detected = await (this.harnessCache?.value ?? this.harnesses(false));
    const accounts = this.harnessAccounts.map();
    const rows = detected.map(row => ({ ...row, accounts: accounts[row.id].accounts }));
    this.harnessCache = { at: this.harnessCache?.at ?? Date.now(), value: Promise.resolve(rows) };
    return rows;
  }

  /** Detects one harness again, when it signs in from another folder, and keeps the other rows as they were. */
  private async detectAgain(harness: HarnessCatalogId): Promise<HarnessInfo[]> {
    this.invalidateModelList(harness);
    const detected = await (this.harnessCache?.value ?? this.harnesses(false));
    const fresh = (await this.harness.detect(this.harnessAccounts.map(), [harness]).catch(() => [] as HarnessInfo[])).find(row => row.id === harness);
    const rows = fresh ? detected.map(row => row.id === harness ? fresh : row) : detected;
    const withFresh = fresh && !rows.some(row => row.id === harness) ? [...rows, fresh] : rows;
    this.harnessCache = { at: Date.now(), value: Promise.resolve(withFresh) };
    return withFresh;
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
  invalidateModelList(provider: CredentialProvider | ModelListProviderId) {
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
      customConnection: (provider: string) => findCustomConnection(readCustomConnections(this.store), provider),
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
    this.takeNewChatCapabilities(kind === 'team' ? { teamId: entityId } : { workerId: entityId });
    this.workspaceGrants.takePending(kind === 'team' ? { teamId: entityId } : { workerId: entityId });
    if (kind === 'worker') {
      this.takeGroupChatCapabilities(entityId);
      this.workspaceGrants.takePendingOfGroupsWith(entityId);
    }
  }
  /**
   * Permissions for a chat that has not started yet (COD-178). The `tasks` row only exists once the first message
   * is sent, so until then the set waits under the worker, team or group of orglets and `createTask` moves it onto
   * the new row.
   */
  private setNewChatCapabilities(input: { capabilities: ToolCapability[] } & ({ workerId: string } | { teamId: string } | { workerIds: string[] })) {
    const chat = newChatTargetOf(input);
    for (const workerId of this.newChatWorkerIds(chat)) snapshotCapabilities(this.store.get<Worker>('workers', workerId).provider, input.capabilities);
    const pending = { ...this.store.setting<Record<string, ToolCapability[]>>('newChatCapabilities', {}) };
    pending[newChatKey(chat)] = [...input.capabilities];
    this.store.setSetting('newChatCapabilities', pending);
    this.notify();
  }
  /** Every worker who will answer in this chat once it starts. */
  private newChatWorkerIds(chat: NewChatTarget): string[] {
    if ('teamId' in chat) {
      const team = this.store.get<Team>('teams', chat.teamId);
      return [...team.memberIds, team.synthesizerId];
    }
    if ('workerIds' in chat) return chat.workerIds;
    return [chat.workerId];
  }
  /** The permissions waiting for this chat's first message, if any were chosen. */
  private pendingNewChatCapabilities(chat: NewChatTarget): ToolCapability[] | undefined {
    return this.store.setting<Record<string, ToolCapability[]>>('newChatCapabilities', {})[newChatKey(chat)];
  }
  /** Drops the waiting set once the chat row carries it, or the worker or team is gone. */
  private takeNewChatCapabilities(chat: NewChatTarget) {
    const pending = { ...this.store.setting<Record<string, ToolCapability[]>>('newChatCapabilities', {}) };
    const key = newChatKey(chat);
    if (!(key in pending)) return;
    delete pending[key];
    this.store.setSetting('newChatCapabilities', pending);
  }
  /** Drops the waiting sets of every group chat this worker was part of: without the worker, that group cannot start. */
  private takeGroupChatCapabilities(workerId: string) {
    const pending = this.store.setting<Record<string, ToolCapability[]>>('newChatCapabilities', {});
    const kept = Object.fromEntries(Object.entries(pending).filter(([key]) => !newChatKeyNames(key, workerId)));
    if (Object.keys(kept).length === Object.keys(pending).length) return;
    this.store.setSetting('newChatCapabilities', kept);
  }
  /** Stops whatever is running in a chat; used when its permissions were taken away underneath it. */
  private stopRuns(taskId: string) {
    this.teams.cancel(taskId);
    this.runner.cancel(taskId);
  }
  /** After a main chat's folder changed or was revoked, its side threads' folders follow, stopping their runs (COD-247). */
  private narrowSideThreadFolders(mainTaskId: string) {
    const main = this.store.get<Task>('tasks', mainTaskId);
    for (const sideTaskId of this.sideThreads.narrowWorkspace(main)) this.stopRuns(sideTaskId);
  }
  /**
   * The next message of a chat that already has one: a new turn on the same row. A forward's turn (COD-257) comes
   * through here too, with the record the chat draws in place of its brief.
   */
  private reviseTask(input: Args<'reviseTask'>, forwarded?: ForwardedMessage) {
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
    const revised: Task = { ...task, sourceIds, currentInput: { brief: input.brief, sourceIds: [...new Set(input.sourceIds)], excludedSources: input.excludedSources, replyTo: input.replyTo, ...(forwarded ? { forwarded } : {}) }, inputRevision: (task.inputRevision ?? 0) + 1, consent: input.consent, providerScopes: input.providerScopes, budgetMicros: this.currentTaskLimit(task) ?? input.budgetMicros, teamSnapshot: prepared.teamSnapshot, workerId: prepared.workerId, accepted: false, status: active ? 'pausing' : 'queued', pendingStart: active || undefined, pauseReason: undefined, handoff: undefined,
      decisionRequests: task.decisionRequests?.map(request => request.inputRevision === (task.inputRevision ?? 0) && !request.answer && !request.interruptedAt
        ? { ...request, interruptedAt: now() } : request) };
    this.store.transaction(() => {
      // Preserve readable input for older runs before expanding the task's history scope.
      for (const run of this.store.detail(task.id).runs) if (!run.snapshot.input) this.store.update('runs', { ...run, snapshot: { ...run.snapshot, input: { brief: task.brief, sourceIds: task.sourceIds, excludedSources: task.excludedSources } } });
      this.store.update('tasks', revised);
      this.chatSearch.indexTurn(revised.id, revised.inputRevision ?? 0, revised.currentInput!, now());
    });
    if (active) { this.teams.cancel(task.id); this.runner.cancel(task.id); this.notify(); return; }
    this.start(revised, true);
  }
  /**
   * Sends one message to up to five other chats as the person's own message (COD-257). Each place is its own turn,
   * through `reviseTask` or `createTask` like any message the person types, so budgets, permissions and the queue
   * apply unchanged; one place failing does not stop the others, and the result names every one that did not go.
   * Only the person forwards: no worker tool reaches this command.
   */
  private async forwardMessage(raw: unknown): Promise<ForwardResult> {
    const input = ForwardMessageArgs.parse(raw);
    const origin = this.liveTask(input.taskId);
    const message = this.forwards.message(origin, input.messageId);
    const carried = [...new Set(input.carrySourceIds)];
    if (carried.some(sourceId => !message.files.some(file => file.sourceId === sourceId))) throw new Error('Chỉ gửi kèm được tệp của chính tin này.');
    // An orglet and its main chat picked from Recent are one place: it gets the message once.
    const places = input.targets.map(target => this.forwardChatOf(target)?.id ?? `${target.kind}:${target.id}`);
    if (new Set(places).size !== places.length) throw new Error('Nơi nhận bị trùng.');
    const note = input.note?.trim() || undefined;
    const result: ForwardResult = { sent: [], failed: [] };
    for (const target of input.targets) {
      try {
        result.sent.push({ target, taskId: await this.forwardTo(origin, message, target, note, carried) });
      } catch (error) {
        result.failed.push({ target, name: this.forwards.targetName(target), error: error instanceof Error ? error.message : String(error) });
      }
    }
    this.notify();
    return result;
  }
  /** One place of a forward: the chat it lands in takes it as its next message, or the first one starts that chat. */
  private async forwardTo(origin: Task, message: ForwardSource, target: ForwardTarget, note: string | undefined, carried: string[]): Promise<string> {
    if (target.kind === 'task') this.liveTask(target.id);
    const existing = this.forwardChatOf(target);
    if (existing?.archivedAt) throw new Error('Chat này đã được lưu trữ. Khôi phục rồi chuyển tiếp lại.');
    if (existing?.id === origin.id) throw new Error('Tin này đã ở trong chat đó.');
    // A message arriving would stop the work there; a person typing into a busy chat chooses that, a forward does not.
    if (existing && (existing.pendingStart || this.runner.isActive(existing.id) || this.teams.isActive(existing.id) || ['queued', 'running', 'pausing'].includes(existing.status))) {
      throw new Error('Chat này đang làm. Chuyển tiếp sau khi xong.');
    }
    // A side thread never holds a file its main chat does not (COD-247), and a carried file is a new one.
    if (existing?.sideOf && carried.length) throw new Error('Chat phụ chỉ dùng tệp của chat chính. Bỏ chọn tệp rồi chuyển tiếp lại.');
    const kept = existing ? (existing.currentInput ?? existing).sourceIds.filter(sourceId => !this.store.get<Source>('sources', sourceId).revoked) : [];
    if (new Set([...kept, ...carried]).size > 20) throw new Error('Một tin nhắn mang tối đa 20 tệp.');
    const copies = new Map<string, Source>();
    for (const sourceId of carried) copies.set(sourceId, await this.sources.copyFor(sourceId, origin.sourceIds));
    const forwarded = ForwardedMessage.parse({
      fromTaskId: message.fromTaskId, messageId: message.messageId, from: message.from, authorKind: message.authorKind,
      ...(message.author ? { author: message.author } : {}),
      text: forwardText(message.text),
      files: message.files.map(file => {
        const copy = file.sourceId ? copies.get(file.sourceId) : undefined;
        return { name: file.name, ...(copy ? { sourceId: copy.id } : {}) };
      }),
      ...(note ? { note } : {}),
    });
    const brief = forwardBrief(forwarded);
    const sourceIds = [...new Set([...kept, ...[...copies.values()].map(copy => copy.id)])];
    // Sending is the consent, as it is from the composer and the terminal command: the providers of the orglets that run.
    if (existing) {
      const providerScopes = this.chatProviders(existing);
      const excludedSources = (existing.currentInput ?? existing).excludedSources;
      this.reviseTask({ taskId: existing.id, brief, sourceIds, excludedSources, consent: true, providerScopes, budgetMicros: existing.budgetMicros }, forwarded);
      return existing.id;
    }
    const team = target.kind === 'team' ? this.store.get<Team>('teams', target.id) : undefined;
    const owner = team ? { workerId: team.synthesizerId, teamId: team.id } : { workerId: target.id };
    const budgetMicros = (team ?? this.store.get<Worker>('workers', owner.workerId)).taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS;
    const taskInput: TaskInput = { ...owner, brief, sourceIds, consent: true, providerScopes: this.chatProviders(owner), budgetMicros };
    return this.createTask(taskInput, undefined, await this.resolveNewChatWorkspace(taskInput), forwarded);
  }
  /** The chat a forward to this place lands in: that chat, or the orglet's or crew's main chat once it has one. */
  private forwardChatOf(target: ForwardTarget): Task | undefined {
    const tasks = this.store.all<Task>('tasks');
    if (target.kind === 'task') return tasks.find(task => task.id === target.id && !task.deletedAt);
    return target.kind === 'worker' ? liveWorkerTask(tasks, target.id) : liveTeamTask(tasks, target.id);
  }
  /** The non-Demo providers of every orglet that runs in this chat, the scopes a send from the composer consents to. */
  private chatProviders(chat: Pick<Task, 'workerId' | 'teamId' | 'assignees'>): NonNullable<TaskInput['providerScopes']> {
    const team = chat.teamId ? this.store.get<Team>('teams', chat.teamId) : undefined;
    const workers = team ? [...team.memberIds, team.synthesizerId].map(workerId => this.store.get<Worker>('workers', workerId))
      : this.groupWorkers(chat) ?? [this.store.get<Worker>('workers', chat.workerId)];
    const providers = workers.map(worker => worker.provider).filter(provider => provider !== 'demo');
    return [...new Set(providers)] as NonNullable<TaskInput['providerScopes']>;
  }
  /**
   * A message sent "in a new thread" from an orglet's main chat (COD-247). It becomes a side thread: its own row of
   * the same orglet, marked with the main chat and how far that chat had got, so its first turn reads those turns.
   * It starts with a copy of the main chat's tool permissions, folder grant and MCP grants and nothing more; the
   * files it carries must already belong to the main chat. The main chat is left as it is, running or not.
   */
  private startSideThread(input: Args<'startSideThread'>): string {
    const main = this.liveTask(input.taskId);
    this.sideThreads.assertCanStart(main);
    const sourceIds = [...new Set(input.sourceIds)];
    if (sourceIds.some(sourceId => !main.sourceIds.includes(sourceId))) throw new Error('Chat phụ chỉ mang theo tệp đã có trong chat chính.');
    const task = this.prepareTask({
      workerId: main.workerId, brief: input.brief, sourceIds, excludedSources: input.excludedSources,
      consent: input.consent, providerScopes: input.providerScopes, budgetMicros: this.currentTaskLimit(main) ?? input.budgetMicros,
      ...(main.toolCapabilities ? { toolCapabilities: [...main.toolCapabilities] } : {}),
      ...(main.browser ? { browser: structuredClone(main.browser) } : {}),
      ...(main.desktop ? { desktop: structuredClone(main.desktop) } : {}),
    });
    task.sideOf = { taskId: main.id, throughRevision: main.inputRevision ?? 0 };
    if (main.mcpGrants?.length) task.mcpGrants = main.mcpGrants.map(grant => ({ ...grant }));
    snapshotCapabilities(this.store.get<Worker>('workers', task.workerId).provider, task.toolCapabilities);
    this.store.transaction(() => {
      this.store.put('tasks', task);
      this.chatSearch.indexTurn(task.id, 0, task.currentInput ?? task, task.createdAt);
      this.workspaceGrants.copyInsideTransaction(main.id, task.id);
    });
    this.start(task, true);
    return task.id;
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
   * proposed from it and not yet approved is deleted; approved knowledge keeps the answers it was learned from. A memory
   * learned only in this chat goes with it; one also merged from another chat stays (COD-161).
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
    const memoriesToDelete = this.knowledge.memoriesOnlyFrom(task.id);
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
        db.prepare('DELETE FROM app_proposals WHERE run_id=?').run(run.id);
        this.browser.deleteRun(run.id);
        this.desktop.deleteRun(run.id);
      }
      db.prepare('DELETE FROM profiles WHERE task_id=?').run(task.id);
      db.prepare('DELETE FROM preflights WHERE task_id=?').run(task.id);
      this.chatSearch.removeChat(task.id);
      db.prepare('DELETE FROM workspace_grants WHERE task_id=?').run(task.id);
      for (const item of proposed) this.knowledge.deleteRows(item.id);
      for (const item of memoriesToDelete) this.knowledge.deleteRows(item.id);
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
  /**
   * The Limit per task a crew or orglet chat runs under is that crew's or orglet's current setting, so raising it in
   * settings reaches the chat's next turn, retry and resume; a run already in flight keeps the limit it started with.
   * Group chats and scheduled runs keep the limit saved on their own row.
   */
  private currentTaskLimit(task: Pick<Task, 'teamId' | 'workerId' | 'assignees' | 'routineId'>): number | undefined {
    if (task.assignees || task.routineId) return undefined;
    if (task.teamId) return this.store.all<Team>('teams').find(team => team.id === task.teamId)?.taskBudgetMicros;
    return this.store.all<Worker>('workers').find(worker => worker.id === task.workerId)?.taskBudgetMicros;
  }
  /** Workers of a group chat in sidebar order, or undefined when one worker (or a team) handles the task. */
  private groupWorkers(task: Pick<Task, 'assignees'>) {
    if (!task.assignees) return undefined;
    const workers = this.store.workspace().workers.filter(worker => task.assignees === 'all' || task.assignees!.includes(worker.id));
    return task.assignees === 'all' || workers.length > 1 ? workers : undefined;
  }
  /**
   * Assignees who should answer this group-chat turn: @tagged workers; with no tag at all, the orglet whose answer the
   * person replied to (COD-257); otherwise the whole group.
   */
  private groupTurnWorkers(task: Task) {
    const group = this.groupWorkers(task);
    if (!group) return undefined;
    // A name tagged inside a forwarded message is not the person tagging it (COD-257).
    const brief = ownWords(task.currentInput ?? task);
    const tagged = mentionedPeople(brief, group);
    if (tagged) return tagged;
    // `@all` is a tag too, and keeps everyone even on a reply.
    const taggedAnyone = parseMentions(brief, group).length > 0;
    if (!taggedAnyone) {
      const repliedTo = this.repliedOrglet(task, group);
      if (repliedTo) return [repliedTo];
    }
    return group;
  }
  /** The group member who wrote the answer this turn replies to, if the turn replies to one. */
  private repliedOrglet(task: Task, group: Worker[]): Worker | undefined {
    const replyTo = task.currentInput?.replyTo;
    if (!replyTo) return undefined;
    let target: MessageTarget;
    try {
      target = new MessageInteractions(this.store).target(task.id, replyTo);
    } catch {
      return undefined;
    }
    if (target.kind !== 'answer') return undefined;
    return group.find(worker => worker.id === target.workerId);
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
  /**
   * The first message of a worker, team or group chat is the one that takes what was chosen while the chat was
   * still empty. A chat with every orglet ('all') has no empty chat to choose in, and a routine's rows are not chats.
   */
  private isLiveChatStart(input: TaskInput, routine?: Routine): boolean {
    return !routine && input.assignees !== 'all';
  }
  private newChatTarget(input: TaskInput): NewChatTarget {
    if (input.teamId) return { teamId: input.teamId };
    if (Array.isArray(input.assignees)) return { workerIds: input.assignees };
    return { workerId: input.workerId };
  }
  /**
   * Checks the folder waiting for this chat, if any, right before its first message creates the row (COD-186). A
   * folder that is gone or was replaced does not stop the message: the chat starts without it and `createTask`
   * says so on the first run. Either way the waiting entry is used up.
   */
  private async resolveNewChatWorkspace(input: TaskInput): Promise<NewChatFolder | undefined> {
    if (!this.isLiveChatStart(input)) return undefined;
    const pending = this.workspaceGrants.pending(this.newChatTarget(input));
    if (!pending) return undefined;
    try {
      return { pending, resolved: await this.workspaceGrants.confirmPending(pending) };
    } catch (error) {
      return { pending, failure: error instanceof Error ? error.message : String(error) };
    }
  }
  private createTask(input: TaskInput, routine?: Routine, folder?: NewChatFolder, forwarded?: ForwardedMessage): string {
    // The first message of a worker, team or group chat takes the permissions chosen while the chat was still empty.
    const liveChat = this.isLiveChatStart(input, routine) && input.toolCapabilities === undefined;
    const chosen = liveChat ? this.pendingNewChatCapabilities(this.newChatTarget(input)) : undefined;
    const task = this.prepareTask(chosen ? { ...input, toolCapabilities: chosen } : input);
    const workerIds = task.teamSnapshot ? [...task.teamSnapshot.memberIds, task.teamSnapshot.synthesizerId] : task.assignees === 'all' ? this.store.all<Worker>('workers').map(worker => worker.id) : task.assignees ?? [task.workerId];
    for (const workerId of workerIds) snapshotCapabilities(this.store.get<Worker>('workers', workerId).provider, task.toolCapabilities);
    this.policy.assertStart(task.teamId);
    if (routine && task.toolCapabilities?.includes('browser.act')) throw new Error(SCHEDULE_NEVER_ACTS);
    if (routine && (task.toolCapabilities?.includes('desktop.read') || task.desktop?.apps.length)) throw new Error(SCHEDULE_NO_DESKTOP);
    if (routine) task.routineId = routine.id;
    // A forward's first turn keeps its record on the current input, where every later turn keeps its own (COD-257).
    if (forwarded) task.currentInput = { brief: task.brief, sourceIds: [...task.sourceIds], excludedSources: task.excludedSources, forwarded };
    this.store.transaction(() => {
      this.store.put('tasks', task);
      this.chatSearch.indexTurn(task.id, 0, task.currentInput ?? task, task.createdAt);
      if (routine) this.store.update('routines', { ...routine, lastTaskId: task.id });
      if (chosen) this.takeNewChatCapabilities(this.newChatTarget(input));
      if (folder) {
        if (folder.resolved) this.workspaceGrants.applyInsideTransaction(task.id, folder.resolved, folder.pending.permissions);
        this.workspaceGrants.takePending(this.newChatTarget(input));
      }
    });
    this.start(task, true);
    if (folder?.failure) {
      // The runs of the first turn exist as soon as start returns, so the first one carries the reason.
      const firstRun = this.store.detail(task.id).runs[0];
      if (firstRun) this.store.event(firstRun.id, `Chat bắt đầu không có thư mục làm việc ${folder.pending.name}: ${folder.failure} Chọn lại thư mục trong Chi tiết.`);
      this.notify();
    }
    return task.id;
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
    await this.folderTriggers.poll();
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
    void this.runner.run(task, run).catch(() => this.markInterrupted(task.id, run.id));
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
  exportMarkdown(artifactId: string, includeMessageLinks = false): string {
    const artifact = this.store.get<Artifact>('artifacts', artifactId);
    const run = this.store.get<Run>('runs', artifact.runId);
    const task = this.store.get<Task>('tasks', run.taskId);
    const report = artifact.report;
    const reactions = task.messageReactions?.filter(item => item.messageId === artifactId) ?? [];
    const messageLinks = includeMessageLinks ? ['## Message links', `Message ID: ${artifact.id}`,
      artifact.replyTo ? `Reply to: ${artifact.replyTo}` : '',
      ...reactions.map(reaction => {
        const actor = reaction.actor === 'user' ? 'User'
          : this.store.detail(task.id).runs.find(item => item.snapshot.worker.id === reaction.workerId)?.snapshot.worker.name ?? reaction.workerId;
        return `Reaction: ${reaction.emoji} — ${actor}`;
      })].filter(Boolean) : [];
    // A chat answer exports as the message itself, as the chat shows it: a copied source id reads as the file's name.
    if (report.format === 'chat') return [withoutSourceIds(report.summary, this.store.detail(task.id).sources),
      ...(report.limitations.length ? ['## Limitations', ...report.limitations.map(limitation => `- ${limitation}`)] : []),
      ...messageLinks].join('\n\n');
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
    return [`# ${report.title}`, report.summary, ...review, ...findings, '## Limitations', ...report.limitations.map(l => `- ${l}`), '## Sources', ...(run.snapshot.input?.sourceIds ?? task.sourceIds).map(sourceId => { const s = this.store.get<Source>('sources', sourceId); return `- ${s.id}: ${s.name} (SHA-256 ${s.hash})`; }), ...checks, `Run: ${run.id}\nWorker revision: ${run.snapshot.worker.revision}\nSkill revision: ${run.snapshot.skill.revision}\nProvider: ${run.snapshot.worker.provider}\nArtifact SHA-256: ${artifact.hash}`, ...messageLinks].join('\n\n');
  }
}
