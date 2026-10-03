import type { Store } from './database';
import { removeSeed, untouchedSeed } from './factory-seed';
import { SyncDeviceId, type SyncRecordingContext } from '../../shared/sync';
import { SyncRecord, syncRecordKey } from '../../shared/sync-records';
import { SyncServerCursor, SYNC_BATCH_BYTES } from '../../shared/sync-protocol';
import { SyncReplicaAction, type SyncReplicaBatch, type SyncReplicaState } from '../../shared/sync-replica';

/** Room for the request's own fields around the records. */
const BATCH_MARGIN_BYTES = 65_536;

/**
 * This computer's side of account sync (COD-329 phase 3): which accounts it has joined, how far it has read each, and
 * which of its records the server is known to hold. Main drives it while talking to the server; nothing here touches
 * the network or sees a token. Local changes are recorded for an account only once the computer has joined it.
 */
export class SyncReplica {
  constructor(private store: Store, private notify: () => void) {}

  execute(raw: unknown): SyncReplicaState | SyncReplicaBatch | null {
    const input = SyncReplicaAction.parse(raw);
    if (input.action === 'attach') return this.attach(input.context);
    if (input.action === 'detach') {
      this.store.sync.setRecordingContext(undefined);
      return null;
    }
    if (input.action === 'begin') return this.begin(input.context, input.discardSeed);
    if (input.action === 'receive') return this.receive(input.context, input.records, input.cursor);
    if (input.action === 'settle') return this.settle(input.context, input.cursor);
    if (input.action === 'outbox') return this.outbox(input.context);
    return this.acknowledge(input.context, input.outcomes);
  }

  private account(accountKey: string) {
    const row = this.store.db.prepare('SELECT linked,cursor_json,held FROM sync_accounts WHERE account_key=?').get(accountKey);
    return {
      linked: Boolean(row?.linked),
      held: Boolean(row?.held),
      cursor: row?.cursor_json ? SyncServerCursor.parse(JSON.parse(String(row.cursor_json))) : null,
    };
  }

  private attach(context: SyncRecordingContext): SyncReplicaState {
    const account = this.account(context.accountKey);
    this.store.sync.setRecordingContext(account.linked ? context : undefined);
    // Edits made while signed out were not recorded for the account; queue what the server lacks.
    if (account.linked) this.requeue(context);
    return {
      deviceId: SyncDeviceId.parse(this.store.sync.deviceId()),
      linked: account.linked,
      cursor: account.cursor,
      // Data erased here on purpose counts too: the account's copy returns only when the person asks for it.
      ownData: account.held || !untouchedSeed(this.store),
    };
  }

  private begin(context: SyncRecordingContext, discardSeed: boolean): null {
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO sync_accounts(account_key,linked,cursor_json,held) VALUES(?,1,NULL,0)
        ON CONFLICT(account_key) DO UPDATE SET linked=1,cursor_json=NULL,held=0`).run(context.accountKey);
      this.store.db.prepare('DELETE FROM sync_confirmed WHERE account_key=?').run(context.accountKey);
      const seed = discardSeed ? untouchedSeed(this.store) : undefined;
      if (seed) {
        // The seed never left this computer, so its removal is not news for the account either.
        this.store.sync.setRecordingContext(undefined);
        removeSeed(this.store, seed);
        this.store.db.prepare('DELETE FROM sync_records WHERE record_key IN (?,?)')
          .run(`withdraw:worker:${seed.workerId}`, `delete:skill:${seed.skillId}`);
      }
      this.store.sync.setRecordingContext(context);
    });
    return null;
  }

  private receive(context: SyncRecordingContext, records: unknown[], cursor?: SyncServerCursor): null {
    this.store.transaction(() => {
      this.store.sync.receive(context, records);
      for (const raw of records) {
        const record = SyncRecord.safeParse(raw);
        if (record.success) this.confirm(context.accountKey, syncRecordKey(record.data.data), record.data.id);
      }
      // An applied page is settled by the cursor; keeping its copy would store every record twice.
      this.store.db.prepare("DELETE FROM sync_inbox WHERE account_key=? AND status='applied'").run(context.accountKey);
      if (cursor) this.saveCursor(context.accountKey, cursor);
    });
    if (records.length) this.notify();
    return null;
  }

  private settle(context: SyncRecordingContext, cursor: SyncServerCursor): null {
    this.store.transaction(() => {
      this.saveCursor(context.accountKey, cursor);
      this.requeue(context);
    });
    return null;
  }

  private requeue(context: SyncRecordingContext) {
    const confirmed = new Map(this.store.db.prepare('SELECT record_key,record_id FROM sync_confirmed WHERE account_key=?')
      .all(context.accountKey).map(row => [String(row.record_key), String(row.record_id)]));
    this.store.sync.requeue(context, confirmed);
  }

  private outbox(context: SyncRecordingContext): SyncReplicaBatch {
    if (this.store.sync.hasFutureRecords(context)) return { records: [], skipped: 0, updateRequired: true };
    const records: SyncRecord[] = [];
    let bytes = 0;
    for (const { record } of this.store.sync.outbox(context, 100)) {
      bytes += Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
      if (records.length && bytes > SYNC_BATCH_BYTES - BATCH_MARGIN_BYTES) break;
      records.push(record);
    }
    return { records, skipped: this.store.sync.oversized(context), updateRequired: false };
  }

  private acknowledge(context: SyncRecordingContext, outcomes: { id: string; status: 'kept' | 'superseded' | 'blocked' }[]): null {
    this.store.transaction(() => {
      for (const outcome of outcomes) {
        if (outcome.status === 'blocked') continue;
        const row = this.store.db.prepare('SELECT data FROM sync_outbox WHERE account_key=? AND record_id=?').get(context.accountKey, outcome.id);
        if (row) this.confirm(context.accountKey, syncRecordKey(SyncRecord.parse(JSON.parse(String(row.data))).data), outcome.id);
      }
      // A blocked record names a scope the server has withdrawn or deleted; sending it again cannot change that.
      this.store.sync.acknowledge(context, outcomes.map(outcome => outcome.id));
    });
    return null;
  }

  private confirm(accountKey: string, recordKey: string, recordId: string) {
    this.store.db.prepare(`INSERT INTO sync_confirmed VALUES(?,?,?)
      ON CONFLICT(account_key,record_key) DO UPDATE SET record_id=excluded.record_id`).run(accountKey, recordKey, recordId);
  }

  private saveCursor(accountKey: string, cursor: SyncServerCursor) {
    const saved = this.store.db.prepare('UPDATE sync_accounts SET cursor_json=? WHERE account_key=? AND linked=1')
      .run(JSON.stringify(cursor), accountKey);
    if (!saved.changes) throw new Error('Phiên đồng bộ đã đổi.');
  }
}
