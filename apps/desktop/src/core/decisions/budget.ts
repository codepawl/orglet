import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';

/** What a use of Tacet needs from the service: whether it is on this computer, and an answer. */
export type Decider = {
  isInstalled(): boolean;
  decide(state: DecisionState, questions: DecisionQuestions, maxLength?: number): Promise<DecisionResponse | undefined>;
};

/**
 * Tacet's answer, or undefined when it is not installed, fails, or takes longer than `budgetMs`. The request itself
 * keeps going in the worker when time runs out (a forward pass cannot be stopped halfway), so a cold model that was
 * still loading is ready for the next question.
 */
export async function decideWithin(decider: Decider, budgetMs: number, state: DecisionState, questions: DecisionQuestions, maxLength: number): Promise<DecisionResponse | undefined> {
  if (!decider.isInstalled()) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });
  try {
    const answer = decider.decide(state, questions, maxLength).catch(() => undefined);
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}
