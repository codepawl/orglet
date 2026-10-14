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
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import { ConnectorClientStore } from '../../apps/desktop/src/main/connector-clients';
import { McpSignIns, MCP_SIGN_IN_NEEDS_CLIENT, MCP_SIGN_IN_PORT_BUSY, type GoogleServerTarget } from '../../apps/desktop/src/main/mcp-sign-in';
import { emptyMcpSecrets, McpOAuthState, McpSecrets, McpServer, McpServerDraft, splitMcpDraft, type McpPreregisteredClient } from '../../apps/desktop/src/shared/mcp';
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

function core() {
  return new McpServers(store, () => {}, {
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

it('builds each Google preset with its address, scopes, fixed redirect and offline access', () => {
  const google = MCP_CATALOG.filter(app => app.signIn === 'google');
  expect(google.map(app => new URL(app.url).hostname)).toEqual([
    'sheetsmcp.googleapis.com', 'drivemcp.googleapis.com', 'gmailmcp.googleapis.com', 'calendarmcp.googleapis.com', 'docsmcp.googleapis.com', 'slidesmcp.googleapis.com',
  ]);
  expect(GOOGLE_REDIRECT_URI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const sheets = MCP_CATALOG.find(app => app.id === 'googlesheets')!;
  const draft = McpServerDraft.parse(catalogDraft(sheets));
  expect(draft.transport).toMatchObject({
    kind: 'http', url: 'https://sheetsmcp.googleapis.com/mcp/v1', oauth: true,
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
  const own = McpServerDraft.parse(catalogDraft(sheets, undefined, { ownClient: true }));
  expect(own.transport).toMatchObject({ oauthClient: { shared: 'google', tokenEndpoint: 'https://oauth2.googleapis.com/token' } });
  expect(own.transport).not.toHaveProperty('oauthClient.clientId');
  const scopes = (draft.transport.kind === 'http' ? draft.transport.oauthClient?.scopes : []) ?? [];
  expect(scopes.map(scope => scope.replace('https://www.googleapis.com/auth/', ''))).toEqual(['drive.readonly', 'drive.file', 'spreadsheets.readonly', 'spreadsheets']);
  expect(MCP_CATALOG.find(app => app.id === 'gmail')!.scopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']);
  for (const app of google) expect(catalogAppOf(app.url)).toBe(app.id);
  expect(catalogAppOf('https://api.githubcopilot.com/mcp/')).toBe('github');
});

it('asks for the union of the six services scopes once, and only trusts an https or local broker override', () => {
  const each = GOOGLE_APPS.flatMap(app => app.scopes ?? []);
  expect(GOOGLE_UNION_SCOPES.length).toBeLessThan(each.length);
  expect(new Set(GOOGLE_UNION_SCOPES).size).toBe(GOOGLE_UNION_SCOPES.length);
  for (const scope of each) expect(GOOGLE_UNION_SCOPES).toContain(scope);
  expect(connectBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  expect(connectBaseUrl('https://connect.example.test/')).toBe('https://connect.example.test');
  expect(connectBaseUrl('http://connect.example.test')).toBeUndefined();
  expect(connectBaseUrl('not an address')).toBeUndefined();
  expect(connectBaseUrl(undefined)).toBeUndefined();
});

/** The six Google servers as the Connectors page makes them, pointed at the fake service (same path, one query each). */
async function addGoogleServers(target: McpServers, authorizationEndpoint: string, port: number) {
  const targets: GoogleServerTarget[] = [];
  for (const app of GOOGLE_APPS) {
    const url = `${service.base}/mcp?app=${app.id}`;
    const draft = McpServerDraft.parse(catalogDraft(app));
    if (draft.transport.kind !== 'http' || !draft.transport.oauthClient) throw new Error('A Google preset has an OAuth client.');
    const pointed = { ...draft, transport: { ...draft.transport, url, oauthClient: { ...draft.transport.oauthClient, port, authorizationEndpoint } } };
    const serverId = id();
    const { config, secrets: values } = splitMcpDraft(McpServerDraft.parse(pointed), serverId, emptyMcpSecrets());
    secrets.set(serverId, values);
    await target.save(config);
    targets.push({ id: serverId, url });
  }
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

it('one Google sign-in asks for every scope once and signs in six servers through the broker, with no secret in the app', async () => {
  servers = core();
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServers(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    expect(service.authorizeRequests).toHaveLength(1);
    expect(service.authorizeRequests[0].get('scope')).toBe(GOOGLE_UNION_SCOPES.join(' '));
    expect(service.authorizeRequests[0].get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(broker.fromApp).toHaveLength(1);
    expect(broker.fromApp[0].get('grant_type')).toBe('authorization_code');
    expect(broker.fromApp[0].has('client_secret')).toBe(false);
    expect(service.tokenRequests[0].form.get('client_secret')).toBe(FAKE_SECRET);
    expect(targets).toHaveLength(6);
    for (const target of targets) {
      const saved = secrets.get(target.id)!.oauth!;
      expect(saved.serverUrl).toBe(target.url);
      expect(saved.tokens).toMatchObject({ refresh_token: 'refresh-1' });
      const metadata = (saved.discovery as { authorizationServerMetadata: { token_endpoint: string } }).authorizationServerMetadata;
      expect(metadata.token_endpoint).toBe(`${broker.base}/google/token`);
      expect((await servers.test(target.id)).status).toBe('connected');
    }
    expect(JSON.stringify([...secrets.values()])).not.toContain(FAKE_SECRET);
  } finally {
    await broker.close();
  }
});

it('refreshes Google servers on their own through the broker without breaking each other', async () => {
  servers = core();
  const broker = await startBroker(service.base);
  try {
    const targets = await addGoogleServers(servers, `${service.base}/auth`, await freePort());
    await brokerSignIns(broker.base).signInGoogle(targets[0].id, targets);
    broker.fromApp.length = 0;
    service.validAccess.clear();
    expect((await servers.test(targets[0].id)).status).toBe('connected');
    expect((await servers.test(targets[1].id)).status).toBe('connected');
    expect(broker.fromApp.map(form => form.get('grant_type'))).toEqual(['refresh_token', 'refresh_token']);
    expect(broker.fromApp.every(form => form.get('refresh_token') === 'refresh-1' && !form.has('client_secret') && !form.has('resource'))).toBe(true);
    expect(secrets.get(targets[0].id)!.oauth!.tokens).toMatchObject({ refresh_token: 'refresh-1' });
    expect(secrets.get(targets[1].id)!.oauth!.tokens).toMatchObject({ refresh_token: 'refresh-1' });
    // A third server, which never refreshed on its own before, still refreshes with what it was given.
    service.validAccess.clear();
    expect((await servers.test(targets[2].id)).status).toBe('connected');
  } finally {
    await broker.close();
  }
});

it('lets the chosen orglets use the six Google servers on top of what they already use, and drops nothing', async () => {
  const readSecrets = async (serverId: string) => secrets.get(serverId) ?? emptyMcpSecrets();
  const coreService = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets });
  try {
    const targets: string[] = [];
    for (const app of GOOGLE_APPS) {
      const saved = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse(catalogDraft(app)), id(), emptyMcpSecrets()).config);
      targets.push(saved.id);
    }
    expect(coreService.mcpGoogleServers().map(server => server.id).sort()).toEqual([...targets].sort());
    const notes = await coreService.saveMcpServer(splitMcpDraft(McpServerDraft.parse({ name: 'Notes', enabled: true, transport: { kind: 'http', url: 'https://notes.example.test/mcp', headers: [] } }), id(), emptyMcpSecrets()).config);
    const first = store.all<Worker>('workers')[0];
    const { id: _ignored, revision: _revision, ...firstFields } = first;
    const second = await coreService.command('saveWorker', { ...firstFields, name: 'Second' }) as Worker;
    await coreService.command('saveWorker', { ...first, mcpServerIds: [notes.id] });
    await coreService.command('grantMcpServers', { workerIds: [first.id], serverIds: targets });
    expect(store.get<Worker>('workers', first.id).mcpServerIds).toEqual([notes.id, ...targets]);
    expect(store.get<Worker>('workers', second.id).mcpServerIds).toBeUndefined();
    await coreService.command('grantMcpServers', { workerIds: [first.id, second.id], serverIds: targets });
    expect(store.get<Worker>('workers', first.id).mcpServerIds).toEqual([notes.id, ...targets]);
    expect(store.get<Worker>('workers', second.id).mcpServerIds).toEqual(targets);
  } finally {
    await coreService.mcp.shutdown();
  }
});

it('removes all six Google servers and their secrets, one by one', async () => {
  servers = core();
  const targets = await addGoogleServers(servers, `${service.base}/auth`, await freePort());
  for (const target of targets) {
    await servers.remove(target.id);
    secrets.delete(target.id);
  }
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
  const { config } = splitMcpDraft(McpServerDraft.parse(catalogDraft(MCP_CATALOG.find(app => app.id === 'googledrive')!)), serverId, emptyMcpSecrets());
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
