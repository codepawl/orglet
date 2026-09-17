import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { amountToMicros, formatMicros, microsToAmount, usdCurrency, type CurrencyCode } from '../../apps/desktop/src/shared/currency';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';

let store: Store; let core: CoreService; let now: Date; let calls: CurrencyCode[]; let fail: boolean;
beforeEach(() => {
  store = new Store(':memory:'); now = new Date('2026-09-16T00:00:00Z'); calls = []; fail = false;
  core = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, () => now, undefined, async code => {
    calls.push(code);
    if (fail) throw new Error('offline');
    return { rate: code === 'VND' ? 26_150 : 0.91, updatedAt: now.toISOString() };
  });
});
afterEach(() => store.close());
const workspace = () => core.command('workspace', {}) as Promise<Workspace>;

it('converts between USD micros and the display currency without changing stored budgets', () => {
  const vnd = { code: 'VND' as const, rate: 26_000, updatedAt: null };
  expect(formatMicros(500_000, usdCurrency)).toBe('$0.50');
  expect(formatMicros(500_000, vnd).replace(/\s/g, ' ')).toBe('13.000 ₫');
  expect(microsToAmount(500_000, vnd)).toBe('13000');
  expect(amountToMicros('13000', vnd)).toBe(500_000);
  expect(amountToMicros('13,000', vnd)).toBe(500_000);
  expect(amountToMicros('abc', vnd)).toBeNaN();
  expect(microsToAmount(1234, usdCurrency)).toBe('0.0012');
});

it('switches currency with a fetched rate, keeps the last rate on failure and refreshes stale rates in the background', async () => {
  expect((await workspace()).currency).toEqual(usdCurrency);
  await core.command('setCurrency', { code: 'VND' });
  expect((await workspace()).currency).toEqual({ code: 'VND', rate: 26_150, updatedAt: now.toISOString() });

  fail = true;
  await expect(core.command('setCurrency', { code: 'EUR' })).rejects.toThrow('Không lấy được tỷ giá EUR');
  expect((await workspace()).currency.code).toBe('VND');
  await expect(core.command('refreshCurrency', {})).rejects.toThrow('offline');
  expect((await workspace()).currency).toMatchObject({ code: 'VND', rate: 26_150, error: expect.stringContaining('offline') });

  fail = false; calls = [];
  await core.tick(); expect(calls).toEqual([]);
  now = new Date(now.getTime() + 13 * 60 * 60 * 1000);
  await core.tick(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toEqual(['VND']);
  expect((await workspace()).currency).toEqual({ code: 'VND', rate: 26_150, updatedAt: now.toISOString() });
  // Budgets stay in USD micros regardless of the display currency.
  const worker = (await workspace()).workers[0];
  await core.command('saveWorker', { ...worker, provider: 'openai', taskBudgetMicros: 500_000 });
  expect((await workspace()).workers[0].taskBudgetMicros).toBe(500_000);
});
