import { beforeAll, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { verifyMarketIdentity } from '../../services/market/src/auth';

const issuer = 'https://accounts.codepawl.com/api/auth';
const audience = 'https://market.orglet.codepawl.com';
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const generated = await generateKeyPair('EdDSA');
  privateKey = generated.privateKey;
  const publicKey = await exportJWK(generated.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...publicKey, kid: 'fixture-key', alg: 'EdDSA', use: 'sig' }] });
});

async function token(changes: JWTPayload = {}, signingKey = privateKey) {
  return new SignJWT({
    iss: issuer, aud: audience, sub: 'fixture-subject', azp: 'orglet-desktop',
    scope: 'openid profile email offline_access', email_verified: true, name: 'Fixture Person',
    orglet_grant_id: 'fixture-family', entitlements: { publishedListings: 10 },
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900,
    ...changes,
  }).setProtectedHeader({ alg: 'EdDSA', kid: 'fixture-key' }).sign(signingKey);
}

async function verify(value: string) {
  return verifyMarketIdentity(new Request('https://market.orglet.codepawl.com/private-fixture', {
    headers: { authorization: `Bearer ${value}` },
  }), keys);
}

it('verifies a signed market identity without exposing bearer or private account fields', async () => {
  expect(await verify(await token())).toEqual({ ok: true, identity: {
    subject: 'fixture-subject', grantId: 'fixture-family', displayName: 'Fixture Person', publishedListings: 10,
  } });
  expect((await verify(await token({ aud: [audience, `${issuer}/oauth2/userinfo`] }))).ok).toBe(true);
});

it.each([
  { iss: 'https://wrong.example.test/api/auth' },
  { aud: 'https://sync.orglet.codepawl.com' },
  { aud: [audience, 'https://sync.orglet.codepawl.com'] },
  { aud: [audience, 'https://other.example.test'] },
  { sub: '' }, { azp: 'other-client' }, { scope: 'openid profile' },
  { email_verified: false }, { email_verified: 'true' },
  { name: '' }, { name: 'x'.repeat(81) }, { name: 'Unsafe\nName' },
  { orglet_grant_id: '' }, { orglet_grant_id: 'x'.repeat(201) },
  { entitlements: {} }, { entitlements: { publishedListings: -1 } },
  { entitlements: { publishedListings: 1.5 } }, { entitlements: { publishedListings: '10' } },
  { entitlements: { publishedListings: 11 } }, { exp: 1 }, { exp: undefined },
])('refuses invalid signed authority or metadata %#', async changes => {
  const result = await verify(await token(changes));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(401);
    expect(await result.response.text()).toBe('Invalid account token');
  }
});

it('refuses unsigned and wrong-key tokens and missing bearer without reflecting raw values', async () => {
  const other = await generateKeyPair('EdDSA');
  expect((await verify(await token({}, other.privateKey))).ok).toBe(false);
  expect((await verify('unsigned-fixture')).ok).toBe(false);
  expect((await verifyMarketIdentity(new Request('https://market.orglet.codepawl.com/private-fixture'), keys)).ok).toBe(false);
});
