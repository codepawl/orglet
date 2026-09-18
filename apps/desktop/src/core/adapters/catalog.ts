import { CATALOG_HINT_IDS } from '../../shared/models';

/** Pinned default IDs and verified prices. Suggestions for the picker, not the only allowed ID. */
export const modelCatalog = {
  openai: { model: CATALOG_HINT_IDS.openai, inputTenths: 4, outputTenths: 16, pricingVersion: `${CATALOG_HINT_IDS.openai}:0.40:1.60` },
  anthropic: { model: CATALOG_HINT_IDS.anthropic, inputTenths: 10, outputTenths: 50, pricingVersion: `${CATALOG_HINT_IDS.anthropic}:1.00:5.00` },
  // ponytail: grok-3-mini keeps the cheap default; revalidate against https://docs.x.ai/developers/pricing before release.
  xai: { model: CATALOG_HINT_IDS.xai, inputTenths: 3, outputTenths: 5, pricingVersion: `${CATALOG_HINT_IDS.xai}:0.30:0.50` },
} as const;
export type CatalogProvider = keyof typeof modelCatalog;
export function modelConfig(provider: string) {
  if (!Object.hasOwn(modelCatalog, provider)) throw new Error('Provider không có catalog giá hợp lệ.');
  return modelCatalog[provider as keyof typeof modelCatalog];
}
