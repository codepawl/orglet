import type { DecisionQuestion, DecisionQuestions, JsonValue } from '../../shared/decisions';

/**
 * Turning a request into the one token sequence Tacet reads, ported line for line from `tacet/packing.py` (0.2.1):
 *
 *   [CLS] <q1 type> question: instructions [MASK] opt [MASK] opt [SEP]
 *         <q2 type> question: instructions [MASK] opt ... [SEP]
 *         state [SEP]
 *
 * Each question's options are read at its own [MASK] markers, and every token carries a segment id: the type of the
 * question block it belongs to, or the state. The option rendering is the prompt format the model was trained on,
 * so a change here changes every answer; `tests/integration/decisions-parity.test.ts` holds it to the Python output.
 */

export const QUESTION_SEGMENTS = { choice: 0, score: 1, noul: 2 } as const;
export const STATE_SEGMENT = 3;
export const MAX_OPTION_TOKENS = 48;
/** The questions go first, so they must leave the state at least this much room. */
export const MIN_STATE_ROOM = 64;
/** Tacet's default packed length; the state is cut to fit and the answer's usage says so. */
export const DEFAULT_MAX_LENGTH = 1536;

/** What the packing needs of a tokenizer: text to ids without special tokens, and the four special ids. */
export type PackingTokenizer = {
  encode(text: string): number[];
  maskToken: string;
  clsId: number;
  sepId: number;
  maskId: number;
  padId: number;
};

export type PackedRequest = {
  questionIds: string[];
  questions: DecisionQuestion[];
  tokenIds: number[];
  segmentIds: number[];
  /** Per question, the positions of its option markers. */
  markers: number[][];
  stateTruncated: boolean;
  optionsTruncated: boolean;
};

export class QuestionsTooLong extends Error {}

/**
 * JSON text the way Python's `json.dumps(value, ensure_ascii=False)` writes it: ", " between items and ": " after a
 * key. The model was trained on that spacing, so `JSON.stringify` would read differently.
 */
export function pythonJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`;
  const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonJson(item)}`);
  return `{${entries.join(', ')}}`;
}

export function serializeState(state: JsonValue): string {
  if (typeof state === 'string') return state;
  return pythonJson(state);
}

/** One criterion as text: strings pass through, anything structured becomes compact JSON. */
export function renderCriterion(value: JsonValue): string {
  if (typeof value === 'string') return value;
  return pythonJson(value);
}

function isBlank(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === '';
}

/** Option texts in label order. A noul question is always [false, true]. */
export function renderOptions(question: DecisionQuestion): string[] {
  if (question.type === 'choice') {
    // Only null and "" mean "no description"; 0 and false are real criterion values.
    return Object.entries(question.criteria).map(([name, description]) => isBlank(description) ? name : `${name}: ${renderCriterion(description)}`);
  }
  if (question.type === 'score') {
    return question.criteria.map((text, level) => `level ${level}: ${renderCriterion(text)}`);
  }
  const falseText = isBlank(question.criteria?.false) ? 'no, the statement does not hold' : renderCriterion(question.criteria!.false!);
  const trueText = isBlank(question.criteria?.true) ? 'yes, the statement holds' : renderCriterion(question.criteria!.true!);
  return [`false: ${falseText}`, `true: ${trueText}`];
}

/** A literal mask token in user text would add a marker the model reads as an option. */
function tokenIdsOf(tokenizer: PackingTokenizer, text: string): number[] {
  return tokenizer.encode(text.replaceAll(tokenizer.maskToken, ' '));
}

