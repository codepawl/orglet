import { WorkerTemplate } from '../../shared/templates';
import { MARKET_BODY_LIMIT } from '../../shared/market';
import { SpaceTemplate, validateSpaceTemplate } from '../../shared/space-template';
import { parseTeamTemplate } from '../storage/templates';

export type MarketKind = 'orglet' | 'crew' | 'space';

/**
 * Normalize the strict import shapes into one: orglets by key with their skills, a crew when the listing is one, and
 * a space when the listing is one. No privileged fields are added here.
 */
export function parseMarketTemplate(text: string, kind: MarketKind) {
  if (Buffer.byteLength(text) > MARKET_BODY_LIMIT) throw new Error('Template vượt giới hạn 2 MB.');
  if (kind === 'crew') return { ...parseTeamTemplate(text), space: undefined };
  if (kind === 'space') {
    const template = SpaceTemplate.parse(JSON.parse(text));
    validateSpaceTemplate(template);
    return { format: 'orglet-team-template' as const, version: 1 as const, workers: template.workers, skills: template.skills, team: undefined, knowledge: undefined, space: template.space };
  }
  const template = WorkerTemplate.parse(JSON.parse(text));
  return {
    format: 'orglet-team-template' as const, version: 1 as const,
    workers: [{ ...template.worker, key: 'friend', skillKey: 'skill' }],
    skills: [{ ...template.skill, key: 'skill' }],
    team: undefined, knowledge: undefined, space: undefined,
  };
}
