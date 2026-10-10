import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelListResult } from '../../apps/desktop/src/shared/models';
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import { emptyConnections } from '../../apps/desktop/src/shared/contracts';
import { readiness } from '../../apps/desktop/src/renderer/components/providers';
import { workerProviderOptions } from '../../apps/desktop/src/renderer/components/WorkerDialog';
import { CodepawlAdapter } from '../../apps/desktop/src/core/adapters/codepawl';
import { ProviderRequestError } from '../../apps/desktop/src/core/adapters/opencode';
import { fetchProviderList, parseCodepawlModels } from '../../apps/desktop/src/core/models/fetch';
import { resolveWorkerModel } from '../../apps/desktop/src/core/models/resolve';
import { AccountService, ResourceRefused, RouterSignInRequired, type AccountStore } from '../../apps/desktop/src/main/account';
import { RouterConnection, RouterKeyIdFile, routerKeyName, type RouterKeyIdStore, type RouterKeyStore } from '../../apps/desktop/src/main/router-connection';
import type { AccountState } from '../../apps/desktop/src/shared/account';
import { ApiProvider, isPaidApi, isPlanApi } from '../../apps/desktop/src/shared/contracts';
import {
  ACCOUNT_ROUTER_RESOURCE,
  ACCOUNT_ROUTER_SCOPE,
  CodepawlState,
  CodepawlUsage,
  ROUTER_KEY_PATTERN,
  routerApiUrl,
  routerBaseUrl,
} from '../../apps/desktop/src/shared/router';

// Obviously fake: no live router, accounts service or provider is called anywhere in this file.
const ROUTER_KEY = 'cpr_0123456789abcdef0123456789abcdef_fixtureSecretNotRealAAAAAAAAAAAAAAAAAAAA';
const ACCESS_TOKEN = 'fixture-router-access-token';
const KEY_ID = 'key_fixture_1';

type Received = { method: string; url: string; authorization?: string; body: unknown };
type RouterBehavior = {
  keyStatus: number;
  revokeStatus: number;
  usage: unknown;
  usageStatus: number;
  chat: 'tool' | { status: number; message: string };
};

/** A stand-in for the router: the key routes (token-authenticated), models, usage and a streamed chat/completions. */
async function fakeRouter() {
  const received: Received[] = [];
  const behavior: RouterBehavior = {
    keyStatus: 201,
    revokeStatus: 200,
    usage: { free: { tokensLeft: 41_000, tokensLimit: 50_000, resetsAt: '2026-10-11T00:00:00.000Z' }, starter: null },
    usageStatus: 200,
    chat: 'tool',
  };
  let keysMade = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void answer(request, response);
  });
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const url = request.url ?? '';
    received.push({ method: request.method ?? '', url, authorization: request.headers.authorization, body: text ? JSON.parse(text) : undefined });
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url === '/v1/keys' && request.method === 'POST') {
      keysMade += 1;
      return behavior.keyStatus === 201
        ? json(201, { id: `${KEY_ID}_${keysMade}`, name: 'laptop', createdAt: '2026-10-10T00:00:00.000Z', secret: ROUTER_KEY })
        : json(behavior.keyStatus, { error: { message: 'no', type: 'invalid_request_error' } });
    }
    if (url.startsWith('/v1/keys/') && request.method === 'DELETE') return json(behavior.revokeStatus, { revoked: true });
    if (url === '/v1/usage') return json(behavior.usageStatus, behavior.usage);
    if (url === '/v1/models') {
      return json(200, { object: 'list', data: [
        { id: 'codepawl/free-small', object: 'model', owned_by: 'codepawl', pricing: { free: true } },
        { id: 'codepawl/large', object: 'model', owned_by: 'codepawl', pricing: { free: false } },
        { id: 'codepawl/free-small', object: 'model' },
      ] });
    }
    if (url === '/v1/chat/completions') {
      if (behavior.chat !== 'tool') return json(behavior.chat.status, { error: { message: behavior.chat.message, type: 'error' } });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'codepawl/free-small' };
      const call = { index: 0, id: 'call_1', type: 'function', function: { name: 'reply', arguments: '{"text":"hi"}' } };
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: 'tool_calls' }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    json(404, { error: { message: 'not found' } });
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    apiUrl: `${origin}/v1`,
    behavior,
    received,
    keyRequests: () => received.filter(item => item.method === 'POST' && item.url === '/v1/keys'),
    revokes: () => received.filter(item => item.method === 'DELETE'),
    close() { server.closeAllConnections(); server.close(); },
  };
}

