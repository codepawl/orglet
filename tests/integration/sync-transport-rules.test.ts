import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { SyncReplica } from '../../apps/desktop/src/core/storage/sync-replica';
import { untouchedSeed } from '../../apps/desktop/src/core/storage/factory-seed';
import { openSyncSocket, PUSH_DEBOUNCE_MS, PUSH_INTERVAL_MS, SyncTransport } from '../../apps/desktop/src/main/sync-transport';
import { syncBaseUrl, SyncStatus } from '../../apps/desktop/src/shared/sync-status';
import { SYNC_RECORD_BYTES } from '../../apps/desktop/src/shared/sync-protocol';
import type { SyncReplicaBatch, SyncReplicaState } from '../../apps/desktop/src/shared/sync-replica';
import type { Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * The transport's own rules against a scripted server (GH-482): pacing, refusals and what the window may learn. The
 * real merge behaviour is in sync-transport.test.ts, which runs the actual account object.
 */

const context = { accountKey: 'a'.repeat(64), generation: 1 };
const cursor = (sequence: number) => ({ generation: '11111111-1111-4111-8111-111111111111', sequence, privacy: 0 });
const stores: Store[] = [];
const transports: SyncTransport[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const transport of transports.splice(0)) await transport.stop();
  for (const store of stores.splice(0)) store.db.close();
});

type Answer = { status: number; body: unknown } | 'network';
function setup(answer: (path: string, body: { records?: { id: string }[] }) => Answer) {
  const store = new Store(':memory:');
  stores.push(store);
  const replica = new SyncReplica(store, () => undefined);
  const requests: string[] = [];
  const statuses: SyncStatus[] = [];
  const transport = new SyncTransport({
    baseUrl: 'https://sync.test',
    account: { syncContext: () => context, getAccessToken: async () => 'secret-access-token' },
    core: async action => replica.execute(JSON.parse(JSON.stringify(action))),
    connect: () => ({ close: () => undefined }),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      const reply = answer(path, JSON.parse(String(init?.body)));
      if (reply === 'network') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
    onChange: status => statuses.push(status),
  });
  transports.push(transport);
  return { store, replica, transport, requests, statuses };
}
/** An empty account that keeps whatever is pushed. */
function accepting(path: string, body: { records?: { id: string }[] }): Answer {
  if (path === '/v1/snapshot') return { status: 200, body: { cursor: cursor(0), records: [], next: null } };
  if (path === '/v1/pull') return { status: 200, body: { cursor: cursor(0), records: [], more: false } };
  return { status: 200, body: { cursor: cursor(1), outcomes: body.records!.map(record => ({ id: record.id, status: 'kept' })) } };
}
function chat(store: Store): Task {
  const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief: 'Message', sourceIds: [], status: 'completed',
    createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return task;
}

it('syncs with CodePawl by default, never with another accounts service, and accepts only https or this computer', () => {
  expect(syncBaseUrl(undefined)).toBe('https://sync.orglet.codepawl.com');
  expect(syncBaseUrl(undefined, 'http://localhost:8787')).toBeUndefined();
  expect(syncBaseUrl('off')).toBeUndefined();
  expect(syncBaseUrl('http://localhost:8788', 'http://localhost:8787')).toBe('http://localhost:8788');
  expect(syncBaseUrl('http://example.com')).toBeUndefined();
  expect(syncBaseUrl('not an address')).toBeUndefined();
  expect(syncBaseUrl('https://sync.example.com/path?query=1')).toBe('https://sync.example.com');
  expect(syncBaseUrl('http://localhost:8787')).toBe('http://localhost:8787');
});

it('stays off and asks the core nothing when no server is configured', async () => {
  const core = vi.fn(async () => null);
  const transport = new SyncTransport({ baseUrl: undefined, account: { syncContext: () => context, getAccessToken: async () => 'token' }, core });
  await transport.refresh();
  transport.localChanged();
  expect(await transport.start()).toEqual({ state: 'off' });
  expect(core).not.toHaveBeenCalled();
});

