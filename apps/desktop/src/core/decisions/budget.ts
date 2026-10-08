import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';

/** A harness backend (the Codex CLI) takes seconds, so it serves only a decision whose caller can wait at least this long. */
export const HARNESS_MIN_BUDGET_MS = 15_000;

/**
 * What a request may say about itself beyond the question: the chat its answer is for, which its usage is counted
 * against, and how long the caller will wait. A caller that names neither `budgetMs` nor `background` is treated as
 * interactive, so a slow backend is never used for it by accident.
 */
export type DecisionContext = {
  taskId?: string;
  /** How long the caller waits for the answer. */
  budgetMs?: number;
  /** Nothing is waiting on this answer (the quiet-run review): a slow backend may serve it. */
  background?: true;
};

/** Whether a slow backend may serve this request. */
export function allowsSlowBackend(context: DecisionContext): boolean {
  return context.background === true || (context.budgetMs ?? 0) >= HARNESS_MIN_BUDGET_MS;
}

/** What a use of the decision model needs from the service: whether it is turned on, and an answer. */
export type Decider = {
  isEnabled(): boolean;
  decide(state: DecisionState, questions: DecisionQuestions, maxLength?: number, context?: DecisionContext): Promise<DecisionResponse | undefined>;
};

/**
 * The decision model's answer, or undefined when it is off, fails, or takes longer than `budgetMs`. The request itself keeps going
 * until its own 15-second limit when time runs out, and its answer is dropped.
 */
export async function decideWithin(decider: Decider, budgetMs: number, state: DecisionState, questions: DecisionQuestions, maxLength: number, context?: DecisionContext): Promise<DecisionResponse | undefined> {
  if (!decider.isEnabled()) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });
  try {
    const answer = decider.decide(state, questions, maxLength, { ...context, budgetMs }).catch(() => undefined);
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}