function memoryKeys(): RouterKeyStore & { value: string | null } {
  const store = {
    value: null as string | null,
    read: async () => store.value,
    save: async (key: string) => { store.value = key; },
    remove: async () => { store.value = null; },
  };
  return store;
}

function memoryKeyIds(): RouterKeyIdStore & { value: string | undefined } {
  const store = {
    value: undefined as string | undefined,
    read: async () => store.value,
    save: async (id: string) => { store.value = id; },
    remove: async () => { store.value = undefined; },
  };
  return store;
}

/** A token source standing in for the signed-in account. */
function fakeAccount(status: AccountState['status'] = 'signed_in') {
  const account = {
    status,
    refuse: false,
    failure: undefined as Error | undefined,
    resources: [] as string[],
    coversRouter: true,
    state: (): AccountState => ({ status: account.status }),
    signInCoversRouter: () => account.coversRouter,
    getAccessToken: async (resource: typeof ACCOUNT_ROUTER_RESOURCE) => {
      account.resources.push(resource);
      if (account.refuse) throw new ResourceRefused('invalid_target');
      if (account.failure) throw account.failure;
      return ACCESS_TOKEN;
    },
  };
  return account;
}

let router: Awaited<ReturnType<typeof fakeRouter>>;
beforeEach(async () => {
  router = await fakeRouter();
});
afterEach(() => {
  router.close();
  vi.restoreAllMocks();
});

function connection(overrides: { baseUrl?: string | undefined; account?: ReturnType<typeof fakeAccount> } = {}) {
  const keys = memoryKeys();
  const keyIds = memoryKeyIds();
  const account = overrides.account ?? fakeAccount();
  const changes: number[] = [];
  const baseUrl = 'baseUrl' in overrides ? overrides.baseUrl : router.origin;
  const subject = new RouterConnection({ baseUrl, account, keys, keyIds, deviceName: 'Orglet on LAPTOP', onChange: () => changes.push(changes.length) });
  return { subject, keys, keyIds, account, changes };
}

