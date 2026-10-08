import { afterEach, describe, expect, it } from 'vitest';
import { AccountService, listenOnLoopback, SIGN_IN_REPLACED, SIGN_IN_TIMED_OUT, type AccountStore, type LoopbackStarter } from '../../apps/desktop/src/main/account';
import { ACCOUNT_REDIRECT_URI } from '../../apps/desktop/src/shared/account';

// Sign-in returns over a loopback redirect (RFC 8252 section 7.3): a one-shot listener on 127.0.0.1, on a port the
// system picks, that takes the one callback with the sign-in's state and sends the browser on to the service's page.
// These tests use the real listener and a fake `fetch` standing in for the identity service.

const BASE = 'https://accounts.example.test';

function memoryStore(): AccountStore {
  let saved: Awaited<ReturnType<AccountStore['read']>>;
  return {
    async read() { return saved; },
    async save(account) { saved = structuredClone(account); },
    async remove() { saved = undefined; },
  };
}

type Fake = { fetch: typeof fetch; tokenBodies: URLSearchParams[]; failExchange: boolean };

function fakeIdentity(): Fake {
  const fake: Fake = {
    tokenBodies: [],
    failExchange: false,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const address = String(input);
      if (address.endsWith('/oauth2/token')) {
        fake.tokenBodies.push(new URLSearchParams(String(init?.body)));
        if (fake.failExchange) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 900 });
      }
      if (address.endsWith('/me')) return Response.json({ id: 'user-1', email: 'an@example.com', plan: 'free', emailVerified: true });
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  };
  return fake;
}

let services: AccountService[] = [];
afterEach(() => {
  for (const service of services) service.cancelSignIn();
  services = [];
});

