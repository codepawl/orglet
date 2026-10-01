import { Store, id, now } from '../storage/database';
import { modelConfig } from '../adapters/catalog';
import type { ModelRates, TokenPrice } from '../models/resolve';
import { dailyCapOfTask, spentOnDay } from './daily-cap';

export class BudgetError extends Error {}
/** A schedule's runs of the day already cost what its daily cap allows (COD-288). */
export class DailyCapReached extends BudgetError {}
/**
 * A request inside a schedule's run would take the day past the schedule's cap. A run is only started when its whole
 * limit fits, so this happens when the day also spent elsewhere, such as a message the person sent in an earlier run.
 */
export const DAILY_CAP_REACHED_IN_RUN = 'Lịch đã chạm giới hạn chi phí trong ngày. Nâng giới hạn mỗi ngày của lịch rồi tiếp tục.';
export type { ModelRates };
/**
 * The prompt tokens of one request a provider served from its cache (`read`) or wrote to it (`write`). Both are parts of
 * the request's input tokens, not added to them (COD-358).
 */
export type CachedTokens = { read: number; write: number };

function validTokenCount(count: number) {
  return Number.isSafeInteger(count) && count >= 0;
}

type TenthsPrice = { inputTenths: number; outputTenths: number; cacheWriteHundredths?: number; cacheReadHundredths?: number };

/** A tenths price in hundredths of a micro-dollar per token; a price without cache prices bills cached tokens as input. */
function hundredthsOf(config: TenthsPrice) {
  const input = config.inputTenths * 10;
  return { input, output: config.outputTenths * 10, write: config.cacheWriteHundredths ?? input, read: config.cacheReadHundredths ?? input };
}

// Integer micro-USD; round upward instead of losing fractional micro-dollars.
export function cost(inputTokens: number, outputTokens: number, rates: string | TokenPrice = 'openai', cached: CachedTokens = { read: 0, write: 0 }) {
  if (![inputTokens, outputTokens, cached.read, cached.write].every(validTokenCount)) throw new Error('Usage không hợp lệ.');
  if (cached.read + cached.write > inputTokens) throw new Error('Usage không hợp lệ.');
  const config = typeof rates === 'string' ? modelConfig(rates) : rates;
  if ('inputMicrosPerMillion' in config) {
    // A price entered on a custom connection has no cache prices, so every prompt token costs the input price.
    const perMillion = inputTokens * config.inputMicrosPerMillion + outputTokens * config.outputMicrosPerMillion;
    if (!Number.isSafeInteger(perMillion)) throw new Error('Usage không hợp lệ.');
    return Math.ceil(perMillion / 1_000_000);
  }
  const price = hundredthsOf(config);
  const uncached = inputTokens - cached.read - cached.write;
  const hundredths = uncached * price.input + cached.write * price.write + cached.read * price.read + outputTokens * price.output;
  if (!Number.isSafeInteger(hundredths)) throw new Error('Usage không hợp lệ.');
  return Math.ceil(hundredths / 100);
}

/**
 * What to hold before a request: every prompt token at the dearer of the input and cache-write prices, since any of
 * them may be written to the cache, plus the whole output cap, since thinking and the answer may use all of it. A cache
 * read only ever settles lower than this (COD-358).
 */
export function holdFor(upperInputTokens: number, maxOutputTokens: number, rates: TokenPrice) {
  const allWritten = cost(upperInputTokens, maxOutputTokens, rates, { read: 0, write: upperInputTokens });
  const noneWritten = cost(upperInputTokens, maxOutputTokens, rates);
  return Math.max(allWritten, noneWritten);
}

/**
 * The most output tokens, between `least` and `most`, whose hold fits in `remainingMicros`. A chat with little budget
 * left asks for a shorter answer instead of waiting for budget it may never get; the request is sent with exactly that
 * cap, so it still cannot cost more than its hold. When even `least` does not fit, `most` is returned and the
 * reservation refuses the step as before.
 */
