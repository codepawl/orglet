import { Store, id, now } from '../storage/database';
import { modelConfig } from '../adapters/catalog';
import type { ModelRates, TokenPrice } from '../models/resolve';

export class BudgetError extends Error {}
export type { ModelRates };
// Integer micro-USD; round upward instead of losing fractional micro-dollars.
export function cost(inputTokens: number, outputTokens: number, rates: string | TokenPrice = 'openai') {
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Usage không hợp lệ.');
  const config = typeof rates === 'string' ? modelConfig(rates) : rates;
  if ('inputMicrosPerMillion' in config) {
    const perMillion = inputTokens * config.inputMicrosPerMillion + outputTokens * config.outputMicrosPerMillion;
    if (!Number.isSafeInteger(perMillion)) throw new Error('Usage không hợp lệ.');
    return Math.ceil(perMillion / 1_000_000);
  }
  return Math.ceil((inputTokens * config.inputTenths + outputTokens * config.outputTenths) / 10);
}
export class BudgetLedger {
  constructor(private store: Store) {}
  reserve(runId: string, taskId: string, provider: string, amount: number, taskLimit: number, connectionLimit: number, team?: { id: string; limit: number }, journal?: (reservationId: string) => void): string {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BudgetError('Không có giá hợp lệ để giữ ngân sách.');
    return this.store.transaction(() => {
      const month = new Date().toISOString().slice(0, 7);
      const used = (clause: string, args: string[]) => Number(this.store.db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.state='settled' THEN COALESCE(l.amount,0) ELSE r.amount END),0) AS total FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id WHERE ${clause}`).get(...args)!.total);
      if (used('r.task_id=?', [taskId]) + amount > taskLimit || used('r.provider=? AND (r.month=? OR r.state!=\'settled\')', [provider, month]) + amount > connectionLimit) throw new BudgetError('Ngân sách còn lại không đủ cho request kế tiếp.');
      if (team && used("r.task_id IN (SELECT id FROM tasks WHERE json_extract(data,'$.teamId')=?) AND (r.month=? OR r.state!='settled')", [team.id, month]) + amount > team.limit) throw new BudgetError('Hội đã chạm giới hạn ngân sách tháng.');
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
  settle(reservation: string, input: number, output: number, rates?: ModelRates) {
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT state,provider FROM reservations WHERE id=?').get(reservation);
      if (!row || row.state === 'settled') throw new Error('Reservation đã được đối soát hoặc không tồn tại.');
      const amount = cost(input, output, rates ?? String(row.provider));
      this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(id(), reservation, amount, input, output, rates?.pricingVersion ?? modelConfig(String(row.provider)).pricingVersion);
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
      this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)')
        .run(id(), reservation, amount, 0, 0, 'manual-reconciliation');
      this.store.db.prepare('UPDATE reservation_reviews SET actual_amount=?,verified_source=?,resolved_at=? WHERE reservation_id=?')
        .run(amount, source, now(), reservation);
      this.store.db.prepare("UPDATE reservations SET state='settled' WHERE id=?").run(reservation);
    });
  }
}
