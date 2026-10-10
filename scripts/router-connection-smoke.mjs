// Manual smoke for the CodePawl router connection (issue 532), end to end on this computer: the real router Worker
// under `wrangler dev`, a stand-in accounts service that signs real tokens, a stand-in inference provider, and the
// packaged app. It needs the router's repository beside this one, so it is not part of CI:
//   ROUTER_REPO=C:\path\to\router node scripts/router-connection-smoke.mjs
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { label, useEnglish, openSettings } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const routerRepository = process.env.ROUTER_REPO;
if (!routerRepository) throw new Error('Set ROUTER_REPO to the folder of the router repository.');
const ROUTER_AUDIENCE = 'https://router.codepawl.com';
const UPSTREAM_ANSWER = 'The router relayed this answer from the stand-in provider.';
const directory = await mkdtemp(join(tmpdir(), 'orglet-router-'));
await mkdir('test-results', { recursive: true });

function listen(server) {
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server.address().port)));
}

function readBody(request) {
  return new Promise(done => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { text += chunk; });
    request.on('end', () => done(text));
  });
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

// The accounts service: any code signs in; a token asked for the router's resource is a real EdDSA token.
const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const publicJwk = { ...await exportJWK(publicKey), kid: 'smoke', alg: 'EdDSA', use: 'sig' };
let accountsUrl = '';
const tokenRequests = [];
const accounts = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url.startsWith('/api/auth/jwks')) return sendJson(response, { keys: [publicJwk] });
  if (request.method === 'GET' && request.url.startsWith('/me')) return sendJson(response, { id: 'smoke', email: 'an@example.com', name: 'An Nguyen', plan: 'free' });
  if (request.method === 'POST' && request.url.startsWith('/api/auth/oauth2/token')) {
    const form = new URLSearchParams(await readBody(request));
    tokenRequests.push({ grant: form.get('grant_type'), resource: form.getAll('resource'), scope: form.get('scope') });
    let accessToken = 'smoke-access';
    if (form.getAll('resource').includes(ROUTER_AUDIENCE)) {
      const now = Math.floor(Date.now() / 1000);
      accessToken = await new SignJWT({ azp: 'orglet-desktop', scope: 'router:manage' })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'smoke' })
        .setIssuer(`${accountsUrl}/api/auth`).setAudience(ROUTER_AUDIENCE).setSubject('smoke-account')
        .setIssuedAt(now).setExpirationTime(now + 600).sign(privateKey);
    }
    return sendJson(response, { access_token: accessToken, refresh_token: 'smoke-refresh', expires_in: 600, token_type: 'Bearer' });
  }
  if (request.method === 'POST') return sendJson(response, {});
  response.writeHead(404);
  response.end();
});
accountsUrl = `http://127.0.0.1:${await listen(accounts)}`;

// The inference provider: one streamed answer with a final usage chunk, and the key it was called with.
const upstreamCalls = [];
const upstream = createServer(async (request, response) => {
  const body = JSON.parse(await readBody(request) || '{}');
  upstreamCalls.push({ url: request.url, authorization: request.headers.authorization, model: body.model, stream: body.stream, toolChoice: body.tool_choice, tools: (body.tools ?? []).map(tool => ({ name: tool.function?.name, parameters: tool.function?.parameters })) });
  // An orglet answers by calling its `reply` tool, so the stand-in answers the way a model does.
  const replyCall = { index: 0, id: 'call_reply', type: 'function', function: { name: 'reply', arguments: JSON.stringify({ message: UPSTREAM_ANSWER, title: null, knowledgeProposals: [] }) } };
  const usage = { prompt_tokens: 21, completion_tokens: 11, total_tokens: 32 };
  if (!body.stream) {
    return sendJson(response, { id: 'smoke', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [replyCall] }, finish_reason: 'tool_calls' }], usage });
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = payload => `data: ${JSON.stringify(payload)}\n\n`;
  const chunk = (delta, finish) => event({ id: 'smoke', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
  response.write(chunk({ role: 'assistant', tool_calls: [replyCall] }));
  response.write(chunk({}, 'tool_calls'));
  response.write(event({ id: 'smoke', object: 'chat.completion.chunk', model: body.model, choices: [], usage }));
  response.end('data: [DONE]\n\n');
});
const upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`;

// The real router, local: its own code, its own Durable Objects, configured for the two stand-ins.
const catalog = { models: [{ id: 'smoke-free', free: true, published: { inputMicrosPerMillion: 100_000, outputMicrosPerMillion: 400_000 }, upstreams: [{ name: 'stand-in', baseUrl: `${upstreamUrl}/v1`, model: 'stand-in-model', secret: 'UPSTREAM_STANDIN', price: { inputMicrosPerMillion: 75_000, outputMicrosPerMillion: 300_000 } }] }] };
const environmentFile = join(directory, 'router.env');
await writeFile(environmentFile, [
  `ROUTER_ISSUER=${accountsUrl}/api/auth`,
  `ROUTER_AUDIENCE=${ROUTER_AUDIENCE}`,
  `ROUTER_CATALOG='${JSON.stringify(catalog)}'`,
  'UPSTREAM_STANDIN=standin-upstream-key',
  '',
].join('\n'));
const routerPort = await listen(createServer()).then(port => port + 1);
const router = spawn(process.execPath, [join(routerRepository, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--port', String(routerPort), '--ip', '127.0.0.1', '--env-file', environmentFile, '--persist-to', join(directory, 'router-state')], { cwd: routerRepository, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let routerLog = '';
router.stdout.on('data', chunk => { routerLog += chunk; });
router.stderr.on('data', chunk => { routerLog += chunk; });
const routerUrl = `http://127.0.0.1:${routerPort}`;

