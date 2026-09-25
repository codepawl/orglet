import { z } from 'zod';

/** Connections that can produce a native or alias model list. Demo never fetches. */
export const ModelListProvider = z.enum(['openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', 'ollama', 'claude-code', 'codex', 'cursor', 'gemini']);
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
  source: ModelSource,
}).strict();
export type ModelEntry = z.infer<typeof ModelEntry>;

export const ModelListRow = z.object({
  fetchedAt: z.iso.datetime(),
  source: ModelSource,
  models: z.array(ModelEntry).max(500),
  error: z.string().max(500).optional(),
}).strict();
export type ModelListRow = z.infer<typeof ModelListRow>;

export const ModelListCache = z.object({
  version: z.literal(1),
  byProvider: z.object({
    openai: ModelListRow.optional(),
    anthropic: ModelListRow.optional(),
    xai: ModelListRow.optional(),
    openrouter: ModelListRow.optional(),
    'opencode-zen': ModelListRow.optional(),
    'opencode-go': ModelListRow.optional(),
    ollama: ModelListRow.optional(),
    'claude-code': ModelListRow.optional(),
    codex: ModelListRow.optional(),
    cursor: ModelListRow.optional(),
    gemini: ModelListRow.optional(),
  }).strict(),
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
  anthropic: 'claude-haiku-4-5-20251001',
  xai: 'grok-3-mini',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
} as const;

export const MODEL_LIST_CACHE_VERSION = 1;
export const MODEL_LISTS_SETTING = 'modelLists';
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
