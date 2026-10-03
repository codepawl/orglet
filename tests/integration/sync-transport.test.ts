import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { SyncReplica } from '../../apps/desktop/src/core/storage/sync-replica';
import { eraseEverything } from '../../apps/desktop/src/core/storage/erase';
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import { FILE_NOT_SYNCED } from '../../apps/desktop/src/main/sync-transport';
import type { Source } from '../../apps/desktop/src/shared/contracts';
import { SyncTransport, type SyncConnect } from '../../apps/desktop/src/main/sync-transport';
import type { SyncStatus } from '../../apps/desktop/src/shared/sync-status';
import type { Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Two or three real SQLite workspaces sync through the real account object in a local Worker runtime (GH-482). The
 * Worker entry is the service's test entry: it trusts a synthetic identity, so these tests do not prove JWT checking
 * (services/sync/test/auth.test.mjs does) or a deployed service. The network layer here is the transport's own
 * `fetch` and socket hooks, pointed at that runtime, with faults injected between the two.
 */

const serviceRoot = resolve(__dirname, '../../services/sync');
const installed = existsSync(join(serviceRoot, 'node_modules', 'miniflare'));
// CI installs the service before the tests and sets this, so a missing install fails there instead of skipping.
const required = process.env.ORGLET_REQUIRE_SYNC_SERVICE === '1';

type Fault = 'network' | 'lost';
type Limits = { storageBytes: number; devices: number; historyDays: number };
type Device = {
  owner: string;
  grant: string;
  store: Store;
  transport: SyncTransport;
  statuses: SyncStatus[];
  faults: Fault[];
  requests: string[];
  context: { accountKey: string; generation: number } | undefined;
  limits: Limits;
  sockets: boolean;
  /** When set, the next request waits here after it was sent and before its reply is handed back. */
  hold?: { entered: () => void; release: Promise<void> };
  transform?: (path: string, text: string) => string;
  /** Flips a byte of the next downloaded file. */
  damage?: boolean;
};
type FixtureSocket = { accept(): void; close(code?: number): void; addEventListener(type: string, listener: (event: { data?: unknown }) => void): void };
type Runtime = {
  dispatchFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string>; json(): Promise<unknown>; webSocket?: FixtureSocket }>;
  dispose(): Promise<void>;
};

let runtime: Runtime;
const devices: Device[] = [];
const accountKey = (owner: string) => createHash('sha256').update(owner).digest('hex');
const DEFAULT_LIMITS: Limits = { storageBytes: 5_000_000, devices: 3, historyDays: 90 };

