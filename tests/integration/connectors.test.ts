import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { McpServers } from '../../apps/desktop/src/core/tools/mcp';
import { GOOGLE_SIGN_IN_NEEDED, type GoogleFetch } from '../../apps/desktop/src/core/tools/google-api';
import { GOOGLE_LEGACY_SERVER_URLS, GOOGLE_SCOPES, GOOGLE_TOOLS_URL } from '../../apps/desktop/src/shared/google-tools';
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import { ConnectorClientStore } from '../../apps/desktop/src/main/connector-clients';
import { McpSignIns, MCP_SIGN_IN_NEEDS_CLIENT, MCP_SIGN_IN_PORT_BUSY, type GoogleServerTarget } from '../../apps/desktop/src/main/mcp-sign-in';
import { mcpCallGranted, emptyMcpSecrets, McpOAuthState, McpSecrets, McpServer, McpServerDraft, splitMcpDraft, type McpPreregisteredClient } from '../../apps/desktop/src/shared/mcp';
import {
  catalogAppOf, catalogDraft, connectBaseUrl, GOOGLE_APPS, GOOGLE_BROKER_TOKEN_ENDPOINT, GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GOOGLE_UNION_SCOPES, MCP_CATALOG,
} from '../../apps/desktop/src/shared/mcp-catalog';

/**
 * A service that signs in the way Google's Workspace servers do (measured against their documentation, 2026-10-15): no
 * dynamic registration, a client ID and secret made in advance, an exact redirect address, a refresh token only when
 * the request asks for offline access, and a refresh answer that carries no new refresh token. The fake keeps the
 * authorization server and the MCP endpoint at one address.
 */
const FAKE_SECRET = 'fake-client-secret-for-tests';
const FAKE_CLIENT_ID = 'fake-client-id.apps.example';
const SCOPES = ['https://www.example.test/auth/one', 'https://www.example.test/auth/two'];

type Service = {
  base: string;
  validAccess: Set<string>;
  authorizeRequests: URLSearchParams[];
  tokenRequests: { form: URLSearchParams; authorization: string | undefined }[];
  close: () => Promise<void>;
};

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

async function startService(): Promise<Service> {
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const refreshTokens = new Set<string>();
  let counter = 0;
  const service = { validAccess: new Set<string>(), authorizeRequests: [], tokenRequests: [] } as unknown as Service;
  const mcp = () => {
    const server = new Server({ name: 'fake-workspace', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'read_sheet', description: 'Reads a sheet.', inputSchema: { type: 'object', properties: {} } }] }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'rows' }] }));
    return server;
  };
  const http: HttpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', service.base);
    // The resource metadata exists, as Google's does, so the SDK would send `resource` unless told not to.
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(response, 200, { resource: `${service.base}/mcp`, authorization_servers: [service.base] });
    if (url.pathname === '/auth') {
      service.authorizeRequests.push(url.searchParams);
      const code = `code-${++counter}`;
      const redirectUri = url.searchParams.get('redirect_uri')!;
      codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirectUri });
      response.writeHead(302, { location: `${redirectUri}?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}` }).end();
      return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await body(request));
      const authorization = request.headers.authorization;
      service.tokenRequests.push({ form, authorization });
      const basic = authorization === `Basic ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_SECRET}`).toString('base64')}`;
      const posted = [FAKE_CLIENT_ID, GOOGLE_CLIENT_ID].includes(form.get('client_id') ?? '') && form.get('client_secret') === FAKE_SECRET;
      if (!basic && !posted) return json(response, 401, { error: 'invalid_client' });
      if (form.get('resource')) return json(response, 400, { error: 'invalid_request', error_description: 'Parameter not allowed for this message type: resource' });
      const access = `access-${++counter}`;
      service.validAccess.add(access);
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!pending || pending.challenge !== challenge || pending.redirectUri !== form.get('redirect_uri')) return json(response, 400, { error: 'invalid_grant' });
        refreshTokens.add('refresh-1');
        return json(response, 200, { access_token: access, refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600 });
      }
      if (form.get('grant_type') === 'refresh_token' && refreshTokens.has(form.get('refresh_token') ?? '')) {
        return json(response, 200, { access_token: access, token_type: 'Bearer', expires_in: 3600 });
      }
      return json(response, 400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/mcp') {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
      if (!token || !service.validAccess.has(token)) {
        response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${service.base}/.well-known/oauth-protected-resource/mcp"` }).end();
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp().connect(transport);
      const text = request.method === 'POST' ? await body(request) : '';
      await transport.handleRequest(request, response, text ? JSON.parse(text) : undefined);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  service.base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  service.close = () => new Promise(resolve => { http.closeAllConnections(); http.close(() => resolve()); });
  return service;
}

