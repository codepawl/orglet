import { z } from 'zod';
import { ChannelLeadSettings, Id, ProviderId, TeamInput, WorkerAvatar, WorkerInput } from '../shared/contracts';
import { CHANNEL_NAME_LIMIT, CHANNEL_TOPIC_LIMIT, ChannelMember, ChannelMembers, ChannelMode } from '../shared/channels';

/** Only person-editable configuration; grants and automatic proposal settings stay in the desktop. */
export const OrgletConfig = WorkerInput.omit({ id: true, autoApplyProposals: true, mcpServerIds: true }).strict();
export const CrewConfig = TeamInput.omit({ id: true, preflight: true, reviewPolicy: true, workHours: true }).strict();
export type OrgletConfig = z.infer<typeof OrgletConfig>;
export type CrewConfig = z.infer<typeof CrewConfig>;
export const OrgletPatch = OrgletConfig.partial().extend({
  modelId: OrgletConfig.shape.modelId.nullable(),
  taskBudgetMicros: OrgletConfig.shape.taskBudgetMicros.nullable(),
  description: OrgletConfig.shape.description.nullable(),
  avatar: WorkerAvatar.extend({ color: WorkerAvatar.shape.color.nullable() }).strict().nullable().optional(),
}).strict();
export const CrewPatch = CrewConfig.partial().extend({
  taskBudgetMicros: CrewConfig.shape.taskBudgetMicros.nullable(),
  maxConcurrentTasks: CrewConfig.shape.maxConcurrentTasks.nullable(),
}).strict();
export type OrgletPatch = z.infer<typeof OrgletPatch>;
export type CrewPatch = z.infer<typeof CrewPatch>;

/** The lead's settings a person can change; work hours, the dataset check and the checklist stay in the desktop. */
export const ChannelLeadPatch = ChannelLeadSettings.omit({ workHours: true, preflight: true, reviewPolicy: true }).strict();
export type ChannelLeadPatch = z.infer<typeof ChannelLeadPatch>;
/**
 * A channel's configuration, as `create channel` and `edit channel` take it: its name, topic and members, how it
 * answers (`mode`), and the lead's settings as `lead`. The crew's older flat names (`memberIds`, `synthesizerId`,
 * `instructions`, `workflow` and the limits) are still read for one release and mean the same as `lead` does.
 */
export const ChannelPatch = CrewPatch.extend({
  topic: z.string().trim().max(CHANNEL_TOPIC_LIMIT).optional(),
  members: ChannelMembers.optional(),
  mode: ChannelMode.optional(),
  lead: ChannelLeadPatch.optional(),
}).strict();
export type ChannelPatch = z.infer<typeof ChannelPatch>;

/** A channel as `config` lists it: the lead's settings are there only when the lead splits the work. */
export const ChannelConfig = z.object({
  name: z.string().min(1).max(CHANNEL_NAME_LIMIT),
  topic: z.string().max(CHANNEL_TOPIC_LIMIT).optional(),
  members: z.array(ChannelMember),
  mode: ChannelMode,
  lead: TeamInput.pick({ synthesizerId: true, instructions: true, workflow: true, monthlyBudgetMicros: true, maxConcurrentTasks: true, taskBudgetMicros: true }).strict().optional(),
}).strict();
export type ChannelConfig = z.infer<typeof ChannelConfig>;

export const ManagementTarget = z.object({ id: Id, revision: z.number().int().positive() }).strict();
export type ManagementTarget = z.infer<typeof ManagementTarget>;
/** A channel has no revision of its own: only one where the lead splits the work has the revision of its settings. */
export const ChannelTarget = z.object({ id: Id, revision: z.number().int().positive().optional() }).strict();
export type ChannelTarget = z.infer<typeof ChannelTarget>;
export const ManagementCatalog = z.object({
  orglets: z.array(z.object({ ...ManagementTarget.shape, config: OrgletConfig }).strict()),
  /** The channels where the lead splits the work, as the crews they were; kept for one release, `channels` has them all. */
  crews: z.array(z.object({ ...ManagementTarget.shape, config: CrewConfig }).strict()),
  /** Every channel. An app older than this field sends only `crews`. */
  channels: z.array(z.object({ ...ChannelTarget.shape, config: ChannelConfig }).strict()).optional(),
  skills: z.array(z.object({ id: Id, name: z.string().max(80) }).strict()),
  providers: z.array(z.object({ id: ProviderId, name: z.string().max(80) }).strict()),
}).strict();
export type ManagementCatalog = z.infer<typeof ManagementCatalog>;
/** `id` is the one that names the entity in this release (a channel with a lead keeps its crew's id); `channelId` is the channel's own. */
export const ManagementResult = z.object({
  kind: z.enum(['worker', 'team']),
  id: Id,
  channelId: Id.optional(),
  name: z.string().max(80),
  revision: z.number().int().positive().optional(),
  deleted: z.boolean().optional(),
  space: z.string().max(80).optional(),
}).strict();
export type ManagementResult = z.infer<typeof ManagementResult>;

export type ManagementClient = {
  catalog: () => Promise<ManagementCatalog>;
  saveOrglet: (config: OrgletPatch, target?: ManagementTarget) => Promise<ManagementResult>;
  /** Creates or edits a channel; the name is the one `create channel` and `edit channel` had when a channel was a crew. */
  saveCrew: (config: ChannelPatch, target?: ChannelTarget) => Promise<ManagementResult>;
  delete: (kind: 'worker' | 'team', target: ChannelTarget, confirmName: string) => Promise<ManagementResult>;
};
