import { CATALOG_HINT_IDS } from '../../shared/models';

/**
 * Prompt-cache prices in hundredths of a micro-dollar per token, so a $1.25 per million write stays an integer. Writes
 * are the 5-minute TTL price, the only one Orglet sends; reads are what a cache hit costs.
 */
export type CachePrice = { cacheWriteHundredths: number; cacheReadHundredths: number };

/** Pinned default IDs and verified prices. Suggestions for the picker, not the only allowed ID. */
export const modelCatalog = {
  openai: { model: CATALOG_HINT_IDS.openai, inputTenths: 4, outputTenths: 16, pricingVersion: `${CATALOG_HINT_IDS.openai}:0.40:1.60` },
  // Claude Sonnet 5.5: $2 / $10 per MTok, 5-minute cache writes $2.50, cache reads $0.20 (claude-api skill, 2026-09-25).
  anthropic: {
    model: CATALOG_HINT_IDS.anthropic, inputTenths: 20, outputTenths: 100, cacheWriteHundredths: 250, cacheReadHundredths: 20,
    pricingVersion: `${CATALOG_HINT_IDS.anthropic}:2.00:10.00:cache-write-2.50:cache-read-0.20`,
  },
  // ponytail: grok-3-mini keeps the cheap default; revalidate against https://docs.x.ai/developers/pricing before release.
  xai: { model: CATALOG_HINT_IDS.xai, inputTenths: 3, outputTenths: 5, pricingVersion: `${CATALOG_HINT_IDS.xai}:0.30:0.50` },
  // OpenRouter pass-through of the OpenAI mini snapshot; native list tenths win when cached. Revalidate at https://openrouter.ai/models.
  openrouter: { model: CATALOG_HINT_IDS.openrouter, inputTenths: 4, outputTenths: 16, pricingVersion: `${CATALOG_HINT_IDS.openrouter}:0.40:1.60` },
} as const;
export type CatalogProvider = keyof typeof modelCatalog;
export function modelConfig(provider: string) {
  if (!Object.hasOwn(modelCatalog, provider)) throw new Error('Provider không có catalog giá hợp lệ.');
  return modelCatalog[provider as keyof typeof modelCatalog];
}

const HAIKU_4_5_PRICE = {
  // Claude Haiku 4.5: $1 / $5 per MTok; cache writes 1.25x and reads 0.1x the input price (claude-api skill).
  inputTenths: 10, outputTenths: 50, cacheWriteHundredths: 125, cacheReadHundredths: 10,
  pricingVersion: 'claude-haiku-4-5-20251001:1.00:5.00:cache-write-1.25:cache-read-0.10',
};

/**
 * Verified prices of Anthropic IDs that are no longer the default but that an orglet may have saved, so its runs keep
 * settling at the real price instead of holding an unknown charge (COD-358 moved the default off Claude Haiku 4.5).
 */
export const formerAnthropicDefaults: Readonly<Record<string, typeof HAIKU_4_5_PRICE>> = {
  'claude-haiku-4-5-20251001': HAIKU_4_5_PRICE,
  'claude-haiku-4-5': { ...HAIKU_4_5_PRICE, pricingVersion: 'claude-haiku-4-5:1.00:5.00:cache-write-1.25:cache-read-0.10' },
};

/**
 * The most output tokens one request may ask for, and so what a step's budget hold covers. Anthropic gets the
 * claude-api skill's default for requests that must finish inside an HTTP timeout (a step stops after 90 seconds);
 * thinking counts toward it. The OpenAI-compatible adapters keep their 4096.
 */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 16_000;
export const OPENAI_MAX_OUTPUT_TOKENS = 4096;
export function maxOutputTokens(provider: string): number {
  return provider === 'anthropic' ? ANTHROPIC_MAX_OUTPUT_TOKENS : OPENAI_MAX_OUTPUT_TOKENS;
}
/**
 * The fewest output tokens a step may ask for when the chat's budget cannot hold the full cap: the 4096 every provider
 * had before COD-358. Only Anthropic asks for less than its cap; the others always ask for their 4096.
 */
export function minOutputTokens(provider: string): number {
  return provider === 'anthropic' ? OPENAI_MAX_OUTPUT_TOKENS : maxOutputTokens(provider);
}
