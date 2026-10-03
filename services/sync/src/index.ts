import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../worker-configuration';
import { AccountSync, SyncOperationError } from './account-object';
import { identityConfiguration, verifySyncIdentity } from './auth';
import { SyncPushRequest, SyncPullRequest, SyncSnapshotRequest, SyncReleaseDeviceRequest, SYNC_BATCH_BYTES, SYNC_FILE_BYTES } from '../../../apps/desktop/src/shared/sync-protocol';
import { SyncDeviceId } from '../../../apps/desktop/src/shared/sync';

export { AccountSync };

/**
 * What the identity service may ask of sync, through a service binding only: this class has no route, so nothing on
 * the internet reaches it, and a sync access token cannot call it. The subject comes from the identity service's own
 * session, never from a request body a client wrote. Both calls are safe to repeat after a failure.
 */
export class SyncLifecycle extends WorkerEntrypoint<Env> {
  private account(subject: string) {
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) throw new SyncOperationError('invalid_request', 400);
    return this.env.SYNC_ACCOUNTS.getByName(JSON.stringify([identityConfiguration(this.env).issuer, subject]));
  }
  /** Removes the account's records, key and files, and leaves the marker that keeps a live token from recreating it. */
  async deleteAccount(subject: string): Promise<{ deleted: true }> {
    await this.account(subject).eraseAccount();
    return { deleted: true };
  }
  /** One sign-in was revoked at the identity service: that device stops syncing at once, not when its token ends. */
  async revokeDevice(subject: string, grantId: string): Promise<{ revoked: true }> {
    await this.account(subject).revokeGrant(grantId);
    return { revoked: true };
  }
}
const encoder = new TextEncoder();
function error(code: string, status: number): Response {
  return Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function operationFailure(failure: unknown): { code: string; status: number } | undefined {
  if (!failure || typeof failure !== 'object') return;
  const value = failure as Record<string, unknown>;
  // Workers RPC preserves serializable fields, but cannot preserve a custom Error prototype.
  if (value.name === 'SyncOperationError' && typeof value.code === 'string' && /^[a-z_]{1,64}$/.test(value.code)
    && typeof value.status === 'number' && Number.isSafeInteger(value.status) && value.status >= 400 && value.status <= 599) {
    return { code: value.code, status: value.status };
  }
}
async function readBytes(request: Request, type: string, limit: number, tooLarge: string): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new SyncOperationError(tooLarge, 413);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type) throw new SyncOperationError('invalid_content_type', 415);
  if (!request.body) throw new SyncOperationError('invalid_body', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new SyncOperationError(tooLarge, 413); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (failure) {
    if (failure instanceof SyncOperationError) throw failure;
    throw new SyncOperationError('invalid_body', 400);
  } finally { reader.releaseLock(); }
}
async function readBody(request: Request): Promise<unknown> {
  const bytes = await readBytes(request, 'application/json', SYNC_BATCH_BYTES, 'batch_too_large');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new SyncOperationError('invalid_body', 400); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ service: 'orglet-sync', enabled: env.SYNC_ENABLED === 'true' },
      { headers: { 'Cache-Control': 'no-store' } });
    const path = url.pathname;
    // A file is named by its source's id; the id is not a secret and the bearer token stays in its header.
    const file = /^\/v1\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path);
    if (!file && !['/v1/push', '/v1/pull', '/v1/snapshot', '/v1/devices/release', '/v1/connect'].includes(path)) return error('not_found', 404);
    if (file ? request.method !== 'PUT' && request.method !== 'GET' : request.method !== (path === '/v1/connect' ? 'GET' : 'POST')) return error('method_not_allowed', 405);
    // No bearer token, owner or private content is accepted through URL parameters.
    if (url.search) return error('invalid_query', 400);
    if (env.SYNC_ENABLED !== 'true') return error('sync_disabled', 503);
    try {
      const auth = await verifySyncIdentity(request, env);
      if (!auth.ok) return auth.response;
      const identity = auth.identity;
      const account = JSON.stringify([identityConfiguration(env).issuer, identity.subject]);
      if (encoder.encode(account).byteLength > 2048) return error('invalid_token', 401);
      const stub = env.SYNC_ACCOUNTS.getByName(account);
      if (path === '/v1/connect') {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error('websocket_required', 426);
        const device = SyncDeviceId.safeParse(request.headers.get('x-orglet-device'));
        if (!device.success) return error('invalid_device', 400);
        // Only the binding uses Worker-specific Response types; do not add Worker globals to Electron.
        return await stub.fetch('https://sync.internal/connect', { headers: {
          Upgrade: 'websocket', 'x-orglet-identity': JSON.stringify(identity), 'x-orglet-device': device.data,
        } }) as unknown as Response;
      }
      if (file) {
        const device = SyncDeviceId.safeParse(request.headers.get('x-orglet-device'));
        if (!device.success) return error('invalid_device', 400);
        const input = { deviceId: device.data, sourceId: file[1] };
        if (request.method === 'GET') return new Response(await stub.getFile(identity, input),
          { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
        const bytes = await readBytes(request, 'application/octet-stream', SYNC_FILE_BYTES, 'file_too_large');
        return Response.json(await stub.putFile(identity, input, bytes.buffer), { headers: { 'Cache-Control': 'no-store' } });
      }
      const body = await readBody(request);
      if (path === '/v1/push') {
        const input = SyncPushRequest.safeParse(body);
        if (!input.success) return error('invalid_batch', 400);
        return Response.json(await stub.push(identity, input.data), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (path === '/v1/pull') {
        const input = SyncPullRequest.safeParse(body);
        if (!input.success) return error('invalid_cursor', 400);
        return Response.json(await stub.pull(identity, input.data), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (path === '/v1/snapshot') {
        const input = SyncSnapshotRequest.safeParse(body);
        if (!input.success) return error('invalid_cursor', 400);
        return Response.json(await stub.snapshot(identity, input.data), { headers: { 'Cache-Control': 'no-store' } });
      }
      const input = SyncReleaseDeviceRequest.safeParse(body);
      if (!input.success) return error('invalid_device', 400);
      await stub.releaseDevice(identity, input.data);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    } catch (failure) {
      const refused = operationFailure(failure);
      if (refused) return error(refused.code, refused.status);
      // SQL, JWT and crypto diagnostics can contain account data; retain no raw error text in logs or responses.
      return error('sync_unavailable', 503);
    }
  },
};
