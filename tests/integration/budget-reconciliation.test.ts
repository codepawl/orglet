import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { BudgetError, BudgetLedger } from '../../apps/desktop/src/core/budgets/ledger';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const stores: Store[] = [];
const createStore = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
};

function createRun(store: Store) {
  const worker = store.all<Worker>('workers')[0];
  const skill = store.all<Skill>('skills')[0];
  const task: Task = {
    id: id(), workerId: worker.id, brief: 'Check a charge', status: 'failed', budgetMicros: 1_000,
    sourceIds: [], consent: true, providerScopes: ['openai'], accepted: false, createdAt: now(),
  };
  const run: Run = {
    id: id(), taskId: task.id, status: 'failed', snapshot: { worker: { ...worker, provider: 'openai' }, skill },
    error: 'Request failed', startedAt: now(),
  };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

it('keeps an unknown hold until a verified amount is recorded, then changes the ledger only once', async () => {
  const store = createStore();
  const { task, run } = createRun(store);
  const ledger = new BudgetLedger(store);
  const reservation = ledger.reserve(run.id, task.id, 'openai', 600, task.budgetMicros, 1_000);
  ledger.unknown(reservation, 'request_failed');
  expect(store.workspace().budgetReservations).toMatchObject([{
    id: reservation, originalMicros: 600, reason: 'request_failed', actualMicros: null,
  }]);
  const core = new CoreService(store, () => {}, async () => { throw new Error('No model call'); });
  await core.command('reconcileBudget', { reservationId: reservation, amountMicros: 250, source: 'provider_dashboard' });
  await core.command('reconcileBudget', { reservationId: reservation, amountMicros: 250, source: 'provider_dashboard' });
  await expect(core.command('reconcileBudget', { reservationId: reservation, amountMicros: 0, source: 'invoice' })).rejects.toThrow(BudgetError);
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM ledger WHERE reservation_id=?').get(reservation)?.count).toBe(1);
  expect(store.usage(task.id)).toMatchObject({ chargedMicros: 250, reservedMicros: 0, uncertainCount: 0 });
  expect(store.workspace().budgetReservations).toMatchObject([{
    id: reservation, originalMicros: 600, actualMicros: 250, verifiedSource: 'provider_dashboard',
  }]);
});

it('releases an old-month unknown hold from current monthly caps after reconciliation', () => {
  const store = createStore();
  const first = createRun(store);
  const second = createRun(store);
  const teamId = id();
  store.update('tasks', { ...first.task, teamId });
  store.update('tasks', { ...second.task, teamId });
  const ledger = new BudgetLedger(store);
  const team = { id: teamId, limit: 1_000 };
  const reservation = ledger.reserve(first.run.id, first.task.id, 'openai', 600, first.task.budgetMicros, 2_000, team);
  ledger.unknown(reservation, 'missing_usage');
  store.db.prepare("UPDATE reservations SET month='2020-01' WHERE id=?").run(reservation);
  expect(() => ledger.reserve(second.run.id, second.task.id, 'openai', 500, second.task.budgetMicros, 1_000, { ...team, limit: 2_000 })).toThrow(BudgetError);
  expect(() => ledger.reserve(second.run.id, second.task.id, 'openai', 500, second.task.budgetMicros, 2_000, team)).toThrow(BudgetError);
  ledger.reconcile(reservation, 200, 'invoice');
  expect(ledger.reserve(second.run.id, second.task.id, 'openai', 500, second.task.budgetMicros, 1_000, team)).toBeTruthy();
  expect(() => ledger.reserve(first.run.id, first.task.id, 'openai', 900, first.task.budgetMicros, 2_000)).toThrow(BudgetError);
});

it('preserves a resolved charge when an older unknown backup is restored again', () => {
  const source = createStore();
  const { task, run } = createRun(source);
  const ledger = new BudgetLedger(source);
  const reservation = ledger.reserve(run.id, task.id, 'openai', 600, task.budgetMicros, 1_000);
  ledger.unknown(reservation, 'missing_usage');
  const service = new CoreService(source, () => {}, async () => { throw new Error('No model call'); });
  const oldBackup = service.backups.export();
  ledger.reconcile(reservation, 125, 'invoice');
  const resolvedBackup = service.backups.export();

  const restored = createStore();
  const receiver = new CoreService(restored, () => {}, async () => { throw new Error('No model call'); });
  receiver.backups.restore(receiver.backups.preview(resolvedBackup).token);
  receiver.backups.restore(receiver.backups.preview(oldBackup).token);
  expect(restored.usage(task.id)).toMatchObject({ chargedMicros: 125, reservedMicros: 0, uncertainCount: 0 });
  expect(restored.budgetReservations()).toMatchObject([{
    id: reservation, originalMicros: 600, reason: 'missing_usage', actualMicros: 125, verifiedSource: 'invoice',
  }]);
  expect(restored.db.prepare('SELECT COUNT(*) AS count FROM ledger WHERE reservation_id=?').get(reservation)?.count).toBe(1);
});

it('imports an older backup without review records as an explicit legacy unknown', () => {
  const source = createStore();
  const { task, run } = createRun(source);
  const ledger = new BudgetLedger(source);
  const reservation = ledger.reserve(run.id, task.id, 'openai', 600, task.budgetMicros, 1_000);
  ledger.unknown(reservation, 'missing_usage');
  const service = new CoreService(source, () => {}, async () => { throw new Error('No model call'); });
  const envelope = JSON.parse(service.backups.export());
  delete envelope.payload.reservationReviews;
  envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');

  const restored = createStore();
  const receiver = new CoreService(restored, () => {}, async () => { throw new Error('No model call'); });
  receiver.backups.restore(receiver.backups.preview(JSON.stringify(envelope)).token);
  expect(restored.budgetReservations()).toMatchObject([{
    id: reservation, originalMicros: 600, reason: 'legacy', actualMicros: null,
  }]);
  expect(restored.usage(task.id).reservedMicros).toBe(600);
});
