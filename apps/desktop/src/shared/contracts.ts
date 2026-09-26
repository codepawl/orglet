import { z } from 'zod';
import type { DecisionRequest } from './work-decisions';
import type { WorkFrame } from './work-frame';
import { ToolCapabilities, type ToolCapability } from './tool-policy';
import { GroupChatWorkerIds, type NewChatTarget, type NewChatWorkspaceView, type WorkspaceGrantSnapshot, type WorkspaceGrantView, type WorkspacePermission } from './workspace-access';
import type { WorkspaceRecoveryView } from './workspace-recovery';
import { ReadRecoveryFile, type RecoveryFile, ReadRecoveryOutput, RestoreWorkspaceFile, RetireWorkspaceAttempt, type RecoveryOutput } from './workspace-recovery';
import { ApplyWorkspaceReview, DiscardWorkspaceReview } from './workspace-review';
import { WorkspaceDiffRequest, type WorkspaceDiff } from './workspace-diff';
import { ExactMatchRequest, ProfileArgs, type DataFormat, type DatasetProfile, type ProfileRecord } from './profiles';
import { PreflightPolicy, type PreflightRecord } from './preflight';
import { Schedule, WorkHours } from './schedule';
import { RoutineTrigger, type WatchFolderView } from './routine-triggers';
import { SkillPackage, type PackageReview } from './skill-package';
import { RunAuditArgs } from './run-audit';
import { DATASET_SOURCE_LIMIT, INLINE_PREVIEW_LIMIT, type MediaKind } from './source-kinds';
import { Review, ReviewPolicy, type EvidenceRequest } from './review';
import { KnowledgeInput, MEMORY_TEXT_LIMIT, type Knowledge, type RunContext } from './knowledge';
import { HarnessCatalogId, type HarnessInfo, type HarnessUsage } from './harness';
import { FontFamily } from './fonts';
import { EraseScope, type EraseSummary } from './erase';
import { CurrencyCode, type CurrencyState } from './currency';
import { Language } from './i18n';
import { CustomModelId, type ModelListResult } from './models';
import { SetUserReaction, type MessageReaction } from './message-interactions';
import type { AboutInfo, AboutLink, Changelog, UpdateState } from './updates';
import type { AppProposal } from './app-proposals';
import { WebSearchProvider, type WebSearchKeyProvider, type WebSearchTest } from './web-tools';
import { CustomConnectionInput, CustomProviderId, isCustomProvider, type CustomConnection } from './custom-connections';
import { McpGrant, type McpRunTool, type McpServerView } from './mcp';
import type { ChatQuote, SideOf } from './side-threads';
import { ForwardedMessage, ForwardMessageArgs, type ForwardResult } from './forward';
import type { ChatSearchResult } from './chat-search';
import { BrowserChoice, type BrowserAction, type BrowserLive, type BrowserProfileId, type BrowserState } from './browser';
import { DesktopChoice, type DesktopAction, type DesktopLive, type DesktopWindowsView } from './desktop';

export const Id = z.string().uuid();
/** The providers Orglet ships with. A custom OpenAI-compatible connection is `custom:<id>` (shared/custom-connections.ts). */
export const BuiltInProviderId = z.enum(['demo', 'openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', 'ollama', 'claude-code', 'codex', 'cursor', 'gemini']);
export type BuiltInProviderId = z.infer<typeof BuiltInProviderId>;
export const ProviderId = z.union([BuiltInProviderId, CustomProviderId]);
export type ProviderId = z.infer<typeof ProviderId>;
/** Providers that receive task content and therefore need per-task consent. */
export const ProviderScope = z.union([BuiltInProviderId.exclude(['demo']), CustomProviderId]);
export type ProviderScope = z.infer<typeof ProviderScope>;
/**
 * Every provider a chat or a setting may list at once: all the built-in ones and every custom connection. A crew of
 * eight on eight different connections, or a group chat with everyone, must still fit.
 */
export const MAX_PROVIDER_SCOPES = 32;
/** API providers that store an encrypted connection (not local harnesses). Ollama stores a local sentinel, not a billed key. */
export const ApiProvider = z.enum(['openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', 'ollama']);
export type ApiProvider = z.infer<typeof ApiProvider>;
/** What main keeps a key for: a built-in API, or a custom connection under its own id. */
export const CredentialProvider = z.union([ApiProvider, CustomProviderId]);
export type CredentialProvider = z.infer<typeof CredentialProvider>;
export const API_PROVIDER_NAMES: Record<ApiProvider, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', xai: 'Grok (xAI)', openrouter: 'OpenRouter',
  'opencode-zen': 'OpenCode Zen', 'opencode-go': 'OpenCode Go', ollama: 'Ollama',
};
export function isLocalApi(provider: string): provider is 'ollama' {
  return provider === 'ollama';
}
/**
 * Pay-per-use APIs whose requests Orglet reserves against the task, team and connection budgets. A custom
 * connection counts: Orglet has no verified price for it, so every request is an unknown charge, never a free one.
 */
export function isPaidApi(provider: string): boolean {
  if (isCustomProvider(provider)) return true;
  return provider === 'openai' || provider === 'anthropic' || provider === 'xai' || provider === 'openrouter';
}
/**
 * APIs whose spending is bounded by the provider's own controls, not Orglet budgets: the OpenCode Go subscription
 * limits and the OpenCode Zen balance and spending limit. Orglet has no verified price for either, so these requests
 * are never reserved against Orglet budgets (main session decision, 2026-09-21).
 */
