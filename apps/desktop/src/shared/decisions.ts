import { z } from 'zod';

/**
 * Typed decisions Tacet answers through an API (COD-303): a choice among named options, a place on an ordered score, or
 * a yes/no ("noul"), each with a probability for every option. OpenAI's Decisions API answers them directly; any other
 * connection answers through its chat adapter (core/decisions/emulated.ts). The shapes below are the ones every caller
 * already uses, so a caller never learns which of the two answered.
 */

/** Limits kept from the package the shapes come from. */
export const DECISION_MAX_QUESTIONS = 32;
export const DECISION_MAX_OPTIONS = 64;
export const DECISION_MAX_TEXT_CHARS = 4000;
export const DECISION_MAX_STATE_CHARS = 200_000;

/** Anything JSON can carry: a criterion or a state may be structured, and is then read as compact JSON text. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

// Checked but never trimmed: the model reads the text exactly as sent.
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
/** `inputTokens` is the provider's own count when it reports one, otherwise about a quarter of the characters sent. */
export type DecisionUsage = { inputTokens: number; stateTruncated?: true };
export type DecisionResponse = { model: string; answers: Record<string, DecisionAnswer>; usage: DecisionUsage };

/** Tacet's connection: one of the chat's own connections and the model that answers it, or off. */
export const TacetConnection = z.object({
  connection: z.string().min(1).max(200),
  model: z.string().trim().min(1).max(200),
}).strict();
export type TacetConnection = z.infer<typeof TacetConnection>;
export const TacetSetting = z.union([z.literal('off'), TacetConnection]);
export type TacetSetting = z.infer<typeof TacetSetting>;

/** The default when an OpenAI key is saved and the person has not chosen: OpenAI's Decisions API on its small model. */
export const DEFAULT_TACET_CONNECTION: TacetConnection = { connection: 'openai', model: 'gpt-6-luna' };

/** What Settings shows: the setting in force, and whether the person chose it or it is the default. */
export type TacetSettingView = { setting: TacetSetting; chosen: boolean };

/** What one sample decision from Settings → Test came back with. */
export type TacetTestResult = { connection: string; model: string; milliseconds: number; choice: string; probability: number };

/** The setting in force: the saved one, else OpenAI's default when a key is saved, else off. */
export function effectiveTacetSetting(saved: TacetSetting | undefined, openAiKeySaved: boolean): TacetSetting {
  if (saved !== undefined) return saved;
  return openAiKeySaved ? DEFAULT_TACET_CONNECTION : 'off';
}

const MODEL_HINTS: Record<string, string> = {
  openai: DEFAULT_TACET_CONNECTION.model,
  anthropic: 'claude-sonnet-5-5',
  xai: 'grok-3-mini',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
};

/** A model to prefill when a connection is picked; empty when only the person knows (a custom connection). */
export function tacetModelHint(connection: string): string {
  return MODEL_HINTS[connection] ?? '';
}
