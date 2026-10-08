import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { SyncRecordingContext } from '../shared/sync';
import { SyncFileStored, SyncHint, SyncPushResult, SyncServerCursor, SYNC_BATCH_BYTES, SYNC_FILE_BYTES } from '../shared/sync-protocol';
import { SyncReplicaBatch, SyncReplicaCounts, SyncReplicaFiles, SyncReplicaState, type SyncReplicaAction } from '../shared/sync-replica';
import { SyncPreview, SyncStatus, type SyncChoice, type SyncPauseReason } from '../shared/sync-status';

/**
 * Account sync on the network (COD-329 phase 3). Main owns the access token, every request and the hint socket; the
 * core owns SQLite and is asked through `SyncReplicaAction`. Nothing here imports Electron, so the tests drive it
 * against a local sync Worker.
 *
 * One cycle runs at a time: download the account when there is no cursor, pull when the server hinted or the
 * connection was lost, then send the outbox in batches. A reply is used only while the account that started the
 * cycle is still the one signed in, checked before each request and again before the core applies anything.
 */

/** Local changes are sent this long after the first one, so a burst of edits is one request. */
export const PUSH_DEBOUNCE_MS = 5_000;
/** While changes keep coming, they are sent at most this often. */
export const PUSH_INTERVAL_MS = 60_000;
const RETRY_FIRST_MS = 5_000;
const RETRY_LAST_MS = 5 * 60_000;
/** A refused upload (the account is full, a record the server will not take) is tried again after this long. */
const PUSH_HOLD_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
/** The server closes a socket when its token ends (15 minutes); this replaces one that died without a close. */
const SOCKET_LIFETIME_MS = 16 * 60_000;
const RESPONSE_CHARACTERS = SYNC_BATCH_BYTES + 1_048_576;
const SNAPSHOT_ATTEMPTS = 3;

export type SyncSocket = { close(): void };
export type SyncSocketHandlers = { message(text: string): void; close(): void };
export type SyncConnect = (url: string, headers: Record<string, string>, handlers: SyncSocketHandlers) => SyncSocket;

export type SyncTransportDependencies = {
  /** The sync server's origin, or nothing when this build does not sync. */
  baseUrl: string | undefined;
  account: {
    syncContext(): SyncRecordingContext | undefined;
    getAccessToken(): Promise<string>;
  };
  core: (action: SyncReplicaAction) => Promise<unknown>;
  /** Saves a copy of the database, then erases this computer's workspace. Rejects, erasing nothing, when it cannot. */
  replaceLocal?: () => Promise<unknown>;
  /**
   * A signed-in computer joins without being asked, merging what it holds with the account (owner, 2026-10-04). The
   * one that still waits is a computer erased on purpose, so Erase all data is not undone by the next sync; Sync
   * there joins it again. Without this, any computer that holds data waits for `start`.
   */
  joinsOnItsOwn?: boolean;
  fetch?: typeof fetch;
  connect?: SyncConnect;
  /** Reads a file Orglet saved under its own data folder; the tests pass a reader of their own. */
  readFile?: (path: string) => Promise<Uint8Array>;
  now?: () => number;
  onChange?: (status: SyncStatus) => void;
};

/** The server answered with a refusal it names. */
class SyncRefused extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}
/** The core refused or failed; the message is its own. */
class ReplicaFailed extends Error {}
/** The account changed while a request was out; its reply is dropped. */
class Stale extends Error {}

const CONTEXT_CHANGED = 'Phiên đồng bộ đã đổi.';
export const SYNC_NOT_ON = 'Đồng bộ đang tắt trên máy này.';
export const NOTHING_TO_CHOOSE = 'Máy này không còn gì phải chọn cho đồng bộ.';
export const PREVIEW_FAILED = 'Không đọc được tài khoản. Kiểm tra kết nối rồi thử lại.';
export const PREVIEW_SIGN_IN = 'Máy chủ đồng bộ không nhận phiên đăng nhập này. Đăng xuất rồi đăng nhập lại.';
export const PREVIEW_SERVER = 'Máy chủ đồng bộ đang gặp lỗi. Thử lại sau.';
export const PREVIEW_BUSY = 'Tài khoản vừa gửi quá nhiều yêu cầu. Chờ vài phút rồi thử lại.';
export const PREVIEW_DEVICES = 'Tài khoản đã đủ số máy được đồng bộ.';
export const PREVIEW_DELETED = 'Tài khoản này đã bị xóa trên máy chủ. Dữ liệu trên máy này vẫn còn.';

