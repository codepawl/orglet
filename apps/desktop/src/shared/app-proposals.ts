import { z } from 'zod';
import { FormatPreference, Id, LogoColor, ProviderId } from './contracts';
import { CustomModelId } from './models';
import { FontFamily } from './fonts';
import { Language } from './i18n';
import { ClockTime, TimeZone } from './schedule';

/**
 * What a worker may propose to change in the app (COD-199). A proposal is stored with the chat and shown as a card
 * the user applies or dismisses; nothing here changes the app on its own. The shapes are the model-facing tool
 * arguments: every property is present and nullable so strict tool schemas accept them, and a lenient copy
 * (`.partial()`) parses what a CLI harness sends back. What is deliberately not here: API keys, connections,
 * harness accounts, backup and restore, erase, tool permissions, working folders and the auto-apply switch. The
 * schemas are strict, so a field for any of those is rejected as unknown.
 */
const Text = (max: number) => z.string().trim().min(1).max(max);
/** A short handle a later proposal in the same reply uses to point at something proposed before it. */
export const ProposalRef = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/i, 'Ref là chữ, số, gạch nối hoặc gạch dưới.');
const Budget = z.number().int().min(1000).max(100_000_000);
const Workflow = z.enum(['sequential', 'parallel']);
const Frequency = z.enum(['daily', 'weekly']);
const Weekday = z.number().int().min(0).max(6);
const Theme = z.enum(['system', 'light', 'dark']);
const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const ProposeOrglet = z.object({
  targetId: Id.nullable(),
  ref: ProposalRef.nullable(),
  name: Text(80).nullable(),
  description: z.string().trim().max(160).nullable(),
  instructions: Text(16000).nullable(),
  provider: ProviderId.nullable(),
  modelId: CustomModelId.nullable(),
  skillId: Id.nullable(),
  skillRef: ProposalRef.nullable(),
  taskBudgetMicros: Budget.nullable(),
}).strict();
export const ProposeCrew = z.object({
  targetId: Id.nullable(),
  ref: ProposalRef.nullable(),
  name: Text(80).nullable(),
  instructions: Text(16000).nullable(),
  memberIds: z.array(Id).max(4).nullable(),
  memberRefs: z.array(ProposalRef).max(4).nullable(),
  leadId: Id.nullable(),
  leadRef: ProposalRef.nullable(),
  workflow: Workflow.nullable(),
  monthlyBudgetMicros: z.number().int().min(1000).max(1_000_000_000).nullable(),
  taskBudgetMicros: Budget.nullable(),
}).strict();
export const ProposeCrewTemplate = z.object({
  teamId: Id.nullable(),
  teamRef: ProposalRef.nullable(),
}).strict();
export const ProposeSkill = z.object({
  targetId: Id.nullable(),
  ref: ProposalRef.nullable(),
  name: Text(80).nullable(),
  content: Text(16000).nullable(),
}).strict();
export const ProposeSchedule = z.object({
  targetId: Id.nullable(),
  name: Text(80).nullable(),
  brief: Text(16000).nullable(),
  frequency: Frequency.nullable(),
  time: ClockTime.nullable(),
  weekday: Weekday.nullable(),
  timeZone: TimeZone.nullable(),
  workerId: Id.nullable(),
  workerRef: ProposalRef.nullable(),
  teamId: Id.nullable(),
  teamRef: ProposalRef.nullable(),
}).strict();
/** The settings a worker may propose: appearance, language, fonts, copy and download formats and two conveniences. */
export const ProposeSettings = z.object({
  theme: Theme.nullable(),
  language: Language.nullable(),
  accentColor: HexColor.nullable(),
  logoColor: LogoColor.nullable(),
  interfaceFont: FontFamily.nullable(),
  codeFont: FontFamily.nullable(),
  copyFormat: FormatPreference.nullable(),
  downloadFormat: FormatPreference.nullable(),
  autoTitles: z.boolean().nullable(),
  confirmOpenTask: z.boolean().nullable(),
}).strict();
export const PROPOSED_SETTING_KEYS = Object.keys(ProposeSettings.shape) as (keyof z.infer<typeof ProposeSettings>)[];

