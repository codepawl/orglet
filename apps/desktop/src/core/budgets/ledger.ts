import { Store, id } from '../storage/database';
import { modelConfig } from '../adapters/catalog';

export class BudgetError extends Error {}
// Integer micro-USD; round upward instead of losing fractional micro-dollars.
export function cost(inputTokens: number, outputTokens: number, provider = 'openai') {
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Usage không hợp lệ.');
  const config = modelConfig(provider);
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
      if (team && used("r.task_id IN (SELECT id FROM tasks WHERE json_extract(data,'$.teamId')=?) AND (r.month=? OR r.state!='settled')", [team.id, month]) + amount > team.limit) throw new BudgetError('Nhóm đã chạm giới hạn ngân sách tháng.');
      const reservation = id();
      this.store.db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?)').run(reservation, runId, taskId, provider, month, amount, 'held');
      journal?.(reservation);
      return reservation;
    });
  }
  settle(reservation: string, input: number, output: number) {
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT state,provider FROM reservations WHERE id=?').get(reservation);
      if (!row || row.state === 'settled') throw new Error('Reservation đã được đối soát hoặc không tồn tại.');
      const amount = cost(input, output, String(row.provider));
      this.store.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(id(), reservation, amount, input, output, modelConfig(String(row.provider)).pricingVersion);
      this.store.db.prepare("UPDATE reservations SET state='settled' WHERE id=?").run(reservation);
    });
  }
  unknown(reservation: string) { this.store.db.prepare("UPDATE reservations SET state='unknown' WHERE id=? AND state='held'").run(reservation); }
}
