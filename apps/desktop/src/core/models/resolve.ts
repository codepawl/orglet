import { isLocalApi, type Worker } from '../../shared/contracts';
import { isHarness } from '../../shared/harness';
import { CATALOG_HINT_IDS, type ModelEntry, type ModelListCache } from '../../shared/models';
import { isOpenCodePlan, type OpenCodePlan } from '../../shared/opencode';
import { modelCatalog, type CatalogProvider } from '../adapters/catalog';

export type ModelRates = { inputTenths: number; outputTenths: number; pricingVersion: string };
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
 * so nothing is pinned here. Zen runs hold unknown cost like any unpriced ID; Go runs are billed by the Go plan.
 */
function resolveOpenCodeModel(plan: OpenCodePlan, custom: string | undefined): ResolvedModel {
  if (!custom) return { pricingVersion: `${plan}:unselected` };
  if (plan === 'opencode-go') return { id: custom, pricingVersion: `plan:opencode-go:${custom}` };
  return { id: custom, pricingVersion: `unknown:${custom}` };
}

/** Selected slug plus verified prices. Custom OpenAI/Anthropic IDs are unpriced (unknown reservation). */
export function resolveWorkerModel(worker: Pick<Worker, 'provider' | 'modelId'>, cache?: ModelListCache): ResolvedModel {
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
