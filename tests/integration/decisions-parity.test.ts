import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAnswers, rounded, softmax, usageOf } from '../../apps/desktop/src/core/decisions/decoding';
import { packRequest, pythonJson, QuestionsTooLong, tensorsOf } from '../../apps/desktop/src/core/decisions/packing';
import { tacetTokenizer } from '../../apps/desktop/src/core/decisions/tokenizer';
import { DecisionQuestions, type DecisionAnswer, type JsonValue } from '../../apps/desktop/src/shared/decisions';

/**
 * The TypeScript port of Tacet's packing and decoding against what the Python package (tacet 0.2.1) produced for the
 * same requests. `tests/fixtures/tacet/parity.json` and the cut tokenizer beside it come from
 * `scripts/tacet/make_fixtures.py`; the cut tokenizer tokenizes these requests exactly as the full 34 MB one does,
 * which the script checks before writing.
 */

type ParityCase = {
  name: string;
  state: JsonValue;
  questions: unknown;
  tokenIds: number[];
  segmentIds: number[];
  markers: number[][];
  stateTruncated: boolean;
  optionsTruncated: boolean;
  logits: number[][];
  answers: Record<string, DecisionAnswer>;
  usage: { input_tokens: number; state_truncated?: boolean; options_truncated?: boolean };
};

const fixtures = join(__dirname, '..', 'fixtures', 'tacet');
const parity = JSON.parse(readFileSync(join(fixtures, 'parity.json'), 'utf8')) as { maxLength: number; cases: ParityCase[] };
const tokenizer = tacetTokenizer(JSON.parse(readFileSync(join(fixtures, 'tokenizer.cut.json'), 'utf8')));

/** Probabilities are rounded to four places on both sides, so one unit of the last place is the tolerance. */
const TOLERANCE = 1.01e-4;

function expectSameAnswer(actual: DecisionAnswer, expected: DecisionAnswer) {
  expect(actual.type).toBe(expected.type);
  expect(Math.abs(actual.confidence - expected.confidence)).toBeLessThanOrEqual(TOLERANCE);
  if (actual.type === 'noul' && expected.type === 'noul') {
    expect(Math.abs(actual.noul - expected.noul)).toBeLessThanOrEqual(TOLERANCE);
    return;
  }
  if (actual.type === 'noul' || expected.type === 'noul') throw new Error('type mismatch');
  expect(Object.keys(actual.probabilities)).toEqual(Object.keys(expected.probabilities));
  for (const [option, probability] of Object.entries(expected.probabilities)) {
    expect(Math.abs(actual.probabilities[option] - probability)).toBeLessThanOrEqual(TOLERANCE);
  }
  if (actual.type === 'choice' && expected.type === 'choice') expect(actual.choice).toBe(expected.choice);
  if (actual.type === 'score' && expected.type === 'score') {
    expect(Math.abs(actual.score - expected.score)).toBeLessThanOrEqual(TOLERANCE);
    expect(actual.legend).toEqual(expected.legend);
  }
}

describe('Tacet packing in TypeScript', () => {
  it('covers English, Vietnamese, every question type, structured state and cut text', () => {
    const names = parity.cases.map(parityCase => parityCase.name);
    expect(names).toEqual(expect.arrayContaining(['choice-vi', 'score-vi', 'noul-vi', 'object-state', 'long-state', 'long-option', 'special-text']));
    expect(parity.cases.some(parityCase => parityCase.stateTruncated)).toBe(true);
    expect(parity.cases.some(parityCase => parityCase.optionsTruncated)).toBe(true);
  });

  for (const parityCase of parity.cases) {
    it(`packs "${parityCase.name}" into the same tokens, segments and markers`, () => {
      const questions = DecisionQuestions.parse(parityCase.questions);
      const packed = packRequest(tokenizer, parityCase.state, questions, parity.maxLength);
      expect(packed.tokenIds).toEqual(parityCase.tokenIds);
      expect(packed.segmentIds).toEqual(parityCase.segmentIds);
      expect(packed.markers).toEqual(parityCase.markers);
      expect(packed.stateTruncated).toBe(parityCase.stateTruncated);
      expect(packed.optionsTruncated).toBe(parityCase.optionsTruncated);
      expect(usageOf(packed).inputTokens).toBe(parityCase.usage.input_tokens);
    });

    it(`decodes "${parityCase.name}" into the same answers`, () => {
      const questions = DecisionQuestions.parse(parityCase.questions);
      const packed = packRequest(tokenizer, parityCase.state, questions, parity.maxLength);
      const optionCount = Math.max(...parityCase.logits.map(row => row.length));
      const flat = parityCase.logits.flatMap(row => [...row, ...Array(optionCount - row.length).fill(-1e4)]);
      const answers = decodeAnswers(flat, optionCount, packed);
      expect(Object.keys(answers)).toEqual(Object.keys(parityCase.answers));
      for (const [questionId, expected] of Object.entries(parityCase.answers)) expectSameAnswer(answers[questionId], expected);
    });
  }

  it('lays out the tensors of a request the way collate() does for a batch of one', () => {
    const multi = parity.cases.find(parityCase => parityCase.name === 'multi')!;
    const packed = packRequest(tokenizer, multi.state, DecisionQuestions.parse(multi.questions), parity.maxLength);
    const tensors = tensorsOf(packed);
    expect(tensors.questionCount).toBe(3);
    expect(tensors.optionCount).toBe(3);
    expect(Array.from(tensors.inputIds, Number)).toEqual(multi.tokenIds);
    // The noul question has two options, so its third slot is padding and stays out of the mask.
    expect(Array.from(tensors.markerMask)).toEqual([1, 1, 1, 1, 1, 0, 1, 1, 1]);
    expect(Number(tensors.markerPositions[3])).toBe(multi.markers[1][0]);
  });

  it('refuses questions that leave the state no room, as the Python package does', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`q${index}`, { type: 'choice', instructions: 'Pick the one that fits best here.', criteria: { first: 'the first of the options', second: 'the second of the options' } }]));
    expect(() => packRequest(tokenizer, 'short', DecisionQuestions.parse(many), 256)).toThrow(QuestionsTooLong);
  });

  it('writes structured values with Python json.dumps spacing', () => {
    expect(pythonJson({ ticket: 4411, items: ['áo', 'quần'], paid: true, note: null })).toBe('{"ticket": 4411, "items": ["áo", "quần"], "paid": true, "note": null}');
  });

  it('rounds and normalises like numpy', () => {
    expect(softmax([1, 1]).map(rounded)).toEqual([0.5, 0.5]);
    expect(rounded(1 / 3)).toBe(0.3333);
    expect(rounded(2 / 3)).toBe(0.6667);
  });
});
