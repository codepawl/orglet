import { z } from 'zod';
import { ProfileArgs, type DataFormat, type DatasetProfile, type ProfileRecord } from './profiles';
import { PreflightPolicy, type PreflightRecord } from './preflight';
import { Schedule, WorkHours } from './schedule';
import { SkillPackage, type PackageReview } from './skill-package';
import { RunAuditArgs } from './run-audit';
import { Review, ReviewPolicy, type EvidenceRequest } from './review';
import { KnowledgeInput, type Knowledge, type RunContext } from './knowledge';
import type { HarnessInfo } from './harness';
import { CurrencyCode, type CurrencyState } from './currency';
import { Language } from './i18n';
import { CustomModelId, type ModelListResult } from './models';

export const Id = z.string().uuid();
export const ProviderId = z.enum(['demo', 'openai', 'anthropic', 'xai', 'claude-code', 'codex', 'cursor']);
export type ProviderId = z.infer<typeof ProviderId>;
/** Providers that receive task content and therefore need per-task consent. */
export const ProviderScope = ProviderId.exclude(['demo']);
export type ProviderScope = z.infer<typeof ProviderScope>;
/** API providers that store an encrypted key (not local harnesses). */
export const ApiProvider = z.enum(['openai', 'anthropic', 'xai']);
export type ApiProvider = z.infer<typeof ApiProvider>;
export const WorkerInput = z.object({
  id: Id.optional(), name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(16000),
  provider: ProviderId, skillId: Id,
  // Selected or typed model slug. Absence means the catalog suggestion for this provider (or the CLI default for a harness).
  modelId: CustomModelId.optional(),
  // Default spending cap for tasks this worker runs through a paid API; harnesses and Demo ignore it.
  taskBudgetMicros: z.number().int().min(1000).max(100_000_000).optional(),
  // Presentation only: shown in the app and carried by templates, never sent to a model.
  avatar: z.object({ mascot: z.string().regex(/^[a-z-]{1,32}$/).optional(), letter: z.literal(true).optional(), emoji: z.string().min(1).max(16).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }).strict().optional(),
  description: z.string().trim().max(160).optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;
export const TeamInput = z.object({
  id: Id.optional(), name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(16000),
  memberIds: z.array(Id).min(1).max(4).refine(ids => new Set(ids).size === ids.length, 'Members must be unique'),
  synthesizerId: Id, workflow: z.enum(['sequential', 'parallel']),
  monthlyBudgetMicros: z.number().int().min(1000).max(1_000_000_000),
  preflight: PreflightPolicy.optional(),
  reviewPolicy: ReviewPolicy.optional(),
  workHours: WorkHours.optional(),
  maxConcurrentTasks: z.number().int().min(1).max(4).optional(),
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
  excludedSources: z.array(z.object({ name: z.string().max(4096), reason: z.string().max(2000) }).strict()).max(20020).optional(),
  providerScopes: z.array(ProviderScope).max(4).optional(),
  budgetMicros: z.number().int().min(1000).max(100_000_000),
});
export type TaskInput = z.infer<typeof TaskInput>;
export const RunInput = TaskInput.pick({ brief: true, sourceIds: true, excludedSources: true }).strict();
export type RunInput = z.infer<typeof RunInput>;
/** Orchestrator routing for one team-chat turn (COD-25). Stored on the plan run snapshot; not a user-facing artifact. */
export const PlanAssignment = z.object({ workerId: Id, brief: z.string().trim().min(1).max(16000) }).strict();
export const TeamPlan = z.object({
  assignments: z.array(PlanAssignment).min(1).max(4).refine(items => new Set(items.map(item => item.workerId)).size === items.length, 'Members must be unique'),
  note: z.string().trim().max(2000).optional(),
}).strict();
export type TeamPlan = z.infer<typeof TeamPlan>;
/** Queued member run skipped because the orchestrator did not assign that worker this turn. */
export const UNASSIGNED_PLAN_ERROR = 'Không được phân việc cho lượt này.';
export const MISSING_PLAN_ERROR = 'Phân việc không có kết quả. Không chạy thành viên và không bịa báo cáo.';
export const INVALID_PLAN_ERROR = 'Phân việc không hợp lệ: nhân viên không thuộc nhóm.';
export const RoutineInput = z.object({ id: Id.optional(), name: z.string().trim().min(1).max(80), enabled: z.boolean(), schedule: Schedule, task: TaskInput }).strict();
export const Routine = RoutineInput.extend({ id: Id, revision: z.number().int().positive(), approvedConfig: z.string(), nextDueAt: z.iso.datetime(), pending: z.object({ dueAt: z.iso.datetime(), reason: z.string() }).strict().nullable(), lastTaskId: Id.optional() }).strict();
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
export type Source = { id: string; name: string; bytes: number; hash: string; revoked: boolean; format?: DataFormat };
export type FolderIntake = { sources: Source[]; skipped: { name: string; reason: string }[] };
export type TaskStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'waiting_budget' | 'waiting_input';
export type Task = { id: string; brief: string; title?: string; workerId: string; teamId?: string; teamSnapshot?: Team; assignees?: 'all' | string[]; archivedAt?: string; deletedAt?: string; status: TaskStatus; createdAt: string; budgetMicros: number; sourceIds: string[]; excludedSources?: FolderIntake['skipped']; consent: boolean; providerScopes?: ProviderScope[]; accepted: boolean; /** Stamp of the result the user last opened; unread when it differs from `taskResultStamp`. */ seenStamp?: string; /** Latest saved answer/report id, part of the result stamp. */ lastArtifactId?: string; /** When the user last opened this task. */ seenAt?: string; routineId?: string; pauseReason?: 'shift'; handoff?: Handoff; evidenceRequests?: EvidenceRequest[]; inputRevision?: number; currentInput?: RunInput };
export type RunStage = 'plan' | 'member' | 'synthesis' | 'group';
export type Run = { id: string; taskId: string; stage?: RunStage; status: TaskStatus; snapshot: { worker: Worker; skill: Skill; team?: Team; input?: RunInput; context?: RunContext; inputRevision?: number; upstreamArtifactIds?: string[]; preflightId?: string; model?: string; pricingVersion?: string; plan?: TeamPlan }; startedAt: string; error: string | null };
export type Activity = { id: string; runId: string; sequence?: number; message: string; createdAt: string };
export type Artifact = { id: string; runId: string; report: Report; hash: string; createdAt: string };
export type Usage = { chargedMicros: number; reservedMicros: number; uncertainCount: number; inputTokens: number; outputTokens: number };
export type TaskDetail = { task: Task; runs: Run[]; events: Activity[]; artifacts: Artifact[]; profiles: ProfileRecord[]; preflights: PreflightRecord[]; sources: Source[]; usage: Usage };
export type Workspace = { copyFormat: FormatPreference; downloadFormat: FormatPreference; archivedWorkers: (Worker & { archivedAt: string })[]; archivedTeams: (Team & { archivedAt: string })[]; language: Language; autoTitles: boolean; confirmOpenTask: boolean; archiveRetentionDays: ArchiveRetention; avatarColors: string[]; knowledge: Knowledge[]; workers: Worker[]; teams: Team[]; skills: Skill[]; tasks: Task[]; routines: Routine[]; usage: Usage; theme: 'system' | 'light' | 'dark'; connectionLimitMicros: number; providerConcurrency: number; providerConsent: ProviderScope[]; currency: CurrencyState; sqliteVersion: string };
export type Connections = { openai: boolean; anthropic: boolean; xai: boolean };

export const commands = {
  workspace: z.object({}),
  task: z.object({ id: Id }),
  createTask: TaskInput,
  reviseTask: RunInput.extend({ taskId: Id, consent: z.boolean(), providerScopes: z.array(ProviderScope).max(4), budgetMicros: z.number().int().min(1000).max(100_000_000) }).strict(),
  saveWorker: WorkerInput,
  saveTeam: TeamInput,
  createTemplate: z.object({ templateId: z.enum(['research-review', 'eris-review']), provider: z.enum(['demo', 'openai']) }),
  saveSkill: SkillInput,
  inspectSkill: z.object({ id: Id }),
  reviewSkill: z.object({ id: Id, hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  saveRoutine: RoutineInput,
  dismissRoutine: z.object({ id: Id }),
  catchUpRoutine: z.object({ id: Id }),
  cancel: z.object({ id: Id }),
  pause: z.object({ id: Id }),
  resume: z.object({ id: Id }),
  retry: z.object({ id: Id }),
  revoke: z.object({ id: Id }),
  previewSource: z.object({ taskId: Id, id: Id }),
  sourceMetadata: z.object({ ids: z.array(Id).max(20) }),
  profileSources: ProfileArgs.extend({ taskId: Id }),
  auditRunLog: RunAuditArgs.extend({ taskId: Id }),
  cancelCheckers: z.object({ id: Id }),
  accept: z.object({ id: Id }),
  markTaskSeen: z.object({ id: Id }),
  acknowledgeEvidence: z.object({ taskId: Id, requestId: Id }),
  saveKnowledge: KnowledgeInput,
  reviewKnowledge: z.object({ id: Id, revision: z.number().int().positive(), decision: z.enum(['approve', 'archive']) }).strict(),
  searchKnowledge: z.object({ query: z.string().max(200) }).strict(),
  harnesses: z.object({ refresh: z.boolean() }).strict(),
  modelList: z.object({ provider: ProviderId, refresh: z.boolean().optional() }).strict(),
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
  settings: z.object({ language: Language.optional(), autoTitles: z.boolean().optional(), confirmOpenTask: z.boolean().optional(), copyFormat: FormatPreference.optional(), downloadFormat: FormatPreference.optional(), archiveRetentionDays: ArchiveRetention.optional(), theme: z.enum(['system', 'light', 'dark']), connectionLimitMicros: z.number().int().min(1000).max(1_000_000_000), providerConcurrency: z.number().int().min(1).max(4).optional(), providerConsent: z.array(ProviderScope).max(4).refine(items => new Set(items).size === items.length, 'Duplicate provider').optional() }),
} as const;
export type Command = keyof typeof commands;
export type Args<C extends Command> = z.infer<(typeof commands)[C]>;
export type Results = { renameTask: void; updateTask: void; archiveTask: void; deleteTask: void; archiveEntity: void; deleteEntity: void; reorder: void; saveAvatarColors: void; setCurrency: CurrencyState; refreshCurrency: CurrencyState; harnesses: HarnessInfo[]; modelList: ModelListResult; saveKnowledge: Knowledge; reviewKnowledge: void; searchKnowledge: Knowledge[]; reviseTask: void; acknowledgeEvidence: void; auditRunLog: DatasetProfile; inspectSkill: PackageReview; reviewSkill: void; workspace: Workspace; task: TaskDetail; createTask: string; saveWorker: Worker; saveTeam: Team; createTemplate: Team; saveSkill: Skill; saveRoutine: Routine; dismissRoutine: void; catchUpRoutine: string; cancel: void; pause: void; resume: void; retry: void; revoke: void; sourceMetadata: Source[]; previewSource: { name: string; text: string; hash: string }; profileSources: DatasetProfile; cancelCheckers: void; accept: void; markTaskSeen: Task; settings: void };
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Bridge {
  call<C extends Command>(command: C, args: Args<C>): Promise<Results[C]>;
  pickSources(): Promise<Source[]>;
  pickFolder(): Promise<FolderIntake>;
  /** Save an API key from typed input, or omit `key` to pick a .txt file. The key never comes back to the renderer. */
  connect(provider: ApiProvider, key?: string): Promise<Connections>;
  disconnect(provider: ApiProvider): Promise<Connections>;
  connections(): Promise<Connections>;
  exportArtifact(id: string, format?: TextFormat): Promise<boolean>;
  copyArtifact(id: string, format: TextFormat): Promise<void>;
  copyFeedback(id: string): Promise<void>;
  exportTemplate(teamId: string): Promise<boolean>;
  importTemplate(): Promise<Team | null>;
  importSkill(): Promise<Skill | null>;
  exportSkill(id: string): Promise<boolean>;
  openPricing(provider: ApiProvider): Promise<void>;
  backup(): Promise<boolean>;
  restore(): Promise<boolean>;
  onChange(callback: () => void): () => void;
  /** Live progress of streaming workers. The callback gets a null progress when a run stops streaming. */
  onProgress(callback: (update: import('./progress').RunProgressUpdate) => void): () => void;
}
declare global { interface Window { orglet: Bridge } }

