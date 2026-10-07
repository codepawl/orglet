import type { ChoiceAnswer, DecisionAnswer, DecisionQuestion, JsonValue, NoulAnswer, ScoreAnswer } from '../../shared/decisions';

/**
 * Turning a provider's probabilities into the answers every caller reads. Both ways of asking (OpenAI's Decisions API
 * and the chat-adapter emulation) end here, so a question gets the same shape of answer from either.
 *
 * Confidence of a choice or a score is Laya's normalized entropy (Apache 2.0): 1 when all the mass is on one option,
 * 0 when it is spread evenly. A yes/no uses the larger of the probability and its complement.
 */

const DECIMALS = 10_000;

export function roundedProbability(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

/** The probabilities scaled to sum to 1, or undefined when any is negative or not a number, or all are zero. */
export function normalised(values: readonly number[]): number[] | undefined {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) return undefined;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return undefined;
  return values.map(value => value / total);
}

export function confidenceFromProbabilities(probabilities: readonly number[]): number {
  const optionCount = probabilities.length;
  if (optionCount < 2) return 1;
  let entropy = 0;
  for (const probability of probabilities) {
    if (probability > 0) entropy -= probability * Math.log(probability);
  }
  return Math.min(Math.max(1 - entropy / Math.log(optionCount), 0), 1);
}

function indexOfLargest(values: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

/** The option names of a choice, or the level indexes of a score, in the order the question lists them. */
export function optionCount(question: DecisionQuestion): number {
  if (question.type === 'choice') return Object.keys(question.criteria).length;
  if (question.type === 'score') return question.criteria.length;
  return 2;
}

/** The question's options as text, in order: a choice's name, a score level's text, and "false" then "true". */
export function optionLabels(question: DecisionQuestion): string[] {
  if (question.type === 'choice') return Object.keys(question.criteria);
  if (question.type === 'score') return question.criteria.map(criterion => criterionText(criterion));
  return ['false', 'true'];
}

/** A criterion as the model reads it: text stays as written, anything structured becomes compact JSON. */
export function criterionText(value: JsonValue | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One answer from the probabilities of a question's options, given in the order `optionLabels` lists them. Returns
 * undefined when they cannot be a distribution, so the caller leaves the question unanswered.
 */
export function answerFromProbabilities(question: DecisionQuestion, raw: readonly number[]): DecisionAnswer | undefined {
  const probabilities = normalised(raw);
  if (!probabilities || probabilities.length !== optionCount(question)) return undefined;
  if (question.type === 'choice') {
    const names = Object.keys(question.criteria);
    const answer: ChoiceAnswer = {
      type: 'choice',
      choice: names[indexOfLargest(probabilities)],
      probabilities: Object.fromEntries(names.map((name, index) => [name, roundedProbability(probabilities[index])])),
      confidence: roundedProbability(confidenceFromProbabilities(probabilities)),
    };
    return answer;
  }
  if (question.type === 'score') {
    const expected = probabilities.reduce((sum, probability, level) => sum + level * probability, 0);
    const answer: ScoreAnswer = {
      type: 'score',
      score: roundedProbability(expected),
      probabilities: Object.fromEntries(probabilities.map((probability, level) => [String(level), roundedProbability(probability)])),
      confidence: roundedProbability(confidenceFromProbabilities(probabilities)),
      legend: Object.fromEntries(question.criteria.map((criterion, level) => [String(level), criterion])),
    };
    return answer;
  }
  const probabilityTrue = probabilities[1];
  const answer: NoulAnswer = { type: 'noul', noul: roundedProbability(probabilityTrue), confidence: roundedProbability(Math.max(probabilityTrue, 1 - probabilityTrue)) };
  return answer;
}

/** A yes/no answered with only the probability of true, as OpenAI's predicate gives it. */
export function noulFromProbability(probability: number): NoulAnswer | undefined {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) return undefined;
  return { type: 'noul', noul: roundedProbability(probability), confidence: roundedProbability(Math.max(probability, 1 - probability)) };
}

/** Text of a state as the provider reads it: a string as written, structured data as compact JSON. */
export function stateText(state: JsonValue): string {
  return typeof state === 'string' ? state : JSON.stringify(state);
}
