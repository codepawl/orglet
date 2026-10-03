import { afterEach, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { SyncClockStore } from '../../apps/desktop/src/core/storage/sync-clock';
import { SyncClock, compareSyncClock } from '../../apps/desktop/src/shared/sync';

const directory = mkdtempSync(join(tmpdir(), 'orglet-sync-clock-'));
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

it('keeps local time monotonic through rollback, remote observation and a database restart', () => {
  const path = join(directory, 'clock.sqlite');
  let store = new Store(path, { syncNow: () => 0 }); stores.push(store);
  let time = 1000;
  let clock = new SyncClockStore(store, () => time);
  const first = clock.tick();
  expect({ wallMs: first.wallMs, counter: first.counter }).toEqual({ wallMs: 1000, counter: 0 });
  time = 900;
  expect(clock.tick()).toEqual({ ...first, counter: 1 });
  const remote = SyncClock.parse({ wallMs: 2000, counter: 7, deviceId: '20000000-0000-4000-8000-000000000001' });
  expect(clock.tick(remote)).toEqual({ ...first, wallMs: 2000, counter: 8 });
  const records = store.db.prepare('SELECT record_key,data FROM sync_records ORDER BY record_key').all();
  store.db.close(); stores.pop();
  store = new Store(path, { syncNow: () => 0 }); stores.push(store); clock = new SyncClockStore(store, () => 800);
  expect(store.db.prepare('SELECT record_key,data FROM sync_records ORDER BY record_key').all()).toEqual(records);
  expect(clock.tick()).toEqual({ ...first, wallMs: 2000, counter: 9 });
  expect(compareSyncClock(first, clock.read())).toBeLessThan(0);
});

it('rolls back the persisted clock together with a failed domain transaction', () => {
  const store = new Store(':memory:', { syncNow: () => 0 }); stores.push(store);
  const clock = new SyncClockStore(store, () => 1000);
  const before = clock.read();
  expect(() => store.transaction(() => {
    clock.tick(); store.setSetting('language', 'vi'); throw new Error('Injected write failure');
  })).toThrow('Injected write failure');
  expect(clock.read()).toEqual(before);
  expect(store.setting('language', 'en')).toBe('en');
  expect(clock.tick()).toEqual({ ...before, wallMs: 1000, counter: 0 });
});

it('uses a deterministic device tie-breaker for equal remote clocks', () => {
  const first = SyncClock.parse({ wallMs: 1000, counter: 2, deviceId: '10000000-0000-4000-8000-000000000001' });
  const second = SyncClock.parse({ wallMs: 1000, counter: 2, deviceId: '20000000-0000-4000-8000-000000000001' });
  expect(compareSyncClock(first, second)).toBe(-1);
  expect(compareSyncClock(second, first)).toBe(1);
});
