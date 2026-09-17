import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store; let core: CoreService; let live: number; let peak: number; let calls: number; let hold: Promise<void>; let release: () => void;
const report = JSON.stringify({ title: 'Report', summary: 'Fixture.', findings: [], limitations: [] });
beforeEach(() => {
  store = new Store(':memory:'); live = 0; peak = 0; calls = 0;
  hold = new Promise(resolve => { release = resolve; });
  core = new CoreService(store, () => {}, async () => ({ async request() {
    calls++; live++; peak = Math.max(peak, live);
    try { await hold; return { calls: [{ id: 'r', name: 'submit_report', arguments: report }], usage: { input: 10, output: 10 } }; }
    finally { live--; }
  } }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); });

async function start(brief: string) {
  const worker = store.all<Worker>('workers')[0];
  return core.command('createTask', { workerId: worker.id, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as Promise<string>;
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 300 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(condition()).toBe(true);
}

it('queues requests beyond the workspace provider limit without reserving budget for waiting work', async () => {
  await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' });
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, providerConcurrency: 1 });
  expect(store.workspace().providerConcurrency).toBe(1);
  const first = await start('First'); const second = await start('Second');
  await until(() => calls === 1 && store.detail(second).events.some(event => event.message.includes('chờ lượt')));
  expect(store.usage(second).reservedMicros).toBe(0);

  // Cancelling queued work releases nothing it never held and leaves the running request alone.
  await core.command('cancel', { id: second });
  await until(() => store.get<Task>('tasks', second).status === 'cancelled');
  const third = await start('Third');
  release();
  await until(() => [first, third].every(id => store.get<Task>('tasks', id).status === 'completed'));
  expect(peak).toBe(1); expect(calls).toBe(2);
  expect(store.detail(second).runs[0].status).toBe('cancelled');
});

it('defaults to two concurrent requests per provider', async () => {
  await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' });
  const ids = await Promise.all(['A', 'B', 'C'].map(start));
  await until(() => calls === 2);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(calls).toBe(2);
  release();
  await until(() => ids.every(id => store.get<Task>('tasks', id).status === 'completed'));
  expect(peak).toBe(2);
});
