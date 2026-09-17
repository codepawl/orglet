import { z } from 'zod';

/** Display currencies. Budgets and the ledger stay in USD micros; these only change how amounts are shown and entered. */
export const currencies = {
  USD: 'Đô la Mỹ', VND: 'Việt Nam đồng', EUR: 'Euro', GBP: 'Bảng Anh', JPY: 'Yên Nhật', CNY: 'Nhân dân tệ',
  KRW: 'Won Hàn Quốc', SGD: 'Đô la Singapore', THB: 'Baht Thái', AUD: 'Đô la Úc', CAD: 'Đô la Canada',
} as const;
export const CurrencyCode = z.enum(Object.keys(currencies) as [keyof typeof currencies, ...(keyof typeof currencies)[]]);
export type CurrencyCode = z.infer<typeof CurrencyCode>;
export const CurrencyState = z.object({
  code: CurrencyCode,
  /** Units of `code` per 1 USD. */
  rate: z.number().positive().finite(),
  updatedAt: z.iso.datetime().nullable(),
  error: z.string().max(300).optional(),
}).strict();
export type CurrencyState = z.infer<typeof CurrencyState>;
export const usdCurrency: CurrencyState = { code: 'USD', rate: 1, updatedAt: null };

const locale = (code: CurrencyCode) => code === 'VND' ? 'vi-VN' : 'en-US';

export function formatMicros(micros: number, currency: CurrencyState) {
  const amount = micros / 1_000_000 * currency.rate;
  // USD keeps sub-cent precision for token-level costs; other currencies use their normal minor units.
  const digits = currency.code === 'USD' ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : {};
  return new Intl.NumberFormat(locale(currency.code), { style: 'currency', currency: currency.code, ...digits }).format(amount);
}
/** Plain number for an input field, in the display currency. */
export function microsToAmount(micros: number, currency: CurrencyState) {
  const amount = micros / 1_000_000 * currency.rate;
  return String(Number(amount.toFixed(currency.code === 'USD' ? 4 : amount >= 100 ? 0 : 2)));
}
/** USD micros for a value typed in the display currency; NaN when the text is not a number. */
export function amountToMicros(text: string, currency: CurrencyState) {
  const amount = Number(text.replace(/[\s,]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount / currency.rate * 1_000_000) : Number.NaN;
}
export const currencySymbol = (currency: CurrencyState) => new Intl.NumberFormat(locale(currency.code), { style: 'currency', currency: currency.code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency.code;
