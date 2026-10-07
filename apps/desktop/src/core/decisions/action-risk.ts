import type { DecisionAnswer, DecisionQuestions, DecisionState } from '../../shared/decisions';
import { decideWithin, type Decider } from './budget';

/**
 * Tacet's second opinion on a step in Orglet's browser or a desktop app (COD-306): does it send, pay, delete or
 * publish something? The word rules (`browser-risk.ts`, `desktop-risk.ts`) stay the authority. This is asked only
 * about a step they let through, in a chat where the person can answer, and a yes can only add the approval card the
 * rules did not ask for; nothing here removes or skips an ask. The wording was chosen on `scripts/tacet/action_cases.json`
 * with the on-device model Tacet used before it moved to an API; it has not been re-measured against a hosted model.
 */

/** A step Orglet's browser or a desktop app is about to take, in the words Tacet reads. */
export type ActionToJudge =
  | { surface: 'browser'; kind: 'click'; element: string; role: string; site: string; page: string }
  | { surface: 'browser'; kind: 'press'; key: string; element: string; role: string; site: string; page: string }
  | { surface: 'browser'; kind: 'type'; text: string; element: string; role: string; site: string; page: string }
  | { surface: 'desktop'; kind: 'invoke' | 'toggle'; element: string; controlType: string; program: string; window: string; inDialog: boolean };

/** One sentence and a few names: far below this. */
export const ACTION_RISK_MAX_LENGTH = 256;
const NAME_CHARS = 120;
const TYPED_CHARS = 200;

const cleaned = (text: string, limit = NAME_CHARS) => text.replace(/\s+/g, ' ').trim().slice(0, limit);
const quoted = (text: string, limit = NAME_CHARS) => `"${cleaned(text, limit)}"`;

/** The step as one plain English sentence: what is done, to which element, where. */
export function actionDescription(action: ActionToJudge): string {
  if (action.surface === 'desktop') {
    const verb = action.kind === 'toggle' ? 'Toggle' : 'Press';
    const dialog = action.inDialog ? ' (a dialog)' : '';
    return `${verb} the ${action.controlType} ${quoted(action.element)} in the window ${quoted(action.window)}${dialog} of ${action.program}.`;
  }
  const where = `on ${action.site} (page ${quoted(action.page)})`;
  if (action.kind === 'type') return `Type ${quoted(action.text, TYPED_CHARS)} into the ${action.role} ${quoted(action.element)} and press Enter ${where}.`;
  if (action.kind === 'press') return `Press ${action.key} in the ${action.role} ${quoted(action.element)} ${where}.`;
  return `Click the ${action.role} ${quoted(action.element)} ${where}.`;
}

/** The step as named fields, the way a trace row reads: the action, the element and where it is. */
export function actionFields(action: ActionToJudge): DecisionState {
  if (action.surface === 'desktop') {
    return { action: action.kind === 'toggle' ? 'toggle' : 'press', element: cleaned(action.element), element_type: action.controlType, window: cleaned(action.window), app: action.program, ...(action.inDialog ? { dialog: true } : {}) };
  }
  const base = { element: cleaned(action.element), element_type: action.role, site: action.site, page: cleaned(action.page) };
  if (action.kind === 'type') return { action: 'type and press Enter', text: cleaned(action.text, TYPED_CHARS), ...base };
  if (action.kind === 'press') return { action: `press ${action.key}`, ...base };
  return { action: 'click', ...base };
}

/** The kinds of step that are hard to take back, among the options of `does`. */
const RISKY_KINDS = ['send', 'pay', 'delete', 'publish'];

/**
 * Two questions in one request, averaged: which of six kinds the step is, and whether it only looks around or does
 * something that counts. Each alone ranked the measured steps worse than the two together (docs/browser.md).
 */
export const ACTION_RISK_QUESTIONS: DecisionQuestions = {
  does: {
    type: 'choice', instructions: 'What does this step do?', criteria: {
      look: 'opens, shows, searches, sorts, filters or moves around',
      edit: 'changes a draft, a setting or the view, without sending anything',
      send: 'sends a message, a form or a file to someone',
      pay: 'pays, buys, orders, transfers or withdraws money',
      delete: 'deletes, trashes, cancels or closes something for good',
      publish: 'posts, publishes, shares or makes something public',
    },
  },
  happens: {
    type: 'choice', instructions: 'What happens when this step is taken?', criteria: {
      harmless: 'it only opens, shows, searches, sorts, filters or moves around',
      consequential: 'it sends, pays, buys, transfers, deletes, cancels or publishes something',
    },
  },
};

/**
 * At or above this, a step the rules let through asks the person anyway. On the measured steps it catches three in
 * four of the risky ones and asks about one harmless step in six; 0.30 would catch five in six but ask about three
 * harmless steps in eight, search buttons and next-page links among them, the steps a browser session takes most
 * (docs/browser.md).
 */
export const ACTION_RISK_THRESHOLD = 0.35;

/**
 * How long a step waits for Tacet. An API answers one short step in well under a second; past this the step goes ahead
 * on the rules alone.
 */
export const ACTION_RISK_BUDGET_MS = 3_000;

export type RiskOpinion = { risky: boolean; score: number };

/** Tacet's second opinion on one step, or undefined when it is off, fails or is late. */
export async function askActionRisk(decider: Decider, action: ActionToJudge, budgetMs = ACTION_RISK_BUDGET_MS): Promise<RiskOpinion | undefined> {
  const response = await decideWithin(decider, budgetMs, actionFields(action), ACTION_RISK_QUESTIONS, ACTION_RISK_MAX_LENGTH);
  if (!response) return undefined;
  const score = riskShare(response.answers);
  if (score === undefined) return undefined;
  return { risky: score >= ACTION_RISK_THRESHOLD, score };
}

/**
 * What Orglet's browser and desktop tools hold (COD-306): a way to ask about one step. It does nothing while Tacet is
 * off.
 */
export type SecondOpinion = {
  judge(action: ActionToJudge): Promise<RiskOpinion | undefined>;
};

/** The second opinion over the app's Tacet service, read afresh on every call since the service can be replaced. */
export function actionRiskOpinion(decider: () => Decider): SecondOpinion {
  return { judge: action => askActionRisk(decider(), action) };
}

/** How likely the step sends, pays, deletes or publishes, from 0 to 1; undefined when the answers are not the expected ones. */
export function riskShare(answers: Record<string, DecisionAnswer>): number | undefined {
  const kind = answers.does;
  const effect = answers.happens;
  if (kind?.type !== 'choice' || effect?.type !== 'choice') return undefined;
  const risky = RISKY_KINDS.reduce((sum, name) => sum + (kind.probabilities[name] ?? 0), 0);
  return (risky + (effect.probabilities.consequential ?? 0)) / 2;
}
