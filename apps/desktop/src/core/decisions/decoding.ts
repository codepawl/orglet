import type { ChoiceAnswer, DecisionAnswer, DecisionUsage, JsonValue, NoulAnswer, ScoreAnswer } from '../../shared/decisions';
import type { PackedRequest } from './packing';

/**
 * Turning the model's per-option logits into answers, ported from `tacet/decoding.py` (0.2.1). Confidence is Laya's
 * normalized entropy (Apache 2.0): 1 when all mass is on one option, 0 when it is spread evenly.
 */

const DECIMALS = 4;

export function softmax(scores: readonly number[]): number[] {
  const highest = Math.max(...scores);
  const exponentials = scores.map(score => Math.exp(score - highest));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map(value => value / total);
}

export function confidenceFromProbabilities(probabilities: readonly number[]): number {
  const optionCount = probabilities.length;
  if (optionCount < 2) return 1;
  let entropy = 0;
  for (const probability of probabilities) {
    const clipped = Math.min(Math.max(probability, 1e-12), 1);
    entropy -= probability * Math.log(clipped);
  }
  return Math.min(Math.max(1 - entropy / Math.log(optionCount), 0), 1);
}

/** Python's round() to four places: halves go to the even neighbour, as `round(float(value), 4)` does. */
export function rounded(value: number): number {
  const scale = 10 ** DECIMALS;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const difference = scaled - floor;
  let whole = difference > 0.5 ? floor + 1 : difference < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  if (Object.is(whole, -0)) whole = 0;
  return whole / scale;
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

function decodeChoice(criteria: Record<string, JsonValue | null>, probabilities: number[]): ChoiceAnswer {
  const names = Object.keys(criteria);
  return {
    type: 'choice',
    choice: names[argmax(probabilities)],
    probabilities: Object.fromEntries(names.map((name, index) => [name, rounded(probabilities[index])])),
    confidence: rounded(confidenceFromProbabilities(probabilities)),
  };
}

function decodeScore(criteria: JsonValue[], probabilities: number[]): ScoreAnswer {
  const expected = probabilities.reduce((sum, probability, level) => sum + level * probability, 0);
  return {
    type: 'score',
    score: rounded(expected),
    probabilities: Object.fromEntries(probabilities.map((probability, level) => [String(level), rounded(probability)])),
    confidence: rounded(confidenceFromProbabilities(probabilities)),
    legend: Object.fromEntries(criteria.map((criterion, level) => [String(level), criterion])),
  };
}

function decodeNoul(probabilities: number[]): NoulAnswer {
  const probabilityTrue = probabilities[1];
  return { type: 'noul', noul: rounded(probabilityTrue), confidence: rounded(Math.max(probabilityTrue, 1 - probabilityTrue)) };
}

/**
 * Answers for one request from its logits, laid out [questions, options] row by row with `optionCount` slots each
 * (the ONNX output for a batch of one). Padded slots are ignored: each question reads only its own options.
 */
export function decodeAnswers(logits: ArrayLike<number>, optionCount: number, packed: PackedRequest): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  packed.questionIds.forEach((questionId, index) => {
    const question = packed.questions[index];
    const count = packed.markers[index].length;
    const row = Array.from({ length: count }, (_, option) => Number(logits[index * optionCount + option]));
    const probabilities = softmax(row);
    if (question.type === 'choice') answers[questionId] = decodeChoice(question.criteria, probabilities);
    else if (question.type === 'score') answers[questionId] = decodeScore(question.criteria, probabilities);
    else answers[questionId] = decodeNoul(probabilities);
  });
  return answers;
}

export function usageOf(packed: PackedRequest): DecisionUsage {
  return {
    inputTokens: packed.tokenIds.length,
    ...(packed.stateTruncated ? { stateTruncated: true as const } : {}),
    ...(packed.optionsTruncated ? { optionsTruncated: true as const } : {}),
  };
}
