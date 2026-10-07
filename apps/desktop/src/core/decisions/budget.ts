import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';

/** What a use of Tacet needs from the service: whether it is turned on, and an answer. */
export type Decider = {
  isEnabled(): boolean;
  decide(state: DecisionState, questions: DecisionQuestions, maxLength?: number): Promise<DecisionResponse | undefined>;
};

/**
 * Tacet's answer, or undefined when it is off, fails, or takes longer than `budgetMs`. The request itself keeps going
 * until its own 15-second limit when time runs out, and its answer is dropped.
 */
export async function decideWithin(decider: Decider, budgetMs: number, state: DecisionState, questions: DecisionQuestions, maxLength: number): Promise<DecisionResponse | undefined> {
  if (!decider.isEnabled()) return undefined;
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