it('groups a burst of local changes into one send and spaces the next one a minute later', async () => {
  vi.useFakeTimers();
  const { store, transport, requests } = setup(accepting);
  await transport.refresh();
  await transport.settled();
  // Joining sent the Researcher; a quiet minute later the next change counts as the first of a new burst.
  await vi.advanceTimersByTimeAsync(PUSH_INTERVAL_MS);
  const afterJoining = requests.length;
  for (let index = 0; index < 5; index++) {
    chat(store);
    transport.localChanged();
  }
  await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 1);
  expect(requests.length).toBe(afterJoining);
  await vi.advanceTimersByTimeAsync(1);
  await transport.settled();
  // One send, and no pull: the server's hint is what asks for a pull.
  expect(requests.slice(afterJoining)).toEqual(['/v1/push']);

  chat(store);
  transport.localChanged();
  await vi.advanceTimersByTimeAsync(PUSH_INTERVAL_MS - 1_000);
  expect(requests.slice(afterJoining)).toEqual(['/v1/push']);
  await vi.advanceTimersByTimeAsync(1_000);
  await transport.settled();
  expect(requests.slice(afterJoining)).toEqual(['/v1/push', '/v1/push']);
});

it('retries a lost connection with a growing wait and never shows the token', async () => {
  vi.useFakeTimers();
  let online = false;
  const { transport, requests, statuses } = setup((path, body) => online ? accepting(path, body) : 'network');
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'offline' });
  expect(requests.length).toBe(1);
  await vi.advanceTimersByTimeAsync(5_000);
  await transport.settled();
  expect(requests.length).toBe(2);
  await vi.advanceTimersByTimeAsync(5_000);
  await transport.settled();
  expect(requests.length).toBe(2);
  online = true;
  await vi.advanceTimersByTimeAsync(5_000);
  await transport.settled();
  expect(transport.state().state).toBe('synced');
  expect(JSON.stringify(statuses)).not.toContain('secret-access-token');
  for (const status of statuses) expect(() => SyncStatus.parse(status)).not.toThrow();
});

it.each([
  ['device_limit', 403, 'device_limit'],
  ['device_released', 403, 'device_released'],
  ['account_deleted', 410, 'account_deleted'],
] as const)('stops on %s and waits for the person', async (code, status, reason) => {
  vi.useFakeTimers();
  const { store, transport, requests } = setup(() => ({ status, body: { code } }));
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'paused', reason });
  const asked = requests.length;
  chat(store);
  transport.localChanged();
  transport.windowFocused();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(requests.length).toBe(asked);
});

it('says the server is turned off and keeps trying slowly', async () => {
  vi.useFakeTimers();
  const { transport, requests } = setup(() => ({ status: 503, body: { code: 'sync_disabled' } }));
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'paused', reason: 'server_unavailable' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(requests.length).toBe(1);
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  await transport.settled();
  expect(requests.length).toBe(2);
});

it('treats a server whose keys are misconfigured as unavailable, not as this computer being offline', async () => {
  vi.useFakeTimers();
  const { transport, requests } = setup(() => ({ status: 503, body: { code: 'key_configuration' } }));
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'paused', reason: 'server_unavailable' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(requests.length).toBe(1);
});

it('sends an orglet before its skill and a chat before its turn, and leaves an oversized change at home', async () => {
  const { store, replica } = setup(accepting);
  replica.execute({ action: 'begin', context, discardSeed: false });
  replica.execute({ action: 'settle', context, cursor: cursor(0) });
  const skill: Skill = { id: randomUUID(), name: 'Later skill', revision: 1, content: 'Written first.' };
  store.version('skills', skill);
  store.version('workers', { id: randomUUID(), name: 'Later orglet', revision: 1, provider: 'demo', skillId: skill.id, instructions: 'Written second.' });
  chat(store);
  const batch = replica.execute({ action: 'outbox', context }) as SyncReplicaBatch;
  const kinds = batch.records.map(record => record.data.kind === 'revision' ? record.data.revision.entity : record.data.kind);
  expect(kinds.indexOf('worker')).toBeLessThan(kinds.indexOf('skill'));
  expect(kinds.indexOf('chat')).toBeLessThan(kinds.indexOf('turn'));
  expect(batch.skipped).toBe(0);

  // Schemas keep real records small; this guards a row that grew past the server's limit on disk anyway.
  const queued = store.db.prepare('SELECT data FROM sync_outbox LIMIT 1').get()!;
  const padded = JSON.stringify({ ...JSON.parse(String(queued.data)), id: randomUUID() }) + ' '.repeat(SYNC_RECORD_BYTES);
  store.db.prepare('INSERT INTO sync_outbox(account_key,record_id,data) VALUES(?,?,?)').run(context.accountKey, randomUUID(), padded);
  const next = replica.execute({ action: 'outbox', context }) as SyncReplicaBatch;
  expect(next.skipped).toBe(1);
  expect(next.records.every(record => JSON.stringify(record).length < SYNC_RECORD_BYTES)).toBe(true);
});

