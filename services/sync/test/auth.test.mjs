import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { identityConfiguration, verifySyncIdentity } from '../src/auth.ts';

const config = { SYNC_ISSUER: 'https://issuer.test/api/auth', SYNC_AUDIENCE: 'https://sync.test/v1' };
const pair = await generateKeyPair('EdDSA');
const now = Math.floor(Date.now() / 1000);
const claims = { iss: config.SYNC_ISSUER, aud: config.SYNC_AUDIENCE, sub: 'fixture-owner', azp: 'orglet-desktop',
  iat: now, exp: now + 900, orglet_grant_id: 'fixture-grant', scope: 'openid profile email offline_access',
  entitlements: { syncStorageMb: 5, devices: 3, historyDays: 90, push: false } };
async function verify(changes = {}, signingPair = pair) {
  const jwt = await new SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: 'EdDSA' }).sign(signingPair.privateKey);
  return verifySyncIdentity(new Request('https://sync.test/v1/push', { headers: { authorization: `Bearer ${jwt}` } }), config, async () => pair.publicKey);
}
test('actual EdDSA verification projects signed owner/limits; free push:false still permits replication', async () => {
  const result = await verify({ aud: [config.SYNC_AUDIENCE, `${config.SYNC_ISSUER}/oauth2/userinfo`] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.identity, { subject: 'fixture-owner', grantId: 'fixture-grant', expiresAt: (now + 900) * 1000,
    limits: { storageBytes: 5_000_000, devices: 3, historyDays: 90 } });
});
test('wrong issuer/audience/client/key, expired/future token, missing family/scope and invalid entitlements fail closed', async () => {
  for (const changed of [{ iss: 'https://wrong.test' }, { aud: 'https://market.test' },
    { aud: [config.SYNC_AUDIENCE, 'https://other.test'] }, { azp: 'other-client' }, { exp: now - 1 },
    { iat: now + 100 }, { exp: now + 901 }, { sub: '' }, { orglet_grant_id: undefined }, { scope: 'openid' },
    { entitlements: { ...claims.entitlements, devices: -1 } }, { entitlements: { ...claims.entitlements, syncStorageMb: 1.5 } }]) {
    const result = await verify(changed); assert.equal(result.ok, false, JSON.stringify(changed)); assert.equal(result.response.status, 401);
  }
  assert.equal((await verify({}, await generateKeyPair('EdDSA'))).ok, false);
  assert.equal((await verifySyncIdentity(new Request('https://sync.test'), config)).ok, false);
});
test('self-host identity configuration accepts only canonical HTTPS resource URLs', () => {
  assert.deepEqual(identityConfiguration(config), { issuer: config.SYNC_ISSUER, audience: config.SYNC_AUDIENCE, jwks: `${config.SYNC_ISSUER}/jwks` });
  assert.equal(identityConfiguration({ ...config, SYNC_AUDIENCE: 'https://sync.orglet.codepawl.com' }).audience, 'https://sync.orglet.codepawl.com');
  for (const url of ['http://issuer.test/api/auth', 'https://name:password@issuer.test/api/auth', 'https://issuer.test/api/auth?token=x', 'https://issuer.test/api/auth/']) {
    assert.throws(() => identityConfiguration({ ...config, SYNC_ISSUER: url }));
  }
});
