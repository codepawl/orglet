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
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import { SyncTransport } from '../../apps/desktop/src/main/sync-transport';
import type { SyncStatus } from '../../apps/desktop/src/shared/sync-status';
import type { Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * The service's production entry, unchanged, in a local Worker runtime, reached the way the app reaches it: the
 * transport's own `fetch` and its own WebSocket over loopback HTTP, with EdDSA access tokens the Worker verifies
 * against a JWKS it fetches from its configured issuer. Only the issuer is a stand-in (the test answers the JWKS
 * request). This does not prove a deployment on Cloudflare or a sign-in at accounts.codepawl.com.
 */

const serviceRoot = resolve(__dirname, '../../services/sync');
const installed = existsSync(join(serviceRoot, 'node_modules', 'miniflare'));
const required = process.env.ORGLET_REQUIRE_SYNC_SERVICE === '1';
const ISSUER = 'https://issuer.test/api/auth';
const AUDIENCE = 'https://sync.test';

type Runtime = { ready: Promise<URL>; dispose(): Promise<void> };
type Jose = {
  generateKeyPair(algorithm: string, options?: { extractable?: boolean }): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
  exportJWK(key: CryptoKey): Promise<Record<string, unknown>>;
  SignJWT: new (claims: Record<string, unknown>) => { setProtectedHeader(header: Record<string, unknown>): { sign(key: CryptoKey): Promise<string> } };
};
type Device = { store: Store; transport: SyncTransport; statuses: SyncStatus[]; claims: Record<string, unknown>; signedWith?: CryptoKey };

let runtime: Runtime;
let origin: string;
let jose: Jose;
let signingKey: CryptoKey;
let jwksRequests = 0;
const devices: Device[] = [];

function device(subject: string, changes: Record<string, unknown> = {}): Device {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'orglet-sync-http-')), 'orglet.sqlite'));
  const replica = new SyncReplica(store, () => undefined);
  const created: Device = { store, statuses: [], transport: undefined as unknown as SyncTransport,
    claims: { iss: ISSUER, aud: AUDIENCE, sub: subject, azp: 'orglet-desktop', orglet_grant_id: `grant-${randomUUID()}`,
      scope: 'openid profile email offline_access', entitlements: { syncStorageMb: 5, devices: 3, historyDays: 90, push: false }, ...changes } };
  const context = { accountKey: createHash('sha256').update(subject).digest('hex'), generation: 1 };
  created.transport = new SyncTransport({
    baseUrl: origin,
    account: {
      syncContext: () => context,
      getAccessToken: async () => {
        const now = Math.floor(Date.now() / 1000);
        return new jose.SignJWT({ ...created.claims, iat: now, exp: now + 600 }).setProtectedHeader({ alg: 'EdDSA' }).sign(created.signedWith ?? signingKey);
      },
    },
    core: async action => replica.execute(JSON.parse(JSON.stringify(action))),
    onChange: status => created.statuses.push(status),
  });
  devices.push(created);
  return created;
}
function chat(store: Store, brief: string, sourceIds: string[] = []): Task {
  const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief, sourceIds, status: 'completed',
    createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return store.get<Task>('tasks', task.id);
}
const liveChats = (store: Store) => store.all<Task>('tasks').filter(task => !task.deletedAt).map(task => task.id).sort();
async function run(target: Device) {
  await target.transport.start();
  await target.transport.settled();
}
async function until(condition: () => boolean, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Condition not reached in time.');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
}

