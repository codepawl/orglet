import { isLocalApi, type Worker } from '../../shared/contracts';
import { isHarness } from '../../shared/harness';
import { CATALOG_HINT_IDS, type ModelEntry, type ModelListCache } from '../../shared/models';
import { isOpenCodePlan, type OpenCodePlan } from '../../shared/opencode';
import { connectionPricing, findCustomConnection, isCustomProvider, type CustomConnection } from '../../shared/custom-connections';
import { modelCatalog, type CatalogProvider } from '../adapters/catalog';

/**
 * A price per token: tenths of a micro-dollar for the built-in catalog and native lists, or micro-dollars per million
 * tokens for a price the person entered on a custom connection (COD-242). `cost` in the ledger reads either.
 */
export type TokenPrice = { inputTenths: number; outputTenths: number } | { inputMicrosPerMillion: number; outputMicrosPerMillion: number };
export type ModelRates = TokenPrice & { pricingVersion: string };
export type ResolvedModel = { id?: string; rates?: ModelRates; pricingVersion: string };

export function pricingVersionOf(id: string, inputTenths: number, outputTenths: number) {
  return `${id}:${(inputTenths / 10).toFixed(2)}:${(outputTenths / 10).toFixed(2)}`;
}

function matchEntry(models: ModelEntry[] | undefined, id: string) {
  return models?.find(entry => entry.id === id || entry.aliases?.includes(id));
}

function catalogRates(provider: CatalogProvider): ModelRates {
  const config = modelCatalog[provider];
  return { inputTenths: config.inputTenths, outputTenths: config.outputTenths, pricingVersion: config.pricingVersion };
}

/**
 * OpenCode has no default model and no price Orglet can verify: `/models` carries no prices and the doc tables change,
 * so nothing is pinned here. Both plans are billed outside Orglet budgets (Zen balance, Go subscription).
 */
function resolveOpenCodeModel(plan: OpenCodePlan, custom: string | undefined): ResolvedModel {
  if (!custom) return { pricingVersion: `${plan}:unselected` };
  return { id: custom, pricingVersion: `plan:${plan}:${custom}` };
}

/**
 * A custom connection has no default model. Its price is the one the person entered, zero for a server on this computer
 * or a private network, or unknown; its `/models` is never trusted for a price. Without a price every request is
 * reserved as an unknown charge (no rates), exactly like a custom model ID on a built-in paid API.
 */
function resolveCustomConnectionModel(provider: string, custom: string | undefined, connections: readonly CustomConnection[]): ResolvedModel {
  if (!custom) return { pricingVersion: `${provider}:unselected` };
  const connection = findCustomConnection(connections, provider);
  const pricing = connection ? connectionPricing(connection) : { kind: 'unknown' as const };
  if (pricing.kind === 'unknown') return { id: custom, pricingVersion: `unknown:${custom}` };
  const { inputMicrosPerMillion, outputMicrosPerMillion } = pricing.price;
  const pricingVersion = `${pricing.kind}:${custom}:${inputMicrosPerMillion}:${outputMicrosPerMillion}`;
  return { id: custom, rates: { inputMicrosPerMillion, outputMicrosPerMillion, pricingVersion }, pricingVersion };
}

/** Selected slug plus verified prices. Custom OpenAI/Anthropic IDs are unpriced (unknown reservation). */
export function resolveWorkerModel(worker: Pick<Worker, 'provider' | 'modelId'>, cache?: ModelListCache, customConnections: readonly CustomConnection[] = []): ResolvedModel {
  if (worker.provider === 'demo') return { pricingVersion: 'demo' };
  const custom = worker.modelId?.trim();
  if (isHarness(worker.provider)) {
    return custom
      ? { id: custom, pricingVersion: `harness:${worker.provider}:${custom}` }
      : { pricingVersion: `harness:${worker.provider}` };
  }
  if (isLocalApi(worker.provider)) {
    const id = custom || CATALOG_HINT_IDS.ollama;
    return { id, pricingVersion: custom ? `ollama:${custom}` : 'ollama' };
  }
  if (isOpenCodePlan(worker.provider)) return resolveOpenCodeModel(worker.provider, custom);
  if (isCustomProvider(worker.provider)) return resolveCustomConnectionModel(worker.provider, custom, customConnections);
  if (!Object.hasOwn(modelCatalog, worker.provider)) throw new Error('Provider không có catalog giá hợp lệ.');
  const provider = worker.provider as CatalogProvider;
  const catalog = modelCatalog[provider];
  const id = custom || catalog.model;
  if (id === catalog.model) return { id, rates: catalogRates(provider), pricingVersion: catalog.pricingVersion };
  if (provider === 'xai' || provider === 'openrouter') {
    const entry = matchEntry(cache?.byProvider[provider]?.models, id);
    if (entry && entry.inputTenths != null && entry.outputTenths != null) {
      const pricingVersion = pricingVersionOf(id, entry.inputTenths, entry.outputTenths);
      return { id, rates: { inputTenths: entry.inputTenths, outputTenths: entry.outputTenths, pricingVersion }, pricingVersion };
    }
  }
  return { id, pricingVersion: `unknown:${id}` };
}
