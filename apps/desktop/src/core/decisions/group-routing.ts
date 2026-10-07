import type { DecisionQuestions, DecisionResponse } from '../../shared/decisions';
import type { Worker } from '../../shared/contracts';

/**
 * The question that picks who in a group chat answers a message that tags nobody (COD-305), and how its answer becomes
 * a pick. Chosen on the tune half of `tests/fixtures/tacet/group-routing.json` (21 messages to four groups, English
 * and Vietnamese) and scored on the held-out half; the numbers are in docs/decisions.md.
 */

export type RoutableOrglet = Pick<Worker, 'id' | 'name' | 'description' | 'instructions'>;

/** The option that keeps today's behaviour; an orglet with this name makes the group unroutable. */
export const EVERYONE_OPTION = 'everyone';

/**
 * A single orglet answers alone only when the decision model gives it at least this. At 0.6 and above no labelled message went to
 * the wrong orglet or away from a group it was meant for; a message to two general helpers with no description reached
 * 0.59 for one of them, so the line sits a step above it. Below it, everyone answers, as before the decision model.
 */
export const ROUTING_THRESHOLD = 0.65;
/** The model reads 48 tokens of each option; a group of eight and a message fit well inside this. */
export const ROUTING_MAX_LENGTH = 512;
/** Larger groups (a chat with every orglet) keep everyone: the options would crowd out the message. */
export const MAX_ROUTED_GROUP = 8;
/** An option longer than the model reads only makes the request bigger. */
const OPTION_CHARS = 300;

/** What the model reads about one orglet: its description, then its instructions. */
export function orgletOption(orglet: RoutableOrglet): string {
  const parts = [orglet.description?.trim(), orglet.instructions.trim()].filter((part): part is string => Boolean(part));
  const text = parts.join('. ');
  return text.length > OPTION_CHARS ? text.slice(0, OPTION_CHARS) : text;
}

/** Whether the decision model can be asked at all: two to eight orglets, each with its own name, none called "everyone". */
export function routableGroup(orglets: readonly RoutableOrglet[]): boolean {
  if (orglets.length < 2 || orglets.length > MAX_ROUTED_GROUP) return false;
  const names = orglets.map(orglet => orglet.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return false;
  return !names.includes(EVERYONE_OPTION);
}

export function routingQuestion(orglets: readonly RoutableOrglet[]): DecisionQuestions {
  const criteria: Record<string, string> = {};
  for (const orglet of orglets) criteria[orglet.name.trim()] = orgletOption(orglet);
  criteria[EVERYONE_OPTION] = "the whole group: a greeting, or a question for everyone's view";
  return { route: { type: 'choice', instructions: 'Who in this group chat should answer this message?', criteria } };
}

/** The one orglet the decision model picked with enough confidence, or undefined to keep everyone. */
export function routedOrglet<T extends RoutableOrglet>(response: DecisionResponse | undefined, orglets: readonly T[]): { orglet: T; probability: number } | undefined {
  const answer = response?.answers.route;
  if (!answer || answer.type !== 'choice' || answer.choice === EVERYONE_OPTION) return undefined;
  const probability = answer.probabilities[answer.choice] ?? 0;
  if (probability < ROUTING_THRESHOLD) return undefined;
  const orglet = orglets.find(item => item.name.trim() === answer.choice);
  return orglet ? { orglet, probability } : undefined;
}