async function waitForRouter() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await fetch(`${routerUrl}/health`);
      if (health.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error(`The router did not start:\n${routerLog.slice(-2000)}`);
}

async function routerKeys() {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ azp: 'orglet-desktop', scope: 'router:manage' }).setProtectedHeader({ alg: 'EdDSA', kid: 'smoke' })
    .setIssuer(`${accountsUrl}/api/auth`).setAudience(ROUTER_AUDIENCE).setSubject('smoke-account').setIssuedAt(now).setExpirationTime(now + 600).sign(privateKey);
  const answer = await fetch(`${routerUrl}/v1/keys`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(answer.status, 200, 'the router accepts the stand-in account token');
  const body = await answer.json();
  return body.keys ?? body.data ?? body;
}

let app;
try {
  await waitForRouter();
  const env = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_ACCOUNTS_URL: accountsUrl, ORGLET_ROUTER_URL: routerUrl, ORGLET_SYNC_URL: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${join(directory, 'profile')}`], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useEnglish(page);

  assert.equal((await page.evaluate(() => window.orglet.codepawlState())).status, 'signed_out', 'with a router and no account the connection waits for a sign-in');

  // Sign in through the real flow with the browser left out: the callback comes straight back.
  await app.evaluate(({ app: electronApp, shell }) => {
    shell.openExternal = async address => {
      const state = new URL(address).searchParams.get('state');
      const redirect = new URL(address).searchParams.get('redirect_uri');
      if (redirect && redirect.startsWith('http://127.0.0.1')) {
        setTimeout(() => { void fetch(`${redirect}?code=smoke&state=${state}`).catch(() => undefined); }, 50);
        return;
      }
      const argv = [process.execPath, `com.codepawl.orglet://auth/callback?code=smoke&state=${state}`];
      setTimeout(() => electronApp.emit('second-instance', { preventDefault() {} }, argv, process.cwd(), { argv }), 50);
    };
  });
  await page.evaluate(() => window.orglet.accountSignIn());
  assert.equal((await page.evaluate(() => window.orglet.codepawlState())).status, 'ready', 'signed in, the connection can be made');

  const connected = await page.evaluate(() => window.orglet.codepawlConnect());
  console.log('connect:', JSON.stringify(connected));
  assert.equal((await page.evaluate(() => window.orglet.codepawlState())).status, 'connected');
  assert.equal(JSON.stringify(await page.evaluate(() => window.orglet.codepawlState())).includes('cpr_'), false, 'the window never receives the key');
  await page.evaluate(() => window.orglet.codepawlConnect());
  assert.equal((await routerKeys()).length, 1, 'connecting twice makes one key at the router');

  // An orglet on the router's free model answers through the router.
  const workspace = await page.evaluate(() => window.orglet.call('workspace', {}));
  const models = await page.evaluate(() => window.orglet.call('modelList', { provider: 'codepawl' })).catch(error => ({ error: String(error) }));
  console.log('model list:', JSON.stringify(models).slice(0, 300));
  await page.evaluate(worker => window.orglet.call('saveWorker', { ...worker, provider: 'codepawl', modelId: 'smoke-free', expectedRevision: worker.revision }), workspace.workers[0]);
  const box = page.getByRole('textbox', { name: label('Tin nhắn') });
  await box.fill('Say one sentence.');
  await box.press('Enter');
  const answer = page.locator('.main-pane .assistant-message').first();
  await answer.waitFor({ timeout: 60000 });
  await page.waitForFunction(text => document.querySelector('.main-pane .assistant-message')?.textContent?.includes(text), 'stand-in provider', { timeout: 60000 }).catch(() => undefined);
  console.log('answer:', (await answer.innerText()).slice(0, 300).replace(/\n/g, ' | '));
  await page.screenshot({ path: 'test-results/router-answer.png' });
  assert.ok((await answer.innerText()).includes('stand-in provider'), 'the answer came through the router from the provider');
  assert.equal(upstreamCalls.at(-1)?.authorization, 'Bearer standin-upstream-key', 'the provider is called with the router\'s key, not the person\'s');
  assert.equal(upstreamCalls.at(-1)?.model, 'stand-in-model', 'the router sends the provider its own model name');

  const usage = await page.evaluate(() => window.orglet.codepawlUsage());
  console.log('usage:', JSON.stringify(usage));

  await openSettings(page);
  await page.getByRole('tab', { name: label('Kết nối API'), exact: true }).click();
  await page.getByRole('dialog').evaluate(dialog => { for (const element of dialog.querySelectorAll('*')) if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/router-settings.png' });
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.orglet.codepawlDisconnect());
  assert.equal((await page.evaluate(() => window.orglet.codepawlState())).status, 'ready', 'disconnected, the account is still signed in');
  assert.equal((await routerKeys()).filter(key => !key.revokedAt && !key.revoked).length, 0, 'disconnect revokes the key at the router');

  console.log('token requests:', JSON.stringify(tokenRequests));
  console.log(JSON.stringify({ result: 'passed' }));
} finally {
  await app?.close().catch(() => undefined);
  router.kill();
  accounts.close();
  upstream.close();
}
process.exit(0);
