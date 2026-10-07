import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { McpServers } from '../../apps/desktop/src/core/tools/mcp';
import { McpSignIns, MCP_SIGN_IN_TIMED_OUT, MCP_SIGN_IN_WRONG_SERVICE } from '../../apps/desktop/src/main/mcp-sign-in';
import { emptyMcpSecrets, splitMcpDraft, type McpOAuthState, type McpSecrets } from '../../apps/desktop/src/shared/mcp';
import { catalogDraft, MCP_CATALOG } from '../../apps/desktop/src/shared/mcp-catalog';

/**
 * A service that does what Linear and Notion do (measured 2026-10-07): protected resource metadata, authorization
 * server metadata with dynamic registration, PKCE S256 and `iss` on the way back, rotating refresh tokens, and an MCP
 * endpoint that answers only a valid access token.
 */
type Service = {
  base: string;
  validAccess: Set<string>;
  registrations: number;
  refreshes: number;
  /** What the authorize step sends back; a test changes it to play a forged or misdirected callback. */
  callbackParameters: (parameters: URLSearchParams) => URLSearchParams;
  close: () => Promise<void>;
};

async function body(request: IncomingMessage): Promise<string> {
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
  const service = { validAccess: new Set<string>(), registrations: 0, refreshes: 0, callbackParameters: (parameters: URLSearchParams) => parameters } as Service;
  const mcp = (): Server => {
    const server = new Server({ name: 'fake-service', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'whoami', description: 'Names the signed-in user.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'signed in as ada' }] }));
    return server;
  };
  const http: HttpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', service.base);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(response, 200, { resource: `${service.base}/mcp`, authorization_servers: [service.base] });
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(response, 200, {
        issuer: service.base, authorization_endpoint: `${service.base}/authorize`, token_endpoint: `${service.base}/token`, registration_endpoint: `${service.base}/register`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.pathname === '/register' && request.method === 'POST') {
      service.registrations++;
      const metadata = JSON.parse(await body(request)) as Record<string, unknown>;
      return json(response, 201, { ...metadata, client_id: `client-${service.registrations}` });
    }
    if (url.pathname === '/authorize') {
      const code = `code-${++counter}`;
      const redirectUri = url.searchParams.get('redirect_uri')!;
      codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirectUri });
      const back = service.callbackParameters(new URLSearchParams({ code, state: url.searchParams.get('state')!, iss: service.base }));
      response.writeHead(302, { location: `${redirectUri}?${back}` }).end();
      return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await body(request));
      const issue = () => {
        const access = `access-${++counter}`;
        const refresh = `refresh-${counter}`;
        service.validAccess.add(access);
        refreshTokens.add(refresh);
        return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 };
      };
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!pending || pending.challenge !== challenge || pending.redirectUri !== form.get('redirect_uri')) return json(response, 400, { error: 'invalid_grant' });
        return json(response, 200, issue());
      }
      if (form.get('grant_type') === 'refresh_token' && refreshTokens.delete(form.get('refresh_token') ?? '')) {
        service.refreshes++;
        return json(response, 200, issue());
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

/** The browser: follows the service's redirect back to Orglet's loopback listener, as a person clicking Allow would. */
async function browser(url: string) {
  const authorize = await fetch(url, { redirect: 'manual' });
  const location = authorize.headers.get('location');
  if (location) await fetch(location);
}

let directory: string;
let store: Store;
let service: Service;
let servers: McpServers | undefined;
let secrets: Map<string, McpSecrets>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-mcp-oauth-'));
  store = new Store(join(directory, 'state.sqlite'));
  service = await startService();
  secrets = new Map();
});

