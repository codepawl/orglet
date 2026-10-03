import { randomUUID } from 'node:crypto';
import type { Store } from './database';
import { SyncClock, nextSyncClock } from '../../shared/sync';

/** Private device state. Call tick inside the transaction that saves its domain change and outbox record. */
export class SyncClockStore {
  constructor(private store: Store, private nowMs: () => number = Date.now) {
    this.ensure();
  }
  private ensure() {
    this.store.db.prepare('INSERT OR IGNORE INTO sync_clock(id,device_id,wall_ms,counter) VALUES(1,?,0,0)').run(randomUUID());
  }
  read(): SyncClock {
    const row = this.store.db.prepare('SELECT device_id,wall_ms,counter FROM sync_clock WHERE id=1').get();
    if (!row) throw new Error('Thiếu clock đồng bộ của máy này.');
    return SyncClock.parse({ deviceId: row.device_id, wallMs: row.wall_ms, counter: row.counter });
  }
  tick(remote?: SyncClock): SyncClock {
    const write = () => {
      this.ensure();
      const result = nextSyncClock(this.read(), this.nowMs(), remote);
      this.store.db.prepare('UPDATE sync_clock SET wall_ms=?,counter=? WHERE id=1').run(result.wallMs, result.counter);
      return result;
    };
    return this.store.db.isTransaction ? write() : this.store.transaction(write);
  }
}