function start(options: { signInTimeoutMs?: number; loopback?: LoopbackStarter } = {}) {
  const identity = fakeIdentity();
  const opened: string[] = [];
  const account = new AccountService({
    baseUrl: BASE,
    store: memoryStore(),
    openExternal: async address => { opened.push(address); },
    fetch: identity.fetch,
    loopback: 'loopback' in options ? options.loopback : listenOnLoopback,
    signInTimeoutMs: options.signInTimeoutMs,
  });
  services.push(account);
  return { account, identity, opened };
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

/** What the person's browser does with the callback: one request, the redirect left unfollowed so it can be read. */
async function visit(address: string, init: RequestInit = {}) {
  const response = await fetch(address, { redirect: 'manual', ...init });
  await response.arrayBuffer();
  return { status: response.status, location: response.headers.get('location') };
}

function callbackFor(authorizeUrl: string, extra: Record<string, string> = {}, path?: string) {
  const authorize = new URL(authorizeUrl);
  const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
  if (path) redirect.pathname = path;
  redirect.searchParams.set('state', authorize.searchParams.get('state')!);
  redirect.searchParams.set('code', 'the-code');
  for (const [key, value] of Object.entries(extra)) redirect.searchParams.set(key, value);
  return redirect.toString();
}

async function refused(address: string) {
  await expect(fetch(address, { redirect: 'manual' })).rejects.toThrow();
}

describe('the loopback redirect', () => {
  it('sends a loopback redirect_uri to authorize and the same exact value to the token exchange', async () => {
    const { account, identity, opened } = start();
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    const authorize = new URL(opened[0]!);
    const redirectUri = authorize.searchParams.get('redirect_uri')!;
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);

    const reply = await visit(callbackFor(opened[0]!));
    expect(reply).toEqual({ status: 303, location: `${BASE}/signed-in` });
    expect((await finished).status).toBe('signed_in');
    expect(identity.tokenBodies[0]!.get('redirect_uri')).toBe(redirectUri);
    expect(identity.tokenBodies[0]!.get('grant_type')).toBe('authorization_code');
    await refused(redirectUri);
  });

  it('answers with the failed page when the code is refused, and closes', async () => {
    const { account, identity, opened } = start();
    identity.failExchange = true;
    const finished = account.signIn();
    const outcome = finished.then(() => 'signed in', error => (error as Error).message);
    await waitFor(() => opened.length > 0);
    const reply = await visit(callbackFor(opened[0]!));
    expect(reply).toEqual({ status: 303, location: `${BASE}/signed-in?failed=1` });
    expect(await outcome).not.toBe('signed in');
    await refused(new URL(opened[0]!).searchParams.get('redirect_uri')!);
  });

  it('answers the failed page when the person refused in the browser', async () => {
    const { account, opened } = start();
    const outcome = account.signIn().then(() => 'signed in', error => (error as Error).message);
    await waitFor(() => opened.length > 0);
    const authorize = new URL(opened[0]!);
    const denied = new URL(authorize.searchParams.get('redirect_uri')!);
    denied.searchParams.set('state', authorize.searchParams.get('state')!);
    denied.searchParams.set('error', 'access_denied');
    expect(await visit(denied.toString())).toEqual({ status: 303, location: `${BASE}/signed-in?failed=1` });
    expect(await outcome).not.toBe('signed in');
  });

  it('turns away a wrong state without ending the sign-in, then takes the right one once', async () => {
    const { account, identity, opened } = start();
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    const redirectUri = new URL(opened[0]!).searchParams.get('redirect_uri')!;

    const forged = new URL(callbackFor(opened[0]!));
    forged.searchParams.set('state', 'not-the-state');
    expect(await visit(forged.toString())).toEqual({ status: 303, location: `${BASE}/signed-in?failed=1` });
    expect(account.state().status).toBe('signing_in');
    expect(identity.tokenBodies).toHaveLength(0);

    expect((await visit(callbackFor(opened[0]!))).location).toBe(`${BASE}/signed-in`);
    expect((await finished).status).toBe('signed_in');
    await refused(redirectUri);
    expect(identity.tokenBodies).toHaveLength(1);
  });

  it('answers 404 to another path and to any method but GET, and sends nothing to the service', async () => {
    const { account, identity, opened } = start();
    void account.signIn().catch(() => undefined);
    await waitFor(() => opened.length > 0);
    expect((await visit(callbackFor(opened[0]!, {}, '/elsewhere'))).status).toBe(404);
    expect((await visit(callbackFor(opened[0]!, {}, '/')) ).status).toBe(404);
    expect((await visit(callbackFor(opened[0]!), { method: 'POST' })).status).toBe(404);
    expect((await visit(callbackFor(opened[0]!), { method: 'OPTIONS' })).status).toBe(404);
    expect(identity.tokenBodies).toHaveLength(0);
    expect(account.state().status).toBe('signing_in');
  });

  it('adds no CORS headers', async () => {
    const { account, opened } = start();
    void account.signIn().catch(() => undefined);
    await waitFor(() => opened.length > 0);
    const response = await fetch(callbackFor(opened[0]!, {}, '/elsewhere'), { redirect: 'manual' });
    expect([...response.headers.keys()].filter(name => name.startsWith('access-control'))).toEqual([]);
  });

  it('closes on timeout', async () => {
    const { account, opened } = start({ signInTimeoutMs: 40 });
    const outcome = account.signIn().then(() => 'signed in', error => (error as Error).message);
    await waitFor(() => opened.length > 0);
    const redirectUri = new URL(opened[0]!).searchParams.get('redirect_uri')!;
    expect(await outcome).toBe(SIGN_IN_TIMED_OUT);
    await refused(redirectUri);
  });

  it('closes when the person cancels', async () => {
    const { account, opened } = start();
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    const redirectUri = new URL(opened[0]!).searchParams.get('redirect_uri')!;
    account.cancelSignIn();
    expect((await finished).status).toBe('local');
    await refused(redirectUri);
  });

  it('closes the earlier listener when a second sign-in replaces it', async () => {
    const { account, opened } = start();
    const first = account.signIn().then(() => 'signed in', error => (error as Error).message);
    await waitFor(() => opened.length > 0);
    const firstRedirect = new URL(opened[0]!).searchParams.get('redirect_uri')!;
    void account.signIn().catch(() => undefined);
    expect(await first).toBe(SIGN_IN_REPLACED);
    await waitFor(() => opened.length > 1);
    await refused(firstRedirect);
    const secondRedirect = new URL(opened[1]!).searchParams.get('redirect_uri')!;
    expect(secondRedirect).not.toBe(firstRedirect);
    expect((await visit(callbackFor(opened[1]!, {}, '/nope'))).status).toBe(404);
  });

  it('falls back to the custom scheme when the listener cannot start', async () => {
    const { account, identity, opened } = start({ loopback: async () => { throw new Error('EADDRINUSE'); } });
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    const authorize = new URL(opened[0]!);
    expect(authorize.searchParams.get('redirect_uri')).toBe(ACCOUNT_REDIRECT_URI);
    expect(account.handleCallback(callbackFor(opened[0]!).replace(/^.*\?/, `${ACCOUNT_REDIRECT_URI}?`))).toBe(true);
    expect((await finished).status).toBe('signed_in');
    expect(identity.tokenBodies[0]!.get('redirect_uri')).toBe(ACCOUNT_REDIRECT_URI);
  });

  it('keeps the scheme redirect when no listener is configured', async () => {
    const { account, opened } = start({ loopback: undefined });
    void account.signIn().catch(() => undefined);
    await waitFor(() => opened.length > 0);
    expect(new URL(opened[0]!).searchParams.get('redirect_uri')).toBe(ACCOUNT_REDIRECT_URI);
  });
});

describe('the wait screen actions', () => {
  it('opens the same sign-in page again and hands out that address while waiting', async () => {
    const { account, opened } = start();
    expect(account.signInLink()).toBeUndefined();
    void account.signIn().catch(() => undefined);
    await waitFor(() => opened.length > 0);
    expect(account.signInLink()).toBe(opened[0]);
    await account.reopenSignIn();
    expect(opened).toEqual([opened[0], opened[0]]);
    // Only the state and the PKCE challenge travel in the address, never a verifier or a token.
    const link = new URL(account.signInLink()!);
    expect(link.searchParams.get('code_verifier')).toBeNull();
    expect(link.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('has nothing to reopen or copy once the sign-in has ended', async () => {
    const { account, opened } = start();
    const finished = account.signIn();
    await waitFor(() => opened.length > 0);
    account.cancelSignIn();
    await finished;
    await account.reopenSignIn();
    expect(opened).toHaveLength(1);
    expect(account.signInLink()).toBeUndefined();
  });
});