afterEach(async () => {
  await servers?.shutdown();
  servers = undefined;
  store.close();
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

function signIns(open: (url: string) => Promise<void> = browser, timeoutMs?: number) {
  return new McpSignIns({
    readSecrets: async serverId => secrets.get(serverId) ?? emptyMcpSecrets(),
    saveSecrets: async (serverId, values) => { secrets.set(serverId, values); },
    openExternal: open,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

function core(saved: { serverId: string; state: McpOAuthState }[] = []) {
  return new McpServers(store, () => {}, {
    readSecrets: async serverId => secrets.get(serverId) ?? emptyMcpSecrets(),
    saveSignIn: (serverId, state) => {
      saved.push({ serverId, state });
      const current = secrets.get(serverId) ?? emptyMcpSecrets();
      secrets.set(serverId, { ...current, oauth: state });
    },
  });
}

async function addServer(target: McpServers) {
  const serverId = id();
  const { config, secrets: values } = splitMcpDraft({ name: 'Service', enabled: true, transport: { kind: 'http', url: `${service.base}/mcp`, headers: [], oauth: true } }, serverId, emptyMcpSecrets());
  secrets.set(serverId, values);
  await target.save(config);
  return serverId;
}

it('waits for a sign-in, then signs in through the browser and uses the service (stage 4)', async () => {
  servers = core();
  const serverId = await addServer(servers);
  expect((await servers.test(serverId)).status).toBe('signIn');
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const stored = secrets.get(serverId)!.oauth!;
  expect(stored.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  expect(stored.client).toMatchObject({ client_id: 'client-1', token_endpoint_auth_method: 'none' });
  expect(stored.tokens).toMatchObject({ token_type: 'Bearer', refresh_token: expect.any(String) });
  const view = await servers.test(serverId);
  expect(view.status).toBe('connected');
  expect(view.tools?.map(tool => tool.name)).toEqual(['whoami']);
  const answer = await servers.call(serverId, 'whoami', {}, new AbortController().signal);
  expect(answer.content).toBe('signed in as ada');
});

it('refreshes an access token the service stopped taking, and hands the rotated tokens to main', async () => {
  const saved: { serverId: string; state: McpOAuthState }[] = [];
  servers = core(saved);
  const serverId = await addServer(servers);
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const first = secrets.get(serverId)!.oauth!.tokens!;
  service.validAccess.clear();
  await servers.test(serverId);
  expect(service.refreshes).toBe(1);
  const rotated = saved.at(-1)!.state.tokens!;
  expect(rotated.refresh_token).not.toBe(first.refresh_token);
  expect(secrets.get(serverId)!.oauth!.tokens).toEqual(rotated);
  expect((await servers.call(serverId, 'whoami', {}, new AbortController().signal)).content).toBe('signed in as ada');
});

it('asks for a new sign-in once the refresh token is refused too', async () => {
  servers = core();
  const serverId = await addServer(servers);
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const oauth = secrets.get(serverId)!.oauth!;
  secrets.set(serverId, { ...secrets.get(serverId)!, oauth: { ...oauth, tokens: { ...oauth.tokens, refresh_token: 'revoked' } } });
  service.validAccess.clear();
  const view = await servers.test(serverId);
  expect(view.status).toBe('signIn');
  expect(view.error).toContain('cần đăng nhập');
});

it('reuses the registered client and its port on the next sign-in', async () => {
  servers = core();
  const serverId = await addServer(servers);
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const before = secrets.get(serverId)!.oauth!;
  await signIns().signIn(serverId, `${service.base}/mcp`);
  const after = secrets.get(serverId)!.oauth!;
  expect(service.registrations).toBe(1);
  expect(after.redirectUri).toBe(before.redirectUri);
  expect(after.tokens!.access_token).not.toBe(before.tokens!.access_token);
});

it('drops a callback with the wrong state and refuses one from another service', async () => {
  servers = core();
  const serverId = await addServer(servers);
  service.callbackParameters = parameters => {
    parameters.set('state', 'forged');
    return parameters;
  };
  const forged = signIns(browser, 1500).signIn(serverId, `${service.base}/mcp`);
  await expect(forged).rejects.toThrow(MCP_SIGN_IN_TIMED_OUT);
  service.callbackParameters = parameters => {
    parameters.set('iss', 'https://elsewhere.example');
    return parameters;
  };
  await expect(signIns().signIn(serverId, `${service.base}/mcp`)).rejects.toThrow(MCP_SIGN_IN_WRONG_SERVICE);
  expect(secrets.get(serverId)!.oauth).toBeUndefined();
});

it('keeps a sign-in only for the address it was made for, and never with a token beside it', () => {
  const oauth: McpOAuthState = { serverUrl: 'https://mcp.linear.app/mcp', redirectUri: 'http://127.0.0.1:50000/callback', tokens: { access_token: 'a', token_type: 'Bearer' } };
  const saved = { ...emptyMcpSecrets(), oauth };
  const same = splitMcpDraft({ name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/mcp', headers: [], oauth: true } }, id(), saved);
  expect(same.secrets.oauth).toEqual(oauth);
  expect(same.config.transport).toMatchObject({ oauth: true, bearer: false });
  const moved = splitMcpDraft({ name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/v2', headers: [], oauth: true } }, id(), saved);
  expect(moved.secrets.oauth).toBeUndefined();
  expect(() => splitMcpDraft({ name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/mcp', headers: [], oauth: true, bearer: 'x' } }, id(), saved)).toThrow();
  const github = MCP_CATALOG.find(app => app.id === 'github')!;
  expect(catalogDraft(github, 'ghp_test').transport).toMatchObject({ bearer: 'ghp_test' });
  expect(catalogDraft(MCP_CATALOG.find(app => app.id === 'notion')!).transport).toMatchObject({ oauth: true });
});