describe('where the router is', () => {
  it('has no default: no address, off and a bad address all mean no router', () => {
    expect(routerBaseUrl(undefined)).toBeUndefined();
    expect(routerBaseUrl('')).toBeUndefined();
    expect(routerBaseUrl('off')).toBeUndefined();
    expect(routerBaseUrl('not a url')).toBeUndefined();
    expect(routerBaseUrl('http://router.example.test')).toBeUndefined();
    expect(routerApiUrl(undefined)).toBeUndefined();
  });

  it('takes https, or http on this computer, as an origin', () => {
    expect(routerBaseUrl('https://router.example.test/some/path')).toBe('https://router.example.test');
    expect(routerBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(routerApiUrl('https://router.example.test')).toBe('https://router.example.test/v1');
  });

  it('is not implied by an accounts address: a build that names only the accounts service has no router', async () => {
    const withAccountsOnly = routerBaseUrl(process.env.ORGLET_ROUTER_URL);
    expect(withAccountsOnly).toBeUndefined();
    const { subject } = connection({ baseUrl: withAccountsOnly });
    expect(subject.configured).toBe(false);
    expect(await subject.state()).toEqual({ status: 'off' });
  });
});

describe('connecting with the account', () => {
  it('makes one key named after this computer, asking for the router audience, and keeps it in main', async () => {
    const { subject, keys, keyIds, account, changes } = connection();
    expect(await subject.state()).toEqual({ status: 'ready' });

    const state = await subject.connect();

    expect(state).toEqual({ status: 'connected', deviceName: 'Orglet on LAPTOP' });
    expect(account.resources).toEqual([ACCOUNT_ROUTER_RESOURCE]);
    expect(router.keyRequests()).toHaveLength(1);
    expect(router.keyRequests()[0]).toMatchObject({ authorization: `Bearer ${ACCESS_TOKEN}`, body: { name: 'Orglet on LAPTOP' } });
    expect(keys.value).toBe(ROUTER_KEY);
    expect(keyIds.value).toBe(`${KEY_ID}_1`);
    expect(changes).toHaveLength(1);
  });

  it('makes no second key when connected again, or when two connects overlap', async () => {
    const { subject } = connection();
    await Promise.all([subject.connect(), subject.connect()]);
    await subject.connect();
    expect(router.keyRequests()).toHaveLength(1);
  });

  it('asks the person to sign in when there is no account, and makes no key', async () => {
    const { subject, keys } = connection({ account: fakeAccount('local') });
    expect(await subject.state()).toEqual({ status: 'signed_out' });
    expect(await subject.connect()).toEqual({ status: 'signed_out' });
    expect(router.received).toHaveLength(0);
    expect(keys.value).toBeNull();
  });

  it('says the router is not open yet when the accounts service refuses the audience, and never falls back', async () => {
    const account = fakeAccount();
    account.refuse = true;
    const { subject, keys } = connection({ account });

    expect(await subject.connect()).toEqual({ status: 'not_open' });
    expect(await subject.state()).toEqual({ status: 'not_open' });
    expect(router.received).toHaveLength(0);
    expect(keys.value).toBeNull();

    account.refuse = false;
    expect(await subject.connect()).toMatchObject({ status: 'connected' });
  });

  it('refuses a router that answers with a key it cannot use, and keeps nothing', async () => {
    router.behavior.keyStatus = 500;
    const { subject, keys, keyIds } = connection();
    await expect(subject.connect()).rejects.toThrow('CodePawl router');
    expect(keys.value).toBeNull();
    expect(keyIds.value).toBeUndefined();
  });

  it('drops the key at the router again when it cannot be saved here', async () => {
    const { subject, keys, keyIds } = connection();
    keys.save = async () => { throw new Error('OS credential storage không khả dụng.'); };
    await expect(subject.connect()).rejects.toThrow('credential');
    expect(keyIds.value).toBeUndefined();
    expect(router.revokes()).toHaveLength(1);
    expect(router.revokes()[0].url).toBe(`/v1/keys/${KEY_ID}_1`);
  });
});

describe('disconnecting and signing out', () => {
  it('forgets the key here and revokes it at the router', async () => {
    const { subject, keys, keyIds } = connection();
    await subject.connect();

    expect(await subject.disconnect()).toEqual({ status: 'ready' });

    expect(keys.value).toBeNull();
    expect(keyIds.value).toBeUndefined();
    expect(router.revokes()).toHaveLength(1);
    expect(router.revokes()[0]).toMatchObject({ url: `/v1/keys/${KEY_ID}_1`, authorization: `Bearer ${ACCESS_TOKEN}` });
  });

  it('still forgets the key when the router cannot be reached', async () => {
    const { subject, keys } = connection();
    await subject.connect();
    router.behavior.revokeStatus = 500;
    await subject.disconnect();
    expect(keys.value).toBeNull();
  });

  it('revokes before the account signs out, and a failing token source cannot stop the sign-out', async () => {
    const { subject, keys, account } = connection();
    await subject.connect();
    await subject.revokeBeforeSignOut();
    expect(keys.value).toBeNull();
    expect(router.revokes()).toHaveLength(1);

    await subject.connect();
    account.failure = new Error('Chưa đăng nhập tài khoản CodePawl.');
    await expect(subject.revokeBeforeSignOut()).resolves.toBeUndefined();
    expect(keys.value).toBeNull();
  });

  it('forgets a key an earlier build left even when this build names no router', async () => {
    const { subject, keys, keyIds } = connection({ baseUrl: undefined });
    keys.value = ROUTER_KEY;
    keyIds.value = KEY_ID;
    expect(await subject.disconnect()).toEqual({ status: 'off' });
    expect(keys.value).toBeNull();
    expect(router.received).toHaveLength(0);
  });
});

describe('no router address', () => {
  it('shows nothing and calls nothing', async () => {
    const { subject, keys } = connection({ baseUrl: undefined });
    expect(subject.configured).toBe(false);
    expect(await subject.state()).toEqual({ status: 'off' });
    expect(await subject.connect()).toEqual({ status: 'off' });
    expect(await subject.usage()).toEqual({ known: false });
    expect(keys.value).toBeNull();
    expect(router.received).toHaveLength(0);
  });

  it('has no list to fetch and builds no request', async () => {
    delete process.env.ORGLET_ROUTER_URL;
    const request = vi.fn(fetch);
    const row = await fetchProviderList('codepawl', {
      readKey: async () => ROUTER_KEY, fetch: request, harnesses: async () => [], now: () => new Date('2026-10-10T00:00:00Z'),
    });
    expect(row.models).toEqual([]);
    expect(row.error).toBe('Bản này không có CodePawl router.');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('the account asks for the router audience', () => {
  const SYNC_RESOURCE = 'https://sync.orglet.codepawl.com';

  async function accountAgainst(identity: (fields: URLSearchParams) => Response, resources: Parameters<AccountStore['save']>[0]['resources'] = [SYNC_RESOURCE, ACCOUNT_ROUTER_RESOURCE]) {
    const requests: URLSearchParams[] = [];
    let saved: Parameters<AccountStore['save']>[0] | undefined = {
      refreshToken: 'fixture-refresh-0',
      resources,
      profile: { id: 'fixture-account', email: 'a@example.test', name: undefined, plan: 'free', entitlements: {} },
    };
    const store: AccountStore = { read: async () => saved, save: async value => { saved = structuredClone(value); }, remove: async () => { saved = undefined; } };
    const service = new AccountService({
      baseUrl: 'https://accounts.example.test', store, openExternal: async () => undefined,
      fetch: async (_input, options) => {
        const fields = new URLSearchParams(String(options?.body));
        requests.push(fields);
        return identity(fields);
      },
    });
    await service.load();
    return { service, requests, saved: () => saved };
  }

  it('sends the resource and the router scope on the refresh, without changing what the sign-in was granted', async () => {
    const { service, requests, saved } = await accountAgainst(() => Response.json({ access_token: 'fixture-access-1', refresh_token: 'fixture-refresh-1', expires_in: 900 }));
    expect(await service.getAccessToken(ACCOUNT_ROUTER_RESOURCE)).toBe('fixture-access-1');
    expect(requests[0].get('resource')).toBe(ACCOUNT_ROUTER_RESOURCE);
    expect(requests[0].get('scope')).toBe(ACCOUNT_ROUTER_SCOPE);
    expect(saved()?.resources).toEqual([SYNC_RESOURCE, ACCOUNT_ROUTER_RESOURCE]);
  });

  it('turns invalid_target into a refusal that keeps the sign-in', async () => {
    const { service } = await accountAgainst(() => Response.json({ error: 'invalid_target' }, { status: 400 }));
    await expect(service.getAccessToken(ACCOUNT_ROUTER_RESOURCE)).rejects.toBeInstanceOf(ResourceRefused);
    expect(service.state().status).toBe('signed_in');
  });

  it('shows the router as not open through the connection when the real account service refuses', async () => {
    const { service } = await accountAgainst(() => Response.json({ error: 'invalid_scope' }, { status: 400 }));
    const keys = memoryKeys();
    const subject = new RouterConnection({ baseUrl: router.origin, account: service, keys, keyIds: memoryKeyIds(), deviceName: 'Orglet on LAPTOP' });
    expect(await subject.connect()).toEqual({ status: 'not_open' });
    expect(router.received).toHaveLength(0);
    expect(keys.value).toBeNull();
  });

  it('does not ask the accounts service at all for a sign-in that did not ask for the router, and says to sign in again', async () => {
    const { service, requests } = await accountAgainst(() => Response.json({ access_token: 'unused' }), [SYNC_RESOURCE]);
    await expect(service.getAccessToken(ACCOUNT_ROUTER_RESOURCE)).rejects.toBeInstanceOf(RouterSignInRequired);
    expect(requests).toHaveLength(0);

    const keys = memoryKeys();
    const subject = new RouterConnection({ baseUrl: router.origin, account: service, keys, keyIds: memoryKeyIds(), deviceName: 'Orglet on LAPTOP' });
    expect(await subject.state()).toEqual({ status: 'sign_in_again' });
    expect(await subject.connect()).toEqual({ status: 'sign_in_again' });
    expect(await subject.usage()).toEqual({ known: false });
    expect(requests).toHaveLength(0);
    expect(router.received).toHaveLength(0);
    expect(keys.value).toBeNull();
  });

});

describe('signing in on a build with and without a router', () => {
  /** Behaves like the real service: a router refresh works only when the authorization request listed the router and its scope. */
  async function signedInAgainst(routerConfigured: boolean | undefined) {
    const opened: string[] = [];
    const refreshes: URLSearchParams[] = [];
    let askedForRouter = false;
    let saved: Parameters<AccountStore['save']>[0] | undefined;
    const store: AccountStore = { read: async () => saved, save: async value => { saved = structuredClone(value); }, remove: async () => { saved = undefined; } };
    const service = new AccountService({
      baseUrl: 'https://accounts.example.test', store, ...(routerConfigured === undefined ? {} : { routerConfigured }),
      openExternal: async address => { opened.push(address); },
      fetch: async (input, options) => {
        const address = String(input);
        if (address.endsWith('/me')) return Response.json({ id: 'fixture-account', email: 'a@example.test', plan: 'free', entitlements: {} });
        const fields = new URLSearchParams(String(options?.body));
        if (fields.get('grant_type') === 'refresh_token') {
          refreshes.push(fields);
          if (fields.get('resource') === ACCOUNT_ROUTER_RESOURCE && !askedForRouter) return Response.json({ error: 'invalid_target' }, { status: 400 });
        }
        return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 900 });
      },
    });
    const finished = service.signIn();
    while (opened.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const authorize = new URL(opened[0]);
    askedForRouter = authorize.searchParams.getAll('resource').includes(ACCOUNT_ROUTER_RESOURCE) && authorize.searchParams.get('scope')!.split(' ').includes(ACCOUNT_ROUTER_SCOPE);
    const callback = new URL(authorize.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('state', authorize.searchParams.get('state')!);
    expect(service.handleCallback(callback.toString())).toBe(true);
    await finished;
    return { service, authorize, refreshes, saved: () => saved };
  }

  it('asks for the router resource and scope, and saves that the sign-in did, when the build names a router', async () => {
    const { service, authorize, saved } = await signedInAgainst(true);
    expect(authorize.searchParams.get('scope')).toBe('openid profile email offline_access router:manage');
    expect(authorize.searchParams.getAll('resource')).toEqual([
      'https://sync.orglet.codepawl.com', 'https://market.orglet.codepawl.com', ACCOUNT_ROUTER_RESOURCE,
    ]);
    expect(saved()?.resources).toEqual(['https://sync.orglet.codepawl.com', 'https://market.orglet.codepawl.com', ACCOUNT_ROUTER_RESOURCE]);
    expect(service.signInCoversRouter()).toBe(true);
  });

  it('asks exactly what it always did, and saves no router, when the build names none', async () => {
    for (const routerConfigured of [undefined, false]) {
      const { service, authorize, saved } = await signedInAgainst(routerConfigured);
      expect(authorize.searchParams.get('scope')).toBe('openid profile email offline_access');
      expect(authorize.searchParams.getAll('resource')).toEqual(['https://sync.orglet.codepawl.com', 'https://market.orglet.codepawl.com']);
      expect(saved()?.resources).toEqual(['https://sync.orglet.codepawl.com', 'https://market.orglet.codepawl.com']);
      expect(service.signInCoversRouter()).toBe(false);
    }
  });

  it('is told to sign in again by an old sign-in, and after signing in again the refresh carries the resource and scope and the connection is made', async () => {
    const old = await signedInAgainst(false);
    const oldConnection = new RouterConnection({ baseUrl: router.origin, account: old.service, keys: memoryKeys(), keyIds: memoryKeyIds(), deviceName: 'Orglet on LAPTOP' });
    expect(await oldConnection.connect()).toEqual({ status: 'sign_in_again' });
    expect(old.refreshes).toHaveLength(0);

    const renewed = await signedInAgainst(true);
    const keys = memoryKeys();
    const connection = new RouterConnection({ baseUrl: router.origin, account: renewed.service, keys, keyIds: memoryKeyIds(), deviceName: 'Orglet on LAPTOP' });
    expect(await connection.state()).toEqual({ status: 'ready' });
    expect(await connection.connect()).toMatchObject({ status: 'connected' });
    expect(renewed.refreshes[0].get('resource')).toBe(ACCOUNT_ROUTER_RESOURCE);
    expect(renewed.refreshes[0].get('scope')).toBe(ACCOUNT_ROUTER_SCOPE);
    expect(keys.value).toBe(ROUTER_KEY);
  });
});

describe('chatting through the router', () => {
  const tools = [{ type: 'function' as const, function: { name: 'reply', description: 'Reply', parameters: { type: 'object', properties: { text: { type: 'string' } } } } }];

  it('sends the request to the router with the key and streams the answer back', async () => {
    const adapter = new CodepawlAdapter(ROUTER_KEY, router.apiUrl, 'codepawl/free-small');
    const reply = await adapter.request([{ role: 'user', content: 'Hello' }], tools, new AbortController().signal, () => {});

    const chat = router.received.filter(item => item.url === '/v1/chat/completions');
    expect(chat).toHaveLength(1);
    expect(chat[0].authorization).toBe(`Bearer ${ROUTER_KEY}`);
    expect(chat[0].body).toMatchObject({ model: 'codepawl/free-small', stream: true });
    expect(reply.calls).toEqual([{ id: 'call_1', name: 'reply', arguments: '{"text":"hi"}' }]);
    expect(reply.usage).toMatchObject({ input: 12, output: 3 });
  });

  it('shows the router\'s own refusal in words, with no key in it', async () => {
    router.behavior.chat = { status: 429, message: `Free tokens used up for today; they return at 00:00 UTC. (${ROUTER_KEY})` };
    const adapter = new CodepawlAdapter(ROUTER_KEY, router.apiUrl, 'codepawl/free-small');
    const failure = await adapter.request([{ role: 'user', content: 'Hello' }], tools, new AbortController().signal, () => {}).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderRequestError);
    expect(failure.message).toContain('Free tokens used up for today');
    expect(failure.message).not.toContain('cpr_');
  });

  it('tells a refused key apart from a rate refusal', async () => {
    router.behavior.chat = { status: 401, message: 'Invalid key.' };
    const adapter = new CodepawlAdapter(ROUTER_KEY, router.apiUrl, 'codepawl/free-small');
    const failure = await adapter.request([{ role: 'user', content: 'Hello' }], tools, new AbortController().signal, () => {}).catch(error => error);
    expect(failure.message).toContain('từ chối key');
  });
});

describe('the model list and how a run is classed', () => {
  it('reads the router\'s list through the model-list machinery, one entry per ID, with no price or free mark', async () => {
    const row = await fetchProviderList('codepawl', {
      readKey: async provider => provider === 'codepawl' ? ROUTER_KEY : null,
      endpoints: { codepawl: router.apiUrl },
      harnesses: async () => [],
      now: () => new Date('2026-10-10T00:00:00Z'),
    });
    expect(row.error).toBeUndefined();
    expect(row.models).toEqual([
      { provider: 'codepawl', id: 'codepawl/free-small', source: 'native' },
      { provider: 'codepawl', id: 'codepawl/large', source: 'native' },
    ]);
    expect(router.received[0]).toMatchObject({ url: '/v1/models', authorization: `Bearer ${ROUTER_KEY}` });
  });

  it('says the connection is missing when no key is saved, and asks the router nothing', async () => {
    const row = await fetchProviderList('codepawl', {
      readKey: async () => null, endpoints: { codepawl: router.apiUrl }, harnesses: async () => [], now: () => new Date('2026-10-10T00:00:00Z'),
    });
    expect(row.models).toEqual([]);
    expect(row.error).toContain('Chưa kết nối');
    expect(router.received).toHaveLength(0);
  });

  it('refuses a list that is not a list', () => {
    expect(() => parseCodepawlModels({ models: [] })).toThrow();
  });

  it('is a provider with a plan, not a priced API Orglet reserves against', () => {
    expect(ApiProvider.options).toContain('codepawl');
    expect(isPlanApi('codepawl')).toBe(true);
    expect(isPaidApi('codepawl')).toBe(false);
    expect(resolveWorkerModel({ provider: 'codepawl', modelId: 'codepawl/large' })).toEqual({ id: 'codepawl/large', pricingVersion: 'plan:codepawl:codepawl/large' });
    expect(resolveWorkerModel({ provider: 'codepawl' }).id).toBeUndefined();
  });
});

describe('the Model menu', () => {
  it('lists CodePawl only once a router key is saved, so a normal install shows nothing new', () => {
    const none = workerProviderOptions(readiness(emptyConnections(), []), [], []);
    expect(none.map(option => option.value)).not.toContain('codepawl');
    const connected = workerProviderOptions(readiness({ ...emptyConnections(), codepawl: true }, []), [], []);
    const option = connected.find(candidate => candidate.value === 'codepawl');
    expect(option?.label).toBe('CodePawl');
    expect(option?.dimmed).toBeFalsy();
  });
});

describe('usage', () => {
  it('reads free tokens left today and leaves out included usage when the account has no plan', async () => {
    const { subject } = connection();
    const usage = await subject.usage();
    expect(usage).toEqual({ known: true, freeTokensLeft: 41_000, freeTokensLimit: 50_000, freeResetsAt: '2026-10-11T00:00:00.000Z' });
    expect(usage.includedLeftMicros).toBeUndefined();
    expect(router.received[0]).toMatchObject({ url: '/v1/usage', authorization: `Bearer ${ACCESS_TOKEN}` });
  });

  it('reads the included usage left this period when there is a plan', async () => {
    router.behavior.usage = { free: { tokensLeft: 0, tokensLimit: 50_000, resetsAt: '2026-10-11T00:00:00.000Z' }, starter: { leftMicros: 2_250_000, periodEnd: '2026-11-01T00:00:00.000Z' } };
    const usage = await connection().subject.usage();
    expect(usage).toMatchObject({ known: true, freeTokensLeft: 0, includedLeftMicros: 2_250_000, includedPeriodEnd: '2026-11-01T00:00:00.000Z' });
  });

  it('stays unknown, with no number at all, when the router cannot say', async () => {
    const unknown = { known: false };
    router.behavior.usageStatus = 503;
    expect(await connection().subject.usage()).toEqual(unknown);

    router.behavior.usageStatus = 200;
    router.behavior.usage = { free: { tokensLeft: 'many' } };
    expect(await connection().subject.usage()).toEqual(unknown);

    const refused = fakeAccount();
    refused.refuse = true;
    expect(await connection({ account: refused }).subject.usage()).toEqual(unknown);
    expect(await connection({ account: fakeAccount('local') }).subject.usage()).toEqual(unknown);
  });
});

describe('the key stays in main', () => {
  it('has no field for a key in anything the window receives', async () => {
    const { subject } = connection();
    const state = CodepawlState.parse(await subject.connect());
    const usage = CodepawlUsage.parse(await subject.usage());
    expect(JSON.stringify([state, usage])).not.toContain('cpr_');
    expect(() => CodepawlState.parse({ status: 'connected', key: ROUTER_KEY })).toThrow();
    expect(() => CodepawlUsage.parse({ known: true, secret: ROUTER_KEY })).toThrow();
  });

  it('writes the key to no log while connecting, disconnecting and failing', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => { logged.push(parts.map(String).join(' ')); });
    }
    const { subject } = connection();
    await subject.connect();
    await subject.usage();
    await subject.disconnect();
    router.behavior.chat = { status: 500, message: `boom ${ROUTER_KEY}` };
    await new CodepawlAdapter(ROUTER_KEY, router.apiUrl, 'codepawl/large').request([{ role: 'user', content: 'x' }], [], new AbortController().signal, () => {}).catch(() => undefined);
    expect(logged.join('\n')).not.toContain('cpr_');
  });

  it('keeps only an identifier on disk beside the credentials, never the key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-router-'));
    try {
      const keyIds = new RouterKeyIdFile(directory);
      expect(await keyIds.read()).toBeUndefined();
      await keyIds.save(KEY_ID);
      expect(await keyIds.read()).toBe(KEY_ID);
      const files = await readdir(directory);
      for (const file of files) expect(await readFile(join(directory, file), 'utf8')).not.toContain('cpr_');
      await keyIds.remove();
      await keyIds.remove();
      expect(await keyIds.read()).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('carries the key into no backup, though a worker uses the connection and its model list was read with the key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-router-backup-'));
    const store = new Store(join(directory, 'test.sqlite'));
    const core = new CoreService(store, () => {}, async () => { throw new Error('No run in this test.'); }, undefined, undefined, undefined, undefined, {
      readKey: async provider => provider === 'codepawl' ? ROUTER_KEY : null,
      endpoints: { codepawl: router.apiUrl },
    });
    try {
      const worker = store.all<Worker>('workers')[0];
      await core.command('saveWorker', { ...worker, provider: 'codepawl', modelId: 'codepawl/free-small' });
      const list = await core.command('modelList', { provider: 'codepawl' }) as ModelListResult;
      expect(list.models.map(model => model.id)).toEqual(['codepawl/free-small', 'codepawl/large']);
      expect(router.received.some(item => item.authorization === `Bearer ${ROUTER_KEY}`)).toBe(true);
      expect(core.backups.export()).not.toContain('cpr_');
      expect(JSON.stringify(store.all('workers'))).not.toContain('cpr_');
    } finally {
      await core.runner.shutdown();
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts only the shape the router makes, so a pasted key of another service is not kept', () => {
    expect(ROUTER_KEY_PATTERN.test(ROUTER_KEY)).toBe(true);
    expect(ROUTER_KEY_PATTERN.test('sk-or-aaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(ROUTER_KEY_PATTERN.test('cpr_short')).toBe(false);
  });

  it('names the key after the computer within the router\'s limit', () => {
    expect(routerKeyName('LAPTOP-01')).toBe('Orglet on LAPTOP-01');
    expect(routerKeyName('')).toBe('Orglet on this computer');
    expect(routerKeyName('x'.repeat(200))).toHaveLength(80);
  });
});
