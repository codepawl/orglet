import { z } from 'zod';
import { Id, ProviderId, TeamInput, WorkerAvatar, WorkerInput } from '../shared/contracts';

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

export const ManagementTarget = z.object({ id: Id, revision: z.number().int().positive() }).strict();
export type ManagementTarget = z.infer<typeof ManagementTarget>;
export const ManagementCatalog = z.object({
  orglets: z.array(z.object({ ...ManagementTarget.shape, config: OrgletConfig }).strict()),
  crews: z.array(z.object({ ...ManagementTarget.shape, config: CrewConfig }).strict()),
  skills: z.array(z.object({ id: Id, name: z.string().max(80) }).strict()),
  providers: z.array(z.object({ id: ProviderId, name: z.string().max(80) }).strict()),
}).strict();
export type ManagementCatalog = z.infer<typeof ManagementCatalog>;
export const ManagementResult = z.object({ kind: z.enum(['worker', 'team']), id: Id, name: z.string().max(80), revision: z.number().int().positive(), deleted: z.boolean().optional(), space: z.string().max(80).optional() }).strict();
export type ManagementResult = z.infer<typeof ManagementResult>;

export type ManagementClient = {
  catalog: () => Promise<ManagementCatalog>;
  saveOrglet: (config: OrgletPatch, target?: ManagementTarget) => Promise<ManagementResult>;
  saveCrew: (config: CrewPatch, target?: ManagementTarget) => Promise<ManagementResult>;
  delete: (kind: 'worker' | 'team', target: ManagementTarget, confirmName: string) => Promise<ManagementResult>;
};