it('records nothing for an account this computer has not joined, and refuses a stale context', () => {
  const { store, replica } = setup(accepting);
  expect(untouchedSeed(store)).toBeDefined();
  const fresh = replica.execute({ action: 'attach', context }) as SyncReplicaState;
  expect(fresh).toMatchObject({ linked: false, cursor: null, ownData: false });
  chat(store);
  expect((replica.execute({ action: 'attach', context }) as SyncReplicaState).ownData).toBe(true);
  expect(Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count)).toBe(0);
  expect(() => replica.execute({ action: 'outbox', context })).toThrow('Phiên đồng bộ đã đổi.');

  replica.execute({ action: 'begin', context, discardSeed: false });
  replica.execute({ action: 'settle', context, cursor: cursor(3) });
  expect(Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count)).toBeGreaterThan(0);
  expect((replica.execute({ action: 'attach', context }) as SyncReplicaState)).toMatchObject({ linked: true, cursor: cursor(3) });
  expect(() => replica.execute({ action: 'outbox', context: { ...context, generation: 2 } })).toThrow('Phiên đồng bộ đã đổi.');
  replica.execute({ action: 'detach' });
  expect(() => replica.execute({ action: 'receive', context, records: [], cursor: cursor(4) })).toThrow('Phiên đồng bộ đã đổi.');
});

it('opens the hint socket with the bearer token and device in headers, never in the address', async () => {
  const seen: { url?: string; authorization?: string; device?: string } = {};
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    seen.url = request.url;
    seen.authorization = request.headers.authorization;
    seen.device = String(request.headers['x-orglet-device']);
    socket.destroy();
  });
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const port = (server.address() as AddressInfo).port;
  const closed = new Promise<void>(resolvePromise => {
    openSyncSocket(`ws://127.0.0.1:${port}/v1/connect`, { Authorization: 'Bearer header-token', 'X-Orglet-Device': 'device-id' },
      { message: () => undefined, close: resolvePromise });
  });
  await closed;
  await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
  expect(seen).toEqual({ url: '/v1/connect', authorization: 'Bearer header-token', device: 'device-id' });
});

it.each([
  [401, 'invalid_token', 'Máy chủ đồng bộ không nhận phiên đăng nhập này. Đăng xuất rồi đăng nhập lại.'],
  [503, 'sync_unavailable', 'Máy chủ đồng bộ đang gặp lỗi. Thử lại sau.'],
  [429, 'rate_limited', 'Tài khoản vừa gửi quá nhiều yêu cầu. Chờ vài phút rồi thử lại.'],
  [403, 'device_limit', 'Tài khoản đã đủ số máy được đồng bộ.'],
  [410, 'account_deleted', 'Tài khoản này đã bị xóa trên máy chủ. Dữ liệu trên máy này vẫn còn.'],
] as const)('says why the account could not be read before joining: %s %s', async (status, code, message) => {
  const { store, transport } = setup(() => ({ status, body: { code } }));
  chat(store);
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'link_required' });
  await expect(transport.preview()).rejects.toThrow(message);
  expect(transport.state()).toEqual({ state: 'link_required' });
});

it('blames the connection only when there was no answer at all', async () => {
  const { store, transport } = setup(() => 'network');
  chat(store);
  await transport.refresh();
  await transport.settled();
  await expect(transport.preview()).rejects.toThrow('Không đọc được tài khoản. Kiểm tra kết nối rồi thử lại.');
});
