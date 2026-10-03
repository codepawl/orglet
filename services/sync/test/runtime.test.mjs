import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const directory = resolve(import.meta.dirname, '..');
const devices = new Map();
const expiries = new Map();
const masters = JSON.stringify({ active: 1, keys: { 1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
let runtime, persistence, bundle;
function device(owner) { if (!devices.has(owner)) devices.set(owner, crypto.randomUUID()); return devices.get(owner); }
async function start(secret = masters, enabled = 'true') {
  const options = convertV4MiniflareOptions({ workers: [{ name: 'orglet-sync-local-test', modules: true,
    script: await readFile(bundle, 'utf8'), compatibilityDate: '2026-10-03',
    durableObjects: { SYNC_ACCOUNTS: { className: 'AccountSync', useSQLite: true } },
    bindings: { SYNC_ENABLED: enabled, SYNC_ISSUER: 'https://issuer.test/api/auth', SYNC_AUDIENCE: 'https://sync.test',
      SYNC_MASTER_KEYS: secret, SYNC_MAX_ACCOUNT_BYTES: '33554432', SYNC_MAX_RECORDS: '10000' } }] });
  options.resourcePersistencePath = join(persistence, 'v3'); options.telemetry = { enabled: false };
  runtime = new Miniflare(options);
}
before(async () => {
  persistence = await mkdtemp(join(tmpdir(), 'orglet-sync-test-'));
  const output = await mkdtemp(join(tmpdir(), 'orglet-sync-bundle-'));
  const built = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', 'test/runtime-worker.ts', '--dry-run', '--outdir', output],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  bundle = join(output, (await readdir(output)).find(file => file.endsWith('.js')));
  await start();
}, { timeout: 60_000 });
after(async () => { await runtime?.dispose(); });
function call(owner, operation, input, extra = {}) {
  if (!expiries.has(owner)) expiries.set(owner, Date.now() + 900_000);
  return runtime.dispatchFetch('https://fixture.test/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, operation, device: device(owner), input, expiresAt: expiries.get(owner), ...extra }) });
}
async function ok(owner, operation, input, extra) {
  const response = await call(owner, operation, input, extra);
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
function snapshot(owner, extra = {}) { return ok(owner, 'snapshot', { deviceId: device(owner), limit: 100, ...extra }); }
function record(owner, data, scopes = [], wallMs = 1000) {
  const origin = device(owner);
  return { schemaVersion: 1, id: crypto.randomUUID(), origin, clock: { wallMs, counter: 0, deviceId: origin }, scopes, data };
}
function setting(owner, value, wallMs = 1000, key = 'language') { return record(owner, { kind: 'setting', change: { key, value } }, [], wallMs); }
function push(owner, records, extra = {}) { return ok(owner, 'push', { deviceId: device(owner), records }, extra); }
async function refused(response, status, code) { assert.equal(response.status, status); if (code) assert.equal((await response.json()).code, code); }
function epoch(kind, id) {
  const bytes = createHash('sha256').update(`orglet-sync-scope:${kind}:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function worker(owner) {
  const id = crypto.randomUUID(), skillId = crypto.randomUUID();
  const scope = { kind: 'worker', id, epoch: epoch('worker', id) };
  const clock = { wallMs: 1000, counter: 0, deviceId: device(owner) };
  return { id, scope, row: record(owner, { kind: 'revision', revision: { entity: 'worker', revisionId: crypto.randomUUID(), generation: 1, clock,
    value: { id, name: 'Private fixture sentinel', instructions: 'Private fixture instructions', provider: 'demo', skillId } } }, [scope]) };
}

test('native SQLite persists encrypted rows and isolates authenticated account routing across restart', async () => {
  const a = 'restart-a', b = 'restart-b';
  await push(a, [setting(a, 'vi')]); await push(b, [setting(b, 'en')]);
  const before = await ok(a, 'inspect');
  assert.equal(before.records.length, 1); assert.equal(before.account[0].wrapped.includes('body'), true);
  assert.equal(JSON.stringify(before.records).includes('"value":"vi"'), false);
  await runtime.dispose(); await start();
  assert.equal((await snapshot(a)).records[0].data.change.value, 'vi');
  assert.equal((await snapshot(b)).records[0].data.change.value, 'en');
  await refused(await call(a, 'snapshot', { deviceId: device(a), limit: 100 }, { routeOwner: b }), 403);
});
test('higher HLC wins concurrent offline writes and exact record-ID retry cannot alter its body', async () => {
  const owner = 'hlc'; const old = setting(owner, 'vi'), fresh = setting(owner, 'en', 2000);
  await Promise.all([push(owner, [old]), push(owner, [fresh])]);
  assert.equal((await snapshot(owner)).records[0].data.change.value, 'en');
  assert.equal((await push(owner, [old])).outcomes[0].status, 'superseded');
  await refused(await call(owner, 'push', { deviceId: device(owner), records: [{ ...old, data: fresh.data }] }), 409, 'record_id_conflict');
});
test('immutable data rejects altered history but accepts unchanged payload with a fresh envelope clock', async () => {
  const owner = 'immutable'; const fixture = worker(owner); await push(owner, [fixture.row]);
  const refreshed = { ...fixture.row, id: crypto.randomUUID(), clock: { ...fixture.row.clock, wallMs: 2000 } };
  assert.equal((await push(owner, [refreshed])).outcomes[0].status, 'kept');
  const changed = structuredClone(refreshed); changed.id = crypto.randomUUID(); changed.clock.wallMs = 3000; changed.data.revision.value.instructions = 'Rewritten history';
  await refused(await call(owner, 'push', { deviceId: device(owner), records: [changed] }), 409, 'immutable_conflict');
});
test('native transaction rolls back earlier row, log, receipt and sequence writes when a later SQL insert fails', async () => {
  const owner = 'rollback'; await snapshot(owner);
  await call(owner, 'fail', undefined, { enabled: true });
  const before = await ok(owner, 'inspect');
  await refused(await call(owner, 'push', { deviceId: device(owner), records: [setting(owner, 'vi'), setting(owner, 'dark', 1000, 'theme')] }), 503);
  assert.deepEqual(await ok(owner, 'inspect'), before);
  await call(owner, 'fail', undefined, { enabled: false });
  await push(owner, [setting(owner, 'en')]);
});
test('snapshot pages pin one sequence, bind the device and reject mutation or ciphertext tampering', async () => {
  const owner = 'pages'; await push(owner, [setting(owner, 'vi'), setting(owner, 'dark', 1000, 'theme')]);
  const first = await snapshot(owner, { limit: 1 }); assert.equal(first.records.length, 1); assert.ok(first.next);
  const final = await snapshot(owner, { limit: 1, cursor: first.next }); assert.equal(final.records.length, 1); assert.equal(final.next, null);
  await push(owner, [setting(owner, 'en', 2000)]);
  await refused(await call(owner, 'snapshot', { deviceId: device(owner), limit: 1, cursor: first.next }), 409, 'cursor_reset');
  await call(owner, 'tamper'); await refused(await call(owner, 'snapshot', { deviceId: device(owner), limit: 100 }), 503);
});
test('withdrawal erases old payload/log history; newer re-enable accepts only its new scope epoch', async () => {
  const owner = 'privacy'; const fixture = worker(owner);
  const before = await push(owner, [fixture.row]);
  const withdrawn = record(owner, { kind: 'withdraw', root: { kind: 'worker', id: fixture.id }, epoch: crypto.randomUUID(), localOnly: true, deleted: false }, [], 2000);
  await push(owner, [withdrawn]);
  const stored = await ok(owner, 'inspect'); assert.equal(stored.records.some(row => row.record_key === `revision:${fixture.row.data.revision.revisionId}`), false);
  assert.equal(stored.changes.some(row => row.record_key === `revision:${fixture.row.data.revision.revisionId}`), false);
  await refused(await call(owner, 'pull', { deviceId: device(owner), after: before.cursor, limit: 100 }), 409, 'cursor_reset');
  assert.equal((await push(owner, [{ ...fixture.row, id: crypto.randomUUID(), clock: { ...fixture.row.clock, wallMs: 9000 } }])).outcomes[0].status, 'blocked');
  const enabled = record(owner, { ...withdrawn.data, epoch: crypto.randomUUID(), localOnly: false }, [], 3000);
  await push(owner, [enabled]);
  const refreshed = { ...fixture.row, id: crypto.randomUUID(), clock: { ...fixture.row.clock, wallMs: 4000 }, scopes: [{ ...fixture.scope, epoch: enabled.data.epoch }] };
  assert.equal((await push(owner, [refreshed])).outcomes[0].status, 'kept');
});
test('permanent deletion survives restart and changed-ID or stripped-scope resurrection attempts', async () => {
  const owner = 'permanent'; const fixture = worker(owner); await push(owner, [fixture.row]);
  await push(owner, [record(owner, { kind: 'withdraw', root: { kind: 'worker', id: fixture.id }, epoch: crypto.randomUUID(), localOnly: true, deleted: true }, [], 500)]);
  await runtime.dispose(); await start();
  for (const scopes of [fixture.row.scopes, []]) {
    const replay = { ...fixture.row, id: crypto.randomUUID(), scopes, clock: { ...fixture.row.clock, wallMs: 999999 } };
    assert.equal((await push(owner, [replay])).outcomes[0].status, 'blocked');
  }
  const snapshotRows = (await snapshot(owner)).records;
  assert.equal(snapshotRows.some(row => row.data.kind === 'revision'), false);
  assert.equal(snapshotRows.some(row => row.data.kind === 'withdraw' && row.data.deleted), true);
});
test('quota rejects a whole batch, preserves local input and permits withdrawal after the entitlement shrinks', async () => {
  const owner = 'quota'; await snapshot(owner); const before = await ok(owner, 'inspect');
  const input = { deviceId: device(owner), records: [setting(owner, 'vi')] };
  await refused(await call(owner, 'push', input, { limits: { storageBytes: 0, devices: 3, historyDays: 90 } }), 413, 'storage_limit');
  assert.equal(input.records[0].data.change.value, 'vi'); assert.deepEqual(await ok(owner, 'inspect'), before);
  const fixture = worker(owner); await push(owner, [fixture.row]);
  await push(owner, [record(owner, { kind: 'withdraw', root: { kind: 'worker', id: fixture.id }, epoch: crypto.randomUUID(), localOnly: true, deleted: false }, [], 2000)],
    { limits: { storageBytes: 0, devices: 3, historyDays: 90 } });
});
test('deleting a crew purges its chat, turns and scoped notes without rolling back or permitting resurrection', async () => {
  const owner = 'crew-delete'; const lead = worker(owner); const teamId = crypto.randomUUID(), taskId = crypto.randomUUID();
  const clock = { wallMs: 1000, counter: 0, deviceId: device(owner) };
  const team = record(owner, { kind: 'revision', revision: { entity: 'team', revisionId: crypto.randomUUID(), generation: 1, clock,
    value: { id: teamId, name: 'Crew', instructions: 'Read', memberIds: [lead.id], synthesizerId: lead.id,
      workflow: 'sequential', monthlyBudgetMicros: 1000 } } }, [lead.scope]);
  const taskScope = { kind: 'task', id: taskId, epoch: epoch('task', taskId) };
  const chat = record(owner, { kind: 'chat', value: { id: taskId, workerId: lead.id, teamId, participants: [lead.id],
    createdAt: '2026-01-01T00:00:00.000Z' } }, [lead.scope, taskScope]);
  const sourceId = crypto.randomUUID(), sharedId = crypto.randomUUID(), otherTask = crypto.randomUUID();
  const turn = record(owner, { kind: 'turn', value: { id: crypto.randomUUID(), taskId,
    createdAt: '2026-01-01T00:00:00.000Z', input: { brief: 'Crew history', sourceIds: [sourceId, sharedId] } } }, chat.scopes);
  const otherScopes = [lead.scope, { kind: 'task', id: otherTask, epoch: epoch('task', otherTask) }];
  const otherChat = record(owner, { kind: 'chat', value: { id: otherTask, workerId: lead.id,
    createdAt: '2026-01-01T00:00:00.000Z' } }, otherScopes);
  const otherTurn = record(owner, { kind: 'turn', value: { id: crypto.randomUUID(), taskId: otherTask,
    createdAt: '2026-01-01T00:00:00.000Z', input: { brief: 'Shared source', sourceIds: [sharedId] } } }, otherScopes);
  const source = record(owner, { kind: 'source', value: { id: sourceId, name: 'crew.txt', bytes: 4, hash: 'a'.repeat(64) } }, chat.scopes);
  const shared = record(owner, { kind: 'source', value: { id: sharedId, name: 'shared.txt', bytes: 4, hash: 'b'.repeat(64) } }, otherScopes);
  const note = record(owner, { kind: 'revision', revision: { entity: 'knowledge', revisionId: crypto.randomUUID(), generation: 1, clock,
    value: { id: crypto.randomUUID(), title: 'Crew note', content: 'Private crew guidance', tags: [], pinned: false,
      scope: { type: 'team', id: teamId }, status: 'approved', hash: 'a'.repeat(64), provenance: { kind: 'user' },
      createdAt: '2026-01-01T00:00:00.000Z' } } }, [lead.scope]);
  await push(owner, [lead.row, team, chat, turn, note, otherChat, otherTurn, source, shared]);
  await push(owner, [record(owner, { kind: 'delete', entity: 'team', id: teamId }, [], 2000)]);
  const rows = (await snapshot(owner)).records;
  assert.equal(rows.some(row => row.data.kind === 'chat' && row.data.value.id === taskId
    || row.data.kind === 'turn' && row.data.value.taskId === taskId
    || row.data.kind === 'revision' && row.data.revision.entity !== 'worker'), false);
  assert.equal(rows.some(row => row.data.kind === 'source' && row.data.value.id === sourceId), false);
  assert.equal(rows.some(row => row.data.kind === 'source' && row.data.value.id === sharedId), true);
  for (const original of [chat, turn, note, source]) {
    const replay = { ...original, id: crypto.randomUUID(), scopes: [], clock: { ...clock, wallMs: 9000 } };
    assert.equal((await push(owner, [replay])).outcomes[0].status, 'blocked');
  }
});
test('device cap counts durable registrations, release blocks the old grant, and unknown schemas acknowledge nothing', async () => {
  const owner = 'devices'; await snapshot(owner);
  const other = crypto.randomUUID();
  await refused(await call(owner, 'snapshot', { deviceId: other, limit: 100 }, { grant: 'other-grant', limits: { storageBytes: 5_000_000, devices: 1, historyDays: 90 } }), 403, 'device_limit');
  await ok(owner, 'release', { deviceId: device(owner), targetDeviceId: device(owner) });
  await refused(await call(owner, 'snapshot', { deviceId: device(owner), limit: 100 }), 403, 'device_released');
  const unknownOwner = 'schema'; await snapshot(unknownOwner); const before = await ok(unknownOwner, 'inspect');
  await refused(await call(unknownOwner, 'push', { deviceId: device(unknownOwner), records: [{ ...setting(unknownOwner, 'vi'), schemaVersion: 99 }] }), 400);
  assert.deepEqual(await ok(unknownOwner, 'inspect'), before);
});
test('privacy deletion refreshes descendant tags after a crew is added to an existing channel', async () => {
  const owner = 'channel-delete', lead = worker(owner), taskId = crypto.randomUUID(), teamId = crypto.randomUUID();
  const clock = { wallMs: 1000, counter: 0, deviceId: device(owner) };
  const scopes = [lead.scope, { kind: 'task', id: taskId, epoch: epoch('task', taskId) }];
  const chat = record(owner, { kind: 'chat', value: { id: taskId, workerId: lead.id, createdAt: '2026-01-01T00:00:00.000Z' } }, scopes);
  const turn = record(owner, { kind: 'turn', value: { id: crypto.randomUUID(), taskId,
    createdAt: '2026-01-01T00:00:00.000Z', input: { brief: 'Existing channel history', sourceIds: [] } } }, scopes);
  await push(owner, [lead.row, chat, turn]);
  const team = record(owner, { kind: 'revision', revision: { entity: 'team', revisionId: crypto.randomUUID(), generation: 1, clock,
    value: { id: teamId, name: 'Crew', instructions: 'Read', memberIds: [lead.id], synthesizerId: lead.id,
      workflow: 'sequential', monthlyBudgetMicros: 1000 } } }, [lead.scope]);
  await push(owner, [team, record(owner, { kind: 'chatField', taskId, change: { field: 'channel',
    value: { id: crypto.randomUUID(), name: 'Channel', members: [{ kind: 'crew', id: teamId }] } } }, scopes, 2000)]);
  await push(owner, [record(owner, { kind: 'delete', entity: 'team', id: teamId }, [], 3000)]);
  const rows = (await snapshot(owner)).records;
  assert.equal(rows.some(row => ['chat', 'chatField', 'turn'].includes(row.data.kind)), false);
  const stored = await ok(owner, 'inspect');
  assert.equal(stored.changes.some(row => row.record_key.startsWith('turn:')), false);
});
test('aged incremental cursors require a snapshot and account deletion destroys the live key without recreating it', async () => {
  const owner = 'retention'; const initial = await snapshot(owner); await push(owner, [setting(owner, 'vi')]); await call(owner, 'age');
  await refused(await call(owner, 'pull', { deviceId: device(owner), after: initial.cursor, limit: 100 }), 409, 'cursor_reset');
  assert.equal((await snapshot(owner)).records.length, 1);
  assert.equal((await call(owner, 'erase')).status, 204);
  const deleted = await ok(owner, 'inspect'); assert.equal(deleted.account[0].deleted, 1); assert.equal(deleted.account[0].wrapped, null);
  assert.equal(deleted.records.length, 0); await runtime.dispose(); await start();
  await refused(await call(owner, 'snapshot', { deviceId: device(owner), limit: 100 }), 410);
  assert.equal((await ok(owner, 'inspect')).account[0].wrapped, null);
});
test('a replacement grant can release a full device slot before registering itself', async () => {
  const owner = 'replacement'; const limits = { storageBytes: 5_000_000, devices: 1, historyDays: 90 };
  await ok(owner, 'snapshot', { deviceId: device(owner), limit: 100 }, { limits });
  const replacement = crypto.randomUUID(); const extra = { grant: 'replacement-grant', limits };
  await refused(await call(owner, 'snapshot', { deviceId: replacement, limit: 100 }, extra), 403, 'device_limit');
  await ok(owner, 'release', { deviceId: replacement, targetDeviceId: device(owner) }, extra);
  await ok(owner, 'snapshot', { deviceId: replacement, limit: 100 }, extra);
  await refused(await call(owner, 'snapshot', { deviceId: device(owner), limit: 100 }, { limits }), 403, 'device_released');
});
test('production routes remain closed or anonymous-refusing and never expose fixture/key deletion endpoints', async () => {
  for (const path of ['/v1/push', '/v1/pull', '/v1/snapshot']) {
    await refused(await runtime.dispatchFetch(`https://sync.test${path}`, { method: 'POST' }), 401, 'invalid_token');
  }
  assert.equal((await runtime.dispatchFetch('https://sync.test/v1/erase', { method: 'POST' })).status, 404);
  await refused(await runtime.dispatchFetch('https://sync.test/v1/connect?token=fixture'), 400, 'invalid_query');
});
test('native sockets carry only cursor hints, auto-answer ping and close legally when a device is released', async () => {
  const owner = 'socket'; expiries.set(owner, Date.now() + 900_000);
  const response = await runtime.dispatchFetch('https://fixture.test/fixture-connect', { headers: { Upgrade: 'websocket',
    'x-fixture-owner': owner, 'x-fixture-device': device(owner), 'x-fixture-expiry': String(expiries.get(owner)) } });
  assert.equal(response.status, 101); const socket = response.webSocket; assert.ok(socket); socket.accept();
  function event(kind) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Socket ${kind} timed out`)), 5000);
      socket.addEventListener(kind, value => { clearTimeout(timeout); resolve(value); }, { once: true });
    });
  }
  const initial = JSON.parse((await event('message')).data);
  assert.equal(initial.kind, 'changes'); assert.equal(initial.cursor.sequence, 0);
  const pong = event('message'); socket.send('ping'); assert.equal((await pong).data, 'pong');
  const hint = event('message'); await push(owner, [setting(owner, 'vi')]);
  const data = JSON.parse((await hint).data); assert.deepEqual(Object.keys(data).sort(), ['cursor', 'kind']); assert.equal(data.kind, 'changes');
  const closed = event('close'); await ok(owner, 'release', { deviceId: device(owner), targetDeviceId: device(owner) });
  assert.equal((await closed).code, 1008);
});
test('actual persisted account wrapper rotates without rewriting the row ciphertext', async () => {
  const owner = 'rotation'; await push(owner, [setting(owner, 'en')]); const before = await ok(owner, 'inspect');
  const next = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const previous = JSON.parse(masters).keys[1];
  await runtime.dispose(); await start(JSON.stringify({ active: 2, keys: { 1: previous, 2: next } }));
  assert.equal((await snapshot(owner)).records[0].data.change.value, 'en');
  const rotated = await ok(owner, 'inspect'); assert.equal(JSON.parse(rotated.account[0].wrapped).version, 2);
  assert.equal(rotated.records[0].cipher, before.records[0].cipher);
  await runtime.dispose(); await start(JSON.stringify({ active: 2, keys: { 2: next } }));
  assert.equal((await snapshot(owner)).records[0].data.change.value, 'en');
});