export function affordableOutputTokens(upperInputTokens: number, least: number, most: number, rates: TokenPrice, remainingMicros: number) {
  if (holdFor(upperInputTokens, most, rates) <= remainingMicros) return most;
  if (holdFor(upperInputTokens, least, rates) > remainingMicros) return most;
  let fits = least;
  let tooMany = most;
  while (tooMany - fits > 1) {
    const middle = Math.floor((fits + tooMany) / 2);
    if (holdFor(upperInputTokens, middle, rates) <= remainingMicros) fits = middle;
    else tooMany = middle;
  }
  return fits;
}
export class BudgetLedger {
  constructor(private store: Store) {}
  reserve(runId: string, taskId: string, provider: string, amount: number, taskLimit: number, connectionLimit: number, team?: { id: string; limit: number }, journal?: (reservationId: string) => void): string {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BudgetError('Không có giá hợp lệ để giữ ngân sách.');
    return this.store.transaction(() => {
      const month = new Date().toISOString().slice(0, 7);
      const used = (clause: string, args: string[]) => Number(this.store.db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.state='settled' THEN COALESCE(l.amount,0) ELSE r.amount END),0) AS total FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id WHERE ${clause}`).get(...args)!.total);
      if (used('r.task_id=?', [taskId]) + amount > taskLimit || used('r.provider=? AND (r.month=? OR r.state!=\'settled\')', [provider, month]) + amount > connectionLimit) throw new BudgetError('Ngân sách còn lại không đủ cho request kế tiếp.');
      const scheduleCap = dailyCapOfTask(this.store, taskId);
      if (scheduleCap && spentOnDay(this.store, scheduleCap.routineId, scheduleCap.day) + amount > scheduleCap.capMicros) throw new DailyCapReached(DAILY_CAP_REACHED_IN_RUN);
      if (team && used("r.task_id IN (SELECT id FROM tasks WHERE json_extract(data,'$.teamId')=?) AND (r.month=? OR r.state!='settled')", [team.id, month]) + amount > team.limit) throw new BudgetError('Kênh đã chạm giới hạn ngân sách tháng.');
      const reservation = id();
      this.store.db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?)').run(reservation, runId, taskId, provider, month, amount, 'held');
      journal?.(reservation);
      return reservation;
    });
  }
  /**
   * A request at a known price of zero (a free local server, COD-242). `reserve` refuses a zero hold because it would
   * hide a missing price; here the price is known, so the row is held at zero and settled or marked unknown like any
   * other, which keeps tokens counted and a reply without usage visible.
   */
  reserveAtZeroPrice(runId: string, taskId: string, provider: string, journal?: (reservationId: string) => void): string {
    return this.store.transaction(() => {
      const month = new Date().toISOString().slice(0, 7);
      const reservation = id();
      this.store.db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?)').run(reservation, runId, taskId, provider, month, 0, 'held');
      journal?.(reservation);
      return reservation;
    });
  }
  settle(reservation: string, input: number, output: number, rates?: ModelRates, cached?: CachedTokens) {
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT state,provider FROM reservations WHERE id=?').get(reservation);
      if (!row || row.state === 'settled') throw new Error('Reservation đã được đối soát hoặc không tồn tại.');
      const amount = cost(input, output, rates ?? String(row.provider), cached);
      const pricingVersion = rates?.pricingVersion ?? modelConfig(String(row.provider)).pricingVersion;
      const ledgerId = id();
      this.store.db.prepare('INSERT INTO ledger (id,reservation_id,amount,input_tokens,output_tokens,pricing_version) VALUES(?,?,?,?,?,?)')
        .run(ledgerId, reservation, amount, input, output, pricingVersion);
      if (cached && (cached.read || cached.write)) {
        this.store.db.prepare('INSERT INTO ledger_cache (ledger_id,cache_read_tokens,cache_write_tokens) VALUES(?,?,?)').run(ledgerId, cached.read, cached.write);
      }
      this.store.db.prepare("UPDATE reservations SET state='settled' WHERE id=?").run(reservation);
    });
  }
  unknown(reservation: string, reason: 'missing_usage' | 'request_failed') {
    this.store.transaction(() => {
      const changed = this.store.db.prepare("UPDATE reservations SET state='unknown' WHERE id=? AND state='held'").run(reservation);
      if (!changed.changes) return;
      this.store.db.prepare('INSERT INTO reservation_reviews (reservation_id,reason,noted_at) VALUES(?,?,?)')
        .run(reservation, reason, now());
    });
  }

  reconcile(reservation: string, amount: number, source: 'provider_dashboard' | 'invoice') {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new BudgetError('Chi phí đối soát không hợp lệ.');
    if (source !== 'provider_dashboard' && source !== 'invoice') throw new BudgetError('Nguồn đối soát không hợp lệ.');
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT state FROM reservations WHERE id=?').get(reservation);
      const review = this.store.db.prepare('SELECT actual_amount,verified_source FROM reservation_reviews WHERE reservation_id=?').get(reservation);
      if (!row || !review) throw new BudgetError('Không tìm thấy khoản giữ chỗ chưa rõ chi phí.');
      if (row.state === 'settled' && review.actual_amount === amount && review.verified_source === source) return;
      if (row.state !== 'unknown') throw new BudgetError('Khoản giữ chỗ đã được đối soát hoặc vẫn đang chạy.');
      this.store.db.prepare('INSERT INTO ledger (id,reservation_id,amount,input_tokens,output_tokens,pricing_version) VALUES(?,?,?,?,?,?)')
        .run(id(), reservation, amount, 0, 0, 'manual-reconciliation');
      this.store.db.prepare('UPDATE reservation_reviews SET actual_amount=?,verified_source=?,resolved_at=? WHERE reservation_id=?')
        .run(amount, source, now(), reservation);
      this.store.db.prepare("UPDATE reservations SET state='settled' WHERE id=?").run(reservation);
    });
  }
}
