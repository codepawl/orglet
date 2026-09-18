/** Pinned default IDs and verified prices. Suggestions for the picker, not the only allowed ID. */
export const modelCatalog = {
  openai: { model: 'gpt-4.1-mini-2025-04-14', inputTenths: 4, outputTenths: 16, pricingVersion: 'gpt-4.1-mini-2025-04-14:0.40:1.60' },
  anthropic: { model: 'claude-haiku-4-5-20251001', inputTenths: 10, outputTenths: 50, pricingVersion: 'claude-haiku-4-5-20251001:1.00:5.00' },
  // ponytail: grok-3-mini keeps the cheap default; revalidate against https://docs.x.ai/developers/pricing before release.
  xai: { model: 'grok-3-mini', inputTenths: 3, outputTenths: 5, pricingVersion: 'grok-3-mini:0.30:0.50' },
} as const;
export type CatalogProvider = keyof typeof modelCatalog;
export function modelConfig(provider: string) {
  if (!Object.hasOwn(modelCatalog, provider)) throw new Error('Provider không có catalog giá hợp lệ.');
  return modelCatalog[provider as keyof typeof modelCatalog];
}