export function isPlanApi(provider: string): provider is 'opencode-zen' | 'opencode-go' {
  return provider === 'opencode-zen' || provider === 'opencode-go';
}
export const WorkerAvatar = z.object({ mascot: z.string().regex(/^[a-z-]{1,32}$/).optional(), letter: z.literal(true).optional(), emoji: z.string().min(1).max(16).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }).strict();
export const WorkerInput = z.object({
  id: Id.optional(), name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(16000),
  provider: ProviderId, skillId: Id,
  // Selected or typed model slug. Absence means the catalog suggestion for this provider (or the CLI default for a harness).
  modelId: CustomModelId.optional(),
  // Limit per task for this worker's chat: reserved against for a paid API, passed to Claude Code as its spending cap;
  // Codex, Cursor Agent, Gemini CLI and Demo have no cap to give it to.
  taskBudgetMicros: z.number().int().min(1000).max(100_000_000).optional(),
  // Presentation only: shown in the app and carried by templates, never sent to a model.
  avatar: WorkerAvatar.optional(),
  description: z.string().trim().max(160).optional(),
  // Apply this worker's safe app-change proposals when its run finishes instead of waiting for a click (COD-199).
  // Off unless the user turns it on; a worker's proposal tools cannot set it.
  autoApplyProposals: z.boolean().optional(),
  // MCP servers this worker may use (COD-241), none unless the person picks some. Each call still asks in the chat.
  mcpServerIds: z.array(Id).max(20).refine(ids => new Set(ids).size === ids.length, 'Máy chủ MCP bị trùng.').optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;
export type WorkerAvatar = z.infer<typeof WorkerAvatar>;
/** A crew holds up to eight orglets; a lead plans for all of them in one turn. */
export const MAX_CREW_MEMBERS = 8;
/** How many chats of one crew may run at once. */
export const MAX_CREW_CONCURRENT_TASKS = 8;
/** How many requests may be in flight to one provider at once, across the whole app. */
export const MAX_PROVIDER_CONCURRENCY = 8;
/** Above this many at once, the editors say that more at once means more spend at once. */
export const QUIET_PARALLEL_LIMIT = 4;
export const TeamInput = z.object({
  id: Id.optional(), name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(16000),
  memberIds: z.array(Id).min(1).max(MAX_CREW_MEMBERS).refine(ids => new Set(ids).size === ids.length, 'Members must be unique'),
  synthesizerId: Id, workflow: z.enum(['sequential', 'parallel']),
  monthlyBudgetMicros: z.number().int().min(1000).max(1_000_000_000),
  preflight: PreflightPolicy.optional(),
  reviewPolicy: ReviewPolicy.optional(),
  workHours: WorkHours.optional(),
  maxConcurrentTasks: z.number().int().min(1).max(MAX_CREW_CONCURRENT_TASKS).optional(),
  taskBudgetMicros: z.number().int().min(1000).max(100_000_000).optional(),
});
export type Team = z.infer<typeof TeamInput> & { id: string; revision: number };
export const SkillInput = z.object({ id: Id.optional(), name: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(16000) });
// Archived tasks are deleted after this many days; 0 keeps them until the user deletes them.
export const ArchiveRetention = z.union([z.literal(0), z.literal(7), z.literal(30)]);
export type ArchiveRetention = z.infer<typeof ArchiveRetention>;
// How an answer or document is copied or downloaded; 'ask' shows a menu each time.
export const TextFormat = z.enum(['text', 'markdown']);
export type TextFormat = z.infer<typeof TextFormat>;
export const FormatPreference = z.enum(['ask', 'text', 'markdown']);
export type FormatPreference = z.infer<typeof FormatPreference>;
export type EntityState = Record<'workers' | 'teams', Record<string, { archivedAt?: string; deletedAt?: string }>>;
export const TaskInput = z.object({
  workerId: Id, teamId: Id.optional(), brief: z.string().trim().min(1).max(16000),
  // Group chat: several workers, or 'all' (every worker, including ones added later), answer each message in turn.
  assignees: z.union([z.literal('all'), z.array(Id).min(1).max(50)]).optional(),
  sourceIds: z.array(Id).max(20), consent: z.boolean(),
  toolCapabilities: ToolCapabilities.optional(),
  // The browser's profile and site list (COD-261); a schedule carries its own, a chat starts on the Clean profile.
  browser: BrowserChoice.optional(),
  // The desktop programs the chat may see and use (COD-261, phase 2a); a chat starts with none.
  desktop: DesktopChoice.optional(),
  excludedSources: z.array(z.object({ name: z.string().max(4096), reason: z.string().max(2000) }).strict()).max(20020).optional(),
  providerScopes: z.array(ProviderScope).max(MAX_PROVIDER_SCOPES).optional(),
  budgetMicros: z.number().int().min(1000).max(100_000_000),
});
export type TaskInput = z.infer<typeof TaskInput>;
// `forwarded` is set by the core on a forward's turn (COD-257); the window can never send one in a brief of its own.
// `continueFrom` is the run of the turn before, when the person pressed Continue after it ran out of steps (COD-257):
// the new run starts with that run's tool calls and results instead of redoing them.
export const RunInput = TaskInput.pick({ brief: true, sourceIds: true, excludedSources: true }).extend({ replyTo: Id.optional(), forwarded: ForwardedMessage.optional(), continueFrom: Id.optional() }).strict();
export type RunInput = z.infer<typeof RunInput>;
/** Orchestrator routing for one team-chat turn (COD-25). Stored on the plan run snapshot; not a user-facing artifact. */
export const PlanAssignment = z.object({
  workerId: Id,
  brief: z.string().trim().min(1).max(16000),
  expectedOutput: z.string().trim().min(1).max(2000).optional(),
  dependsOn: z.array(Id).max(MAX_CREW_MEMBERS - 1).refine(ids => new Set(ids).size === ids.length, 'Phụ thuộc bị trùng.').optional(),
  writeResources: z.array(z.string().trim().min(1).max(240).refine(
    resource => !resource.startsWith('/') && !resource.includes('\\') && !resource.includes(':')
      && !/[<>|?*]/.test(resource)
      && resource.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[ .]$/.test(part)),
    'Tài nguyên cần là đường dẫn tương đối trong workspace.',
  )).max(20).optional(),
}).strict();
export const TeamPlan = z.object({
  assignments: z.array(PlanAssignment).min(1).max(MAX_CREW_MEMBERS).refine(items => new Set(items.map(item => item.workerId)).size === items.length, 'Members must be unique'),
  note: z.string().trim().max(2000).optional(),
  /** Notes for the lead's own synthesis step, which combines the members' saved results into the final answer. */
  synthesisBrief: z.string().trim().min(1).max(4000).optional(),
}).strict();
export type TeamPlan = z.infer<typeof TeamPlan>;
/** Queued member run skipped because the orchestrator did not assign that worker this turn. */
export const UNASSIGNED_PLAN_ERROR = 'Không được phân việc cho lượt này.';
export const MISSING_PLAN_ERROR = 'Phân việc không có kết quả. Không chạy thành viên và không bịa báo cáo.';
export const INVALID_PLAN_ERROR = 'Phân việc không hợp lệ: Tí không thuộc hội.';
/** `schedule` stays on every routine, so switching the trigger back to the clock keeps the time the person set. */
export const RoutineInput = z.object({ id: Id.optional(), name: z.string().trim().min(1).max(80), enabled: z.boolean(), schedule: Schedule, trigger: RoutineTrigger.optional(), task: TaskInput }).strict();
/**
 * `pending` is a clock routine's one missed run. `notice` is why an event trigger's files did not start a run, or
 * are waiting for the previous run to end; the person dismisses it like a miss, and there is nothing to catch up.
 */
export const Routine = RoutineInput.extend({ id: Id, revision: z.number().int().positive(), approvedConfig: z.string(), nextDueAt: z.iso.datetime(), pending: z.object({ dueAt: z.iso.datetime(), reason: z.string() }).strict().nullable(), notice: z.object({ at: z.iso.datetime(), reason: z.string() }).strict().optional(), lastTaskId: Id.optional() }).strict();
export type Routine = z.infer<typeof Routine>;
export const Handoff = z.object({ createdAt: z.iso.datetime(), artifactIds: z.array(Id), blockers: z.array(z.string()), nextSteps: z.array(z.string()), chargedMicros: z.number().int().nonnegative(), reservedMicros: z.number().int().nonnegative(), uncertainCount: z.number().int().nonnegative() }).strict();
export type Handoff = z.infer<typeof Handoff>;
export const FindingCategory = z.enum(['challenge', 'data', 'scoring', 'runs', 'other']);
export const SourceLocation = z.object({ sourceId: Id, startLine: z.number().int().min(1).max(1_000_000), endLine: z.number().int().min(1).max(1_000_000) }).strict().refine(location => location.endLine >= location.startLine && location.endLine - location.startLine < 500, 'Line range must be ordered and under 500 lines');
export const Finding = z.object({
  title: z.string().min(1).max(300),
  severity: z.enum(['info', 'warning', 'critical']),
  detail: z.string().min(1).max(8000),
  sourceIds: z.array(Id).max(20),
  coverage: z.string().min(1).max(1000),
  category: FindingCategory.optional(),
  recommendation: z.string().min(1).max(2000).nullable().optional(),
  checkerIds: z.array(Id).max(20).optional(),
  workspaceEvidenceIds: z.array(Id).max(20).optional(),
  locations: z.array(SourceLocation).max(20).optional(),
  provenance: z.object({ findingId: Id, writerId: Id, runId: Id }).strict().optional(),
});
export const Report = z.object({
  // 'chat' is a normal message to the user; missing or 'report' is a structured report (older artifacts have no format).
  format: z.enum(['chat', 'report']).optional(),
  title: z.string().min(1).max(300), summary: z.string().min(1).max(16000),
  findings: z.array(Finding).max(50),
  limitations: z.array(z.string().min(1).max(2000)).max(100),
  review: Review.nullable().optional(),
});
export type Report = z.infer<typeof Report>;
export type Worker = WorkerInput & { id: string; revision: number };
export type Skill = z.infer<typeof SkillInput> & { id: string; revision: number; package?: SkillPackage };
/**
 * `format` marks a dataset the checkers can profile; `media` marks a preview-only file no worker can read yet.
 * `editedFrom` is the source this one was edited from in the viewer (COD-280); the edit is Orglet's own copy.
 */
export type Source = { id: string; name: string; bytes: number; hash: string; revoked: boolean; format?: DataFormat; media?: MediaKind; editedFrom?: string };
/** Where an attached file was picked from, for the person's own eyes only; never sent to a model. */
export type SourceOrigin = { id: string; path: string | null };
/** Verified bytes of a media source for an inline preview. */
export type SourceBytes = { name: string; mimeType: string; bytes: Uint8Array };
export type FolderIntake = { sources: Source[]; skipped: { name: string; reason: string }[] };
export type TaskStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'waiting_budget' | 'waiting_input';
export type Task = { toolCapabilities?: ToolCapability[]; messageReactions?: MessageReaction[]; id: string; brief: string; title?: string; workerId: string; teamId?: string; teamSnapshot?: Team; assignees?: 'all' | string[]; archivedAt?: string; deletedAt?: string; status: TaskStatus; createdAt: string; budgetMicros: number; sourceIds: string[]; excludedSources?: FolderIntake['skipped']; consent: boolean; providerScopes?: ProviderScope[]; accepted: boolean; /** A new input was saved while an older run was stopping; dispatch only after it settles. */ pendingStart?: boolean; /** Stamp of the result the user last opened; unread when it differs from `taskResultStamp`. */ seenStamp?: string; /** Latest saved answer/report id, part of the result stamp. */ lastArtifactId?: string; /** When the user last opened this task. */ seenAt?: string; routineId?: string; /** The schedule's name, kept on its runs when the schedule is deleted (COD-283); they stay chats. */ routineName?: string; pauseReason?: 'shift'; handoff?: Handoff; evidenceRequests?: EvidenceRequest[]; decisionRequests?: DecisionRequest[]; /** MCP tools this chat allows without asking again, per server or per tool (COD-241). */ mcpGrants?: McpGrant[]; /** Set on a side thread: the main chat it was started from (COD-247). */ sideOf?: SideOf; /** Answers brought in from side threads, shown as quoted messages in this main chat (COD-247). */ quotes?: ChatQuote[]; /** The browser's profile and site list (COD-261); absent is the Clean profile and no list. */ browser?: BrowserChoice; /** The desktop programs the chat granted (COD-261, phase 2a); absent is none. */ desktop?: DesktopChoice; inputRevision?: number; currentInput?: RunInput };
export type RunStage = 'plan' | 'member' | 'synthesis' | 'group';
/**
 * Why a run stopped, in a form the renderer can act on without reading the message: `unresolved_attempt` means an
 * earlier attempt in this chat holds a file change, command or working copy whose outcome is unknown, and the chat
 * cannot write again until that attempt is reviewed and retired (COD-191). `report_rejected` means the report the
 * worker handed in failed the citation, checker, line-range or process gates, which counts as feedback on the worker's
 * own work (COD-162).
 */
/** plan_limit: a harness account ran out of plan usage (COD-225). */
/** hand_in_blocked: a command that failed after the last file change kept the copy out of the folder (COD-270). */
export type RunErrorCode = 'unresolved_attempt' | 'report_rejected' | 'plan_limit' | 'hand_in_blocked';
export type Run = { id: string; taskId: string; stage?: RunStage; status: TaskStatus; errorCode?: RunErrorCode; /** Set when the run handed in because its steps ran out, not because the work was done (COD-257). */ outOfSteps?: true; /** Which commands refused this run's hand-in and, in a solo chat, the answer waiting on the person (COD-270). */ blockedHandIn?: import('./blocked-hand-in').BlockedHandIn; snapshot: { workspaceGrant?: WorkspaceGrantSnapshot; assignment?: z.infer<typeof PlanAssignment>; reassignment?: import('./team-messages').TeamReassignment; toolCapabilities?: ToolCapability[]; worker: Worker; skill: Skill; team?: Team; input?: RunInput; context?: RunContext; workFrame?: WorkFrame; inputRevision?: number; upstreamArtifactIds?: string[]; preflightId?: string; scoreProfileIds?: string[]; model?: string; pricingVersion?: string; plan?: TeamPlan; /** Repeated feedback on this worker's earlier work, frozen when the run started (COD-162); present only on a chat run that may act on it. */ improvement?: import('./self-improvement').ImprovementSignal[]; /** MCP tools this run may call, frozen when it first started (COD-241); absent on runs that were never offered any. */ mcpTools?: McpRunTool[]; /** The browser profile this run started with (COD-261); a chat that switches profile reaches the next run, never this one. */ browser?: { profileId: BrowserProfileId }; /** The desktop programs this run started with (COD-261, phase 2a); each step also needs the chat to grant them still. */ desktop?: { programs: string[] } }; startedAt: string; error: string | null };
export type Activity = { id: string; runId: string; sequence?: number; message: string; createdAt: string; teamMessage?: import('./team-messages').TeamMessage };
/** A memory the answer was written with, as the run froze it (COD-161); the row may have been edited or deleted since. */
export type UsedMemory = { id: string; revision: number; text: string };
export type Artifact = { id: string; runId: string; report: Report; hash: string; createdAt: string; replyTo?: string; usedMemories?: UsedMemory[] };
export type Usage = { chargedMicros: number; reservedMicros: number; uncertainCount: number; inputTokens: number; outputTokens: number };
export type BudgetReservationView = {
  id: string;
  taskId: string;
  runId: string;
  provider: string;
  month: string;
  originalMicros: number;
  reason: 'missing_usage' | 'request_failed' | 'interrupted' | 'legacy';
  notedAt: string;
  actualMicros: number | null;
  verifiedSource: 'provider_dashboard' | 'invoice' | null;
  resolvedAt: string | null;
};
export type TaskDetail = { task: Task; runs: Run[]; events: Activity[]; artifacts: Artifact[]; profiles: ProfileRecord[]; preflights: PreflightRecord[]; sources: Source[]; workspaceEvidence: (import('./workspace-evidence').WorkspaceReadEvidence & { grantCurrent: boolean })[]; /** App changes the chat's workers proposed, with what became of each (COD-199). */ appProposals: AppProposal[]; usage: Usage; /** What the chat's browser shows right now: a card waiting on the person, the take-over (COD-261); only the `task` command fills it. */ browser?: BrowserLive; /** A desktop step waiting on the person (COD-261, phase 2a); only the `task` command fills it. */ desktop?: DesktopLive };
/** How the in-app brand mark is coloured: the text colour, or the user's accent (COD-154). */
export const LogoColor = z.enum(['mono', 'accent']);
export type LogoColor = z.infer<typeof LogoColor>;
export type Workspace = { copyFormat: FormatPreference; downloadFormat: FormatPreference; archivedWorkers: (Worker & { archivedAt: string })[]; archivedTeams: (Team & { archivedAt: string })[]; language: Language; autoTitles: boolean; confirmOpenTask: boolean; archiveRetentionDays: ArchiveRetention; avatarColors: string[]; /** The one colour the user picks for the app; see shared/accent.ts. */ accentColor: string; logoColor: LogoColor; /** Family names the person picked; absent keeps the fonts the app ships with (shared/fonts.ts). */ interfaceFont?: string; codeFont?: string; /** Check for a new build on a schedule and download it in the background (COD-176); off means manual checks only. */ autoUpdate: boolean; /** Raise a system notification when a chat finishes, fails or needs the person while the window is in the background (COD-258). */ backgroundNotifications: boolean; knowledge: Knowledge[]; workers: Worker[]; teams: Team[]; skills: Skill[]; tasks: Task[]; routines: Routine[]; usage: Usage; budgetReservations: BudgetReservationView[]; theme: 'system' | 'light' | 'dark'; connectionLimitMicros: number; providerConcurrency: number; providerConsent: ProviderScope[]; /** OpenAI-compatible connections the person added (COD-242); names and addresses only, never a key. */ customConnections: CustomConnection[]; currency: CurrencyState; sqliteVersion: string; /** Permissions chosen for a chat before its first message, keyed by `newChatKey`; `createTask` moves them onto the new row (COD-178). */ newChatCapabilities: Record<string, ToolCapability[]>; /** The working folder chosen for a chat before its first message, keyed the same way; only its name and level reach the renderer (COD-186). */ newChatWorkspace: Record<string, NewChatWorkspaceView>; /** App changes workers' proposals made recently, newest first, so the renderer can announce each one (user, 2026-09-23). */ recentAppChanges: import('./app-proposals').AppChangeNotice[]; /** MCP servers the person added, with names but never secret values, and each one's state (COD-241). */ mcpServers: McpServerView[]; /** Where `web_search` sends queries (COD-266); Exa unless the person picked another. */ webSearchProvider: WebSearchProvider; /** Every run working, waiting its turn or stopped at a checkpoint (COD-244). The core's `workspace` command fills it from the runners, so it arrives with the tasks it describes; a store-only read leaves it out. */ running?: import('./running').RunningItem[] };
/** Which built-in APIs have a saved key, and which custom connections (by connection id) have one. Never the key itself. */
export type Connections = Record<ApiProvider, boolean> & { custom: Record<string, boolean>; /** Keys for web search (COD-266), kept apart from the model connections. */ search: Record<WebSearchKeyProvider, boolean> };
export const emptyConnections = (): Connections => ({ openai: false, anthropic: false, xai: false, openrouter: false, 'opencode-zen': false, 'opencode-go': false, ollama: false, custom: {}, search: { exa: false } });

export const commands = {
  workspace: z.object({}),
  task: z.object({ id: Id }),
  createTask: TaskInput,
  reviseTask: RunInput.omit({ forwarded: true }).extend({ taskId: Id, consent: z.boolean(), providerScopes: z.array(ProviderScope).max(MAX_PROVIDER_SCOPES), budgetMicros: z.number().int().min(1000).max(100_000_000) }).strict(),
  // A message sent "in a new thread" from an orglet's main chat (COD-247): a side thread of the same orglet, with the
  // main chat's permissions and never more. `taskId` is the main chat; the sources must already belong to it.
  startSideThread: RunInput.omit({ replyTo: true, forwarded: true, continueFrom: true }).extend({ taskId: Id, consent: z.boolean(), providerScopes: z.array(ProviderScope).max(MAX_PROVIDER_SCOPES), budgetMicros: z.number().int().min(1000).max(100_000_000) }).strict(),
  // Copies a side thread's answer into its main chat as a quoted message; it never starts a run.
  bringIntoMainChat: z.object({ artifactId: Id }).strict(),
  // Sends one message of a chat to up to five other chats as the person's own message (COD-257); each one is a turn there.
  forwardMessage: ForwardMessageArgs,
  setMessageReaction: SetUserReaction,
  answerDecision: z.object({ taskId: Id, requestId: Id, answer: z.string().trim().min(1).max(2000) }).strict(),
  saveWorker: WorkerInput,
  saveTeam: TeamInput,
  createTemplate: z.object({ templateId: z.enum(['research-review', 'eris-review']), provider: z.enum(['demo', 'openai']) }),
  saveSkill: SkillInput,
  inspectSkill: z.object({ id: Id }),
  reviewSkill: z.object({ id: Id, hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  saveRoutine: RoutineInput,
  dismissRoutine: z.object({ id: Id }),
  catchUpRoutine: z.object({ id: Id }),
  /** Run now in the Schedules list: the guards a trigger passes, with the schedule's own files only. */
  runRoutineNow: z.object({ id: Id }).strict(),
  /** Deletes a schedule; its past runs stay as chats and keep its name (COD-283). */
  deleteRoutine: z.object({ id: Id }).strict(),
  cancel: z.object({ id: Id }),
  pause: z.object({ id: Id }),
  resume: z.object({ id: Id }),
  retry: z.object({ id: Id }),
  reconcileBudget: z.object({ reservationId: Id, amountMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), source: z.enum(['provider_dashboard', 'invoice']) }).strict(),
  revoke: z.object({ id: Id }),
  /** A chat's permissions; before its first message, the set the chat with this worker, team or group of orglets will start with (COD-178, COD-215). */
  setToolCapabilities: z.union([
    z.object({ taskId: Id, capabilities: ToolCapabilities }).strict(),
    z.object({ workerId: Id, capabilities: ToolCapabilities }).strict(),
    z.object({ teamId: Id, capabilities: ToolCapabilities }).strict(),
    z.object({ workerIds: GroupChatWorkerIds, capabilities: ToolCapabilities }).strict(),
  ]),
  workspaceAccess: z.object({ taskId: Id }).strict(),
  workspaceRecovery: z.object({ taskId: Id }).strict(),
  retireWorkspaceAttempt: RetireWorkspaceAttempt,
  recoveryProcessOutput: ReadRecoveryOutput,
  recoveryFile: ReadRecoveryFile,
  /** Puts a file a hand-in deleted back from its private backup; never over something at that path (COD-254). */
  restoreWorkspaceFile: RestoreWorkspaceFile,
  /** What a run changed in its private working copy, file by file with hunks; read-only (COD-163). */
  workspaceDiff: WorkspaceDiffRequest,
  /**
   * The person applies a run's copy although a command failed after its last edit (COD-270). Only this command skips
   * that rule, only for the commands that blocked this run, and every other hand-in check still applies.
   */
  applyBlockedHandIn: z.object({ taskId: Id, runId: Id }).strict(),
  /** The person applies changes a run held for review, all of them or the files they left ticked (COD-279). */
  applyWorkspaceReview: ApplyWorkspaceReview,
  /** The person drops changes a run held for review; nothing reaches the folder (COD-279). */
  discardWorkspaceReview: DiscardWorkspaceReview,
  /** Drops a chat's folder; with a `workerId`, `teamId` or `workerIds`, the folder waiting for a chat that has not started (COD-186). */
  revokeWorkspace: z.union([z.object({ taskId: Id }).strict(), z.object({ workerId: Id }).strict(), z.object({ teamId: Id }).strict(), z.object({ workerIds: GroupChatWorkerIds }).strict()]),
  previewSource: z.object({ taskId: Id, id: Id }),
  sourceBytes: z.object({ taskId: Id, id: Id }).strict(),
  sourceOrigins: z.object({ taskId: Id }).strict(),
  /**
   * The person saved an edit of a chat's source in the viewer (COD-280): text for a text or data file, PNG bytes for an
   * image, PDF bytes for a PDF. It becomes a new source of the same chat; the original is never written.
   */
  saveSourceVersion: z.union([
    z.object({ taskId: Id, sourceId: Id, name: z.string().min(1).max(255), text: z.string().max(DATASET_SOURCE_LIMIT) }).strict(),
    z.object({ taskId: Id, sourceId: Id, name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= INLINE_PREVIEW_LIMIT) }).strict(),
  ]),
  sourceMetadata: z.object({ ids: z.array(Id).max(20) }),
  profileSources: ProfileArgs.extend({ taskId: Id }),
  auditRunLog: RunAuditArgs.extend({ taskId: Id }),
  scoreExactMatch: ExactMatchRequest.safeExtend({ taskId: Id }),
  cancelCheckers: z.object({ id: Id }),
  accept: z.object({ id: Id }),
  markTaskSeen: z.object({ id: Id }),
  acknowledgeEvidence: z.object({ taskId: Id, requestId: Id }),
  saveKnowledge: KnowledgeInput,
  // A worker's proposed app change (COD-199): apply it through the same commands the UI uses, drop it, or take an
  // automatic apply back.
  // The face the card showed for a new orglet, so the orglet keeps the avatar the person saw when they applied it.
  applyAppProposal: z.object({ id: Id, avatar: WorkerAvatar.optional() }).strict(),
  dismissAppProposal: z.object({ id: Id }).strict(),
  undoAppProposal: z.object({ id: Id }).strict(),
  reviewKnowledge: z.object({ id: Id, revision: z.number().int().positive(), decision: z.enum(['approve', 'archive']) }).strict(),
  searchKnowledge: z.object({ query: z.string().max(200) }).strict(),
  // Every message, answer and chat, orglet and crew name (COD-267); only the first words of a long query are used.
  searchChats: z.object({ query: z.string().max(2000) }).strict(),
  // A worker's memory, corrected by the person (COD-161): new text or a pin makes a new approved revision; delete removes it for good.
  updateMemory: z.object({ id: Id, text: z.string().trim().min(1).max(MEMORY_TEXT_LIMIT).optional(), pinned: z.boolean().optional() }).strict(),
  deleteMemory: z.object({ id: Id }).strict(),
  harnesses: z.object({ refresh: z.boolean() }).strict(),
  // Plan usage and the signed-in account for every harness account; read over the network, so apart from detection.
  harnessUsage: z.object({ refresh: z.boolean() }).strict(),
  // A harness account is a folder the CLI signs in to; adding one selects it so the next login command is its own.
  saveHarnessAccount: z.object({ harness: HarnessCatalogId, id: z.string().min(1).max(64).optional(), label: z.string().trim().min(1).max(60) }).strict(),
  removeHarnessAccount: z.object({ harness: HarnessCatalogId, id: z.string().min(1).max(64) }).strict(),
  selectHarnessAccount: z.object({ harness: HarnessCatalogId, id: z.string().min(1).max(64) }).strict(),
  // Deleting what the app has kept. `confirm` is the word the window made the person type for a full erase.
  eraseData: z.object({ scope: EraseScope, confirm: z.string().optional() }).strict(),
  modelList: z.object({ provider: ProviderId, refresh: z.boolean().optional() }).strict(),
  // A custom OpenAI-compatible connection: its name and base URL. The key goes through `connect`, to main only.
  saveCustomConnection: CustomConnectionInput,
  // Refused while a live orglet uses it; main then drops the connection's key from the credential store.
  deleteCustomConnection: z.object({ id: Id }).strict(),
  setCurrency: z.object({ code: CurrencyCode }).strict(),
  // Display-only names and sidebar order; kept in settings so a running task never overwrites them.
  renameTask: z.object({ id: Id, title: z.string().trim().max(120) }).strict(),
  // Task settings: name, assignee (a worker, or a team and its synthesizer) and cost limit; applies from the next message.
  archiveTask: z.object({ id: Id, archived: z.boolean() }).strict(),
  // Workers and teams are archived or deleted by state kept in settings, so their revision history and backups stay intact.
  archiveEntity: z.object({ kind: z.enum(['worker', 'team']), id: Id, archived: z.boolean() }).strict(),
  deleteEntity: z.object({ kind: z.enum(['worker', 'team']), id: Id }).strict(),
  deleteTask: z.object({ id: Id }).strict(),
  updateTask: z.object({ id: Id, title: z.string().trim().max(120), assignee: z.discriminatedUnion('kind', [z.object({ kind: z.literal('workers'), workerIds: z.array(Id).min(1).max(50) }).strict(), z.object({ kind: z.literal('team'), teamId: Id }).strict(), z.object({ kind: z.literal('all') }).strict()]), budgetMicros: z.number().int().min(1000).max(100_000_000) }).strict(),
  reorder: z.object({ kind: z.enum(['teams', 'workers']), ids: z.array(Id).max(1000) }).strict(),
  // Colours the user made in the avatar picker, newest first, offered to every worker.
  saveAvatarColors: z.object({ colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).max(16).refine(items => new Set(items).size === items.length, 'Duplicate colour') }).strict(),
  refreshCurrency: z.object({}).strict(),
  // MCP servers (COD-241). Saving and removing go through main, which holds their secret values; these touch no secret.
  testMcpServer: z.object({ id: Id }).strict(),
  /** One real query through the saved web search provider, for Settings → Web search → Test (COD-266). */
  testWebSearch: z.object({}).strict(),
  setMcpServerEnabled: z.object({ id: Id, enabled: z.boolean() }).strict(),
  // A chat's standing MCP permission: allowed adds it, not allowed takes it away; a call already running keeps going.
  setMcpGrant: McpGrant.extend({ taskId: Id, allowed: z.boolean() }).strict(),
  // A chat's browser profile and site list (COD-261). A side thread follows its main chat and cannot set its own.
  setBrowser: z.object({ taskId: Id, browser: BrowserChoice }).strict(),
  // Every browser step the chat's runs took, newest last, and one screenshot's bytes; read-only.
  browserActions: z.object({ taskId: Id }).strict(),
  browserScreenshot: z.object({ taskId: Id, id: Id }).strict(),
  // The person's answer to the card that asks about one consequential browser step; there is no "always".
  answerBrowserApproval: z.object({ taskId: Id, requestId: Id, answer: z.enum(['allow', 'decline']) }).strict(),
  // Take the chat's browser over (true) or hand it back (false). Taken over, the person uses it in Orglet's live view,
  // or with `inChrome` in a Chrome window; the result says whether the tabs are in Chrome now.
  browserTakeOver: z.object({ taskId: Id, taken: z.boolean(), inChrome: z.boolean().optional() }).strict(),
  // The desktop programs a chat may see and use (COD-261, phase 2a). A side thread follows its main chat.
  setDesktop: z.object({ taskId: Id, desktop: DesktopChoice }).strict(),
  // The windows open now, for the person to pick a program from; Orglet's own and refused programs are left out.
  desktopWindows: z.object({}).strict(),
  // Every desktop step the chat's runs took, and one window picture's bytes; read-only.
  desktopActions: z.object({ taskId: Id }).strict(),
  desktopScreenshot: z.object({ taskId: Id, id: Id }).strict(),
  // The person's answer to the card that asks about one consequential desktop step; there is no "always".
  answerDesktopApproval: z.object({ taskId: Id, requestId: Id, answer: z.enum(['allow', 'decline']) }).strict(),
  settings: z.object({ language: Language.optional(), autoTitles: z.boolean().optional(), confirmOpenTask: z.boolean().optional(), copyFormat: FormatPreference.optional(), downloadFormat: FormatPreference.optional(), archiveRetentionDays: ArchiveRetention.optional(), theme: z.enum(['system', 'light', 'dark']), connectionLimitMicros: z.number().int().min(1000).max(1_000_000_000), providerConcurrency: z.number().int().min(1).max(MAX_PROVIDER_CONCURRENCY).optional(), providerConsent: z.array(ProviderScope).max(MAX_PROVIDER_SCOPES).refine(items => new Set(items).size === items.length, 'Duplicate provider').optional(), accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), logoColor: LogoColor.optional(), interfaceFont: FontFamily.nullable().optional(), codeFont: FontFamily.nullable().optional(), autoUpdate: z.boolean().optional(), backgroundNotifications: z.boolean().optional(), webSearchProvider: WebSearchProvider.optional() }),
} as const;
export type Command = keyof typeof commands;
export type Args<C extends Command> = z.infer<(typeof commands)[C]>;
export type Results = { forwardMessage: ForwardResult; setBrowser: void; browserActions: BrowserAction[]; browserScreenshot: { mimeType: 'image/png'; bytes: Uint8Array }; answerBrowserApproval: void; browserTakeOver: boolean; setDesktop: void; desktopWindows: DesktopWindowsView; desktopActions: DesktopAction[]; desktopScreenshot: { mimeType: 'image/png'; bytes: Uint8Array }; answerDesktopApproval: void; searchChats: ChatSearchResult; startSideThread: string; bringIntoMainChat: string; testMcpServer: McpServerView; setMcpServerEnabled: void; setMcpGrant: void; applyAppProposal: AppProposal; dismissAppProposal: void; undoAppProposal: AppProposal; reconcileBudget: void; recoveryFile: RecoveryFile; restoreWorkspaceFile: void; workspaceDiff: WorkspaceDiff; recoveryProcessOutput: RecoveryOutput; retireWorkspaceAttempt: void; workspaceRecovery: WorkspaceRecoveryView; workspaceAccess: WorkspaceGrantView | null; revokeWorkspace: void; setToolCapabilities: void; setMessageReaction: void; renameTask: void; updateTask: void; archiveTask: void; deleteTask: void; archiveEntity: void; deleteEntity: void; reorder: void; saveAvatarColors: void; setCurrency: CurrencyState; refreshCurrency: CurrencyState; harnesses: HarnessInfo[]; harnessUsage: HarnessUsage; saveHarnessAccount: HarnessInfo[]; removeHarnessAccount: HarnessInfo[]; selectHarnessAccount: HarnessInfo[]; eraseData: EraseSummary; modelList: ModelListResult; saveCustomConnection: CustomConnection; deleteCustomConnection: void; saveKnowledge: Knowledge; reviewKnowledge: void; searchKnowledge: Knowledge[]; updateMemory: Knowledge; deleteMemory: void; reviseTask: void; answerDecision: void; acknowledgeEvidence: void; auditRunLog: DatasetProfile; scoreExactMatch: DatasetProfile; inspectSkill: PackageReview; reviewSkill: void; workspace: Workspace; task: TaskDetail; createTask: string; saveWorker: Worker; saveTeam: Team; createTemplate: Team; saveSkill: Skill; saveRoutine: Routine; dismissRoutine: void; catchUpRoutine: string; cancel: void; pause: void; resume: void; retry: void; revoke: void; sourceMetadata: Source[]; previewSource: { name: string; text: string; hash: string }; sourceBytes: SourceBytes; sourceOrigins: SourceOrigin[]; saveSourceVersion: Source; profileSources: DatasetProfile; cancelCheckers: void; accept: void; markTaskSeen: Task; settings: void; applyBlockedHandIn: void; applyWorkspaceReview: void; discardWorkspaceReview: void; testWebSearch: WebSearchTest; runRoutineNow: string; deleteRoutine: void };
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Bridge {
  call<C extends Command>(command: C, args: Args<C>): Promise<Results[C]>;
  pickSources(): Promise<Source[]>;
  pickFolder(): Promise<FolderIntake>;
  /** Open an attached file in the system's default app. The path is looked up by id in the core, never sent from here. */
  openSource(taskId: string, id: string): Promise<void>;
  pickWorkspace(taskId: string, permissions: WorkspacePermission[]): Promise<WorkspaceGrantView | null>;
  /** The same native picker for a chat with no row yet; the core keeps the folder until the first message (COD-186). */
  pickNewChatWorkspace(chat: NewChatTarget, permissions: WorkspacePermission[]): Promise<NewChatWorkspaceView | null>;
  /** The same native picker, read-only, for the folder a routine watches (COD-245); the path stays in the core. */
  pickWatchFolder(): Promise<WatchFolderView | null>;
  /** Save an API key from typed input, or omit `key` to pick a .txt file. The key never comes back to the renderer. */
  connect(provider: CredentialProvider, key?: string): Promise<Connections>;
  disconnect(provider: CredentialProvider): Promise<Connections>;
  connections(): Promise<Connections>;
  exportArtifact(id: string, format?: TextFormat): Promise<boolean>;
  copyArtifact(id: string, format: TextFormat): Promise<void>;
  copyFeedback(id: string): Promise<void>;
  /** Copy a string the renderer already holds; the renderer cannot reach the clipboard from file://. */
  copyText(text: string): Promise<void>;
  exportTemplate(teamId: string): Promise<boolean>;
  importTemplate(): Promise<Team | null>;
  importSkill(): Promise<Skill | null>;
  exportSkill(id: string): Promise<boolean>;
  openPricing(provider: ApiProvider): Promise<void>;
  backup(): Promise<boolean>;
  restore(): Promise<boolean>;
  /** Versions and install facts of the running build, as the main process reports them (COD-176). */
  about(): Promise<AboutInfo>;
  /** Opens one of the About tab's links in the browser. The renderer names the link; main holds the address. */
  openLink(link: AboutLink): Promise<void>;
  /** Release notes from GitHub, or the last list this machine fetched when it is offline. */
  changelog(refresh?: boolean): Promise<Changelog>;
  updateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  /** Restarts into a downloaded update; refused while none is downloaded. */
  installUpdate(): Promise<void>;
  onChange(callback: () => void): () => void;
  /** Every change of the updater's state, pushed by the main process. */
  onUpdate(callback: (state: UpdateState) => void): () => void;
  /** Live progress of streaming workers. The callback gets a null progress when a run stops streaming. */
  onProgress(callback: (update: import('./progress').RunProgressUpdate) => void): () => void;
  /** A back or forward app command the window received: a mouse's side button over the frame, or a driver that sends the command itself (COD-202). */
  onNavigate(callback: (direction: 'back' | 'forward') => void): () => void;
  /** How the `orglet` terminal command is installed on this build (COD-234). */
  cliState(): Promise<import('./cli').CliInstallState>;
  /** Adds the `orglet` command to the user's PATH, or removes it; Windows packaged builds only. */
  setCliOnPath(enabled: boolean): Promise<import('./cli').CliInstallState>;
  /** Saves an MCP server; main keeps its secret values and the window never reads them back (COD-241). */
  saveMcpServer(draft: import('./mcp').McpServerDraft): Promise<McpServerView>;
  removeMcpServer(id: string): Promise<void>;
  /** Imports servers from a file the person picks in a native dialog; nothing is read without that pick. */
  importMcpServers(): Promise<{ imported: string[]; skipped: { name: string; reason: string }[] } | null>;
  /** Saves a web search key (COD-266), encrypted in main like the API keys; the window never reads it back. */
  saveWebSearchKey(provider: WebSearchKeyProvider, key: string): Promise<Connections>;
  removeWebSearchKey(provider: WebSearchKeyProvider): Promise<Connections>;
  /** A chat `orglet open --to` asked the window to show. */
  onOpenChat(callback: (target: import('./cli').OpenChatTarget) => void): () => void;
  /** Shows a system notification while the window is not focused; false when it was focused or the system has none (COD-258). */
  notifyInBackground(notice: import('./background-notice').BackgroundNotice): Promise<boolean>;
  /** The person clicked a system notification: the window is in front and should open this chat. */
  onOpenTask(callback: (taskId: string) => void): () => void;
  /** Takes what Explorer's Send to menu or `orglet://` links sent since the last call (COD-246). */
  takeIncoming(): Promise<import('./incoming').Incoming[]>;
  /** Something new is waiting for `takeIncoming`. */
  onIncoming(callback: () => void): () => void;
  /** Imports the files of a Send to hand-off, by its id; main holds the paths. Refused once taken or replaced. */
  takeSentFiles(id: string): Promise<FolderIntake>;
  /** The person closed the picker: main forgets that hand-off's paths. */
  dropSentFiles(id: string): Promise<void>;
  /** Whether Explorer's Send to menu offers Orglet on this build. */
  sendToState(): Promise<import('./incoming').SendToState>;
  /** Adds Orglet to Send to or takes it off, and keeps that choice across updates; Windows packaged builds only. */
  setSendTo(enabled: boolean): Promise<import('./incoming').SendToState>;
  /** The browser Orglet found and the named profiles, as main keeps them: names and dates, never folders (COD-261). */
  browserState(): Promise<BrowserState>;
  createBrowserProfile(name: string): Promise<BrowserState>;
  /** Opens a named profile in a normal browser window so the person can sign in to sites themselves. */
  openBrowserProfile(id: string): Promise<BrowserState>;
  /** Closes that window, if it is open and no run is using the profile. */
  closeBrowserProfile(id: string): Promise<BrowserState>;
  /** Empties a profile's folder: every sign-in, cookie and site's data in it. */
  clearBrowserProfile(id: string): Promise<BrowserState>;
  deleteBrowserProfile(id: string): Promise<BrowserState>;
  /**
   * Starts, renews or stops watching a run's browser in the live view (COD-261); `width` is how wide the view draws
   * the page, in device pixels. Null when the browser is not running.
   */
  watchBrowser(runId: string, watching: boolean, width: number): Promise<import('./browser-live').BrowserWatchState | null>;
  /** A click, wheel turn or key from the live view; the host refuses it unless the person holds the browser. */
  browserInput(runId: string, event: import('./browser-live').BrowserInputEvent): Promise<void>;
  /** Frames, the cursor and suggestions for the runs a view watches, pushed by main. */
  onBrowserLive(callback: (event: import('./browser-live').BrowserLiveEvent) => void): () => void;
}
declare global { interface Window { orglet: Bridge } }

