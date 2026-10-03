import { DurableObject } from 'cloudflare:workers';
import type { Env, DurableObjectState, CloudflareWorkersModule, WebSocket as HibernatingSocket, WebSocketRequestResponsePair as AutoResponse } from '../worker-configuration';
import { z } from 'zod';
import { SyncRecord, syncRecordKey } from '../../../apps/desktop/src/shared/sync-records';
import { compareSyncClock, syncScopeNamespace, syncUuidFromDigest, SyncDeviceId } from '../../../apps/desktop/src/shared/sync';
import { canonicalSyncData } from '../../../apps/desktop/src/shared/sync-json';
import { SyncPushRequest, SyncPullRequest, SyncSnapshotRequest, SyncReleaseDeviceRequest,
  SyncServerCursor, SYNC_BATCH_BYTES, SYNC_RECORD_BYTES } from '../../../apps/desktop/src/shared/sync-protocol';
import { identityConfiguration, type SyncIdentity } from './auth';
import { masterKeys, createAccountKey, unwrapAccountKey, rewrapAccountKey, encryptRow, decryptRow,
  type WrappedKey, type Ciphertext } from './crypto';
import { assessScope, deletionEntities, immutable, type DeletionEntity } from './scope-policy';

export class SyncOperationError extends Error {
  readonly name = 'SyncOperationError';
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
type Account = { sequence: number; privacy: number; floor: number; deleted: number; wrapped: string | null; history_ms: number };
type Stored = { record_key: string; sequence: number; cipher: string; scopes: string; entities: string; created_at: number };
type Session = { deviceId: string; grantId: string; expiresAt: number; generation: string; subject: string };
type Prepared = { record: SyncRecord; key: string; digest: string; bodyDigest: string; initial: Map<string, string> };
const encoder = new TextEncoder();
type SqlStorageValue = ArrayBuffer | string | number | null;
type UpgradeHandler = NonNullable<CloudflareWorkersModule.DurableObject<Env>['fetch']>;
type UpgradeRequest = Parameters<UpgradeHandler>[0];
type UpgradeResponse = Awaited<ReturnType<UpgradeHandler>>;
declare const WebSocketPair: new () => { 0: HibernatingSocket; 1: HibernatingSocket };
declare const WebSocketRequestResponsePair: new (request: string, response: string) => AutoResponse;
const day = 86_400_000;
const rootKey = (root: { kind: string; id: string }) => `${root.kind}:${root.id}`;
function fail(code: string, status = 409): never { throw new SyncOperationError(code, status); }
const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const InternalIdentity = z.object({ subject: z.string().min(1).max(200).refine(value => Boolean(value.trim())),
  grantId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limits: z.object({ storageBytes: z.number().int().min(0).max(100_000_000_000), devices: z.number().int().min(0).max(1000),
    historyDays: z.number().int().min(0).max(36_500) }).strict() }).strict();
async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One authenticated issuer/subject owns one object; only the Worker can invoke these RPC methods. */
export class AccountSync extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL,
      privacy INTEGER NOT NULL, floor INTEGER NOT NULL, deleted INTEGER NOT NULL, wrapped TEXT, history_ms INTEGER NOT NULL);
      INSERT OR IGNORE INTO account VALUES(1,0,0,0,0,NULL,7776000000);
      CREATE TABLE IF NOT EXISTS records (record_key TEXT PRIMARY KEY, sequence INTEGER NOT NULL, cipher TEXT NOT NULL,
        scopes TEXT NOT NULL, entities TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS changes (sequence INTEGER PRIMARY KEY, record_key TEXT NOT NULL, cipher TEXT NOT NULL,
        scopes TEXT NOT NULL, entities TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS changes_age ON changes(created_at);
      CREATE TABLE IF NOT EXISTS receipts (record_id TEXT PRIMARY KEY, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS immutable_bodies (record_key TEXT PRIMARY KEY, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS barriers (kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS visibility (kind TEXT NOT NULL,id TEXT NOT NULL,epoch TEXT NOT NULL,local_only INTEGER NOT NULL,
        deleted INTEGER NOT NULL, clock TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY,grant_id TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS revoked_grants (grant_id TEXT PRIMARY KEY);`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private sql<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }
  private account(): Account { return this.sql<Account>('SELECT * FROM account WHERE id=1')[0]; }
  private name(identity: SyncIdentity): string {
    if (this.env.SYNC_ENABLED !== 'true') fail('sync_unavailable', 503);
    if (!identity.subject || identity.subject.length > 200 || identity.expiresAt <= Date.now()) fail('invalid_token', 401);
    const name = JSON.stringify([identityConfiguration(this.env).issuer, identity.subject]);
    if (!this.ctx.id.equals(this.env.SYNC_ACCOUNTS.idFromName(name))) fail('account_mismatch', 403);
    if (this.account().deleted) fail('account_deleted', 410);
    if (this.sql('SELECT grant_id FROM revoked_grants WHERE grant_id=?', identity.grantId).length) fail('device_released', 403);
    return name;
  }
  private cursor(account = this.account()): z.infer<typeof SyncServerCursor> {
    if (!account.wrapped || account.deleted) fail('account_deleted', 410);
    return { generation: (JSON.parse(account.wrapped) as WrappedKey).generation, sequence: account.sequence, privacy: account.privacy };
  }
  private register(identity: SyncIdentity, deviceId: string) {
    this.name(identity);
    SyncDeviceId.parse(deviceId);
    const previous = this.sql<{ grant_id: string }>('SELECT grant_id FROM devices WHERE device_id=?', deviceId)[0];
    if (previous && previous.grant_id !== identity.grantId) fail('device_grant_mismatch', 403);
    const bound = this.sql<{ device_id: string }>('SELECT device_id FROM devices WHERE grant_id=?', identity.grantId)[0];
    if (bound && bound.device_id !== deviceId) fail('device_grant_mismatch', 403);
    if (!previous && this.sql<{ count: number }>('SELECT COUNT(*) AS count FROM devices')[0].count >= identity.limits.devices) fail('device_limit', 403);
    this.sql('INSERT INTO devices VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)', deviceId, identity.grantId, identity.expiresAt);
  }
  private fence(identity: SyncIdentity, deviceId: string, before: Account): boolean {
    this.name(identity);
    const current = this.account();
    const device = this.sql<{ grant_id: string }>('SELECT grant_id FROM devices WHERE device_id=?', deviceId)[0];
    if (!device || device.grant_id !== identity.grantId) fail('device_released', 403);
    return current.sequence === before.sequence && current.privacy === before.privacy && current.floor === before.floor && current.wrapped === before.wrapped;
  }
  private async key(identity: SyncIdentity, deviceId: string) {
    const name = this.name(identity);
    this.ctx.storage.transactionSync(() => this.register(identity, deviceId));
    const masters = await masterKeys(this.env.SYNC_MASTER_KEYS);
    this.name(identity);
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = this.account();
      const existing = previous.wrapped ? JSON.parse(previous.wrapped) as WrappedKey : undefined;
      const created = existing ? undefined : await createAccountKey(name, masters);
      const key = existing ? await unwrapAccountKey(name, existing, masters) : created!.key;
      const wrapped = existing && existing.version !== masters.active ? await rewrapAccountKey(name, existing, masters) : existing ?? created!.wrapped;
      const committed = this.ctx.storage.transactionSync(() => {
        if (!this.fence(identity, deviceId, previous)) return false;
        this.sql('UPDATE account SET wrapped=?,history_ms=? WHERE id=1', JSON.stringify(wrapped), Math.min(90, identity.limits.historyDays) * day);
        this.prune();
        return true;
      });
      if (committed) return { name, key, state: this.account(), generation: wrapped.generation };
    }
    return fail('retry_sync', 503);
  }
  private operational() {
    const bytes = Number(this.env.SYNC_MAX_ACCOUNT_BYTES);
    const records = Number(this.env.SYNC_MAX_RECORDS);
    if (!Number.isSafeInteger(bytes) || bytes < SYNC_RECORD_BYTES || bytes > 134_217_728 || !Number.isSafeInteger(records) || records < 1 || records > 100_000) fail('sync_unavailable', 503);
    return { bytes, records };
  }
  private usage(): number {
    // Count persisted ciphertext and permanent fence metadata, with conservative per-row/index overhead.
    let bytes = 0;
    for (const [table, expression] of [['records', 'length(cipher)+length(record_key)+length(scopes)+length(entities)'],
      ['changes', 'length(cipher)+length(record_key)+length(scopes)+length(entities)'], ['receipts', 'length(record_id)+length(digest)'],
      ['immutable_bodies', 'length(record_key)+length(digest)'], ['barriers', 'length(kind)+length(id)'],
      ['visibility', 'length(kind)+length(id)+length(epoch)+length(clock)'], ['devices', 'length(device_id)+length(grant_id)'],
      ['revoked_grants', 'length(grant_id)']] as const) {
      bytes += this.sql<{ bytes: number }>(`SELECT COALESCE(SUM(${expression}+256),0) AS bytes FROM ${table}`)[0].bytes;
    }
    return bytes;
  }
  private async open(rows: Stored[], key: CryptoKey, name: string, generation: string) {
    return Promise.all(rows.map(async row => SyncRecord.parse(JSON.parse(await decryptRow(key, JSON.parse(row.cipher) as Ciphertext,
      [name, generation, row.record_key, row.sequence])))));
  }
  private rows(): Stored[] {
    const limit = this.operational();
    if (this.usage() > limit.bytes || this.sql<{ count: number }>('SELECT COUNT(*) AS count FROM records')[0].count > limit.records) fail('capacity_exceeded', 507);
    return this.sql<Stored>('SELECT * FROM records ORDER BY record_key');
  }
  private barriers(records: readonly SyncRecord[]): DeletionEntity[] {
    // Query relevant permanent fences rather than materializing an unbounded lifetime tombstone table.
    const ids = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)) ids.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    for (const record of records) { ids.add(syncRecordKey(record.data)); visit(record); }
    return this.sql<DeletionEntity>('SELECT kind,id FROM barriers WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...ids]));
  }
  private prune() {
    const cutoff = Date.now() - this.account().history_ms;
    const last = this.sql<{ sequence: number | null }>('SELECT MAX(sequence) AS sequence FROM changes WHERE created_at<=?', cutoff)[0].sequence;
    if (last !== null) {
      this.sql('DELETE FROM changes WHERE created_at<=?', cutoff);
      this.sql('UPDATE account SET floor=MAX(floor,?) WHERE id=1', last);
    }
  }
  private async prepare(records: SyncRecord[]): Promise<Prepared[]> {
    const epochs = new Map<string, Promise<string>>();
    return Promise.all(records.map(async record => {
      const initial = new Map<string, string>();
      await Promise.all(record.scopes.map(async scope => {
        const id = rootKey(scope);
        if (!epochs.has(id)) epochs.set(id, crypto.subtle.digest('SHA-256', encoder.encode(syncScopeNamespace(scope)))
          .then(value => syncUuidFromDigest(new Uint8Array(value))));
        initial.set(id, await epochs.get(id)!);
      }));
      return { record, key: syncRecordKey(record.data), digest: await digest(canonicalSyncData(record)), bodyDigest: await digest(canonicalSyncData(record.data)), initial };
    }));
  }
  private scopeAllowed(item: Prepared, records: SyncRecord[], confirmed: SyncRecord[], barriers: DeletionEntity[]): boolean {
    if (barriers.some(barrier => barrier.kind === 'record' && barrier.id === item.key)) return false;
    try { assessScope(item.record, records, barriers, confirmed); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'permanently_deleted' || code === 'scope_withdrawn') return false;
      if (code === 'dependency_missing' || code === 'scope_missing') fail(code, 400);
      throw error;
    }
    if (item.record.data.kind === 'withdraw' || item.record.data.kind === 'delete') return true;
    return item.record.scopes.every(scope => {
      const policy = this.sql<{ epoch: string; local_only: number; deleted: number }>('SELECT epoch,local_only,deleted FROM visibility WHERE kind=? AND id=?', scope.kind, scope.id)[0];
      return policy ? !policy.deleted && !policy.local_only && policy.epoch === scope.epoch : scope.epoch === item.initial.get(rootKey(scope));
    });
  }
  private purge(kind: string, id: string, permanent: boolean) {
    for (const table of ['records', 'changes']) {
      const rows = this.sql<{ record_key: string }>(`SELECT record_key FROM ${table} WHERE EXISTS
        (SELECT 1 FROM json_each(scopes) WHERE json_extract(value,'$.kind')=? AND json_extract(value,'$.id')=?)
        OR EXISTS (SELECT 1 FROM json_each(entities) WHERE json_extract(value,'$.kind')=? AND json_extract(value,'$.id')=?)`, kind, id, kind, id);
      if (permanent) for (const row of rows) this.sql("INSERT OR IGNORE INTO barriers VALUES('record',?)", row.record_key);
      this.sql(`DELETE FROM ${table} WHERE EXISTS
        (SELECT 1 FROM json_each(scopes) WHERE json_extract(value,'$.kind')=? AND json_extract(value,'$.id')=?)
        OR EXISTS (SELECT 1 FROM json_each(entities) WHERE json_extract(value,'$.kind')=? AND json_extract(value,'$.id')=?)`, kind, id, kind, id);
    }
    this.sql('UPDATE account SET privacy=privacy+1 WHERE id=1');
  }
  async push(identity: SyncIdentity, raw: z.infer<typeof SyncPushRequest>) {
    this.name(identity);
    const checked = SyncPushRequest.safeParse(raw);
    if (!checked.success) fail('invalid_request', 400);
    const input = checked.data;
    if (byteLength(input) > SYNC_BATCH_BYTES || input.records.some(record => byteLength(record) > SYNC_RECORD_BYTES)) fail('payload_too_large', 413);
    const prepared = await this.prepare(input.records);
    for (let attempt = 0; attempt < 3; attempt++) {
      const session = await this.key(identity, input.deviceId);
      const rows = this.rows();
      const confirmed = await this.open(rows, session.key, session.name, session.generation);
      if (!this.fence(identity, input.deviceId, session.state)) continue;
      const candidate = [...confirmed, ...input.records];
      // Prepare every possible winning row before the atomic scope/quota revalidation and SQL commit.
      const encrypted = await Promise.all(prepared.map((item, index) => encryptRow(session.key, JSON.stringify(item.record),
        [session.name, session.generation, item.key, session.state.sequence + index + 1])));
      const result = this.ctx.storage.transactionSync(() => {
        if (!this.fence(identity, input.deviceId, session.state)) return undefined;
        this.prune();
        const beforeBytes = this.usage();
        const current = new Map(confirmed.map(record => [syncRecordKey(record.data), record]));
        const outcomes: { id: string; status: 'kept' | 'superseded' | 'blocked' }[] = [];
        let privacyOnly = true;
        const control = (record: SyncRecord) => record.data.kind === 'withdraw' || record.data.kind === 'delete'
          || record.data.kind === 'entityState' && Boolean(record.data.value?.deletedAt);
        if (prepared.some(item => control(item.record))) {
          // Channel/crew membership can change after a descendant was stored. Retain old tags
          // and add its current confirmed dependencies before erasing any private payload.
          for (const record of confirmed.filter(record => !control(record))) {
            const entities = JSON.stringify(deletionEntities(record.data, confirmed, record.scopes));
            for (const table of ['records', 'changes']) this.sql(`UPDATE ${table} SET entities=(SELECT json_group_array(json(value)) FROM
              (SELECT value FROM json_each(${table}.entities) UNION SELECT value FROM json_each(?))) WHERE record_key=?`,
              entities, syncRecordKey(record.data));
          }
        }
        const order = prepared.map((_, index) => index).sort((left, right) => Number(control(prepared[right].record)) - Number(control(prepared[left].record))
          || (control(prepared[left].record) ? compareSyncClock(prepared[left].record.clock, prepared[right].record.clock) : left - right));
        const statuses = new Map<string, 'kept' | 'superseded' | 'blocked'>();
        for (const index of order) {
          const item = prepared[index];
          const record = item.record;
          const receipt = this.sql<{ digest: string }>('SELECT digest FROM receipts WHERE record_id=?', record.id)[0];
          if (receipt && receipt.digest !== item.digest) fail('record_id_conflict');
          const frozen = this.sql<{ digest: string }>('SELECT digest FROM immutable_bodies WHERE record_key=?', item.key)[0];
          if (immutable(record.data.kind) && frozen && frozen.digest !== item.bodyDigest) fail('immutable_conflict');
          const barriers = this.barriers(candidate);
          if (!this.scopeAllowed(item, candidate, confirmed, barriers)) { outcomes.push({ id: record.id, status: 'blocked' }); continue; }
          const old = current.get(item.key);
          const permanent = record.data.kind === 'withdraw' && record.data.deleted && !(old?.data.kind === 'withdraw' && old.data.deleted);
          if (old && compareSyncClock(record.clock, old.clock) <= 0 && !permanent) {
            this.sql('INSERT OR IGNORE INTO receipts VALUES(?,?)', record.id, item.digest);
            outcomes.push({ id: record.id, status: 'superseded' });
            if (!control(record)) privacyOnly = false;
            continue;
          }
          if (record.data.kind === 'withdraw') {
            const data = record.data;
            const policy = this.sql<{ deleted: number }>('SELECT deleted FROM visibility WHERE kind=? AND id=?', data.root.kind, data.root.id)[0];
            if (policy?.deleted && !data.deleted) { outcomes.push({ id: record.id, status: 'blocked' }); continue; }
            this.sql('INSERT INTO visibility VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET epoch=excluded.epoch,local_only=excluded.local_only,deleted=excluded.deleted,clock=excluded.clock',
              data.root.kind, data.root.id, data.epoch, Number(data.localOnly), Number(data.deleted), JSON.stringify(record.clock));
            if (data.deleted) this.sql('INSERT OR IGNORE INTO barriers VALUES(?,?)', data.root.kind, data.root.id);
            this.purge(data.root.kind, data.root.id, data.deleted);
          } else if (record.data.kind === 'delete') {
            this.sql('INSERT OR IGNORE INTO barriers VALUES(?,?)', record.data.entity, record.data.id);
            this.purge(record.data.entity, record.data.id, true);
          } else if (record.data.kind === 'entityState' && record.data.value?.deletedAt) {
            this.sql('INSERT OR IGNORE INTO barriers VALUES(?,?)', record.data.entity, record.data.id);
            this.purge(record.data.entity, record.data.id, true);
          } else privacyOnly = false;
          const sequence = session.state.sequence + index + 1;
          const cipher = JSON.stringify(encrypted[index]);
          const scopes = JSON.stringify(record.scopes);
          const entities = JSON.stringify(record.data.kind === 'delete' || record.data.kind === 'withdraw'
            || record.data.kind === 'entityState' && record.data.value?.deletedAt ? [] : deletionEntities(record.data, candidate, record.scopes));
          this.sql('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(record_key) DO UPDATE SET sequence=excluded.sequence,cipher=excluded.cipher,scopes=excluded.scopes,entities=excluded.entities,created_at=excluded.created_at',
            item.key, sequence, cipher, scopes, entities, Date.now());
          this.sql('INSERT INTO changes VALUES(?,?,?,?,?,?)', sequence, item.key, cipher, scopes, entities, Date.now());
          this.sql('INSERT OR IGNORE INTO receipts VALUES(?,?)', record.id, item.digest);
          if (immutable(record.data.kind)) this.sql('INSERT OR IGNORE INTO immutable_bodies VALUES(?,?)', item.key, item.bodyDigest);
          this.sql('UPDATE account SET sequence=MAX(sequence,?) WHERE id=1', sequence);
          current.set(item.key, record);
          outcomes.push({ id: record.id, status: 'kept' });
        }
        // Candidate dependencies establish batch order, but a blocked/losing envelope cannot authorize stored data.
        const retainedKeys = new Set(this.sql<{ record_key: string }>('SELECT record_key FROM records').map(row => row.record_key));
        const retained = [...current].filter(([key]) => retainedKeys.has(key)).map(([, record]) => record);
        const finalBarriers = this.barriers(retained);
        for (const record of retained) {
          try { assessScope(record, retained, finalBarriers, retained); }
          catch (error) { fail(error instanceof Error && ['dependency_missing', 'scope_missing', 'scope_withdrawn', 'permanently_deleted'].includes(error.message)
            ? error.message : 'invalid_scope', 400); }
        }
        const afterBytes = this.usage();
        const bounds = this.operational();
        if (afterBytes > bounds.bytes || this.sql<{ count: number }>('SELECT COUNT(*) AS count FROM records')[0].count > bounds.records) fail('capacity_exceeded', 507);
        if (afterBytes > identity.limits.storageBytes && afterBytes > beforeBytes && !(privacyOnly && afterBytes <= beforeBytes + SYNC_BATCH_BYTES)) fail('storage_limit', 413);
        for (const outcome of outcomes) statuses.set(outcome.id, outcome.status);
        return { cursor: this.cursor(), outcomes: input.records.map(record => ({ id: record.id, status: statuses.get(record.id)! })) };
      });
      if (result) { this.hint(result.cursor); this.schedule(); return result; }
    }
    return fail('retry_sync', 503);
  }
  async pull(identity: SyncIdentity, raw: z.infer<typeof SyncPullRequest>) {
    const checked = SyncPullRequest.safeParse(raw);
    if (!checked.success) fail('invalid_request', 400);
    const input = checked.data;
    const session = await this.key(identity, input.deviceId);
    this.ctx.storage.transactionSync(() => this.prune());
    const state = this.account();
    const cursor = this.cursor(state);
    if (input.after.generation !== cursor.generation || input.after.privacy !== cursor.privacy || input.after.sequence < state.floor
      || input.after.sequence > cursor.sequence) fail('cursor_reset');
    const rows = this.sql<Stored>('SELECT * FROM changes WHERE sequence>? ORDER BY sequence LIMIT ?', input.after.sequence, input.limit + 1);
    const available = await this.open(rows.slice(0, input.limit), session.key, session.name, session.generation);
    const records = this.page(available);
    const page = rows.slice(0, records.length);
    const more = rows.length > records.length;
    if (!this.fence(identity, input.deviceId, state)) fail('cursor_reset');
    this.schedule();
    return { cursor: { ...cursor, sequence: more ? page[page.length - 1].sequence : cursor.sequence }, records, more };
  }
  async snapshot(identity: SyncIdentity, raw: z.infer<typeof SyncSnapshotRequest>) {
    const checked = SyncSnapshotRequest.safeParse(raw);
    if (!checked.success) fail('invalid_request', 400);
    const input = checked.data;
    const session = await this.key(identity, input.deviceId);
    const state = this.account();
    const cursor = this.cursor(state);
    let after = '';
    let expires = Date.now() + 300_000;
    if (input.cursor) {
      let decoded: unknown;
      try { decoded = JSON.parse(await decryptRow(session.key, JSON.parse(input.cursor) as Ciphertext, [session.name, session.generation, 'snapshot'])); }
      catch { return fail('cursor_reset'); }
      const token = z.object({ sequence: z.number().int(), privacy: z.number().int(), after: z.string(), expires: z.number().int(), device: z.string() }).strict().safeParse(decoded);
      if (!token.success || token.data.expires <= Date.now() || token.data.sequence !== state.sequence || token.data.privacy !== state.privacy
        || token.data.device !== input.deviceId) fail('cursor_reset');
      after = token.data.after;
      expires = token.data.expires;
    }
    if (!this.fence(identity, input.deviceId, state)) fail('cursor_reset');
    this.rows();
    const rows = this.sql<Stored>('SELECT * FROM records WHERE record_key>? ORDER BY record_key LIMIT ?', after, input.limit + 1);
    const records = this.page(await this.open(rows.slice(0, input.limit), session.key, session.name, session.generation));
    const page = rows.slice(0, records.length);
    const next = rows.length > records.length ? JSON.stringify(await encryptRow(session.key, JSON.stringify({ sequence: state.sequence,
      privacy: state.privacy, after: page[page.length - 1].record_key, expires, device: input.deviceId }), [session.name, session.generation, 'snapshot'])) : null;
    if (!this.fence(identity, input.deviceId, state)) fail('cursor_reset');
    this.schedule();
    return { cursor, records, next };
  }
  private page(records: SyncRecord[]): SyncRecord[] {
    let bytes = 4096;
    const page: SyncRecord[] = [];
    for (const record of records) {
      bytes += byteLength(record) + 1;
      if (bytes > SYNC_BATCH_BYTES) break;
      page.push(record);
    }
    return page;
  }
  async releaseDevice(identity: SyncIdentity, raw: z.infer<typeof SyncReleaseDeviceRequest>) {
    const checked = SyncReleaseDeviceRequest.safeParse(raw);
    if (!checked.success) fail('invalid_request', 400);
    this.ctx.storage.transactionSync(() => {
      // Releasing a slot must work for a newly verified grant even when every slot is occupied.
      this.name(identity);
      const row = this.sql<{ grant_id: string }>('SELECT grant_id FROM devices WHERE device_id=?', checked.data.targetDeviceId)[0];
      if (row) this.sql('INSERT OR IGNORE INTO revoked_grants VALUES(?)', row.grant_id);
      this.sql('DELETE FROM devices WHERE device_id=?', checked.data.targetDeviceId);
    });
    for (const socket of this.ctx.getWebSockets()) {
      const session = socket.deserializeAttachment() as Session;
      if (session.deviceId === checked.data.targetDeviceId) socket.close(1008, 'Device released');
    }
    this.schedule();
    return { released: true };
  }
  async fetch(request: UpgradeRequest): Promise<UpgradeResponse> {
    // This binding-only request is rebuilt by the authenticated Worker; external headers are never forwarded.
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== 'https://sync.internal' || url.pathname !== '/connect' || url.search || url.hash
      || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.has('Authorization')) fail('invalid_request', 400);
    const encoded = request.headers.get('x-orglet-identity');
    if (!encoded || encoded.length > 4096) fail('invalid_token', 401);
    let raw: unknown;
    try { raw = JSON.parse(encoded); } catch { return fail('invalid_token', 401); }
    const identity = InternalIdentity.safeParse(raw);
    if (!identity.success) fail('invalid_token', 401);
    const device = SyncDeviceId.safeParse(request.headers.get('x-orglet-device'));
    if (!device.success) fail('invalid_request', 400);
    return this.connectDevice(identity.data, device.data);
  }
  async connectDevice(identity: SyncIdentity, deviceId: string): Promise<UpgradeResponse> {
    const session = await this.key(identity, deviceId);
    if (!this.fence(identity, deviceId, session.state)) fail('retry_sync', 503);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ deviceId, grantId: identity.grantId, expiresAt: identity.expiresAt,
      generation: session.generation, subject: identity.subject } satisfies Session);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ kind: 'changes', cursor: this.cursor() }));
    this.schedule();
    // The Worker constructor supplies the upgrade extension; DOM types stay isolated from Electron's globals.
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: HibernatingSocket }) as unknown as UpgradeResponse;
  }
  private validSocket(socket: HibernatingSocket): boolean {
    const session = socket.deserializeAttachment() as Session | null;
    const state = this.account();
    if (!session || state.deleted || session.expiresAt <= Date.now() || !state.wrapped
      || session.generation !== (JSON.parse(state.wrapped) as WrappedKey).generation) return false;
    const device = this.sql<{ grant_id: string }>('SELECT grant_id FROM devices WHERE device_id=?', session.deviceId)[0];
    return device?.grant_id === session.grantId && !this.sql('SELECT grant_id FROM revoked_grants WHERE grant_id=?', session.grantId).length;
  }
  private hint(cursor: z.infer<typeof SyncServerCursor>) {
    for (const socket of this.ctx.getWebSockets()) {
      if (!this.validSocket(socket)) socket.close(1008, 'Session expired');
      else { try { socket.send(JSON.stringify({ kind: 'changes', cursor })); } catch { socket.close(1001, 'Reconnect'); } }
    }
  }
  webSocketMessage(socket: HibernatingSocket, _message: string | ArrayBuffer) {
    if (!this.validSocket(socket)) socket.close(1008, 'Session expired');
    else socket.close(1008, 'Hints only');
  }
  webSocketClose(socket: HibernatingSocket, _code: number, _reason: string, _wasClean: boolean) { socket.close(1000, 'Closed'); }
  webSocketError(socket: HibernatingSocket, _error: unknown) { socket.close(1001, 'Reconnect'); }
  private schedule() {
    const expiry = this.ctx.getWebSockets().filter(socket => this.validSocket(socket)).map(socket => (socket.deserializeAttachment() as Session).expiresAt);
    const oldest = this.sql<{ created_at: number | null }>('SELECT MIN(created_at) AS created_at FROM changes')[0].created_at;
    if (oldest !== null) expiry.push(oldest + this.account().history_ms + 1);
    if (expiry.length) this.ctx.waitUntil(this.ctx.storage.setAlarm(Math.max(Date.now() + 1, expiry.reduce((first, next) => Math.min(first, next), Infinity))));
    else this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
  }
  async alarm() {
    this.ctx.storage.transactionSync(() => this.prune());
    for (const socket of this.ctx.getWebSockets()) if (!this.validSocket(socket)) socket.close(1008, 'Session expired');
    this.schedule();
  }
  async erase(identity: SyncIdentity): Promise<void> {
    // Preserve the deletion marker: an unexpired Accounts token must never recreate this key.
    this.name(identity);
    this.ctx.storage.transactionSync(() => {
      for (const table of ['records', 'changes', 'receipts', 'immutable_bodies', 'barriers', 'visibility', 'devices', 'revoked_grants']) this.sql(`DELETE FROM ${table}`);
      this.sql('UPDATE account SET deleted=1,wrapped=NULL,sequence=sequence+1,privacy=privacy+1 WHERE id=1');
    });
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'Account deleted');
    this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
  }
}