describe.skipIf(!installed && !required)('the production sync entry over real HTTP with signed tokens', () => {
  beforeAll(async () => {
    const serviceRequire = createRequire(join(serviceRoot, 'package.json'));
    jose = await import(pathToFileURL(serviceRequire.resolve('jose')).href) as Jose;
    const pair = await jose.generateKeyPair('EdDSA', { extractable: true });
    signingKey = pair.privateKey;
    const jwk = { ...await jose.exportJWK(pair.publicKey), alg: 'EdDSA', use: 'sig', kid: 'test-key' };
    const output = mkdtempSync(join(tmpdir(), 'orglet-sync-production-bundle-'));
    const built = spawnSync(process.execPath, [join(serviceRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'deploy', 'src/index.ts', '--dry-run', '--outdir', output],
      { cwd: serviceRoot, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
    expect(built.status, built.stderr || built.stdout).toBe(0);
    const bundle = join(output, readdirSync(output).find(file => file.endsWith('.js'))!);
    const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(serviceRequire.resolve('miniflare')).href) as {
      Miniflare: new (options: unknown) => Runtime; convertV4MiniflareOptions(options: unknown): Record<string, unknown>;
    };
    const masters = JSON.stringify({ active: 1, keys: { 1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
    const options = convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ name: 'orglet-sync-production-test', modules: true,
      script: readFileSync(bundle, 'utf8'), compatibilityDate: '2026-10-03',
      durableObjects: { SYNC_ACCOUNTS: { className: 'AccountSync', useSQLite: true } }, r2Buckets: ['SYNC_FILES'],
      // The Worker's only outbound request is for its issuer's keys.
      outboundService: (request: { url: string }) => {
        if (request.url !== `${ISSUER}/jwks`) return new Response(null, { status: 404 });
        jwksRequests += 1;
        return Response.json({ keys: [jwk] });
      },
      bindings: { SYNC_ENABLED: 'true', SYNC_ISSUER: ISSUER, SYNC_AUDIENCE: AUDIENCE,
        SYNC_MASTER_KEYS: masters, SYNC_MAX_ACCOUNT_BYTES: '33554432', SYNC_MAX_RECORDS: '10000',
        SYNC_MAX_FILE_BYTES: '26214400', SYNC_MAX_FILE_STORAGE_BYTES: '268435456' } }] });
    options.resourcePersistencePath = join(mkdtempSync(join(tmpdir(), 'orglet-sync-production-')), 'v3');
    options.telemetry = { enabled: false };
    runtime = new Miniflare(options);
    origin = (await runtime.ready).origin;
  }, 120_000);
  afterEach(async () => {
    for (const created of devices.splice(0)) {
      await created.transport.stop();
      created.store.db.close();
    }
  });
  afterAll(async () => { await runtime?.dispose(); });

  it('syncs two computers, hints over a real socket and moves a file, all behind verified tokens', async () => {
    const owner = `owner-${randomUUID()}`;
    const first = device(owner);
    const folder = mkdtempSync(join(tmpdir(), 'orglet-sync-http-file-'));
    writeFileSync(join(folder, 'notes.txt'), 'Attached');
    const sources = new Sources(first.store);
    const [attached] = await sources.import([join(folder, 'notes.txt')]);
    const task = chat(first.store, 'Over real HTTP', [attached.id]);
    const version = await sources.saveVersion(attached.id, [attached.id], 'notes (edited).txt', { text: 'Edited, sent as raw bytes' });
    first.store.update('tasks', { ...first.store.get<Task>('tasks', task.id), sourceIds: [attached.id, version.id], inputRevision: 1,
      currentTurnId: randomUUID(), currentInput: { brief: 'Use my edit', sourceIds: [version.id] } });
    await run(first);
    expect(first.transport.state().state).toBe('synced');
    expect(jwksRequests).toBeGreaterThan(0);

    const second = device(owner);
    await second.transport.refresh();
    await second.transport.settled();
    expect(second.transport.state().state).toBe('synced');
    expect(liveChats(second.store)).toEqual([task.id]);
    await second.transport.downloadFile(task.id, version.id);
    const stored = String(second.store.db.prepare('SELECT path FROM sources WHERE id=?').get(version.id)!.path);
    expect(readFileSync(stored, 'utf8')).toBe('Edited, sent as raw bytes');
    expect(second.store.get<Source>('sources', version.id).availability).toBeUndefined();

    // The second computer holds an open hint socket; a push from the first arrives without asking.
    const later = chat(first.store, 'Arrives by a real hint');
    await run(first);
    await until(() => liveChats(second.store).includes(later.id));

    // Another subject, with an equally valid token, gets its own empty account.
    const stranger = device(`stranger-${randomUUID()}`);
    await stranger.transport.refresh();
    await stranger.transport.settled();
    expect(stranger.transport.state().state).toBe('synced');
    expect(liveChats(stranger.store)).toEqual([]);
    expect(stranger.store.all<Worker>('workers').map(worker => worker.id)).not.toEqual(first.store.all<Worker>('workers').map(worker => worker.id));
  }, 120_000);

  it.each([
    ['another audience', { aud: 'https://market.test' }],
    ['another client', { azp: 'other-client' }],
    ['missing entitlements', { entitlements: undefined }],
  ] as const)('refuses a token for %s and sends nothing', async (_name, changes) => {
    const owner = `refused-${randomUUID()}`;
    const refused = device(owner, changes);
    chat(refused.store, 'Must not leave');
    await run(refused);
    expect(refused.transport.state().state).toBe('offline');
    const honest = device(owner);
    await honest.transport.refresh();
    await honest.transport.settled();
    expect(liveChats(honest.store)).toEqual([]);
  }, 120_000);

  it('refuses a token signed by another key', async () => {
    const owner = `forged-${randomUUID()}`;
    const forged = device(owner);
    forged.signedWith = (await jose.generateKeyPair('EdDSA')).privateKey;
    chat(forged.store, 'Must not leave');
    await run(forged);
    expect(forged.transport.state().state).toBe('offline');
    const anonymous = await fetch(`${origin}/v1/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(anonymous.status).toBe(401);
  }, 120_000);
});