/** Why the account could not be read, in the person's words; a lost connection is the only case left unnamed. */
function previewFailure(error: unknown): string {
  if (!(error instanceof SyncRefused)) return PREVIEW_FAILED;
  if (error.code === 'device_limit') return PREVIEW_DEVICES;
  if (error.code === 'account_deleted' || error.code === 'account_mismatch') return PREVIEW_DELETED;
  if (error.code === 'rate_limited') return PREVIEW_BUSY;
  if (error.status === 401 || error.status === 403) return PREVIEW_SIGN_IN;
  return PREVIEW_SERVER;
}
export const FILE_NOT_SYNCED = 'Tệp này chưa được đồng bộ; nó chỉ có trên máy đã đính kèm.';
export const FILE_DOWNLOAD_FAILED = 'Không tải được tệp. Kiểm tra kết nối rồi thử lại.';
/** Refusals of one file that sending it again cannot change. */
const FILE_SETTLED = new Set(['file_unknown', 'file_mismatch', 'file_too_large']);
const Refusal = z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) });
// Pages are read loosely: a record from a newer Orglet is staged by the core, not refused here.
const PullPage = z.object({ cursor: SyncServerCursor, records: z.array(z.unknown()).max(100), more: z.boolean() });
const SnapshotPage = z.object({ cursor: SyncServerCursor, records: z.array(z.unknown()).max(100), next: z.string().max(4096).nullable() });

/** Refusals that stop sync until the person does something about them. */
const STOPPED: Record<string, SyncPauseReason> = {
  device_limit: 'device_limit',
  device_released: 'device_released',
  device_grant_mismatch: 'device_released',
  account_deleted: 'account_deleted',
  account_mismatch: 'account_deleted',
};
/** Refusals that mean the service cannot serve anyone right now; retrying soon would not help. */
const SERVER_UNAVAILABLE = new Set(['sync_disabled', 'key_configuration', 'account_key_unreadable']);
/** Refusals of one upload; downloading goes on. */
const UPLOAD_REFUSED: Record<string, SyncPauseReason> = {
  storage_limit: 'storage_limit',
  capacity_exceeded: 'storage_limit',
  dependency_missing: 'rejected',
  scope_missing: 'rejected',
  invalid_scope: 'rejected',
  invalid_batch: 'rejected',
  invalid_request: 'rejected',
  record_id_conflict: 'rejected',
  immutable_conflict: 'rejected',
  payload_too_large: 'rejected',
  batch_too_large: 'rejected',
};

type Session = {
  context: SyncRecordingContext;
  controller: AbortController;
  deviceId: string;
  cursor: SyncServerCursor | null;
  /** Signed in, but the person has not said this computer's data may join the account. */
  waitingForConsent: boolean;
  /** The server or the core refused in a way a retry cannot fix; only the person's "try again" resumes. */
  stopped: boolean;
  /** Whether this session already took its device slot back from an earlier sign-in. */
  reclaimed: boolean;
  wantPull: boolean;
  socket?: SyncSocket;
  socketTimer?: ReturnType<typeof setTimeout>;
  uploadRefused?: SyncPauseReason;
  uploadHeldUntil: number;
  skipped: number;
};

/**
 * What the core needs before what, when a whole account arrives at once: a skill before the orglet that uses it, a
 * file before the turn that attached it, a chat before its turns. Later pages still apply in any order; this only
 * keeps records from waiting in the inbox while the rest downloads.
 */
