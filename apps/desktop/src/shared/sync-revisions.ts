import { z } from 'zod';
import { Id, WorkerInput, SkillInput, TeamInput } from './contracts';
import { Knowledge } from './knowledge';
import { SkillPackage } from './skill-package';
import { SyncRevisionId, SyncClock } from './sync';

const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// These are data projections. Local proposal/MCP approval and package review authority never travels with a revision.
export const SyncWorker = WorkerInput.pick({ name: true, instructions: true, provider: true, skillId: true, modelId: true,
  effort: true, taskBudgetMicros: true, avatar: true, description: true }).extend({ id: Id }).strict();
export const SyncSkill = SkillInput.pick({ name: true, content: true }).extend({ id: Id,
  package: SkillPackage.omit({ reviewedHash: true }).strict().optional() }).strict();
export const SyncTeam = TeamInput.pick({ name: true, instructions: true, memberIds: true, synthesizerId: true, workflow: true,
  monthlyBudgetMicros: true, maxConcurrentTasks: true, taskBudgetMicros: true }).extend({ id: Id }).strict();
export const SyncKnowledge = Knowledge.omit({ revision: true }).strict();
const Revision = { revisionId: SyncRevisionId, generation: Integer.refine(value => value > 0), clock: SyncClock };
export const SyncRevision = z.discriminatedUnion('entity', [
  z.object({ ...Revision, entity: z.literal('worker'), value: SyncWorker }).strict(),
  z.object({ ...Revision, entity: z.literal('skill'), value: SyncSkill }).strict(),
  z.object({ ...Revision, entity: z.literal('team'), value: SyncTeam }).strict(),
  z.object({ ...Revision, entity: z.literal('knowledge'), value: SyncKnowledge }).strict(),
]);
export type SyncRevision = z.infer<typeof SyncRevision>;
export const SyncRevisionIdentity = z.object({ entity: z.enum(['worker', 'skill', 'team', 'knowledge']), entityId: Id,
  localRevision: Integer.refine(value => value > 0), revisionId: SyncRevisionId, generation: Integer.refine(value => value > 0), clock: SyncClock }).strict();
export type SyncRevisionIdentity = z.infer<typeof SyncRevisionIdentity>;
