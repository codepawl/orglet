import { z } from 'zod';
import { EffortCapability } from './effort';
import { CustomProviderId } from './custom-connections';

export const BuiltInModelListProvider = z.enum(['openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', 'codepawl', 'ollama', 'claude-code', 'codex', 'cursor', 'gemini']);
/** Connections that can produce a native or alias model list, custom OpenAI-compatible ones included. Demo never fetches. */
export const ModelListProvider = z.union([BuiltInModelListProvider, CustomProviderId]);
export type ModelListProvider = z.infer<typeof ModelListProvider>;
export const ModelSource = z.enum(['native', 'alias', 'catalog-hint']);
export type ModelSource = z.infer<typeof ModelSource>;
/** Typed ID a worker may send. Never rejected because it is missing from a fetched list. */
export const CustomModelId = z.string().trim().min(1).max(200);
export type CustomModelId = z.infer<typeof CustomModelId>;

export const ModelEntry = z.object({
  provider: ModelListProvider,
  id: CustomModelId,
  displayName: z.string().trim().min(1).max(200).optional(),
  aliases: z.array(CustomModelId).max(50).optional(),
  deprecated: z.literal(true).optional(),
  sunsetAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  replacementId: CustomModelId.optional(),
  inputTenths: z.number().int().nonnegative().max(1_000_000).optional(),
  outputTenths: z.number().int().nonnegative().max(1_000_000).optional(),
  /** The provider's own list says this model takes images (xAI, OpenRouter, and servers that copy their fields; COD-260). */
  imageInput: z.literal(true).optional(),
  /** How many tokens the model's context holds, from the provider's own list (OpenRouter's `context_length`; COD-326). */
  contextTokens: z.number().int().positive().max(100_000_000).optional(),
  /** The CLI itself says it runs this model when none is named (Codex `isDefault`, Claude Code's start line, Cursor Agent's current model; COD-332). */
  isDefault: z.literal(true).optional(),
  /** The model an alias stands for right now, as the CLI itself reported it (Claude Code; COD-332). */
  resolvedId: CustomModelId.optional(),
  effort: EffortCapability.optional(),
  source: ModelSource,
}).strict();
export type ModelEntry = z.infer<typeof ModelEntry>;

export const ModelListRow = z.object({
  fetchedAt: z.iso.datetime(),
  source: ModelSource,
  models: z.array(ModelEntry).max(500),
  error: z.string().max(500).optional(),
  /**
   * When a list that learned nothing is fetched again, instead of after the usual day (COD-338): Claude Code signed in
   * but no alias resolved and no names read, most often because its start timed out on a busy computer.
   */
  retryAfter: z.iso.datetime().optional(),
}).strict();
export type ModelListRow = z.infer<typeof ModelListRow>;

export const MODEL_LIST_CACHE_VERSION = 3;

export const ModelListCache = z.object({
  // Version 3 (COD-359) adds native effort metadata; v2 prices and rows are retained with metadata due for refresh.
  version: z.literal(MODEL_LIST_CACHE_VERSION),
  // One row per connection; a key that is neither a built-in list nor `custom:<id>` fails the whole cache.
  byProvider: z.partialRecord(ModelListProvider, ModelListRow),
}).strict();
export type ModelListCache = z.infer<typeof ModelListCache>;

export const ModelListResult = z.object({
  models: z.array(ModelEntry).max(500),
  fetchedAt: z.iso.datetime(),
  stale: z.boolean(),
  error: z.string().max(500).optional(),
  customIdOk: z.literal(true),
  source: ModelSource,
}).strict();
export type ModelListResult = z.infer<typeof ModelListResult>;

/** Pinned suggestion IDs. The picker may show these; a worker is not locked to them. */
export const CATALOG_HINT_IDS = {
  openai: 'gpt-4.1-mini-2025-04-14',
  anthropic: 'claude-sonnet-5-5',
  xai: 'grok-3-mini',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
} as const;

export const MODEL_LISTS_SETTING = 'modelLists';

/**
 * The context window a harness reported running each model with on a finished run (Claude Code's
 * `modelUsage[model].contextWindow`), by connection and model id. Kept apart from the fetched lists, which a refresh
 * replaces, and merged into a list's answer where the list itself gives no window. Local only, like the lists.
 */
export const ReportedContextWindows = z.record(z.string().max(200), z.record(CustomModelId, z.number().int().positive().max(100_000_000)));
export type ReportedContextWindows = z.infer<typeof ReportedContextWindows>;
export const REPORTED_CONTEXT_WINDOWS_SETTING = 'reportedContextWindows';
/** How many models' windows one connection keeps; the oldest report goes first. */
export const REPORTED_CONTEXT_WINDOWS_PER_PROVIDER = 100;
export const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000;
export const MODEL_LIST_MAX = 500;
export const MODEL_LIST_MAX_BYTES = 1024 * 1024;
export const MODEL_LIST_TIMEOUT_MS = 8_000;

/**
 * OpenAI `/v1/models` mixes chat with embeddings, audio and images. Hide these prefixes from the
 * suggestion list only. `CustomModelId` still accepts them.
 */
export const OPENAI_DISPLAY_DENY_PREFIXES = [
  'text-embedding', 'embedding', 'whisper', 'tts', 'dall-e', 'gpt-image', 'chatgpt-image',
  'omni-moderation', 'transcribe', 'sora', 'computer-use', 'babbage', 'davinci', 'ada',
] as const;

export function hiddenOpenAIModel(id: string): boolean {
  const lower = id.toLowerCase();
  return OPENAI_DISPLAY_DENY_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}_`));
}

/** Accept any trimmed model slug. The fetched list is never a gate. */
export function acceptCustomModelId(id: string): CustomModelId {
  return CustomModelId.parse(id);
}

export const emptyModelListCache = (): ModelListCache => ({ version: MODEL_LIST_CACHE_VERSION, byProvider: {} });
