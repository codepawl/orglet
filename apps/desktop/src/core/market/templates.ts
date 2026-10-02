import { z } from 'zod';
import { WorkerInput, SkillInput } from '../../shared/contracts';
import { SkillPackage } from '../../shared/skill-package';
import { MARKET_BODY_LIMIT } from '../../shared/market';
import { parseTeamTemplate } from '../storage/templates';

const WorkerTemplate = z.object({
  format: z.literal('orglet-worker-template'), version: z.literal(1),
  worker: WorkerInput.omit({ id: true, skillId: true, autoApplyProposals: true, mcpServerIds: true }).strict(),
  skill: SkillInput.omit({ id: true }).extend({ package: SkillPackage.optional() }).strict(),
}).strict();

/** Normalize both existing strict import shapes; no privileged fields are added here. */
export function parseMarketTemplate(text: string, kind: 'orglet' | 'crew') {
  if (Buffer.byteLength(text) > MARKET_BODY_LIMIT) throw new Error('Template vượt giới hạn 2 MB.');
  if (kind === 'crew') return parseTeamTemplate(text);
  const template = WorkerTemplate.parse(JSON.parse(text));
  return {
    format: 'orglet-team-template' as const, version: 1 as const,
    workers: [{ ...template.worker, key: 'friend', skillKey: 'skill' }],
    skills: [{ ...template.skill, key: 'skill' }],
    team: undefined, knowledge: undefined,
  };
}
