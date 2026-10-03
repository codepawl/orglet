import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type SyncAuthConfig = { SYNC_ISSUER: string; SYNC_AUDIENCE: string };
export type SyncIdentity = { subject: string; grantId: string; expiresAt: number;
  limits: { storageBytes: number; devices: number; historyDays: number } };
export type Authentication = { ok: true; identity: SyncIdentity } | { ok: false; response: Response };
let cached: { url: string; keys: JWTVerifyGetKey } | undefined;

export function identityConfiguration(config: SyncAuthConfig): { issuer: string; audience: string; jwks: string } {
  const issuer = new URL(config.SYNC_ISSUER);
  const audience = new URL(config.SYNC_AUDIENCE);
  for (const url of [issuer, audience]) {
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' && url.pathname.endsWith('/')) {
      throw new Error('Invalid sync identity configuration');
    }
  }
  const issuerText = issuer.href.replace(/\/$/, '');
  return { issuer: issuerText, audience: audience.href.replace(/\/$/, ''), jwks: `${issuerText}/jwks` };
}
function refused(): Authentication {
  return { ok: false, response: Response.json({ code: 'invalid_token' }, { status: 401,
    headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer error="invalid_token"' } }) };
}
function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** Owner and limits come exclusively from the verified Accounts token, never from the body or device label. */
export async function verifySyncIdentity(request: Request, config: SyncAuthConfig, providedKeys?: JWTVerifyGetKey): Promise<Authentication> {
  const authorization = request.headers.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/i);
  if (!authorization) return refused();
  const trusted = identityConfiguration(config);
  let keys = providedKeys;
  if (!keys) {
    if (cached?.url !== trusted.jwks) cached = { url: trusted.jwks, keys: createRemoteJWKSet(new URL(trusted.jwks)) };
    keys = cached.keys;
  }
  try {
    const { payload } = await jwtVerify(authorization[1], keys, { issuer: trusted.issuer, audience: trusted.audience,
      algorithms: ['EdDSA'], requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp'] });
    const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
    if (!audiences?.length || audiences.some(value => value !== trusted.audience && value !== `${trusted.issuer}/oauth2/userinfo`)
      || payload.azp !== 'orglet-desktop' || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 200
      || typeof payload.orglet_grant_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.orglet_grant_id)
      || !integer(payload.exp, Number.MAX_SAFE_INTEGER) || !integer(payload.iat, Number.MAX_SAFE_INTEGER)
      || payload.iat > Math.floor(Date.now() / 1000) + 60 || payload.exp <= payload.iat || payload.exp - payload.iat > 900) return refused();
    const scopes = new Set(typeof payload.scope === 'string' ? payload.scope.split(' ') : []);
    if (['openid', 'profile', 'email', 'offline_access'].some(scope => !scopes.has(scope))) return refused();
    const input = payload.entitlements;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return refused();
    const limits = input as Record<string, unknown>;
    if (!integer(limits.syncStorageMb, 100_000) || !integer(limits.devices, 1000) || !integer(limits.historyDays, 36_500)) return refused();
    return { ok: true, identity: { subject: payload.sub, grantId: payload.orglet_grant_id, expiresAt: payload.exp * 1000,
      limits: { storageBytes: limits.syncStorageMb * 1_000_000, devices: limits.devices, historyDays: limits.historyDays } } };
  } catch {
    return refused();
  }
}
