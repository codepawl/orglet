import type { Store } from '../storage/database';
import {
  emptyModelListCache,
  MODEL_LIST_CACHE_VERSION,
  MODEL_LIST_MAX_BYTES,
  MODEL_LISTS_SETTING,
  ModelListCache,
  type ModelListProvider,
  type ModelListRow,
} from '../../shared/models';

export function readModelListCache(store: Store): ModelListCache {
  const parsed = ModelListCache.safeParse(store.setting(MODEL_LISTS_SETTING, null));
  if (!parsed.success || parsed.data.version !== MODEL_LIST_CACHE_VERSION) return emptyModelListCache();
  return parsed.data;
}

/** The context window a provider's list gives for a model, by id or alias; undefined when the list does not say (COD-326). */
export function modelContextTokens(cache: ModelListCache, provider: string, modelId: string | undefined): number | undefined {
  if (!modelId) return undefined;
  const row = cache.byProvider[provider as ModelListProvider];
  return row?.models.find(entry => entry.id === modelId || entry.aliases?.includes(modelId))?.contextTokens;
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
