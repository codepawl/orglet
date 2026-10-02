import { z } from 'zod';
import type { Store } from '../storage/database';
import {
  emptyModelListCache,
  MODEL_LIST_CACHE_VERSION,
  MODEL_LIST_MAX_BYTES,
  MODEL_LISTS_SETTING,
  ModelListCache,
  REPORTED_CONTEXT_WINDOWS_PER_PROVIDER,
  REPORTED_CONTEXT_WINDOWS_SETTING,
  ReportedContextWindows,
  type ModelEntry,
  type ModelListProvider,
  type ModelListRow,
} from '../../shared/models';

/** Sentinel used only for native metadata missing from a pre-effort cache. */
export const EFFORT_METADATA_REFRESH_AT = '1970-01-01T00:00:00.000Z';
const PreviousModelListCache = ModelListCache.extend({ version: z.literal(2) });
export function readModelListCache(store: Store): ModelListCache {
  const raw = store.setting(MODEL_LISTS_SETTING, null);
  const parsed = ModelListCache.safeParse(raw);
  if (parsed.success) return parsed.data;
  const previous = PreviousModelListCache.safeParse(raw);
  if (!previous.success) return emptyModelListCache();
  const byProvider = { ...previous.data.byProvider };
  for (const provider of ['codex', 'openrouter', 'ollama'] as const) {
    const row = byProvider[provider];
    if (row) byProvider[provider] = { ...row, retryAfter: EFFORT_METADATA_REFRESH_AT };
  }
  return { version: MODEL_LIST_CACHE_VERSION, byProvider };
}

/** The context window a provider's list gives for a model, by id or alias; undefined when the list does not say (COD-326). */
export function modelContextTokens(cache: ModelListCache, provider: string, modelId: string | undefined): number | undefined {
  if (!modelId) return undefined;
  const row = cache.byProvider[provider as ModelListProvider];
  return row?.models.find(entry => entry.id === modelId || entry.aliases?.includes(modelId))?.contextTokens;
}

export function readReportedContextWindows(store: Store): ReportedContextWindows {
  const parsed = ReportedContextWindows.safeParse(store.setting(REPORTED_CONTEXT_WINDOWS_SETTING, {}));
  return parsed.success ? parsed.data : {};
}

/** Keeps the window a harness reported for one model, as the newest entry of that connection. */
export function rememberReportedContextWindow(store: Store, provider: string, modelId: string, windowTokens: number) {
  const windows = readReportedContextWindows(store);
  const known = { ...windows[provider] };
  if (known[modelId] === windowTokens) return;
  delete known[modelId];
  known[modelId] = windowTokens;
  const kept = Object.entries(known).slice(-REPORTED_CONTEXT_WINDOWS_PER_PROVIDER);
  store.setSetting(REPORTED_CONTEXT_WINDOWS_SETTING, { ...windows, [provider]: Object.fromEntries(kept) });
}

/** A list's models with the harness's reported window on each one the list gives none for, by id, alias or resolved id. */
export function withReportedContextWindows(models: ModelEntry[], reported: Record<string, number> | undefined): ModelEntry[] {
  if (!reported) return models;
  return models.map(entry => {
    if (entry.contextTokens) return entry;
    const names = [entry.id, entry.resolvedId, ...(entry.aliases ?? [])].filter((name): name is string => Boolean(name));
    const windowTokens = names.map(name => reported[name]).find(tokens => tokens !== undefined);
    return windowTokens ? { ...entry, contextTokens: windowTokens } : entry;
  });
}

export function writeModelListCache(store: Store, cache: ModelListCache) {
  store.setSetting(MODEL_LISTS_SETTING, cache);
}

export function modelListRowBytes(row: ModelListRow): number {
  return Buffer.byteLength(JSON.stringify(row), 'utf8');
}

export function canStoreModelListRow(row: ModelListRow): boolean {
  return modelListRowBytes(row) <= MODEL_LIST_MAX_BYTES;
}

export function dropProviderRow(cache: ModelListCache, provider: ModelListProvider): ModelListCache {
  const byProvider = { ...cache.byProvider };
  delete byProvider[provider];
  return { version: MODEL_LIST_CACHE_VERSION, byProvider };
}
