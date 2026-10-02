import { WorkerTemplate } from '../../shared/templates';
import { MARKET_BODY_LIMIT } from '../../shared/market';
import { parseTeamTemplate } from '../storage/templates';

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
