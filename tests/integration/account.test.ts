import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountFile,
  AccountService,
  accountPayload,
  pkcePair,
  SIGN_IN_REFUSED,
  SIGN_IN_TIMED_OUT,
  type AccountStore,
} from '../../apps/desktop/src/main/account';
import {
  ACCOUNT_CLIENT_ID,
  ACCOUNT_REDIRECT_URI,
  ACCOUNT_RESOURCE,
  ACCOUNT_SCHEME,
  accountsBaseUrl,
  DEFAULT_ACCOUNTS_URL,
  needsAccountChoice,
  type AccountState,
} from '../../apps/desktop/src/shared/account';
import { parseLaunchArguments } from '../../apps/desktop/src/main/launch-requests';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Workspace } from '../../apps/desktop/src/shared/contracts';

// COD-337: signing in to a CodePawl account from the desktop app, against a fake identity service on loopback. The
// fake keeps the contract the real one promises: PKCE S256, rotating refresh tokens where a replayed one revokes
// every device, `/me` behind a bearer token. No test touches the network beyond this process.

type FakeIdentity = {
  baseUrl: string;
  /** What the browser would do after the person signs in: the callback URL for this authorize address. */
  approve(authorizeUrl: string): string;
  refreshRequests: number;
  revoked: string[];
  log: string[];
  issuedTokens: string[];
  /** Makes the next refresh wait this long before answering, so two callers can overlap it. */
  refreshDelayMs: number;
  /** Every refresh token is refused from now on, as after a replay or a sign-out elsewhere. */
  revokeEverything(): void;
  entitlements: Record<string, unknown>;
  close(): Promise<void>;
};

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function startFakeIdentity(): Promise<FakeIdentity> {
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const accessTokens = new Set<string>();
  let currentRefresh: string | undefined;
  let everythingRevoked = false;
  const fake = {
    refreshRequests: 0,
    revoked: [] as string[],
    log: [] as string[],
    issuedTokens: [] as string[],
    refreshDelayMs: 0,
    entitlements: { syncStorageMb: 100, devices: 3, push: false, nested: { no: 'kept out' } } as Record<string, unknown>,
  };
  const issue = () => {
    const access = `access-${randomUUID()}`;
    const refresh = `refresh-${randomUUID()}`;
    accessTokens.add(access);
    currentRefresh = refresh;
    fake.issuedTokens.push(access, refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 900, id_token: 'not-read' };
  };
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://fake').pathname;
    if (request.method === 'POST' && path === '/api/auth/oauth2/token') {
      const body = await readBody(request);
      if (body.get('client_id') !== ACCOUNT_CLIENT_ID) return json(response, 401, { error: 'invalid_client' });
      if (body.get('grant_type') === 'authorization_code') {
        const code = codes.get(body.get('code') ?? '');
        codes.delete(body.get('code') ?? '');
        const verifier = body.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!code || code.challenge !== challenge || code.redirectUri !== body.get('redirect_uri')) return json(response, 400, { error: 'invalid_grant' });
        return json(response, 200, issue());
      }
      if (body.get('grant_type') === 'refresh_token') {
        fake.refreshRequests++;
        const sent = body.get('refresh_token');
        if (fake.refreshDelayMs) await new Promise(resolve => setTimeout(resolve, fake.refreshDelayMs));
        if (everythingRevoked || !sent || sent !== currentRefresh) {
          // A rotated-out token sent again: the real service revokes the whole family.
          everythingRevoked = true;
          return json(response, 400, { error: 'invalid_grant' });
        }
        return json(response, 200, issue());
      }
      return json(response, 400, { error: 'unsupported_grant_type' });
    }
    if (request.method === 'POST' && path === '/api/auth/oauth2/revoke') {
      const body = await readBody(request);
      fake.revoked.push(body.get('token') ?? '');
      fake.log.push('revoke');
      if (body.get('token') === currentRefresh) currentRefresh = undefined;
      response.writeHead(200);
      return response.end();
    }
    if (request.method === 'GET' && path === '/me') {
      const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!accessTokens.has(token)) return json(response, 401, { error: 'invalid_token' });
      return json(response, 200, { id: 'user-1', email: 'an@example.com', name: 'An', emailVerified: true, plan: 'free', entitlements: fake.entitlements });
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return Object.assign(fake, {
    baseUrl: `http://127.0.0.1:${port}`,
    approve(authorizeUrl: string) {
      const address = new URL(authorizeUrl);
      const code = `code-${randomUUID()}`;
      codes.set(code, { challenge: address.searchParams.get('code_challenge') ?? '', redirectUri: address.searchParams.get('redirect_uri') ?? '' });
      const callback = new URL(address.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', address.searchParams.get('state') ?? '');
      return callback.toString();
    },
    revokeEverything() { everythingRevoked = true; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  });
}

/** An account store in memory that writes what happened into the fake's log, so the order can be checked. */
function memoryStore(log: string[]): AccountStore & { saved: unknown } {
  const store = {
    saved: undefined as unknown,
    async read() { return store.saved as Awaited<ReturnType<AccountStore['read']>>; },
    async save(account: unknown) { store.saved = structuredClone(account); log.push('save'); },
    async remove() { store.saved = undefined; log.push('remove'); },
  };
  return store;
}

let identity: FakeIdentity;
let opened: string[];
let states: AccountState[];
let clock: number;
let store: ReturnType<typeof memoryStore>;

function service(overrides: Partial<ConstructorParameters<typeof AccountService>[0]> = {}) {
  return new AccountService({
    baseUrl: identity.baseUrl,
    store,
    openExternal: async address => { opened.push(address); },
    now: () => clock,
    onChange: state => states.push(state),
    ...overrides,
  });
}

/** Opens the browser, lets the fake approve, and returns once the app is signed in. */
async function signIn(account: AccountService): Promise<AccountState> {
  const finished = account.signIn();
  await waitFor(() => opened.length > 0);
  expect(account.handleCallback(identity.approve(opened.at(-1)!))).toBe(true);
  return finished;
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

beforeEach(async () => {
  identity = await startFakeIdentity();
  opened = [];
  states = [];
  clock = Date.parse('2026-09-29T10:00:00Z');
  store = memoryStore(identity.log);
});
afterEach(async () => { await identity.close(); });

describe('starting a sign-in', () => {
  it('makes an S256 PKCE pair from 32 random bytes', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(pkcePair().verifier).not.toBe(verifier);
  });

  it('opens the browser at the authorize endpoint with PKCE, state, scopes and the sync resource', async () => {
    const account = service();
    const finished = account.signIn();
    await waitFor(() => opened.length === 1);
    const address = new URL(opened[0]);
    expect(`${address.origin}${address.pathname}`).toBe(`${identity.baseUrl}/api/auth/oauth2/authorize`);
    expect(Object.fromEntries(address.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'orglet-desktop',
      redirect_uri: 'com.codepawl.orglet:/auth/callback',
      scope: 'openid profile email offline_access',
      code_challenge_method: 'S256',
      resource: ACCOUNT_RESOURCE,
    });
    expect(address.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(address.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(account.state()).toEqual({ status: 'signing_in' });
    account.cancelSignIn();
    await expect(finished).resolves.toEqual({ status: 'local' });
  });

  it('drops a callback with another state and keeps waiting for the right one', async () => {
    const account = service();
    const finished = account.signIn();
    await waitFor(() => opened.length === 1);
    const genuine = new URL(identity.approve(opened[0]));
    const forged = new URL(genuine);
    forged.searchParams.set('state', 'someone-else');
    expect(account.handleCallback(forged.toString())).toBe(false);
    const wrongIssuer = new URL(genuine);
    wrongIssuer.searchParams.set('iss', 'https://evil.example/api/auth');
    expect(account.handleCallback(wrongIssuer.toString())).toBe(false);
    expect(account.handleCallback('com.codepawl.orglet:/somewhere-else?state=x')).toBe(false);
    expect(account.state().status).toBe('signing_in');
    expect(account.handleCallback(genuine.toString())).toBe(true);
    expect((await finished).status).toBe('signed_in');
    // The same link a second time spends nothing.
    expect(account.handleCallback(genuine.toString())).toBe(false);
  });

  it('finishes on the double-slash callback the real service sends back', async () => {
    const account = service();
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    // accounts.codepawl.com answers with `com.codepawl.orglet://auth/callback`, which parses as host `auth`.
    const callback = identity.approve(opened.at(-1)!).replace(`${ACCOUNT_SCHEME}:/auth/`, `${ACCOUNT_SCHEME}://auth/`);
    expect(new URL(callback).host).toBe('auth');
    expect(account.handleCallback(callback)).toBe(true);
    expect(await finished).toMatchObject({ status: 'signed_in', email: 'an@example.com' });
  });

  it('ignores a callback when no sign-in is in progress', () => {
    const account = service();
    expect(account.handleCallback(`${ACCOUNT_REDIRECT_URI}?code=abc&state=abc`)).toBe(false);
    expect(account.state()).toEqual({ status: 'local' });
  });

  it('says so when the person refuses in the browser, and when the ten minutes run out', async () => {
    const account = service({ signInTimeoutMs: 40 });
    const refused = account.signIn();
    await waitFor(() => opened.length === 1);
    const state = new URL(opened[0]).searchParams.get('state');
    expect(account.handleCallback(`${ACCOUNT_REDIRECT_URI}?error=access_denied&state=${state}`)).toBe(true);
    await expect(refused).rejects.toThrow(SIGN_IN_REFUSED);
    expect(account.state()).toEqual({ status: 'local' });
    await expect(account.signIn()).rejects.toThrow(SIGN_IN_TIMED_OUT);
    expect(account.state()).toEqual({ status: 'local' });
  });
});

describe('signed in', () => {
  it('exchanges the code, keeps the refresh token in the store and maps /me into the state', async () => {
    const account = service();
    const state = await signIn(account);
    expect(state).toEqual({ status: 'signed_in', email: 'an@example.com', name: 'An', plan: 'free', entitlements: { syncStorageMb: 100, devices: 3, push: false } });
    const saved = store.saved as { refreshToken: string; profile: { email: string } };
    expect(saved.refreshToken).toBe(identity.issuedTokens[1]);
    expect(saved.profile.email).toBe('an@example.com');
    // A new start reads it back as signed in without asking the service.
    const again = service();
    expect(await again.load()).toMatchObject({ status: 'signed_in', email: 'an@example.com' });
  });

  it('refreshes once for two callers at the same time, and saves the rotated token', async () => {
    const account = service();
    await signIn(account);
    const firstAccess = identity.issuedTokens[0];
    expect(await account.getAccessToken()).toBe(firstAccess);
    expect(identity.refreshRequests).toBe(0);
    clock += 16 * 60 * 1000;
    identity.refreshDelayMs = 30;
    const [one, two] = await Promise.all([account.getAccessToken(), account.getAccessToken()]);
    expect(identity.refreshRequests).toBe(1);
    expect(one).toBe(two);
    expect(one).not.toBe(firstAccess);
    expect((store.saved as { refreshToken: string }).refreshToken).toBe(identity.issuedTokens.at(-1));
    // The rotated token keeps working, which it would not if the old one had been replayed.
    clock += 16 * 60 * 1000;
    identity.refreshDelayMs = 0;
    await expect(account.getAccessToken()).resolves.toMatch(/^access-/);
    expect(identity.refreshRequests).toBe(2);
  });

  it('turns expired when the service refuses the refresh, keeping whose account it was and nothing else lost', async () => {
    const coreStore = new Store(':memory:');
    const core = new CoreService(coreStore, () => {}, async () => { throw new Error('no model'); });
    const workers = (await core.command('workspace', {}) as Workspace).workers;
    const account = service();
    await signIn(account);
    identity.revokeEverything();
    clock += 16 * 60 * 1000;
    await expect(account.getAccessToken()).rejects.toThrow();
    expect(account.state()).toMatchObject({ status: 'expired', email: 'an@example.com' });
    expect(store.saved).toMatchObject({ profile: { email: 'an@example.com' } });
    expect((store.saved as { refreshToken?: string }).refreshToken).toBeUndefined();
    expect(await service().load()).toMatchObject({ status: 'expired', email: 'an@example.com' });
    // The account lives outside SQLite: the orglets and settings there are untouched.
    expect((await core.command('workspace', {}) as Workspace).workers).toEqual(workers);
    coreStore.close();
  });

  it('stays signed in when the refresh cannot reach the service', async () => {
    const account = service();
    await signIn(account);
    await identity.close();
    clock += 16 * 60 * 1000;
    await expect(account.getAccessToken()).rejects.toThrow();
    expect(account.state().status).toBe('signed_in');
    expect((await account.refreshProfile()).status).toBe('signed_in');
    identity = await startFakeIdentity();
  });

  it('signs out by deleting the token here before asking the service to revoke it', async () => {
    const account = service();
    await signIn(account);
    const refreshToken = (store.saved as { refreshToken: string }).refreshToken;
    identity.log.length = 0;
    expect(await account.signOut()).toEqual({ status: 'local' });
    expect(identity.log).toEqual(['remove', 'revoke']);
    expect(identity.revoked).toEqual([refreshToken]);
    expect(store.saved).toBeUndefined();
    await expect(account.getAccessToken()).rejects.toThrow();
  });

  it('still signs out when the revoke request fails', async () => {
    const account = service();
    await signIn(account);
    await identity.close();
    expect(await account.signOut()).toEqual({ status: 'local' });
    expect(store.saved).toBeUndefined();
    identity = await startFakeIdentity();
  });

  it('never hands the window a token', async () => {
    const account = service();
    const replies = [await signIn(account)];
    clock += 16 * 60 * 1000;
    await account.getAccessToken();
    replies.push(await account.refreshProfile(), account.state(), await account.signOut());
    const everything = JSON.stringify([...states, ...replies]);
    expect(identity.issuedTokens.length).toBeGreaterThan(2);
    for (const token of identity.issuedTokens) expect(everything).not.toContain(token);
    expect(() => accountPayload({ status: 'signed_in', refreshToken: 'x' } as AccountState)).toThrow();
  });
});

describe('the token file', () => {
  it('keeps the account encrypted and reads nothing back from a file it cannot decrypt', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orglet-account-'));
    try {
      const encryption = {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
        decryptString: (data: Buffer) => Buffer.from(data).reverse().toString('utf8'),
      };
      const file = new AccountFile(directory, encryption);
      await file.save({ refreshToken: 'refresh-1', profile: { id: 'user-1', email: 'an@example.com', name: 'An', plan: 'free', entitlements: {} } });
      expect(await file.read()).toMatchObject({ refreshToken: 'refresh-1', profile: { email: 'an@example.com' } });
      const broken = new AccountFile(directory, { ...encryption, decryptString: () => { throw new Error('other user'); } });
      expect(await broken.read()).toBeUndefined();
      await file.remove();
      await file.remove();
      expect(await file.read()).toBeUndefined();
      await expect(new AccountFile(directory, { ...encryption, isEncryptionAvailable: () => false }).save({ profile: { id: 'u', email: 'e', name: undefined, plan: 'free', entitlements: {} } })).rejects.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('where the browser comes back', () => {
  it('reads the account scheme on the command line as a sign-in callback, never as an orglet:// link', () => {
    const url = `${ACCOUNT_REDIRECT_URI}?code=abc&state=def`;
    expect(parseLaunchArguments(['Orglet.exe', '--', url])).toEqual({ kind: 'account', url });
    expect(parseLaunchArguments(['Orglet.exe', '--', `${url}${'x'.repeat(9000)}`])).toMatchObject({ kind: 'refused' });
  });

  it('accepts https or a service on this computer, and nothing else', () => {
    expect(accountsBaseUrl(undefined)).toBe(DEFAULT_ACCOUNTS_URL);
    expect(accountsBaseUrl('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(accountsBaseUrl('https://accounts.example.dev')).toBe('https://accounts.example.dev');
    expect(accountsBaseUrl('http://accounts.example.dev')).toBe(DEFAULT_ACCOUNTS_URL);
    expect(accountsBaseUrl('not a url')).toBe(DEFAULT_ACCOUNTS_URL);
  });
});

describe('the first-run question', () => {
  it('is asked on a new install that holds only the seeded Researcher', async () => {
    const coreStore = new Store(':memory:');
    const core = new CoreService(coreStore, () => {}, async () => { throw new Error('no model'); });
    const workspace = await core.command('workspace', {}) as Workspace;
    expect(workspace.accountChoice).toEqual({ choice: null, asked: false });
    expect(needsAccountChoice(workspace, { status: 'local' })).toBe(true);
    // Someone signed in from Settings in the meantime is not asked.
    expect(needsAccountChoice(workspace, { status: 'signed_in', email: 'an@example.com' })).toBe(false);
    await core.command('accountChoice', { choice: 'local' });
    const answered = await core.command('workspace', {}) as Workspace;
    expect(answered.accountChoice).toEqual({ choice: 'local', asked: true });
    expect(needsAccountChoice(answered, { status: 'local' })).toBe(false);
    await expect(core.command('accountChoice', { choice: 'cloud' })).rejects.toThrow();
    coreStore.close();
  });

  it('is not asked once the new install has a chat', async () => {
    const coreStore = new Store(':memory:');
    const core = new CoreService(coreStore, () => {}, async () => { throw new Error('no model'); });
    const { workers } = await core.command('workspace', {}) as Workspace;
    await core.command('createTask', { workerId: workers[0].id, brief: 'Hello', sourceIds: [], consent: false, budgetMicros: 1000 });
    expect(needsAccountChoice(await core.command('workspace', {}) as Workspace, { status: 'local' })).toBe(false);
    for (let attempt = 0; attempt < 300 && core.runner.isActive((await core.command('workspace', {}) as Workspace).tasks[0].id); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    coreStore.close();
  });

  it('is skipped on an empty profile the packaged smokes start from', () => {
    const previous = process.env.ORGLET_SKIP_ACCOUNT_CHOICE;
    process.env.ORGLET_SKIP_ACCOUNT_CHOICE = '1';
    try {
      const smoke = new Store(':memory:');
      expect(smoke.workspace().accountChoice).toEqual({ choice: 'local', asked: false });
      expect(needsAccountChoice(smoke.workspace(), { status: 'local' })).toBe(false);
      smoke.close();
    } finally {
      if (previous === undefined) delete process.env.ORGLET_SKIP_ACCOUNT_CHOICE;
      else process.env.ORGLET_SKIP_ACCOUNT_CHOICE = previous;
    }
  });

  it('is never asked of an install that existed before the account, even with only the seed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orglet-first-run-'));
    try {
      const path = join(directory, 'orglet.sqlite');
      const older = new Store(path);
      // What a database from an earlier build looks like: no record of the question at all.
      older.clearSetting('accountChoice');
      older.close();
      const updated = new Store(path);
      const workspace = updated.workspace();
      expect(workspace.accountChoice).toEqual({ choice: 'local', asked: false });
      expect(needsAccountChoice(workspace, { status: 'local' })).toBe(false);
      updated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
