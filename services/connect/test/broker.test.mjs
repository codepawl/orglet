import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest, GOOGLE_TOKEN_URL, MAX_BODY_BYTES } from '../src/index.ts';

const FAKE_SECRET = 'fake-client-secret-for-tests';
const env = { GOOGLE_CLIENT_ID: 'public-id.apps.example', GOOGLE_REDIRECT_URI: 'http://127.0.0.1:53127/callback', GOOGLE_CLIENT_SECRET: FAKE_SECRET };

/** A stand-in for Google's token endpoint that records what it was sent. */
function fakeGoogle(status = 200, body = { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3599 }) {
  const calls = [];
  const fetchGoogle = async (url, init) => {
    calls.push({ url, method: init.method, form: new URLSearchParams(init.body), contentType: init.headers['content-type'] });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  };
  return { calls, fetchGoogle };
}

function tokenRequest(fields, options = {}) {
  const method = options.method ?? 'POST';
  return new Request(options.url ?? 'https://connect.test/google/token', {
    method,
    headers: { 'content-type': options.contentType ?? 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : (options.rawBody ?? new URLSearchParams(fields).toString()),
  });
}

const exchange = { grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verifier-1', redirect_uri: env.GOOGLE_REDIRECT_URI, client_id: env.GOOGLE_CLIENT_ID };
const refresh = { grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: env.GOOGLE_CLIENT_ID };

test('a code exchange gets the secret added and Google answers unchanged', async () => {
  const google = fakeGoogle();
  const response = await handleRequest(tokenRequest(exchange), env, google.fetchGoogle);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3599 });
  assert.equal(google.calls.length, 1);
  assert.equal(google.calls[0].url, GOOGLE_TOKEN_URL);
  assert.equal(google.calls[0].form.get('client_secret'), FAKE_SECRET);
  assert.equal(google.calls[0].form.get('code'), 'code-1');
  assert.equal(google.calls[0].form.get('code_verifier'), 'verifier-1');
  assert.equal(google.calls[0].form.get('redirect_uri'), env.GOOGLE_REDIRECT_URI);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('a refresh gets the secret added', async () => {
  const google = fakeGoogle(200, { access_token: 'access-2', token_type: 'Bearer', expires_in: 3599 });
  const response = await handleRequest(tokenRequest(refresh), env, google.fetchGoogle);
  assert.equal(response.status, 200);
  assert.equal(google.calls[0].form.get('grant_type'), 'refresh_token');
  assert.equal(google.calls[0].form.get('refresh_token'), 'refresh-1');
  assert.equal(google.calls[0].form.get('client_secret'), FAKE_SECRET);
});

test('Google error status and body pass through', async () => {
  const google = fakeGoogle(400, { error: 'invalid_grant', error_description: 'Bad Request' });
  const response = await handleRequest(tokenRequest(refresh), env, google.fetchGoogle);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_grant', error_description: 'Bad Request' });
});

test('a request that carries a client secret is refused before Google, and no answer holds the secret', async () => {
  const google = fakeGoogle();
  const response = await handleRequest(tokenRequest({ ...refresh, client_secret: 'attacker-chosen' }), env, google.fetchGoogle);
  assert.equal(response.status, 400);
  assert.equal(google.calls.length, 0);
  assert.equal((await response.text()).includes(FAKE_SECRET), false);
});

test('another client ID or redirect address is refused before Google', async () => {
  const google = fakeGoogle();
  const wrongClient = await handleRequest(tokenRequest({ ...refresh, client_id: 'someone-else' }), env, google.fetchGoogle);
  assert.equal(wrongClient.status, 400);
  const wrongRedirect = await handleRequest(tokenRequest({ ...exchange, redirect_uri: 'http://127.0.0.1:1234/callback' }), env, google.fetchGoogle);
  assert.equal(wrongRedirect.status, 400);
  const missingClient = await handleRequest(tokenRequest({ grant_type: 'refresh_token', refresh_token: 'r' }), env, google.fetchGoogle);
  assert.equal(missingClient.status, 400);
  assert.equal(google.calls.length, 0);
});

test('other grant types, missing fields and repeated fields are refused', async () => {
  const google = fakeGoogle();
  for (const fields of [
    { ...refresh, grant_type: 'client_credentials' },
    { grant_type: 'authorization_code', client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, code: 'c' },
    { grant_type: 'refresh_token', client_id: env.GOOGLE_CLIENT_ID },
  ]) {
    const response = await handleRequest(tokenRequest(fields), env, google.fetchGoogle);
    assert.equal(response.status, 400, JSON.stringify(fields));
  }
  const repeated = `${new URLSearchParams(refresh)}&refresh_token=second`;
  assert.equal((await handleRequest(tokenRequest({}, { rawBody: repeated }), env, google.fetchGoogle)).status, 400);
  assert.equal(google.calls.length, 0);
});

test('fields the broker does not know are not forwarded', async () => {
  const google = fakeGoogle();
  await handleRequest(tokenRequest({ ...refresh, resource: 'https://x.test', scope: 'everything' }), env, google.fetchGoogle);
  assert.deepEqual([...google.calls[0].form.keys()].sort(), ['client_id', 'client_secret', 'grant_type', 'refresh_token']);
});

test('only POST of a form on the token path is served', async () => {
  const google = fakeGoogle();
  assert.equal((await handleRequest(tokenRequest({}, { method: 'GET' }), env, google.fetchGoogle)).status, 405);
  assert.equal((await handleRequest(tokenRequest(refresh, { url: 'https://connect.test/other' }), env, google.fetchGoogle)).status, 404);
  assert.equal((await handleRequest(tokenRequest(refresh, { url: 'https://connect.test/' }), env, google.fetchGoogle)).status, 404);
  assert.equal((await handleRequest(tokenRequest(refresh, { contentType: 'application/json' }), env, google.fetchGoogle)).status, 415);
  assert.equal(google.calls.length, 0);
});

test('a body over the cap is refused', async () => {
  const google = fakeGoogle();
  const response = await handleRequest(tokenRequest({}, { rawBody: `refresh_token=${'a'.repeat(MAX_BODY_BYTES)}` }), env, google.fetchGoogle);
  assert.equal(response.status, 413);
  assert.equal(google.calls.length, 0);
});

test('an unreachable Google answers 502 without detail, and a missing secret answers 500', async () => {
  const failing = async () => { throw new Error('connection reset with a secret inside'); };
  const unreachable = await handleRequest(tokenRequest(refresh), env, failing);
  assert.equal(unreachable.status, 502);
  assert.equal((await unreachable.text()).includes('secret'), false);
  const unconfigured = await handleRequest(tokenRequest(refresh), { ...env, GOOGLE_CLIENT_SECRET: '' }, fakeGoogle().fetchGoogle);
  assert.equal(unconfigured.status, 500);
});