function receiveRank(raw: unknown): number {
  const data = (raw as { data?: { kind?: unknown; revision?: { entity?: unknown } } } | null)?.data;
  const kind = typeof data?.kind === 'string' ? data.kind : '';
  if (kind === 'withdraw' || kind === 'delete') return 0;
  if (kind === 'revision') return ({ skill: 1, worker: 2, team: 3 } as Record<string, number>)[String(data?.revision?.entity)] ?? 9;
  return ({ entityState: 4, source: 5, chat: 6, turn: 7, run: 10, artifact: 11, event: 11 } as Record<string, number>)[kind] ?? 8;
}
function createdAt(raw: unknown): string {
  const value = (raw as { data?: { value?: { createdAt?: unknown } } } | null)?.data?.value?.createdAt;
  return typeof value === 'string' ? value : '';
}
function isOrglet(raw: unknown): boolean {
  const data = (raw as { data?: { kind?: unknown; revision?: { entity?: unknown } } } | null)?.data;
  return data?.kind === 'revision' && data.revision?.entity === 'worker';
}
function orgletId(raw: unknown): string {
  return String((raw as { data?: { revision?: { value?: { id?: unknown } } } } | null)?.data?.revision?.value?.id);
}
function kindOf(raw: unknown): string {
  const kind = (raw as { data?: { kind?: unknown } } | null)?.data?.kind;
  return typeof kind === 'string' ? kind : '';
}

/** Pages the core accepts: at most 100 records and under the batch size. */
function pages(records: unknown[]): unknown[][] {
  const result: unknown[][] = [];
  let page: unknown[] = [];
  let bytes = 0;
  for (const record of records) {
    const size = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
    if (page.length === 100 || (page.length && bytes + size > SYNC_BATCH_BYTES - 65_536)) {
      result.push(page);
      page = [];
      bytes = 0;
    }
    page.push(record);
    bytes += size;
  }
  if (page.length) result.push(page);
  return result;
}

/** Node's WebSocket takes request headers in its options, which the browser one does not. */
export const openSyncSocket: SyncConnect = (url, headers, handlers) => {
  const socket = new WebSocket(url, { headers } as unknown as string[]);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    handlers.close();
  };
  socket.addEventListener('message', event => {
    if (typeof event.data === 'string') handlers.message(event.data);
  });
  socket.addEventListener('close', close);
  socket.addEventListener('error', () => {
    try {
      socket.close();
    } catch {
      // Already closing.
    }
    close();
  });
  return { close: () => socket.close(1000) };
};

export class SyncTransport {
  private session: Session | undefined;
  private status: SyncStatus = { state: 'off' };
  private refreshTail: Promise<void> = Promise.resolve();
  private running: Promise<void> | undefined;
  private again = false;
  private failures = 0;
  private lastPushAt = 0;
  private lastSyncedAt: string | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private fetch: typeof fetch;
  private connect: SyncConnect;
  private readFile: (path: string) => Promise<Uint8Array>;
  private now: () => number;

  constructor(private dependencies: SyncTransportDependencies) {
    this.fetch = dependencies.fetch ?? fetch;
    this.connect = dependencies.connect ?? openSyncSocket;
    this.readFile = dependencies.readFile ?? (path => readFile(path));
    this.now = dependencies.now ?? Date.now;
  }

  state(): SyncStatus {
    return SyncStatus.parse(this.status);
  }

  /** The app started, or the account changed: leave the old account and attach the one signed in now. */
  refresh(): Promise<void> {
    this.refreshTail = this.refreshTail.then(() => this.attach()).catch(() => undefined);
    return this.refreshTail;
  }

