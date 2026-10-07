import { z } from 'zod';

/**
 * Typed decisions answered on this computer by Tacet (COD-303): a choice among named options, a place on an ordered
 * score, or a yes/no ("noul"), each with a probability for every option. The request and answer shapes are the ones
 * the Python `tacet` package and its hosted API use, so the same question gives the same answer in both.
 */

/** Limits the Python package enforces (tacet/validation.py). */
export const DECISION_MAX_QUESTIONS = 32;
export const DECISION_MAX_OPTIONS = 64;
export const DECISION_MAX_TEXT_CHARS = 4000;
export const DECISION_MAX_STATE_CHARS = 200_000;

/** Anything JSON can carry: a criterion or a state may be structured, and is then read as compact JSON text. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

// Checked but never trimmed: the model reads the text exactly as sent, as the Python package does.
const hasText = (value: string) => value.trim().length > 0;
const Instructions = z.string().max(DECISION_MAX_TEXT_CHARS).refine(hasText, 'Instructions must not be empty.');
const OptionName = z.string().max(200).refine(hasText, 'An option needs a name.');

export const ChoiceQuestion = z.object({
  type: z.literal('choice'),
  instructions: Instructions,
  // Option name to what it means; null or "" means the name says it all.
  criteria: z.record(OptionName, JsonValueSchema.nullable()).refine(options => {
    const count = Object.keys(options).length;
    return count >= 2 && count <= DECISION_MAX_OPTIONS;
  }, 'A choice needs between 2 and 64 options.'),
}).strict();
export const ScoreQuestion = z.object({
  type: z.literal('score'),
  instructions: Instructions,
  // The levels, lowest first.
  criteria: z.array(JsonValueSchema).min(2).max(DECISION_MAX_OPTIONS),
}).strict();
export const NoulQuestion = z.object({
  type: z.literal('noul'),
  instructions: Instructions,
  // What "true" and "false" mean, when the instructions alone leave it open.
  criteria: z.object({ true: JsonValueSchema.optional(), false: JsonValueSchema.optional() }).strict().optional(),
}).strict();
export const DecisionQuestion = z.discriminatedUnion('type', [ChoiceQuestion, ScoreQuestion, NoulQuestion]);
export type DecisionQuestion = z.infer<typeof DecisionQuestion>;
export const DecisionQuestions = z.record(OptionName, DecisionQuestion).refine(questions => {
  const count = Object.keys(questions).length;
  return count >= 1 && count <= DECISION_MAX_QUESTIONS;
}, 'Send between 1 and 32 questions.');
export type DecisionQuestions = z.infer<typeof DecisionQuestions>;
export const DecisionState = z.union([z.string(), z.record(z.string(), JsonValueSchema), z.array(JsonValueSchema)]);
export type DecisionState = z.infer<typeof DecisionState>;

export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number; legend: Record<string, JsonValue> };
/** `noul` is the probability of true; `confidence` is the larger of it and its complement. */
export type NoulAnswer = { type: 'noul'; noul: number; confidence: number };
export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
export type DecisionUsage = { inputTokens: number; stateTruncated?: true; optionsTruncated?: true };
export type DecisionResponse = { model: string; answers: Record<string, DecisionAnswer>; usage: DecisionUsage };

/**
 * Where the on-device model stands, for the Settings block. `absent` until the person downloads it; `failed` keeps the
 * reason (a cut connection, a file that did not match) and the bytes already kept, so trying again resumes. `outdated`
 * means a Tacet from an earlier Orglet is on disk while this one pins another: Tacet rests until the person updates,
 * and `totalBytes` is what the new one weighs.
 */
export type DecisionModelStatus = 'absent' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'outdated';
export type DecisionModelState = {
  status: DecisionModelStatus;
  /** Bytes on disk so far, across every file of the model. */
  receivedBytes: number;
  /** What the whole download weighs, known before it starts. */
  totalBytes: number;
  error?: string;
};
