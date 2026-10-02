import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const ISSUER = 'https://accounts.codepawl.com/api/auth';
const AUDIENCE = 'https://market.orglet.codepawl.com';
const USERINFO_AUDIENCE = `${ISSUER}/oauth2/userinfo`;
const requiredScopes = ['openid', 'profile', 'email', 'offline_access'];
const trustedKeys = createRemoteJWKSet(new URL(`${ISSUER}/jwks`));

export type MarketIdentity = {
  subject: string;
  grantId: string;
  displayName: string;
  publishedListings: number;
};
export type MarketAuthentication = { ok: true; identity: MarketIdentity } | { ok: false; response: Response };

/** Read routes stay anonymous. Future authenticated handlers call this fixed issuer/resource verifier. */
export async function verifyMarketIdentity(request: Request, keys: JWTVerifyGetKey = trustedKeys): Promise<MarketAuthentication> {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s]{1,8192})$/i);
  if (!match) return refused();
  try {
    const { payload } = await jwtVerify(match[1], keys, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ['EdDSA'],
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
    });
    const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
    if (!audiences?.length || audiences.some(audience => audience !== AUDIENCE && audience !== USERINFO_AUDIENCE)) return refused();
    if (payload.azp !== 'orglet-desktop' || payload.email_verified !== true) return refused();
    if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 200) return refused();
    if (typeof payload.orglet_grant_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.orglet_grant_id)) return refused();
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 80 || /[\x00-\x1f\x7f]/.test(payload.name)) return refused();
    const scopes = typeof payload.scope === 'string' ? new Set(payload.scope.split(' ')) : new Set<string>();
    if (requiredScopes.some(scope => !scopes.has(scope))) return refused();
    const entitlements = payload.entitlements;
    const cap = entitlements && typeof entitlements === 'object' && !Array.isArray(entitlements)
      ? (entitlements as Record<string, unknown>).publishedListings : undefined;
    if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap < 0 || cap > 10) return refused();
    return { ok: true, identity: { subject: payload.sub, grantId: payload.orglet_grant_id, displayName: payload.name.trim(), publishedListings: cap } };
  } catch {
    return refused();
  }
}

function refused(): MarketAuthentication {
  return { ok: false, response: new Response('Invalid account token', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer error="invalid_token"' },
  }) };
}