export const proposalToolSchemas = {
  propose_orglet: ProposeOrglet,
  propose_crew: ProposeCrew,
  propose_crew_template: ProposeCrewTemplate,
  propose_skill: ProposeSkill,
  propose_schedule: ProposeSchedule,
  propose_settings: ProposeSettings,
} as const;
export type ProposalToolName = keyof typeof proposalToolSchemas;
export const proposalToolNames = Object.keys(proposalToolSchemas) as ProposalToolName[];
export const isProposalTool = (name: string): name is ProposalToolName => Object.hasOwn(proposalToolSchemas, name);

export const AppProposalKind = z.enum(['orglet', 'crew', 'crew_template', 'skill', 'schedule', 'settings']);
export type AppProposalKind = z.infer<typeof AppProposalKind>;
export const AppProposalAction = z.enum(['create', 'edit', 'export']);
export type AppProposalAction = z.infer<typeof AppProposalAction>;
/** One line of the card's diff: a field, what it is now (nothing for a creation) and what it would become. */
export const ProposalChange = z.object({ field: z.string().min(1).max(40), before: z.string().max(200).nullable(), after: z.string().max(200) }).strict();
export type ProposalChange = z.infer<typeof ProposalChange>;
/** What Apply made or changed, so the card can open it. `template` means the team whose template is ready to save. */
export const ProposalTarget = z.object({ kind: z.enum(['worker', 'team', 'skill', 'routine', 'settings', 'template']), id: z.string().min(1).max(64) }).strict();
export type ProposalTarget = z.infer<typeof ProposalTarget>;
/**
 * Why a proposal is never applied on its own, even for a worker whose auto-apply switch is on: the run read
 * content nobody vetted, the change raises a spending limit, or applying needs a save location.
 */
export const ProposalHold = z.enum(['untrusted', 'budget', 'template']);
export type ProposalHold = z.infer<typeof ProposalHold>;
/** A failed apply stays pending with its error on the card, so the user can fix the cause and try again. */
export const ProposalStatus = z.enum(['pending', 'applied', 'dismissed']);
export type ProposalStatus = z.infer<typeof ProposalStatus>;
/** How an automatic apply can be taken back; only stored for applies the app made on its own. */
export const ProposalUndo = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delete'), entity: z.enum(['worker', 'team']), id: Id }).strict(),
  z.object({ kind: z.literal('restore'), entity: z.enum(['worker', 'team', 'skill']), previous: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal('settings'), previous: z.record(z.string(), z.unknown()) }).strict(),
]);
export type ProposalUndo = z.infer<typeof ProposalUndo>;

export const AppProposal = z.object({
  id: Id,
  taskId: Id,
  runId: Id,
  inputRevision: z.number().int().nonnegative(),
  /** Order within the run; a reference resolves only to an earlier proposal. */
  sequence: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  kind: AppProposalKind,
  action: AppProposalAction,
  ref: ProposalRef.optional(),
  /** The name of what is created or edited, as the card's title. */
  title: z.string().min(1).max(120),
  changes: z.array(ProposalChange).max(40),
  /** The validated tool arguments plus the defaults filled in when the proposal was made, resolved again at apply time. */
  payload: z.record(z.string(), z.unknown()),
  hold: ProposalHold.nullable(),
  status: ProposalStatus,
  /** Set when the run finished with the worker's auto-apply switch on but a hold kept the card waiting for a click. */
  heldReason: ProposalHold.optional(),
  automatic: z.boolean().optional(),
  appliedAt: z.iso.datetime().optional(),
  error: z.string().max(2000).optional(),
  target: ProposalTarget.optional(),
  undo: ProposalUndo.optional(),
  undoneAt: z.iso.datetime().optional(),
}).strict();
export type AppProposal = z.infer<typeof AppProposal>;

/** Whether the labelled worker keeps this proposal waiting for a click: nothing pending applies on its own with a hold. */
export const canAutoApply = (proposal: Pick<AppProposal, 'hold' | 'status'>) => proposal.status === 'pending' && proposal.hold === null;