/**
 * CodePawl's token broker as services/connect behaves: the app's token request must carry no client secret and
 * CodePawl's public client ID; the broker adds the secret and forwards to the service's token endpoint.
 */
async function startBroker(serviceBase: string) {
  const fromApp: URLSearchParams[] = [];
  const http: HttpServer = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/google/token') {
      response.writeHead(404).end();
      return;
    }
    const form = new URLSearchParams(await body(request));
    fromApp.push(new URLSearchParams(form));
    if (form.has('client_secret') || form.get('client_id') !== GOOGLE_CLIENT_ID) return json(response, 400, { error: 'invalid_request' });
    form.set('client_secret', FAKE_SECRET);
    const upstream = await fetch(`${serviceBase}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(await upstream.text());
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const close = () => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()); });
  return { base, fromApp, close };
}

async function browser(url: string) {
  const authorize = await fetch(url, { redirect: 'manual' });
  const location = authorize.headers.get('location');
  if (location) await fetch(location);
}

async function freePort() {
  const probe = createSocketServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

let directory: string;
let store: Store;
let service: Service;
let servers: McpServers | undefined;
let secrets: Map<string, McpSecrets>;
let shared: { clientId: string; clientSecret?: string } | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-connectors-'));
  store = new Store(join(directory, 'state.sqlite'));
  service = await startService();
  secrets = new Map();
  shared = undefined;
});

afterEach(async () => {
  await servers?.shutdown();
  servers = undefined;
  store.close();
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

function signIns() {
  return new McpSignIns({
    readSecrets: async serverId => secrets.get(serverId) ?? emptyMcpSecrets(),
    saveSecrets: async (serverId, values) => { secrets.set(serverId, values); },
    readSharedClient: async () => shared,
    openExternal: browser,
  });
}

function core(googleFetch?: GoogleFetch) {
  return new McpServers(store, () => {}, {
    ...(googleFetch ? { googleFetch } : {}),
    readSecrets: async serverId => secrets.get(serverId) ?? emptyMcpSecrets(),
    saveSignIn: (serverId, state) => {
      secrets.set(serverId, { ...(secrets.get(serverId) ?? emptyMcpSecrets()), oauth: state });
    },
  });
}

function clientAt(port: number, overrides: Partial<McpPreregisteredClient> = {}): McpPreregisteredClient {
  return {
    clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET, scopes: SCOPES, port,
    authorizationEndpoint: `${service.base}/auth`, tokenEndpoint: `${service.base}/token`,
    authorizationParameters: { access_type: 'offline', prompt: 'consent' },
    ...overrides,
  };
}

async function addServer(target: McpServers, oauthClient: McpPreregisteredClient) {
  const serverId = id();
  const draft = McpServerDraft.parse({ name: 'Sheets', enabled: true, transport: { kind: 'http', url: `${service.base}/mcp`, headers: [], oauth: true, oauthClient } });
  const { config, secrets: values } = splitMcpDraft(draft, serverId, emptyMcpSecrets());
  secrets.set(serverId, values);
  await target.save(config);
  return { serverId, config };
}

it('signs in with a client made in advance: a fixed redirect, the secret, PKCE, offline access, and no resource', async () => {
  servers = core();
  const port = await freePort();
  const { serverId } = await addServer(servers, clientAt(port));
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorize = service.authorizeRequests[0];
  expect(authorize.get('redirect_uri')).toBe(redirectUri);
  expect(authorize.get('client_id')).toBe(FAKE_CLIENT_ID);
  expect(authorize.get('scope')).toBe(SCOPES.join(' '));
  expect(authorize.get('code_challenge_method')).toBe('S256');
  expect(authorize.get('access_type')).toBe('offline');
  expect(authorize.get('prompt')).toBe('consent');
  expect(authorize.get('resource')).toBeNull();
  const exchange = service.tokenRequests[0];
  expect(exchange.form.get('grant_type')).toBe('authorization_code');
  expect(exchange.form.get('code_verifier')).toBeTruthy();
  expect(exchange.form.get('resource')).toBeNull();
  const stored = secrets.get(serverId)!.oauth!;
  expect(stored.redirectUri).toBe(redirectUri);
  expect(stored.tokens).toMatchObject({ refresh_token: 'refresh-1' });
  expect(secrets.get(serverId)!.client?.clientId).toBe(FAKE_CLIENT_ID);
  const view = await servers.test(serverId);
  expect(view.status).toBe('connected');
  expect((await servers.call(serverId, 'read_sheet', {}, new AbortController().signal)).content).toBe('rows');
});

it('refreshes with the same client secret and keeps the refresh token when the service sends no new one', async () => {
  servers = core();
  const { serverId } = await addServer(servers, clientAt(await freePort()));
  await signIns().signIn(serverId, `${service.base}/mcp`);
  for (let round = 0; round < 2; round++) {
    service.validAccess.clear();
    expect((await servers.test(serverId)).status).toBe('connected');
  }
  const refreshes = service.tokenRequests.filter(request => request.form.get('grant_type') === 'refresh_token');
  expect(refreshes).toHaveLength(2);
  expect(refreshes.every(request => request.form.get('refresh_token') === 'refresh-1' && request.form.get('resource') === null)).toBe(true);
  expect(secrets.get(serverId)!.oauth!.tokens).toMatchObject({ refresh_token: 'refresh-1' });
});

it('uses the client saved once for a provider, and says so when there is none', async () => {
  servers = core();
  const port = await freePort();
  const { serverId } = await addServer(servers, { shared: 'google', scopes: SCOPES, port, authorizationEndpoint: `${service.base}/auth`, tokenEndpoint: `${service.base}/token` });
  expect(JSON.stringify(secrets.get(serverId))).not.toContain(FAKE_SECRET);
  await expect(signIns().signIn(serverId, `${service.base}/mcp`)).rejects.toThrow(MCP_SIGN_IN_NEEDS_CLIENT);
  shared = { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET };
  await signIns().signIn(serverId, `${service.base}/mcp`);
  expect((await servers.test(serverId)).status).toBe('connected');
});

it('never swaps a fixed port for another one', async () => {
  servers = core();
  const port = await freePort();
  const { serverId } = await addServer(servers, clientAt(port));
  const holder = createSocketServer();
  await new Promise<void>(resolve => holder.listen(port, '127.0.0.1', resolve));
  try {
    await expect(signIns().signIn(serverId, `${service.base}/mcp`)).rejects.toThrow(MCP_SIGN_IN_PORT_BUSY);
  } finally {
    await new Promise<void>(resolve => holder.close(() => resolve()));
  }
  expect(service.authorizeRequests).toHaveLength(0);
});

it('keeps the client secret out of the core, the database and the window view', async () => {
  servers = core();
  const { serverId, config } = await addServer(servers, clientAt(await freePort()));
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const view = await servers.test(serverId);
  expect(JSON.stringify(config)).not.toContain(FAKE_SECRET);
  expect(JSON.stringify(config)).not.toContain(FAKE_CLIENT_ID);
  expect(JSON.stringify(view)).not.toContain(FAKE_SECRET);
  store.close();
  const files = await readdir(directory);
  for (const file of files.filter(name => name.startsWith('state.sqlite'))) {
    expect((await readFile(join(directory, file))).includes(FAKE_SECRET)).toBe(false);
  }
  store = new Store(join(directory, 'state.sqlite'));
});

it('saves the shared client encrypted, keeps its secret when only the ID is re-entered, and replaces it on a new ID', async () => {
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
    decryptString: (data: Buffer) => Buffer.from(data).reverse().toString('utf8'),
  };
  const clients = new ConnectorClientStore(directory, encryption, 'win32');
  await clients.save('google', { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET });
  const file = (await readdir(directory)).find(name => name.startsWith('connector-client-google'))!;
  expect((await readFile(join(directory, file))).includes(Buffer.from(FAKE_SECRET))).toBe(false);
  await clients.save('google', { clientId: FAKE_CLIENT_ID });
  expect(await clients.read('google')).toEqual({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET });
  await clients.save('google', { clientId: 'another-id' });
  expect(await clients.read('google')).toEqual({ clientId: 'another-id' });
  await clients.remove('google');
  expect(await clients.read('google')).toBeUndefined();
});

it('builds the one Google preset with its built-in address, scopes, fixed redirect and offline access', () => {
  const google = MCP_CATALOG.filter(app => app.signIn === 'google');
  expect(google.map(app => app.url)).toEqual([GOOGLE_TOOLS_URL]);
  expect(MCP_CATALOG.some(app => app.url.endsWith('googleapis.com/mcp/v1'))).toBe(false);
  expect(GOOGLE_REDIRECT_URI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const draft = McpServerDraft.parse(catalogDraft(google[0]));
  expect(draft.name).toBe('Google');
  expect(draft.transport).toMatchObject({
    kind: 'http', url: GOOGLE_TOOLS_URL, oauth: true,
    oauthClient: {
      clientId: GOOGLE_CLIENT_ID, port: Number(new URL(GOOGLE_REDIRECT_URI).port),
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth', tokenEndpoint: 'https://connect.orglet.codepawl.com/google/token',
      authorizationParameters: { access_type: 'offline', prompt: 'consent' },
    },
  });
  expect(GOOGLE_BROKER_TOKEN_ENDPOINT).toBe('https://connect.orglet.codepawl.com/google/token');
  // CodePawl's client is the default and carries no secret anywhere in the app; a person's own client signs in to Google directly.
  expect(JSON.stringify(MCP_CATALOG)).not.toMatch(/client_?secret/i);
  expect(draft.transport).not.toHaveProperty('oauthClient.shared');
  expect(draft.transport).not.toHaveProperty('oauthClient.clientSecret');
  const own = McpServerDraft.parse(catalogDraft(google[0], undefined, { ownClient: true }));
  expect(own.transport).toMatchObject({ url: GOOGLE_TOOLS_URL, oauthClient: { shared: 'google', tokenEndpoint: 'https://oauth2.googleapis.com/token' } });
  expect(own.transport).not.toHaveProperty('oauthClient.clientId');
  expect(GOOGLE_SCOPES.map(scope => scope.replace('https://www.googleapis.com/auth/', ''))).toEqual([
    'spreadsheets', 'documents.readonly', 'presentations.readonly', 'drive.readonly',
    'calendar.calendarlist.readonly', 'calendar.events.readonly', 'gmail.readonly', 'gmail.compose',
  ]);
  expect(catalogAppOf(GOOGLE_TOOLS_URL)).toBe('google');
  for (const legacy of GOOGLE_LEGACY_SERVER_URLS) expect(catalogAppOf(legacy)).toBe('google');
  expect(catalogAppOf('https://api.githubcopilot.com/mcp/')).toBe('github');
});

it('asks for the scopes the tools need once, and only trusts an https or local broker override', () => {
  expect(GOOGLE_UNION_SCOPES).toEqual(GOOGLE_SCOPES);
  expect(new Set(GOOGLE_UNION_SCOPES).size).toBe(GOOGLE_UNION_SCOPES.length);
  expect(connectBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  expect(connectBaseUrl('https://connect.example.test/')).toBe('https://connect.example.test');
  expect(connectBaseUrl('http://connect.example.test')).toBeUndefined();
  expect(connectBaseUrl('not an address')).toBeUndefined();
  expect(connectBaseUrl(undefined)).toBeUndefined();
});

/** Google's REST APIs as the fake service guards them: a valid bearer token gets an answer, any other gets a 401. Other addresses (the broker) go through. */
function fakeGoogle(): GoogleFetch {
  return async (input, init) => {
    if (!new URL(input).hostname.endsWith('googleapis.com')) return fetch(input, init);
    const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('authorization') ?? '')?.[1];
    if (!token || !service.validAccess.has(token)) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ properties: { title: 'Budget' }, sheets: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** The built-in Google server as the Connectors page makes it, pointed at the fake service's sign-in page. */
async function addGoogleServer(target: McpServers, authorizationEndpoint: string, port: number) {
  const draft = McpServerDraft.parse(catalogDraft(GOOGLE_APPS[0]));
  if (draft.transport.kind !== 'http' || !draft.transport.oauthClient) throw new Error('The Google preset has an OAuth client.');
  const pointed = { ...draft, transport: { ...draft.transport, oauthClient: { ...draft.transport.oauthClient, port, authorizationEndpoint } } };
  const serverId = id();
  const { config, secrets: values } = splitMcpDraft(McpServerDraft.parse(pointed), serverId, emptyMcpSecrets());
  secrets.set(serverId, values);
  await target.save(config);
  const targets: GoogleServerTarget[] = [{ id: serverId, url: GOOGLE_TOOLS_URL }];
  return targets;
}

function brokerSignIns(brokerBase: string) {
  return new McpSignIns({
    readSecrets: async serverId => secrets.get(serverId) ?? emptyMcpSecrets(),
    saveSecrets: async (serverId, values) => { secrets.set(serverId, values); },
    openExternal: browser,
    connectBaseUrl: brokerBase,
  });
}

it('one Google sign-in asks for every scope once through the broker, with no secret in the app, and the built-in server lists its tools', async () => {
  servers = core(fakeGoogle());
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServer(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    expect(service.authorizeRequests).toHaveLength(1);
    expect(service.authorizeRequests[0].get('scope')).toBe(GOOGLE_UNION_SCOPES.join(' '));
    expect(service.authorizeRequests[0].get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(broker.fromApp).toHaveLength(1);
    expect(broker.fromApp[0].get('grant_type')).toBe('authorization_code');
    expect(broker.fromApp[0].has('client_secret')).toBe(false);
    expect(service.tokenRequests[0].form.get('client_secret')).toBe(FAKE_SECRET);
    const saved = secrets.get(targets[0].id)!.oauth!;
    expect(saved.serverUrl).toBe(GOOGLE_TOOLS_URL);
    expect(saved.tokens).toMatchObject({ refresh_token: 'refresh-1' });
    const metadata = (saved.discovery as { authorizationServerMetadata: { token_endpoint: string } }).authorizationServerMetadata;
    expect(metadata.token_endpoint).toBe(`${broker.base}/google/token`);
    const view = await servers.test(targets[0].id);
    expect(view.status).toBe('connected');
    expect(view.tools).toHaveLength(14);
    expect(JSON.stringify([...secrets.values()])).not.toContain(FAKE_SECRET);
  } finally {
    await broker.close();
  }
});

it('refreshes the built-in server through the broker on a 401, once, and keeps the refresh token', async () => {
  servers = core(fakeGoogle());
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServer(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    expect((await servers.test(targets[0].id)).status).toBe('connected');
    const before = (secrets.get(targets[0].id)!.oauth!.tokens as { access_token: string }).access_token;
    broker.fromApp.length = 0;
    service.validAccess.clear();
    const result = await servers.call(targets[0].id, 'sheets_get_spreadsheet', { spreadsheet: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit' }, new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Budget');
    expect(broker.fromApp.map(form => form.get('grant_type'))).toEqual(['refresh_token']);
    expect(broker.fromApp[0].has('client_secret')).toBe(false);
    const after = secrets.get(targets[0].id)!.oauth!.tokens as { access_token: string; refresh_token: string };
    expect(after.access_token).not.toBe(before);
    expect(after.refresh_token).toBe('refresh-1');
  } finally {
    await broker.close();
  }
});

it('asks for a new sign-in when Google refuses the refresh token, and forgets the dead tokens', async () => {
  servers = core(fakeGoogle());
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServer(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    const state = secrets.get(targets[0].id)!;
    secrets.set(targets[0].id, { ...state, oauth: { ...state.oauth!, tokens: { ...state.oauth!.tokens, refresh_token: 'revoked' } } });
    expect((await servers.test(targets[0].id)).status).toBe('connected');
    service.validAccess.clear();
    const result = await servers.call(targets[0].id, 'sheets_get_spreadsheet', { spreadsheet: '1AbCdEfGhIjKlMnOp' }, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(result.content).toBe(GOOGLE_SIGN_IN_NEEDED);
    expect(servers.views()[0]).toMatchObject({ status: 'signIn', error: GOOGLE_SIGN_IN_NEEDED });
    expect(secrets.get(targets[0].id)!.oauth!.tokens).toBeUndefined();
    expect((await servers.test(targets[0].id)).status).toBe('signIn');
  } finally {
    await broker.close();
  }
});

it('lists the Google tools for a run under the server name, read-only ones marked, and a call still needs a grant', async () => {
  servers = core(fakeGoogle());
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServer(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    const { tools, problems } = await servers.toolsForRun([targets[0].id], new AbortController().signal);
    expect(problems).toEqual([]);
    expect(tools.every(tool => tool.name.startsWith('mcp__google__') && tool.serverName === 'Google')).toBe(true);
    const writing = tools.filter(tool => !tool.readOnly).map(tool => tool.tool).sort();
    expect(writing).toEqual(['gmail_create_draft', 'sheets_append_rows', 'sheets_update_values']);
    expect(tools.find(tool => tool.tool === 'drive_search_files')!.readOnly).toBe(true);
    expect(mcpCallGranted(undefined, targets[0].id, 'gmail_create_draft')).toBe(false);
  } finally {
    await broker.close();
  }
});

it('lets the chosen orglets use the Google server on top of what they already use, and drops nothing', async () => {
  const readSecrets = async (serverId: string) => secrets.get(serverId) ?? emptyMcpSecrets();
  const coreService = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets });
  try {
    const saved = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse(catalogDraft(GOOGLE_APPS[0])), id(), emptyMcpSecrets()).config);
    expect(coreService.mcpGoogleServers().map(server => server.id)).toEqual([saved.id]);
    const notes = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse({ name: 'Notes', enabled: true, transport: { kind: 'http', url: 'https://notes.example.test/mcp', headers: [] } }), id(), emptyMcpSecrets()).config);
    const first = store.all<Worker>('workers')[0];
    const { id: _ignored, revision: _revision, ...firstFields } = first;
    const second = await coreService.command('saveWorker', { ...firstFields, name: 'Second' }) as Worker;
    await coreService.command('saveWorker', { ...first, mcpServerIds: [notes.id] });
    await coreService.command('grantMcpServers', { workerIds: [first.id], serverIds: [saved.id] });
    expect(store.get<Worker>('workers', first.id).mcpServerIds).toEqual([notes.id, saved.id]);
    expect(store.get<Worker>('workers', second.id).mcpServerIds).toBeUndefined();
    await coreService.command('grantMcpServers', { workerIds: [first.id, second.id], serverIds: [saved.id] });
    expect(store.get<Worker>('workers', first.id).mcpServerIds).toEqual([notes.id, saved.id]);
    expect(store.get<Worker>('workers', second.id).mcpServerIds).toEqual([saved.id]);
  } finally {
    await coreService.mcp.shutdown();
  }
});

it('replaces the six preview servers with the built-in one, keeping every orglet grant, and removes the six', async () => {
  const readSecrets = async (serverId: string) => secrets.get(serverId) ?? emptyMcpSecrets();
  const coreService = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets });
  try {
    const legacyIds: string[] = [];
    for (const [index, url] of GOOGLE_LEGACY_SERVER_URLS.entries()) {
      const draft = { name: `Preview ${index}`, enabled: true, transport: { kind: 'http', url, headers: [], oauth: true } };
      legacyIds.push((await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse(draft), id(), emptyMcpSecrets()).config)).id);
    }
    expect(coreService.mcpGoogleLegacyServers().map(server => server.id).sort()).toEqual([...legacyIds].sort());
    const builtIn = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse(catalogDraft(GOOGLE_APPS[0])), id(), emptyMcpSecrets()).config);
    const notes = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse({ name: 'Notes', enabled: true, transport: { kind: 'http', url: 'https://notes.example.test/mcp', headers: [] } }), id(), emptyMcpSecrets()).config);
    const first = store.all<Worker>('workers')[0];
    const { id: _ignored, revision: _revision, ...firstFields } = first;
    const second = await coreService.command('saveWorker', { ...firstFields, name: 'Second' }) as Worker;
    const third = await coreService.command('saveWorker', { ...firstFields, name: 'Third' }) as Worker;
    await coreService.command('saveWorker', { ...store.get<Worker>('workers', first.id), mcpServerIds: [legacyIds[0], notes.id] });
    await coreService.command('saveWorker', { ...store.get<Worker>('workers', second.id), mcpServerIds: [legacyIds[3], legacyIds[5]] });
    await coreService.replaceGoogleServers({ builtInId: builtIn.id, legacyIds });
    expect(store.get<Worker>('workers', first.id).mcpServerIds).toEqual([notes.id, builtIn.id]);
    expect(store.get<Worker>('workers', second.id).mcpServerIds).toEqual([builtIn.id]);
    expect(store.get<Worker>('workers', third.id).mcpServerIds).toBeUndefined();
    expect(coreService.mcpGoogleLegacyServers()).toEqual([]);
    expect(coreService.mcp.list().map(server => server.name).sort()).toEqual(['Google', 'Notes']);
    await expect(coreService.replaceGoogleServers({ builtInId: id(), legacyIds: [] })).rejects.toThrow();
  } finally {
    await coreService.mcp.shutdown();
  }
});

it('removes the Google server and its secrets', async () => {
  servers = core();
  const targets = await addGoogleServer(servers, `${service.base}/auth`, await freePort());
  await servers.remove(targets[0].id);
  secrets.delete(targets[0].id);
  expect(servers.list()).toHaveLength(0);
  expect(secrets.size).toBe(0);
});

it('reads what v0.13.0 saved, and adds nothing to the server record that v0.13.0 reads', () => {
  const serverId = id();
  const now = new Date().toISOString();
  // Shapes as v0.13.0 wrote them (git show v0.13.0:apps/desktop/src/shared/mcp.ts): the new fields are all optional.
  const oldServer = { id: serverId, name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/mcp', headerNames: [], bearer: false, oauth: true }, revision: 1, createdAt: now, updatedAt: now };
  expect(McpServer.safeParse(oldServer).success).toBe(true);
  const oldSecrets = { env: {}, headers: {}, oauth: { serverUrl: 'https://mcp.linear.app/mcp', redirectUri: 'http://127.0.0.1:50000/callback', tokens: { access_token: 'a', token_type: 'Bearer' } } };
  expect(McpSecrets.safeParse(oldSecrets).success).toBe(true);
  expect(McpOAuthState.safeParse(oldSecrets.oauth).success).toBe(true);
  expect(McpServerDraft.safeParse({ name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/mcp', headers: [], oauth: true } }).success).toBe(true);
  // A server made from a Google preset is stored in the core exactly like any browser sign-in server.
  const { config } = splitMcpDraft(McpServerDraft.parse(catalogDraft(GOOGLE_APPS[0])), serverId, emptyMcpSecrets());
  expect(Object.keys(config.transport).sort()).toEqual(['bearer', 'headerNames', 'kind', 'oauth', 'url']);
  expect(Object.keys(config).sort()).toEqual(['enabled', 'id', 'name', 'transport']);
});

it('keeps the saved client when an edit says nothing about it, and drops it only on null', () => {
  const serverId = id();
  const first = splitMcpDraft(McpServerDraft.parse({ name: 'Sheets', enabled: true, transport: { kind: 'http', url: 'https://sheetsmcp.googleapis.com/mcp/v1', headers: [], oauth: true, oauthClient: { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_SECRET, scopes: SCOPES } } }), serverId, emptyMcpSecrets());
  const edit = (oauthClient?: unknown) => splitMcpDraft(McpServerDraft.parse({ id: serverId, name: 'Sheets', enabled: true, transport: { kind: 'http', url: 'https://sheetsmcp.googleapis.com/mcp/v1', headers: [], oauth: true, ...(oauthClient === undefined ? {} : { oauthClient }) } }), serverId, first.secrets);
  expect(edit().secrets.client).toEqual(first.secrets.client);
  expect(edit({ clientId: FAKE_CLIENT_ID, scopes: SCOPES }).secrets.client?.clientSecret).toBe(FAKE_SECRET);
  expect(edit(null).secrets.client).toBeUndefined();
  expect(McpServerDraft.safeParse({ name: 'x', enabled: true, transport: { kind: 'http', url: 'https://example.com/mcp', headers: [], oauth: true, oauthClient: { clientId: 'a', shared: 'google', scopes: [] } } }).success).toBe(false);
});
