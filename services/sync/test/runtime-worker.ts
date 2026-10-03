import { AccountSync as BaseAccountSync } from '../src/account-object';
import production, { SyncLifecycle } from '../src/index';
import type { Env, DurableObjectStub } from '../worker-configuration';
import type { SyncIdentity } from '../src/auth';
import type { SyncPushRequest } from '../../../apps/desktop/src/shared/sync-protocol';
import { z } from 'zod';

// This entry is bundled only by the native test. Production exports neither fixture routes nor inspection hooks.
class FixtureAccountSync extends BaseAccountSync {
  inspectFixture() {
    return Object.fromEntries(['account', 'records', 'changes', 'receipts', 'immutable_bodies', 'barriers', 'visibility', 'devices', 'revoked_grants', 'files', 'file_refs']
      .map(table => [table, this.ctx.storage.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray()]));
  }
  failFixture(enabled: boolean) {
    this.ctx.storage.sql.exec('DROP TRIGGER IF EXISTS reject_fixture_batch');
    if (enabled) this.ctx.storage.sql.exec("CREATE TRIGGER reject_fixture_batch BEFORE INSERT ON changes WHEN NEW.record_key='setting:theme' BEGIN SELECT RAISE(ABORT,'Injected fixture failure'); END");
  }
  ageFixture() { this.ctx.storage.sql.exec('UPDATE changes SET created_at=0'); }
  async maintainFixture() { await this.alarm(); }
  tamperFixture() {
    const row = this.ctx.storage.sql.exec<{ record_key: string; cipher: string }>('SELECT record_key,cipher FROM records LIMIT 1').one();
    const cipher = JSON.parse(row.cipher);
    const body = atob(cipher.body); cipher.body = btoa(String.fromCharCode(body.charCodeAt(0) ^ 1) + body.slice(1));
    this.ctx.storage.sql.exec('UPDATE records SET cipher=? WHERE record_key=?', JSON.stringify(cipher), row.record_key);
  }
}
export { FixtureAccountSync as AccountSync, SyncLifecycle };
type FixtureInput = { operation: string; owner: string; routeOwner?: string; device: string; grant?: string; expiresAt?: number;
  limits?: SyncIdentity['limits']; input?: unknown; enabled?: boolean };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === '/fixture-connect') {
      const owner = request.headers.get('x-fixture-owner')!;
      const device = request.headers.get('x-fixture-device')!;
      const identity: SyncIdentity = { subject: owner, grantId: request.headers.get('x-fixture-grant') ?? `fixture-${owner}`,
        expiresAt: Number(request.headers.get('x-fixture-expiry')), limits: { storageBytes: 5_000_000, devices: 3, historyDays: 90 } };
      return await env.SYNC_ACCOUNTS.getByName(JSON.stringify([env.SYNC_ISSUER, owner])).fetch('https://sync.internal/connect', { headers: {
        Upgrade: 'websocket', 'x-orglet-identity': JSON.stringify(identity), 'x-orglet-device': device,
      } }) as unknown as Response;
    }
    if (new URL(request.url).pathname !== '/fixture') return production.fetch(request, env);
    const input = await request.json() as FixtureInput;
    const identity: SyncIdentity = { subject: input.owner, grantId: input.grant ?? `fixture-${input.owner}`,
      expiresAt: input.expiresAt ?? Date.now() + 900_000,
      limits: input.limits ?? { storageBytes: 5_000_000, devices: 3, historyDays: 90 } };
    const name = JSON.stringify([env.SYNC_ISSUER, input.routeOwner ?? input.owner]);
    const stub = env.SYNC_ACCOUNTS.getByName(name) as unknown as DurableObjectStub<FixtureAccountSync>;
    try {
      if (input.operation === 'push') return Response.json(await stub.push(identity, input.input as z.infer<typeof SyncPushRequest>));
      if (input.operation === 'pull') return Response.json(await stub.pull(identity, input.input as Parameters<BaseAccountSync['pull']>[1]));
      if (input.operation === 'snapshot') return Response.json(await stub.snapshot(identity, input.input as Parameters<BaseAccountSync['snapshot']>[1]));
      if (input.operation === 'release') return Response.json(await stub.releaseDevice(identity, input.input as Parameters<BaseAccountSync['releaseDevice']>[1]));
      if (input.operation === 'putFile') {
        const file = input.input as { deviceId: string; sourceId: string; base64: string };
        const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
        return Response.json(await stub.putFile(identity, { deviceId: file.deviceId, sourceId: file.sourceId } as Parameters<BaseAccountSync['putFile']>[1], bytes.buffer));
      }
      if (input.operation === 'getFile') {
        const bytes = new Uint8Array(await stub.getFile(identity, input.input as Parameters<BaseAccountSync['getFile']>[1]));
        let text = '';
        for (const byte of bytes) text += String.fromCharCode(byte);
        return Response.json({ base64: btoa(text) });
      }
      if (input.operation === 'objects') return Response.json({ keys: (await env.SYNC_FILES.list()).objects.map(object => object.key) });
      if (input.operation === 'damage') {
        const key = (input.input as { key: string }).key;
        const bytes = new Uint8Array(await (await env.SYNC_FILES.get(key))!.arrayBuffer());
        bytes[bytes.length - 1] ^= 1;
        await env.SYNC_FILES.put(key, bytes);
        return new Response(null, { status: 204 });
      }
      // The identity service's two calls, made here straight on the object the entrypoint would reach.
      if (input.operation === 'lifecycleDelete') { await stub.eraseAccount(); return new Response(null, { status: 204 }); }
      if (input.operation === 'audit') return Response.json(await stub.auditLog());
      if (input.operation === 'lifecycleRevoke') { await stub.revokeGrant((input.input as { grantId: string }).grantId); return new Response(null, { status: 204 }); }
      if (input.operation === 'erase') { await stub.erase(identity); return new Response(null, { status: 204 }); }
      if (input.operation === 'inspect') return Response.json(await stub.inspectFixture());
      if (input.operation === 'fail') { await stub.failFixture(Boolean(input.enabled)); return new Response(null, { status: 204 }); }
      if (input.operation === 'age') { await stub.ageFixture(); await stub.maintainFixture(); return new Response(null, { status: 204 }); }
      if (input.operation === 'maintain') { await stub.maintainFixture(); return new Response(null, { status: 204 }); }
      if (input.operation === 'tamper') { await stub.tamperFixture(); return new Response(null, { status: 204 }); }
      return new Response(null, { status: 404 });
    } catch (failure) {
      const value = failure as { name?: string; code?: string; status?: number };
      return Response.json({ code: value.name === 'SyncOperationError' ? value.code : 'fixture_failed' },
        { status: value.name === 'SyncOperationError' ? value.status : 503 });
    }
  },
};