function buildPackedSequence(tokenizer: PackingTokenizer, state: JsonValue, questions: DecisionQuestion[], maxLength: number) {
  const tokenIds = [tokenizer.clsId];
  const segmentIds: number[] = [STATE_SEGMENT];
  const markers: number[][] = [];
  for (const question of questions) {
    const heading = `${question.type} question: ${question.instructions}`;
    const block = tokenIdsOf(tokenizer, heading);
    const blockMarkers: number[] = [];
    for (const option of renderOptions(question)) {
      blockMarkers.push(tokenIds.length + block.length);
      const optionIds = tokenIdsOf(tokenizer, ` ${option}`).slice(0, MAX_OPTION_TOKENS);
      block.push(tokenizer.maskId);
      block.push(...optionIds);
    }
    block.push(tokenizer.sepId);
    tokenIds.push(...block);
    segmentIds.push(...block.map(() => QUESTION_SEGMENTS[question.type]));
    markers.push(blockMarkers);
  }
  if (tokenIds.length > maxLength - MIN_STATE_ROOM) {
    throw new QuestionsTooLong(`the questions take ${tokenIds.length} tokens, which leaves no room for the state within ${maxLength}; send fewer or shorter questions`);
  }
  const room = Math.max(0, maxLength - tokenIds.length - 1);
  const stateIds = tokenIdsOf(tokenizer, serializeState(state)).slice(0, room);
  tokenIds.push(...stateIds, tokenizer.sepId);
  segmentIds.push(...stateIds.map(() => STATE_SEGMENT), STATE_SEGMENT);
  return { tokenIds, segmentIds, markers };
}

function anyOptionTruncated(tokenizer: PackingTokenizer, questions: DecisionQuestion[]): boolean {
  return questions.some(question => renderOptions(question).some(option => tokenIdsOf(tokenizer, ` ${option}`).length > MAX_OPTION_TOKENS));
}

/** A validated request, packed. Throws QuestionsTooLong when the questions leave the state no room. */
export function packRequest(tokenizer: PackingTokenizer, state: JsonValue, questions: DecisionQuestions, maxLength = DEFAULT_MAX_LENGTH): PackedRequest {
  const questionIds = Object.keys(questions);
  const ordered = questionIds.map(questionId => questions[questionId]);
  const { tokenIds, segmentIds, markers } = buildPackedSequence(tokenizer, state, ordered, maxLength);
  const stateTokenCount = tokenIdsOf(tokenizer, serializeState(state)).length;
  // [CLS] and the closing [SEP] also carry the state segment.
  const stateTokensKept = segmentIds.filter(segment => segment === STATE_SEGMENT).length - 2;
  return {
    questionIds,
    questions: ordered,
    tokenIds,
    segmentIds,
    markers,
    stateTruncated: stateTokensKept < stateTokenCount,
    optionsTruncated: anyOptionTruncated(tokenizer, ordered),
  };
}

/** The five tensors the ONNX graph takes, for one request (batch of one), as flat typed arrays with their shapes. */
export type PackedTensors = {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  segmentIds: BigInt64Array;
  markerPositions: BigInt64Array;
  markerMask: Uint8Array;
  sequenceLength: number;
  questionCount: number;
  optionCount: number;
};

/** `collate` for a single request: no padding in the sequence, option slots padded to the widest question. */
export function tensorsOf(packed: PackedRequest): PackedTensors {
  const sequenceLength = packed.tokenIds.length;
  const questionCount = packed.markers.length;
  const optionCount = Math.max(...packed.markers.map(block => block.length));
  const markerPositions = new BigInt64Array(questionCount * optionCount);
  const markerMask = new Uint8Array(questionCount * optionCount);
  packed.markers.forEach((block, questionIndex) => {
    block.forEach((position, optionIndex) => {
      markerPositions[questionIndex * optionCount + optionIndex] = BigInt(position);
      markerMask[questionIndex * optionCount + optionIndex] = 1;
    });
  });
  return {
    inputIds: BigInt64Array.from(packed.tokenIds, BigInt),
    attentionMask: new BigInt64Array(sequenceLength).fill(1n),
    segmentIds: BigInt64Array.from(packed.segmentIds, BigInt),
    markerPositions,
    markerMask,
    sequenceLength,
    questionCount,
    optionCount,
  };
}
