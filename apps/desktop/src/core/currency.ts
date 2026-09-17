import type { CurrencyCode } from '../shared/currency';

export const RATE_SOURCE = 'https://open.er-api.com/v6/latest/USD';
export const RATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export type RateFetcher = (code: CurrencyCode) => Promise<{ rate: number; updatedAt: string }>;

/**
 * Current USD exchange rate from the free ExchangeRate-API open endpoint. The request carries no workspace data.
 */
export const fetchUsdRate: RateFetcher = async code => {
  if (code === 'USD') return { rate: 1, updatedAt: new Date().toISOString() };
  const response = await fetch(RATE_SOURCE, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Dịch vụ tỷ giá trả lỗi ${response.status}.`);
  const body = await response.json() as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
  const rate = body.rates?.[code];
  if (body.result !== 'success' || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new Error(`Không có tỷ giá hợp lệ cho ${code}.`);
  const updated = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : new Date();
  return { rate, updatedAt: updated.toISOString() };
};