  /** The core saved something. Sends are grouped and spaced; this never pulls. */
  localChanged() {
    const session = this.session;
    if (!session || session.waitingForConsent || session.stopped || this.pushTimer) return;
    const delay = Math.max(PUSH_DEBOUNCE_MS, this.lastPushAt + PUSH_INTERVAL_MS - this.now());
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      this.trigger();
    }, delay);
  }

  /** The window came to the front. With a live socket the server's hints already cover this. */
  windowFocused() {
    const session = this.session;
    if (!session || session.waitingForConsent || session.stopped || session.socket) return;
    this.failures = 0;
    session.wantPull = true;
    this.trigger();
  }

  /**
   * Before a computer that holds data joins: how many orglets and chats are here and in the account. Reads the
   * account without changing it and sends nothing from this computer.
   */
  async preview(): Promise<SyncPreview> {
    await this.refresh();
    const session = this.session;
    if (!session || !session.waitingForConsent) throw new Error(NOTHING_TO_CHOOSE);
    try {
      const { records } = await this.snapshot(session);
      const local = SyncReplicaCounts.parse(await this.core({ action: 'counts' }, session));
      const orglets = new Set(records.filter(isOrglet).map(orgletId));
      const chats = records.filter(record => kindOf(record) === 'chat').length;
      return SyncPreview.parse({ local: { orglets: local.orglets, chats: local.chats }, account: { orglets: orglets.size, chats }, localOnly: local.localOnly });
    } catch (error) {
      if (error instanceof ReplicaFailed) throw new Error(error.message);
      throw new Error(previewFailure(error));
    }
  }

  /**
   * The person asked: let this computer join the account, or try again now. `replace` first erases this computer's
   * workspace (a copy is saved beside the database); if that fails, nothing changes and sync stays off.
   */
  async start(choice: SyncChoice = 'merge'): Promise<SyncStatus> {
    await this.refresh();
    const session = this.session;
    if (session?.waitingForConsent && choice === 'replace') {
      if (!this.dependencies.replaceLocal) throw new Error(NOTHING_TO_CHOOSE);
      await this.dependencies.replaceLocal();
      if (!this.alive(session)) return this.state();
    }
    if (session) {
      session.waitingForConsent = false;
      session.stopped = false;
      session.wantPull = true;
      session.uploadHeldUntil = 0;
      this.failures = 0;
      this.trigger();
    }
    return this.state();
  }

  /** Quitting: stop the socket and timers. The outbox stays for the next start. */
  async stop() {
    this.refreshTail = this.refreshTail.then(() => this.leave()).catch(() => undefined);
    await this.refreshTail;
  }

  private async attach() {
    const context = this.dependencies.baseUrl ? this.dependencies.account.syncContext() : undefined;
    const current = this.session;
    if (current && context && current.context.accountKey === context.accountKey && current.context.generation === context.generation) return;
    await this.leave();
    if (!context) return;
    const session: Session = {
      context, controller: new AbortController(), deviceId: '', cursor: null, waitingForConsent: false, stopped: false, reclaimed: false, wantPull: true,
      uploadHeldUntil: 0, skipped: 0,
    };
    this.session = session;
    let state: SyncReplicaState;
    try {
      state = SyncReplicaState.parse(await this.core({ action: 'attach', context }));
    } catch {
      if (this.session === session) this.session = undefined;
      return;
    }
    if (!this.alive(session)) return;
    session.deviceId = state.deviceId;
    session.cursor = state.cursor;
    const waits = this.dependencies.joinsOnItsOwn ? state.held : state.ownData;
    if (!state.linked && waits) {
      session.waitingForConsent = true;
      this.set({ state: 'link_required' });
      return;
    }
    this.trigger();
  }

  private async leave() {
    const session = this.session;
    this.session = undefined;
    for (const timer of [this.retryTimer, this.pushTimer]) clearTimeout(timer);
    this.retryTimer = undefined;
    this.pushTimer = undefined;
    this.failures = 0;
    this.lastSyncedAt = undefined;
    if (session) {
      session.controller.abort();
      this.closeSocket(session);
      await this.core({ action: 'detach' }).catch(() => undefined);
    }
    this.set({ state: 'off' });
  }

  private alive(session: Session): boolean {
    if (this.session !== session || session.controller.signal.aborted) return false;
    const context = this.dependencies.account.syncContext();
    return context?.accountKey === session.context.accountKey && context.generation === session.context.generation;
  }

  private set(status: SyncStatus) {
    const next = SyncStatus.parse({
      ...status,
      ...(this.lastSyncedAt && status.state !== 'off' ? { lastSyncedAt: this.lastSyncedAt } : {}),
      ...(this.session?.skipped ? { skipped: this.session.skipped } : {}),
    });
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    try {
      this.dependencies.onChange?.(next);
    } catch {
      console.warn('Không gửi được cập nhật trạng thái đồng bộ.');
    }
  }

  private trigger() {
    const session = this.session;
    if (!session || session.waitingForConsent || session.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.cycle(session).finally(() => {
      this.running = undefined;
      if (!this.again) return;
      this.again = false;
      this.trigger();
    });
  }

  /** Resolves once no cycle is running or queued; quitting and the tests wait on it. */
  async settled() {
    await this.refreshTail;
    while (this.running) await this.running;
  }

  private async cycle(session: Session) {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    try {
      try {
        await this.exchange(session);
      } catch (error) {
        if (!(error instanceof SyncRefused) || error.code !== 'device_grant_mismatch' || session.reclaimed) throw error;
        // Signing in again gives this computer a new grant while the server still ties it to the old one.
        // Releasing its own slot retires the old grant, and the next request registers the new one.
        session.reclaimed = true;
        await this.post(session, '/v1/devices/release', { deviceId: session.deviceId, targetDeviceId: session.deviceId });
        await this.exchange(session);
      }
      if (!this.alive(session)) return;
      this.failures = 0;
      this.lastSyncedAt = new Date(this.now()).toISOString();
      this.set(session.uploadRefused ? { state: 'paused', reason: session.uploadRefused } : { state: 'synced' });
      await this.listen(session);
    } catch (error) {
      if (error instanceof Stale || !this.alive(session)) return;
      this.failed(session, error);
    }
  }

  private async exchange(session: Session) {
    if (!session.cursor) await this.download(session);
    else if (session.wantPull) await this.pull(session);
    await this.push(session);
    await this.sendFiles(session);
  }

  /**
   * The person opened a file that lives on another computer. Its bytes are fetched once, checked by the core against
   * the file's own record, and kept as a copy here. Rejects with a Vietnamese reason.
   */
  async downloadFile(taskId: string, sourceId: string): Promise<void> {
    const session = this.session;
    if (!session || session.waitingForConsent || session.stopped || !session.cursor) throw new Error(SYNC_NOT_ON);
    try {
      await this.core({ action: 'fileWanted', context: session.context, taskId, sourceId }, session);
      const response = await this.call(session, 'GET', `/v1/files/${sourceId}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > SYNC_FILE_BYTES) throw new Error(FILE_DOWNLOAD_FAILED);
      await this.core({ action: 'fileReceived', context: session.context, taskId, sourceId, base64: bytes.toString('base64') }, session);
    } catch (error) {
      if (error instanceof ReplicaFailed) throw new Error(error.message);
      if (error instanceof SyncRefused && (error.code === 'file_unknown' || error.code === 'file_damaged')) throw new Error(FILE_NOT_SYNCED);
      throw new Error(FILE_DOWNLOAD_FAILED);
    }
  }

  /** Bytes of saved versions go after their records, one file per request, each checked against its record first. */
  private async sendFiles(session: Session) {
    if (session.uploadRefused) return;
    for (;;) {
      const batch = SyncReplicaFiles.parse(await this.core({ action: 'files', context: session.context }, session));
      if (!batch.uploads.length) return;
      for (const file of batch.uploads) {
        const bytes = await this.readFile(file.path).catch(() => undefined);
        let stored = false;
        if (bytes && bytes.length === file.bytes && createHash('sha256').update(bytes).digest('hex') === file.hash) {
          try {
            SyncFileStored.parse(await (await this.call(session, 'PUT', `/v1/files/${file.sourceId}`, bytes)).json());
            stored = true;
          } catch (error) {
            if (error instanceof SyncRefused && error.code === 'file_storage_limit') {
              session.uploadRefused = 'storage_limit';
              session.uploadHeldUntil = this.now() + PUSH_HOLD_MS;
              return;
            }
            if (!(error instanceof SyncRefused) || !FILE_SETTLED.has(error.code)) throw error;
          }
        }
        await this.core({ action: 'fileSent', context: session.context, sourceId: file.sourceId, stored }, session);
      }
    }
  }

  private failed(session: Session, error: unknown) {
    if (error instanceof ReplicaFailed) {
      // Erasing the workspace resets the core's side; attach again from where it now stands.
      if (error.message === CONTEXT_CHANGED) {
        this.session = undefined;
        session.controller.abort();
        this.closeSocket(session);
        void this.refresh();
        return;
      }
      this.halt(session, 'rejected');
      return;
    }
    if (error instanceof SyncRefused) {
      if (error.code === 'cursor_reset' && this.failures < SNAPSHOT_ATTEMPTS) {
        this.failures += 1;
        session.cursor = null;
        this.again = true;
        return;
      }
      const stopped = STOPPED[error.code];
      if (stopped) {
        this.halt(session, stopped);
        return;
      }
      // The service is up but cannot serve this account now (switched off, or its keys are misconfigured): wait longer.
      if (SERVER_UNAVAILABLE.has(error.code)) {
        this.set({ state: 'paused', reason: 'server_unavailable' });
        this.retry(session, RETRY_LAST_MS);
        return;
      }
    }
    this.set({ state: 'offline' });
    this.retry(session, Math.min(RETRY_FIRST_MS * 2 ** this.failures, RETRY_LAST_MS));
    this.failures += 1;
  }

  private halt(session: Session, reason: SyncPauseReason) {
    session.stopped = true;
    this.closeSocket(session);
    this.set({ state: 'paused', reason });
  }

  private retry(session: Session, delay: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.session !== session) return;
      session.wantPull = true;
      this.trigger();
    }, delay);
  }

  /** Every page of the account as it stands at one cursor. */
  private async snapshot(session: Session): Promise<{ records: unknown[]; cursor: SyncServerCursor }> {
    const records: unknown[] = [];
    let cursor!: SyncServerCursor;
    let token: string | undefined;
    do {
      const page = await this.post(session, '/v1/snapshot', { deviceId: session.deviceId, limit: 100, ...(token ? { cursor: token } : {}) }, SnapshotPage);
      records.push(...page.records);
      cursor = page.cursor;
      token = page.next ?? undefined;
    } while (token);
    return { records, cursor };
  }

  /** The whole account, staged here until its last page arrived, then handed to the core in dependency order. */
  private async download(session: Session) {
    this.set({ state: 'syncing' });
    const { records, cursor } = await this.snapshot(session);
    const ranked = records.map((record, index) => ({ record, index, rank: receiveRank(record), createdAt: createdAt(record) }))
      .sort((first, second) => first.rank - second.rank || first.createdAt.localeCompare(second.createdAt) || first.index - second.index)
      .map(item => item.record);
    await this.core({ action: 'begin', context: session.context, discardSeed: records.some(isOrglet) }, session);
    for (const page of pages(ranked)) await this.core({ action: 'receive', context: session.context, records: page }, session);
    await this.core({ action: 'settle', context: session.context, cursor }, session);
    session.cursor = cursor;
    session.wantPull = false;
  }

  private async pull(session: Session) {
    for (;;) {
      const page = await this.post(session, '/v1/pull', { deviceId: session.deviceId, after: session.cursor, limit: 100 }, PullPage);
      if (page.records.length) this.set({ state: 'syncing' });
      await this.core({ action: 'receive', context: session.context, records: page.records, cursor: page.cursor }, session);
      session.cursor = page.cursor;
      if (!page.more) break;
    }
    session.wantPull = false;
  }

  private async push(session: Session) {
    if (session.uploadRefused && this.now() < session.uploadHeldUntil) return;
    for (;;) {
      const batch = SyncReplicaBatch.parse(await this.core({ action: 'outbox', context: session.context }, session));
      session.skipped = batch.skipped;
      if (batch.updateRequired) {
        session.uploadRefused = 'update_required';
        session.uploadHeldUntil = 0;
        return;
      }
      if (!batch.records.length) {
        session.uploadRefused = undefined;
        return;
      }
      this.set({ state: 'syncing' });
      let result: z.infer<typeof SyncPushResult>;
      try {
        result = await this.post(session, '/v1/push', { deviceId: session.deviceId, records: batch.records }, SyncPushResult);
      } catch (error) {
        const refused = error instanceof SyncRefused ? UPLOAD_REFUSED[error.code] : undefined;
        if (!refused) throw error;
        session.uploadRefused = refused;
        session.uploadHeldUntil = this.now() + PUSH_HOLD_MS;
        return;
      }
      await this.core({ action: 'acknowledge', context: session.context, outcomes: result.outcomes }, session);
      this.lastPushAt = this.now();
    }
  }

  /** The hint socket: the server says its cursor moved, and a pull fetches the changes. */
  private async listen(session: Session) {
    if (session.socket) return;
    const token = await this.dependencies.account.getAccessToken();
    if (!this.alive(session) || session.socket) return;
    const address = new URL('/v1/connect', this.dependencies.baseUrl);
    address.protocol = address.protocol === 'http:' ? 'ws:' : 'wss:';
    const socket: SyncSocket = this.connect(address.toString(), { Authorization: `Bearer ${token}`, 'X-Orglet-Device': session.deviceId }, {
      message: text => {
        if (session.socket !== socket) return;
        let hint: z.infer<typeof SyncHint>;
        try {
          hint = SyncHint.parse(JSON.parse(text));
        } catch {
          return;
        }
        const cursor = session.cursor;
        if (cursor && hint.cursor.generation === cursor.generation && hint.cursor.privacy === cursor.privacy && hint.cursor.sequence <= cursor.sequence) return;
        session.wantPull = true;
        this.trigger();
      },
      close: () => {
        if (session.socket !== socket) return;
        this.closeSocket(session);
        if (this.session === session && !session.stopped) this.retry(session, RETRY_FIRST_MS);
      },
    });
    session.socket = socket;
    session.socketTimer = setTimeout(() => {
      if (session.socket !== socket) return;
      this.closeSocket(session);
      if (this.session === session) this.retry(session, 0);
    }, SOCKET_LIFETIME_MS);
  }

  private closeSocket(session: Session) {
    const socket = session.socket;
    session.socket = undefined;
    clearTimeout(session.socketTimer);
    session.socketTimer = undefined;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }

  private async core(action: SyncReplicaAction, session?: Session): Promise<unknown> {
    // Identity is checked again right before SQLite changes; the core checks the same context itself.
    if (session && !this.alive(session)) throw new Stale();
    try {
      return await this.dependencies.core(action);
    } catch (error) {
      throw new ReplicaFailed(error instanceof Error ? error.message : '');
    }
  }

  private async post<Result = void>(session: Session, path: string, body: unknown, schema?: z.ZodType<Result>): Promise<Result> {
    const text = await (await this.call(session, 'POST', path, JSON.stringify(body))).text();
    if (!this.alive(session)) throw new Stale();
    if (text.length > RESPONSE_CHARACTERS) throw new Error('Phản hồi đồng bộ quá lớn.');
    return schema ? schema.parse(JSON.parse(text)) : undefined as Result;
  }

  /** One authenticated request. A string body is JSON, bytes are a file; a refusal is thrown with the server's code. */
  private async call(session: Session, method: 'POST' | 'PUT' | 'GET', path: string, body?: string | Uint8Array): Promise<Response> {
    const token = await this.dependencies.account.getAccessToken();
    if (!this.alive(session)) throw new Stale();
    const response = await this.fetch(new URL(path, this.dependencies.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Orglet-Device': session.deviceId,
        ...(body === undefined ? {} : { 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/octet-stream' }),
      },
      ...(body === undefined ? {} : { body: body as BodyInit }),
      redirect: 'error',
      signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!this.alive(session)) throw new Stale();
    if (!response.ok) {
      let code = 'sync_unavailable';
      try {
        code = Refusal.parse(JSON.parse(await response.text())).code;
      } catch {
        // A proxy or an outage answered, not the sync service.
      }
      throw new SyncRefused(code, response.status);
    }
    return response;
  }
}