function device(owner: string, options: { sockets?: boolean } = {}): Device {
  // A real folder, so saved file versions have somewhere to live beside the database.
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'orglet-sync-device-')), 'orglet.sqlite'));
  const created: Device = {
    owner, grant: `grant-${randomUUID()}`, store, statuses: [], faults: [], requests: [], limits: DEFAULT_LIMITS,
    context: { accountKey: accountKey(owner), generation: 1 }, sockets: options.sockets ?? false,
    transport: undefined as unknown as SyncTransport,
  };
  const replica = new SyncReplica(store, () => undefined);
  const fixtureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    created.requests.push(path);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer token-${created.owner}`);
    const fault = created.faults.shift();
    if (fault === 'network') throw new TypeError('fetch failed');
    const fileId = /^\/v1\/files\/([0-9a-f-]{36})$/.exec(path)?.[1];
    if (fileId) {
      created.requests[created.requests.length - 1] = `${init?.method} ${path}`;
      const deviceId = (init?.headers as Record<string, string>)['X-Orglet-Device'];
      const sending = init?.method === 'PUT';
      const answer = await runtime.dispatchFetch('https://fixture.test/fixture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: created.owner, operation: sending ? 'putFile' : 'getFile', device: deviceId, grant: created.grant, limits: created.limits,
          input: { deviceId, sourceId: fileId, ...(sending ? { base64: Buffer.from(init?.body as Uint8Array).toString('base64') } : {}) } }),
      });
      const reply = await answer.text();
      const held = created.hold;
      if (held) {
        created.hold = undefined;
        held.entered();
        await held.release;
      }
      if (sending || answer.status !== 200) return new Response(reply, { status: answer.status, headers: { 'Content-Type': 'application/json' } });
      const bytes = Buffer.from((JSON.parse(reply) as { base64: string }).base64, 'base64');
      if (created.damage) bytes[0] ^= 1;
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    }
    const body = JSON.parse(String(init?.body)) as { deviceId: string };
    const response = await runtime.dispatchFetch('https://fixture.test/fixture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: created.owner, operation: path.split('/').pop(), device: body.deviceId, grant: created.grant, limits: created.limits, input: body }),
    });
    const text = await response.text();
    if (fault === 'lost') throw new TypeError('fetch failed');
    const hold = created.hold;
    if (hold) {
      created.hold = undefined;
      hold.entered();
      await hold.release;
    }
    return new Response(created.transform ? created.transform(path, text) : text, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const fixtureConnect: SyncConnect = (_url, headers, handlers) => {
    if (!created.sockets) return { close: () => undefined };
    let socket: FixtureSocket | undefined;
    let closed = false;
    void runtime.dispatchFetch('https://fixture.test/fixture-connect', { headers: {
      Upgrade: 'websocket', 'x-fixture-owner': created.owner, 'x-fixture-device': headers['X-Orglet-Device'],
      'x-fixture-grant': created.grant, 'x-fixture-expiry': String(Date.now() + 900_000),
    } }).then(response => {
      socket = response.webSocket;
      if (!socket) {
        handlers.close();
        return;
      }
      socket.accept();
      if (closed) {
        socket.close(1000);
        return;
      }
      socket.addEventListener('message', event => handlers.message(String(event.data)));
      socket.addEventListener('close', () => {
        if (closed) return;
        closed = true;
        handlers.close();
      });
    }).catch(() => handlers.close());
    return { close: () => { closed = true; socket?.close(1000); } };
  };
  created.transport = new SyncTransport({
    baseUrl: 'https://sync.test',
    account: { syncContext: () => created.context, getAccessToken: async () => `token-${created.owner}` },
    core: async action => replica.execute(JSON.parse(JSON.stringify(action))),
    fetch: fixtureFetch,
    connect: fixtureConnect,
    onChange: status => created.statuses.push(status),
  });
  devices.push(created);
  return created;
}

function chat(store: Store, brief = 'Original message'): Task {
  const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief, sourceIds: [], status: 'completed',
    createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return store.get<Task>('tasks', task.id);
}
const outboxSize = (store: Store) => Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count);
const liveChats = (store: Store) => store.all<Task>('tasks').filter(task => !task.deletedAt).map(task => task.id).sort();
const title = (store: Store, taskId: string) => store.workspace().tasks.find(task => task.id === taskId)?.title;

/** One explicit round on a device: "try again now", then wait until it is idle. */
async function run(target: Device) {
  await target.transport.start();
  await target.transport.settled();
}
/** Rounds until every device has nothing left to send and has pulled the others' changes. */
async function converge(...targets: Device[]) {
  for (let round = 0; round < 4; round++) {
    for (const target of targets) await run(target);
  }
  for (const target of targets) {
    expect(target.transport.state().state).toBe('synced');
    expect(outboxSize(target.store)).toBe(0);
  }
}
async function inspect(owner: string) {
  const response = await runtime.dispatchFetch('https://fixture.test/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, operation: 'inspect', device: randomUUID() }) });
  return await response.json() as { records: unknown[]; account: { sequence: number }[] };
}
async function until(condition: () => boolean, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Condition not reached in time.');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
}

describe.skipIf(!installed && !required)('account sync through the local Worker', () => {
  beforeAll(async () => {
    const output = mkdtempSync(join(tmpdir(), 'orglet-sync-transport-bundle-'));
    const serviceRequire = createRequire(join(serviceRoot, 'package.json'));
    const built = spawnSync(process.execPath, [join(serviceRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'deploy', 'test/runtime-worker.ts', '--dry-run', '--outdir', output],
      { cwd: serviceRoot, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
    expect(built.status, built.stderr || built.stdout).toBe(0);
    const bundle = join(output, readdirSync(output).find(file => file.endsWith('.js'))!);
    const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(serviceRequire.resolve('miniflare')).href) as {
      Miniflare: new (options: unknown) => Runtime; convertV4MiniflareOptions(options: unknown): Record<string, unknown>;
    };
    const masters = JSON.stringify({ active: 1, keys: { 1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
    const options = convertV4MiniflareOptions({ workers: [{ name: 'orglet-sync-transport-test', modules: true,
      script: readFileSync(bundle, 'utf8'), compatibilityDate: '2026-10-03',
      durableObjects: { SYNC_ACCOUNTS: { className: 'AccountSync', useSQLite: true } }, r2Buckets: ['SYNC_FILES'],
      bindings: { SYNC_ENABLED: 'true', SYNC_ISSUER: 'https://issuer.test/api/auth', SYNC_AUDIENCE: 'https://sync.test',
        SYNC_MASTER_KEYS: masters, SYNC_MAX_ACCOUNT_BYTES: '33554432', SYNC_MAX_RECORDS: '10000',
        SYNC_MAX_FILE_BYTES: '26214400', SYNC_MAX_FILE_STORAGE_BYTES: '268435456' } }] });
    options.resourcePersistencePath = join(mkdtempSync(join(tmpdir(), 'orglet-sync-transport-')), 'v3');
    options.telemetry = { enabled: false };
    runtime = new Miniflare(options);
  }, 120_000);
  afterEach(async () => {
    for (const created of devices.splice(0)) {
      await created.transport.stop();
      created.store.db.close();
    }
  });
  afterAll(async () => { await runtime?.dispose(); });

  it('sends nothing until the person turns sync on, then a new computer downloads the account in pages', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const chats = Array.from({ length: 130 }, (_, index) => chat(first.store, `Message ${index}`));
    await first.transport.refresh();
    await first.transport.settled();
    expect(first.transport.state()).toEqual({ state: 'link_required' });
    expect(first.requests).toEqual([]);
    expect(outboxSize(first.store)).toBe(0);

    await converge(first);
    expect(first.requests.filter(path => path === '/v1/push').length).toBeGreaterThan(2);
    expect((await inspect(owner)).records.length).toBeGreaterThan(260);

    const second = device(owner);
    await second.transport.refresh();
    await second.transport.settled();
    expect(second.transport.state().state).toBe('synced');
    expect(second.requests.filter(path => path === '/v1/snapshot').length).toBeGreaterThan(2);
    // The untouched Researcher this install started with made way for the account's own.
    expect(second.store.all<Worker>('workers').map(worker => worker.id)).toEqual(first.store.all<Worker>('workers').map(worker => worker.id));
    expect(liveChats(second.store)).toEqual(chats.map(task => task.id).sort());
    expect(second.store.detail(chats[7].id).savedTurns?.map(turn => turn.input.brief)).toEqual(['Message 7']);
    // A received chat never carries consent or a permission from the other computer.
    expect(second.store.get<Task>('tasks', chats[7].id).consent).toBe(false);
    await converge(first, second);
    const shown = JSON.stringify([...first.statuses, ...second.statuses]);
    for (const secret of ['token-', accountKey(owner), first.store.sync.deviceId(), second.store.sync.deviceId()]) expect(shown).not.toContain(secret);
  }, 120_000);

  it('merges edits two computers made while apart, including a new orglet and a conflicting rename', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const task = chat(first.store);
    await converge(first);
    const second = device(owner);
    await converge(second, first);

    const worker = first.store.all<Worker>('workers')[0];
    first.store.setSetting('taskTitles', { [task.id]: 'Renamed on the first computer' });
    first.store.version('workers', { ...worker, revision: 2, name: 'Named on the first computer' });
    const skill: Skill = { id: randomUUID(), name: 'Offline skill', revision: 1, content: 'Made while apart.' };
    first.store.version('skills', skill);
    first.store.version('workers', { id: randomUUID(), name: 'Offline orglet', revision: 1, provider: 'demo', skillId: skill.id, instructions: 'Made while apart.' });
    const turnId = second.store.sync.turns.list(task.id)[0].id;
    second.store.update('tasks', { ...second.store.get<Task>('tasks', task.id),
      messageReactions: [{ messageId: turnId, emoji: 'agree', actor: 'user', createdAt: new Date().toISOString() }] });
    second.store.version('workers', { ...second.store.get<Worker>('workers', worker.id), revision: 2, name: 'Named on the second computer' });

    await converge(first, second, first);
    for (const store of [first.store, second.store]) {
      expect(title(store, task.id)).toBe('Renamed on the first computer');
      expect(store.detail(task.id).task.messageReactions?.map(reaction => reaction.emoji)).toEqual(['agree']);
      expect(store.all<Worker>('workers').map(item => item.name)).toContain('Offline orglet');
      // Both renames stay in the history; the two computers agree on which one is current.
      expect(Number(store.db.prepare('SELECT COUNT(*) AS count FROM revisions WHERE entity_id=?').get(worker.id)!.count)).toBe(3);
    }
    expect(second.store.get<Worker>('workers', worker.id).name).toBe(first.store.get<Worker>('workers', worker.id).name);
  }, 120_000);

  it('keeps an "only on this computer" chat off the server, and withdraws one that had synced', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const shared = chat(first.store, 'Shared at first');
    const kept = chat(first.store, 'Kept at home PRIVATE_SENTINEL');
    first.store.sync.setLocalOnly({ kind: 'task', id: kept.id, localOnly: true });
    await converge(first);
    const second = device(owner);
    await converge(second, first);
    expect(liveChats(second.store)).toEqual([shared.id]);

    first.store.sync.setLocalOnly({ kind: 'task', id: shared.id, localOnly: true });
    await converge(first, second);
    // The withdrawal moves the server's privacy epoch, so the second computer downloads the account again.
    expect(second.requests.filter(path => path === '/v1/snapshot').length).toBeGreaterThan(1);
    const third = device(owner);
    await converge(third);
    expect(liveChats(third.store)).toEqual([]);
    expect(first.store.detail(shared.id).savedTurns?.[0].input.brief).toBe('Shared at first');
    expect(first.store.detail(kept.id).savedTurns?.[0].input.brief).toContain('PRIVATE_SENTINEL');
  }, 120_000);

  it('resends the same batch after a lost reply and after no connection, without duplicates', async () => {
    const owner = randomUUID();
    const first = device(owner);
    await converge(first);
    const task = chat(first.store, 'Sent twice');
    const queued = outboxSize(first.store);
    expect(queued).toBeGreaterThan(0);

    first.faults.push('lost');
    await run(first);
    expect(first.transport.state().state).toBe('offline');
    expect(outboxSize(first.store)).toBe(queued);
    first.faults.push('network');
    await run(first);
    expect(first.transport.state().state).toBe('offline');
    expect(outboxSize(first.store)).toBe(queued);

    await converge(first);
    const second = device(owner);
    await converge(second);
    expect(second.store.detail(task.id).savedTurns?.map(turn => turn.input.brief)).toEqual(['Sent twice']);
  }, 120_000);

  it('drops a reply that arrives after sign-out, keeps the outbox, and does not upload to another account', async () => {
    const owner = randomUUID();
    const first = device(owner);
    await converge(first);
    chat(first.store, 'Queued across a sign-out');
    const queued = outboxSize(first.store);
    let entered!: () => void;
    let release!: () => void;
    const sent = new Promise<void>(resolvePromise => { entered = resolvePromise; });
    first.hold = { entered, release: new Promise<void>(resolvePromise => { release = resolvePromise; }) };
    void first.transport.start();
    await sent;
    first.context = undefined;
    await first.transport.refresh();
    release();
    await first.transport.settled();
    expect(first.transport.state()).toEqual({ state: 'off' });
    expect(outboxSize(first.store)).toBe(queued);
    // Signed out: an edit is not recorded for any account.
    chat(first.store, 'Written while signed out');
    expect(outboxSize(first.store)).toBe(queued);

    // Another account on the same computer: its data stays put until the person says otherwise.
    const other = randomUUID();
    first.owner = other;
    first.grant = `grant-${randomUUID()}`;
    first.context = { accountKey: accountKey(other), generation: 2 };
    const before = first.requests.length;
    await first.transport.refresh();
    await first.transport.settled();
    expect(first.transport.state()).toEqual({ state: 'link_required' });
    expect(first.requests.length).toBe(before);

    // Back on the first account, signed in anew, so with a new grant for the same device: both chats reach it once.
    first.owner = owner;
    first.grant = `grant-${randomUUID()}`;
    first.context = { accountKey: accountKey(owner), generation: 3 };
    await first.transport.refresh();
    await converge(first);
    const second = device(owner);
    await converge(second);
    expect(second.store.all<Task>('tasks').map(task => task.brief).sort()).toEqual(['Queued across a sign-out', 'Written while signed out']);
    expect(first.requests).toContain('/v1/devices/release');
  }, 120_000);

  it('says the account is full, keeps local edits, and still receives', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const second = device(owner);
    await converge(first, second);
    second.limits = { ...DEFAULT_LIMITS, storageBytes: 1 };
    const stuck = chat(second.store, 'Does not fit');
    await run(second);
    expect(second.transport.state()).toMatchObject({ state: 'paused', reason: 'storage_limit' });
    expect(outboxSize(second.store)).toBeGreaterThan(0);
    expect(second.store.detail(stuck.id).savedTurns?.[0].input.brief).toBe('Does not fit');

    const arriving = chat(first.store, 'From the other computer');
    await converge(first);
    await run(second);
    expect(liveChats(second.store)).toContain(arriving.id);
    expect(second.transport.state()).toMatchObject({ state: 'paused', reason: 'storage_limit' });

    second.limits = DEFAULT_LIMITS;
    await converge(second, first);
    expect(liveChats(first.store)).toContain(stuck.id);
  }, 120_000);

  it('stages a record from a newer Orglet, stops sending, and keeps receiving', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const second = device(owner);
    await converge(first, second);
    second.transform = (path, text) => {
      if (path !== '/v1/pull') return text;
      second.transform = undefined;
      const page = JSON.parse(text) as { records: unknown[] };
      page.records.push({ schemaVersion: 2, id: randomUUID(), later: 'unknown shape' });
      return JSON.stringify(page);
    };
    chat(second.store, 'Waits for an update');
    await run(second);
    expect(second.transport.state()).toMatchObject({ state: 'paused', reason: 'update_required' });
    expect(outboxSize(second.store)).toBeGreaterThan(0);
    const arriving = chat(first.store, 'Still arrives');
    await converge(first);
    await run(second);
    expect(liveChats(second.store)).toContain(arriving.id);
  }, 120_000);

  it('pulls on the server\'s hint, without being asked', async () => {
    const owner = randomUUID();
    const first = device(owner, { sockets: true });
    const second = device(owner, { sockets: true });
    await converge(first, second);
    const task = chat(first.store, 'Arrives by hint');
    await run(first);
    await until(() => liveChats(second.store).includes(task.id));
    await second.transport.settled();
    expect(second.store.detail(task.id).savedTurns?.[0].input.brief).toBe('Arrives by hint');
  }, 120_000);

  it('does not bring the account back after the workspace was erased here', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const task = chat(first.store, 'Erased on one computer');
    await converge(first);
    const second = device(owner);
    await converge(second, first);

    eraseEverything(second.store);
    await run(second);
    await second.transport.settled();
    expect(second.transport.state()).toEqual({ state: 'link_required' });
    expect(liveChats(second.store)).toEqual([]);
    await converge(first);
    expect(liveChats(first.store)).toEqual([task.id]);
  }, 120_000);

  it('sends a saved file version once a message carries it, and downloads its bytes only when it is opened', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const folder = mkdtempSync(join(tmpdir(), 'orglet-sync-attached-'));
    const attachedPath = join(folder, 'notes.txt');
    writeFileSync(attachedPath, 'Attached on the first computer');
    const sources = new Sources(first.store);
    const [attached] = await sources.import([attachedPath]);
    const task: Task = { id: randomUUID(), workerId: first.store.all<Worker>('workers')[0].id, brief: 'Read this', sourceIds: [attached.id], status: 'completed',
      createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
    first.store.put('tasks', task);
    const version = await sources.saveVersion(attached.id, [attached.id], 'notes (edited).txt', { text: 'Edited on the first computer' });
    first.store.patchTask(task.id, { sourceIds: [attached.id, version.id] });

    // The chat holds the version, but no message has carried it: nothing about it is sent, and nothing is refused.
    await converge(first);
    expect(first.requests.some(request => request.startsWith('PUT /v1/files/'))).toBe(false);
    first.store.update('tasks', { ...first.store.get<Task>('tasks', task.id), inputRevision: 1, currentTurnId: randomUUID(),
      currentInput: { brief: 'Now use my edit', sourceIds: [version.id] } });
    await converge(first);
    expect(first.requests.filter(request => request.startsWith('PUT /v1/files/'))).toEqual([`PUT /v1/files/${version.id}`]);
    await converge(first);
    expect(first.requests.filter(request => request.startsWith('PUT /v1/files/')).length).toBe(1);

    const second = device(owner);
    await converge(second);
    expect(second.store.get<Source>('sources', version.id)).toMatchObject({ availability: 'other-device', hash: version.hash, editedFrom: attached.id });
    expect(second.requests.some(request => request.startsWith('GET /v1/files/'))).toBe(false);
    const storedPath = () => String(second.store.db.prepare('SELECT path FROM sources WHERE id=?').get(version.id)!.path);
    expect(storedPath()).toBe('');

    // A file the first computer only pointed at was never copied, so the account has no bytes for it.
    await expect(second.transport.downloadFile(task.id, attached.id)).rejects.toThrow(FILE_NOT_SYNCED);
    // Another chat cannot fetch this chat's file.
    const elsewhere = chat(second.store, 'Another chat');
    await expect(second.transport.downloadFile(elsewhere.id, version.id)).rejects.toThrow('Không có quyền đọc nguồn ngoài task này.');
    // Bytes that are not the recorded ones are refused and nothing is kept.
    second.damage = true;
    await expect(second.transport.downloadFile(task.id, version.id)).rejects.toThrow('Tệp tải về không khớp với tệp đã đính kèm.');
    expect(storedPath()).toBe('');
    second.damage = false;

    await second.transport.downloadFile(task.id, version.id);
    expect(storedPath()).toContain(join('edited-sources', version.id));
    expect(readFileSync(storedPath(), 'utf8')).toBe('Edited on the first computer');
    expect(second.store.get<Source>('sources', version.id).availability).toBeUndefined();
    expect(await new Sources(second.store).read(version.id, [attached.id, version.id])).toContain('Edited on the first computer');
    await expect(second.transport.downloadFile(task.id, version.id)).rejects.toThrow('Tệp này đã có trên máy này.');
    // The downloaded copy is this computer's own; having it does not send it again.
    await converge(second, first);
    expect(second.requests.some(request => request.startsWith('PUT /v1/files/'))).toBe(false);
  }, 120_000);

  it('keeps no file when the account is signed out while its bytes are on the way', async () => {
    const owner = randomUUID();
    const first = device(owner);
    const folder = mkdtempSync(join(tmpdir(), 'orglet-sync-attached-'));
    writeFileSync(join(folder, 'draft.txt'), 'Original');
    const sources = new Sources(first.store);
    const [attached] = await sources.import([join(folder, 'draft.txt')]);
    const task: Task = { id: randomUUID(), workerId: first.store.all<Worker>('workers')[0].id, brief: 'Read this', sourceIds: [attached.id], status: 'completed',
      createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
    first.store.put('tasks', task);
    const version = await sources.saveVersion(attached.id, [attached.id], 'draft (edited).txt', { text: 'Edited' });
    first.store.update('tasks', { ...first.store.get<Task>('tasks', task.id), sourceIds: [attached.id, version.id], inputRevision: 1,
      currentTurnId: randomUUID(), currentInput: { brief: 'Use my edit', sourceIds: [version.id] } });
    await converge(first);
    const second = device(owner);
    await converge(second);

    let entered!: () => void;
    let release!: () => void;
    const sent = new Promise<void>(resolvePromise => { entered = resolvePromise; });
    second.hold = { entered, release: new Promise<void>(resolvePromise => { release = resolvePromise; }) };
    const download = second.transport.downloadFile(task.id, version.id);
    const failed = expect(download).rejects.toThrow();
    await sent;
    second.context = undefined;
    await second.transport.refresh();
    release();
    await failed;
    expect(String(second.store.db.prepare('SELECT path FROM sources WHERE id=?').get(version.id)!.path)).toBe('');
    expect(second.store.get<Source>('sources', version.id).availability).toBe('other-device');
  }, 120_000);
});
