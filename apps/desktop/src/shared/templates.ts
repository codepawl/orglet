import { z } from 'zod';
import { MAX_CREW_MEMBERS, WorkerInput, SkillInput, TeamInput } from './contracts';
import { SkillPackage } from './skill-package';
import { KnowledgeInput } from './knowledge';

const Key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const TeamTemplate = z.object({
  format: z.literal('orglet-team-template'), version: z.literal(1),
  team: TeamInput.omit({ id: true, memberIds: true, synthesizerId: true }).extend({ memberKeys: z.array(Key).min(1).max(MAX_CREW_MEMBERS), synthesizerKey: Key }).strict(),
  // A template never carries the auto-apply switch or the MCP servers: both are this computer's, not the crew's (COD-199, COD-241).
  workers: z.array(WorkerInput.omit({ id: true, skillId: true, autoApplyProposals: true, mcpServerIds: true }).extend({ key: Key, skillKey: Key }).strict()).min(1).max(5),
  skills: z.array(SkillInput.omit({ id: true }).extend({ key: Key, package: SkillPackage.optional() }).strict()).min(1).max(5),
  knowledge: z.array(KnowledgeInput.pick({ title: true, content: true, tags: true, pinned: true }).strict()).max(50).optional(),
}).strict();
