import { z } from 'zod';

/**
 * Typed decisions the decision model answers through an API (COD-303): a choice among named options, a place on an ordered score, or
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
/**
 * What one request used. `inputTokens` is the provider's own count when it reports one; when it reports none,
 * `estimated` is set and `inputTokens` is about a quarter of the characters sent. Output and prompt-cache tokens are
 * the provider's counts, left out where it gives none (OpenAI's Decisions API answers without output tokens).
 */
export type DecisionUsage = { inputTokens: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; estimated?: true; stateTruncated?: true };
/** `answeredBy` is the backend of the person's list that gave the answers; nothing outside the list ever answers. */
export type DecisionResponse = { model: string; answers: Record<string, DecisionAnswer>; usage: DecisionUsage; answeredBy?: DecisionModelConnection };

/** The connection id of the Codex CLI, signed in with a ChatGPT account: the one harness the decision model can use. */
export const CODEX_DECISION_CONNECTION = 'codex';
/** A harness answers in seconds, not fractions of one, so it only serves decisions nobody is waiting on. */
export const isHarnessDecisionConnection = (connection: string): boolean => connection === CODEX_DECISION_CONNECTION;
/** The list is a priority order of at most this many backends. */
export const DECISION_MODEL_MAX_ENTRIES = 3;

/** One backend of the decision model: one of the chat's own connections (or the Codex CLI) and the model that answers on it. */
export const DecisionModelConnection = z.object({
  connection: z.string().min(1).max(200),
  model: z.string().trim().min(1).max(200),
}).strict();
export type DecisionModelConnection = z.infer<typeof DecisionModelConnection>;
const entryKey = (entry: DecisionModelConnection) => `${entry.connection}\n${entry.model}`;
/** The person's priority list: tried in order, at most three, the same connection and model not twice. An empty list is off. */
export const DecisionModelSetting = z.array(DecisionModelConnection).max(DECISION_MODEL_MAX_ENTRIES)
  .refine(entries => new Set(entries.map(entryKey)).size === entries.length, 'The same backend is listed twice.');
export type DecisionModelSetting = z.infer<typeof DecisionModelSetting>;

/**
 * A saved value as a list. Before the list the setting was 'off' or one connection; both still read, as an empty list
 * and a list of one. Anything else is no choice.
 */
export function parseStoredDecisionModelSetting(stored: unknown): DecisionModelSetting | undefined {
  if (stored === 'off') return [];
  const single = DecisionModelConnection.safeParse(stored);
  if (single.success) return [single.data];
  const list = DecisionModelSetting.safeParse(stored);
  return list.success ? list.data : undefined;
}

/** The default when an OpenAI key is saved and the person has not chosen: OpenAI's Decisions API on its small model. */
export const DEFAULT_DECISION_MODEL_CONNECTION: DecisionModelConnection = { connection: 'openai', model: 'gpt-6-luna' };

/** What Settings shows: the list in force, and whether the person chose it or it is the default. */
export type DecisionModelSettingView = { entries: DecisionModelSetting; chosen: boolean };

/** What happened to one backend of the list during a decision: it answered, it failed, or it was passed over. */
export type DecisionAttempt = { connection: string; model: string; outcome: 'answered' | 'failed' | 'skipped'; milliseconds: number; reason?: string };

/** What one sample decision from Settings → Test came back with: the backend that answered, and every one tried on the way. */
export type DecisionModelTestResult = { connection: string; model: string; milliseconds: number; choice: string; probability: number; attempts: DecisionAttempt[] };

/** The list in force: the saved one, else OpenAI's default when a key is saved, else off (empty). */
export function effectiveDecisionModelSetting(saved: DecisionModelSetting | undefined, openAiKeySaved: boolean): DecisionModelSetting {
  if (saved !== undefined) return saved;
  return openAiKeySaved ? [DEFAULT_DECISION_MODEL_CONNECTION] : [];
}

const MODEL_HINTS: Record<string, string> = {
  openai: DEFAULT_DECISION_MODEL_CONNECTION.model,
  [CODEX_DECISION_CONNECTION]: 'gpt-6-luna',
  anthropic: 'claude-sonnet-5-5',
  xai: 'grok-3-mini',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
};

/** A model to prefill when a connection is picked; empty when only the person knows (a custom connection). */
export function decisionModelHint(connection: string): string {
  return MODEL_HINTS[connection] ?? '';
}
