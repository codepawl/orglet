import type { Skill, Team, Worker } from '../../shared/contracts';
import type { MarketOrigin, MarketWidening } from '../../shared/market';
import type { Store } from '../storage/database';
import type { parseMarketTemplate } from './templates';

type Template = ReturnType<typeof parseMarketTemplate>;

/** The same default the work policy uses when a channel sets no limit of its own. */
const DEFAULT_CONCURRENT_TASKS = 4;

function differs(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
}

/**
 * What an update would let the installed copy do or spend beyond what it may now. An update never carries a
 * permission, a folder, a key or an MCP server, so what remains is a new orglet that would start answering, more
 * parallel work, rules of the channel that changed, and skill files that were not there before.
 */
export function updateWidening(store: Store, origin: MarketOrigin, template: Template): MarketWidening[] {
  const widening: MarketWidening[] = [];
  for (const worker of template.workers) {
    if (!origin.workerIds[worker.key]) widening.push({ kind: 'new-orglet', name: worker.name });
  }
  for (const skill of template.skills) {
    const workerKey = template.workers.find(worker => worker.skillKey === skill.key)?.key;
    const workerId = workerKey ? origin.workerIds[workerKey] : undefined;
    const previousId = workerId ? store.get<Worker>('workers', workerId).skillId : origin.skillIds[skill.key];
    const previous = previousId ? store.get<Skill>('skills', previousId) : undefined;
    if (skill.package && skill.package.hash !== previous?.package?.hash) widening.push({ kind: 'skill-files', name: skill.name });
  }
  if (template.team) widening.push(...teamWidening(store, origin, template.team));
  return widening;
}

function teamWidening(store: Store, origin: MarketOrigin, next: NonNullable<Template['team']>): MarketWidening[] {
  const previous = store.get<Team>('teams', origin.entityId);
  const widening: MarketWidening[] = [];
  if ((next.maxConcurrentTasks ?? DEFAULT_CONCURRENT_TASKS) > (previous.maxConcurrentTasks ?? DEFAULT_CONCURRENT_TASKS)) widening.push({ kind: 'concurrency', name: next.name });
  const parallelNow = next.workflow === 'parallel' && previous.workflow !== 'parallel';
  const rulesChanged = differs(previous.preflight, next.preflight) || differs(previous.reviewPolicy, next.reviewPolicy) || differs(previous.workHours, next.workHours);
  if (parallelNow || rulesChanged) widening.push({ kind: 'channel-rules', name: next.name });
  return widening;
}
