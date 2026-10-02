import { expect, it, vi } from 'vitest';
import { AccountService, MARKET_SIGN_IN_REQUIRED, type AccountStore } from '../../apps/desktop/src/main/account';
import { ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE, type AccountResource } from '../../apps/desktop/src/shared/account';

type Saved = NonNullable<Awaited<ReturnType<AccountStore['read']>>>;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(resources: AccountResource[] | null = [ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE]) {
  let saved: Saved | undefined = {
    refreshToken: 'fixture-refresh-0', resources: resources ?? undefined,
    profile: { id: 'fixture-old-account', email: 'old@example.test', name: undefined, plan: 'free', entitlements: {} },
  };
  const requests: URLSearchParams[] = [];
  const revoked: string[] = [];
  const opened: string[] = [];
  let saveGate: ReturnType<typeof deferred> | undefined;
  let networkGate: ReturnType<typeof deferred> | undefined;
  let failSave = false;
  let invalidTarget = false;
  let browserFails = false;
  let onChange: (() => void) | undefined;
  let issued = 0;
  let saving = deferred();
  const requesting = deferred();
  const store: AccountStore = {
    read: async () => saved,
    save: async account => {
      saving.resolve();
      const gate = saveGate;
      saveGate = undefined;
      await gate?.promise;
      if (failSave) throw Error('Fixture disk failure');
      saved = structuredClone(account);
    },
    remove: async () => { saved = undefined; },
  };
  const service = new AccountService({
    baseUrl: 'https://accounts.example.test', store,
    onChange: () => onChange?.(),
    openExternal: async url => {
      opened.push(url);
      if (browserFails) throw Error('Fixture browser failure');
    },
    fetch: async (input, options) => {
      const path = new URL(String(input)).pathname;
      if (path === '/me') return Response.json({ id: 'fixture-new-account', email: 'new@example.test', plan: 'free', entitlements: {} });
      const fields = new URLSearchParams(String(options?.body));
      if (path.endsWith('/revoke')) {
        revoked.push(fields.get('token')!);
        return Response.json({});
      }
      requests.push(fields);
      if (invalidTarget && fields.get('resource') === ACCOUNT_MARKET_RESOURCE) return Response.json({ error: 'invalid_target' }, { status: 400 });
      issued += 1;
      const tokenNumber = issued;
      const gate = fields.get('grant_type') === 'refresh_token' ? networkGate : undefined;
      if (gate) {
        networkGate = undefined;
        requesting.resolve();
        await gate.promise;
      }
      return Response.json({ access_token: `fixture-access-${tokenNumber}`, refresh_token: `fixture-refresh-${tokenNumber}`, expires_in: 900 });
    },
  });
  return {
    service, store, requests, revoked, opened, requesting,
    get saving() { return saving; },
    saved: () => saved,
    gateSave: () => {
      saving = deferred();
      saveGate = deferred();
      return saveGate;
    },
    gateNetwork: () => {
      networkGate = deferred();
      return networkGate;
    },
    failSave: (value: boolean) => { failSave = value; },
    invalidTarget: () => { invalidTarget = true; },
    browserFails: () => { browserFails = true; },
    onChange: (callback: () => void) => { onChange = callback; },
  };
}

async function finishBrowser(fixtureState: ReturnType<typeof fixture>) {
  const url = new URL(fixtureState.opened.at(-1)!);
  const callback = new URL('com.codepawl.orglet:/auth/callback');
  callback.searchParams.set('state', url.searchParams.get('state')!);
  callback.searchParams.set('code', 'fixture-code');
  expect(fixtureState.service.handleCallback(callback.toString())).toBe(true);
}

it('keeps old credentials sync-only until an explicit browser grant upgrade', async () => {
  const state = fixture(null);
  await state.service.load();
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).rejects.toThrow(MARKET_SIGN_IN_REQUIRED);
  expect(state.requests).toHaveLength(0);
  await expect(state.service.getAccessToken()).resolves.toBe('fixture-access-1');
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  await signedIn;
  expect(state.saved()?.resources).toEqual([ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE]);
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-3');
});

it.each([
  { phase: 'network', outcome: 'cancel' },
  { phase: 'network', outcome: 'browser failure' },
  { phase: 'save', outcome: 'cancel' },
  { phase: 'save', outcome: 'browser failure' },
])('retains the existing rotation during $phase when browser upgrade ends with $outcome', async ({ phase, outcome }) => {
  const state = fixture();
  await state.service.load();
  const gate = phase === 'network' ? state.gateNetwork() : state.gateSave();
  const refresh = state.service.getAccessToken().catch(error => error);
  await (phase === 'network' ? state.requesting.promise : state.saving.promise);
  if (outcome === 'browser failure') state.browserFails();
  const signIn = state.service.signIn().catch(() => undefined);
  if (outcome === 'cancel') state.service.cancelSignIn();
  await signIn;
  gate.resolve();
  expect(await refresh).toBe('fixture-access-1');
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-1');
  expect(state.saved()?.profile.id).toBe('fixture-old-account');
  expect(state.revoked).toEqual([]);
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-2');
  expect(state.requests.at(-1)?.get('refresh_token')).toBe('fixture-refresh-1');
});

it('coalesces each resource and persists its rotation before dispatching the next resource', async () => {
  const state = fixture();
  await state.service.load();
  const gate = state.gateSave();
  const market = state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE);
  const sameMarket = state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE);
  const sync = state.service.getAccessToken();
  await state.saving.promise;
  expect(state.requests).toHaveLength(1);
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-0');
  gate.resolve();
  await expect(Promise.all([market, sameMarket, sync])).resolves.toEqual(['fixture-access-1', 'fixture-access-1', 'fixture-access-2']);
  expect(state.requests.map(fields => fields.get('refresh_token'))).toEqual(['fixture-refresh-0', 'fixture-refresh-1']);
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-2');
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-1');
  expect(state.requests).toHaveLength(2);
  const restarted = new AccountService({ baseUrl: 'https://accounts.example.test', store: {
    read: async () => state.saved(), save: async () => {}, remove: async () => {},
  }, openExternal: async () => {}, fetch: async (_input, options) => {
    expect(new URLSearchParams(String(options?.body)).get('refresh_token')).toBe('fixture-refresh-2');
    return Response.json({ access_token: 'restart-access', refresh_token: 'restart-refresh' });
  } });
  await restarted.load();
  await expect(restarted.getAccessToken()).resolves.toBe('restart-access');
});

it('keeps invalid_target isolated from a usable sync grant', async () => {
  const state = fixture();
  await state.service.load();
  state.invalidTarget();
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).rejects.toThrow(MARKET_SIGN_IN_REQUIRED);
  expect(state.service.state().status).toBe('signed_in');
  await expect(state.service.getAccessToken()).resolves.toBe('fixture-access-1');
});

it.each(['cancel', 'browser failure'] as const)('never reuses an unpersisted rotation after %s of a new sign-in', async scenario => {
  const state = fixture();
  await state.service.load();
  state.failSave(true);
  await expect(state.service.getAccessToken()).rejects.toThrow('Fixture disk failure');
  expect(state.saved()).toBeUndefined();
  if (scenario === 'browser failure') state.browserFails();
  const signIn = state.service.signIn();
  const result = signIn.catch(() => undefined);
  if (scenario === 'cancel') state.service.cancelSignIn();
  await result;
  await expect(state.service.getAccessToken()).rejects.toThrow();
  expect(state.requests).toHaveLength(1);
  expect(state.service.state().status).toBe('expired');
});

it('fences sign-out during persistence before caching or returning the access token', async () => {
  const state = fixture();
  await state.service.load();
  const gate = state.gateSave();
  const refresh = state.service.getAccessToken().catch(error => error);
  await state.saving.promise;
  const signedOut = state.service.signOut();
  gate.resolve();
  expect(await refresh).toBeInstanceOf(Error);
  await signedOut;
  expect(state.saved()).toBeUndefined();
  expect(state.service.state()).toEqual({ status: 'local' });
  await expect(state.service.getAccessToken()).rejects.toThrow();
});

it('a newer browser sign-in wins over an old rotation still saving to disk', async () => {
  const state = fixture();
  await state.service.load();
  const gate = state.gateSave();
  const refresh = state.service.getAccessToken().catch(error => error);
  await state.saving.promise;
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  gate.resolve();
  expect(await refresh).toBe('fixture-access-1');
  await signedIn;
  expect(state.saved()?.profile.id).toBe('fixture-new-account');
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-2');
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-3');
  expect(state.requests.at(-1)?.get('refresh_token')).toBe('fixture-refresh-2');
});

it('rejects an old rotation queued behind a committed replacement save', async () => {
  const state = fixture();
  await state.service.load();
  const networkGate = state.gateNetwork();
  const refresh = state.service.getAccessToken().catch(error => error);
  await state.requesting.promise;
  const saveGate = state.gateSave();
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  await state.saving.promise;
  networkGate.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  saveGate.resolve();
  await signedIn;
  expect(await refresh).toBeInstanceOf(Error);
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-2');
  expect(state.revoked).toContain('fixture-refresh-1');
  expect(state.revoked).not.toContain('fixture-refresh-2');
  expect(state.saved()?.profile.id).toBe('fixture-new-account');
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-3');
  expect(state.requests.at(-1)?.get('refresh_token')).toBe('fixture-refresh-2');
});

it('restores the rotated active grant when a replacement save is cancelled', async () => {
  const state = fixture();
  await state.service.load();
  await state.service.getAccessToken();
  const saveGate = state.gateSave();
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  await state.saving.promise;
  state.service.cancelSignIn();
  await signedIn;
  saveGate.resolve();
  await expect.poll(() => state.revoked).toContain('fixture-refresh-2');
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-1');
  expect(state.saved()?.profile.id).toBe('fixture-old-account');
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-3');
  expect(state.requests.at(-1)?.get('refresh_token')).toBe('fixture-refresh-1');
});

it('allows a newer browser attempt to replace a cancelled replacement save', async () => {
  const state = fixture();
  await state.service.load();
  const saveGate = state.gateSave();
  const first = state.service.signIn().catch(error => error);
  await finishBrowser(state);
  await state.saving.promise;
  const second = state.service.signIn();
  await finishBrowser(state);
  saveGate.resolve();
  expect(await first).toBeInstanceOf(Error);
  await second;
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-2');
  expect(state.revoked).toContain('fixture-refresh-1');
});

it('removes a replacement saved after sign-out without retaining either grant', async () => {
  const state = fixture();
  await state.service.load();
  const saveGate = state.gateSave();
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  await state.saving.promise;
  const signedOut = state.service.signOut();
  saveGate.resolve();
  await signedOut;
  await signedIn;
  await expect.poll(() => state.revoked).toContain('fixture-refresh-1');
  expect(state.saved()).toBeUndefined();
  expect(state.service.state()).toEqual({ status: 'local' });
});

it('keeps the committed fresh grant when its announcement cancels the completed browser attempt', async () => {
  const state = fixture();
  await state.service.load();
  let cancelled = false;
  state.onChange(() => {
    if (!cancelled && state.saved()?.refreshToken === 'fixture-refresh-1') {
      cancelled = true;
      state.service.cancelSignIn();
    }
  });
  const signedIn = state.service.signIn();
  await finishBrowser(state);
  await signedIn;
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-1');
  expect(state.revoked).toEqual([]);
  await expect(state.service.getAccessToken(ACCOUNT_MARKET_RESOURCE)).resolves.toBe('fixture-access-2');
});

it('does not return a token when the persistence announcement synchronously signs out', async () => {
  const state = fixture();
  await state.service.load();
  let signingOut: Promise<unknown> | undefined;
  state.onChange(() => {
    if (!signingOut) signingOut = state.service.signOut();
  });
  await expect(state.service.getAccessToken()).rejects.toThrow();
  await signingOut;
  expect(state.saved()).toBeUndefined();
  expect(state.service.state()).toEqual({ status: 'local' });
});

it('revokes a fresh browser grant that cannot be persisted', async () => {
  const state = fixture();
  await state.service.load();
  state.failSave(true);
  const signedIn = state.service.signIn();
  const failure = signedIn.catch(error => error);
  await finishBrowser(state);
  expect(await failure).toBeInstanceOf(Error);
  expect(state.revoked).toContain('fixture-refresh-1');
  expect(state.saved()?.refreshToken).toBe('fixture-refresh-0');
});

it.each(['rotation', 'fresh browser grant'] as const)('keeps a durable %s usable when notification delivery throws', async scenario => {
  const state = fixture();
  await state.service.load();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  state.onChange(() => {
    if (state.saved()?.refreshToken === 'fixture-refresh-1') throw Error('Fixture private notification failure');
  });
  try {
    if (scenario === 'rotation') {
      await expect(state.service.getAccessToken()).resolves.toBe('fixture-access-1');
    } else {
      const signedIn = state.service.signIn();
      const outcome = signedIn.catch(error => error);
      await finishBrowser(state);
      expect((await outcome).status).toBe('signed_in');
    }
    expect(state.saved()?.refreshToken).toBe('fixture-refresh-1');
    expect(state.revoked).toEqual([]);
    await expect(state.service.getAccessToken()).resolves.toBe('fixture-access-1');
    expect(state.requests).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('Không gửi được cập nhật trạng thái tài khoản.');
    const restarted = new AccountService({
      baseUrl: 'https://accounts.example.test',
      store: state.store,
      openExternal: async () => {},
      fetch: async (_input, options) => {
        expect(new URLSearchParams(String(options?.body)).get('refresh_token')).toBe('fixture-refresh-1');
        return Response.json({ access_token: 'fixture-restart-access', refresh_token: 'fixture-restart-refresh' });
      },
    });
    await restarted.load();
    await expect(restarted.getAccessToken()).resolves.toBe('fixture-restart-access');
    expect(state.saved()?.refreshToken).toBe('fixture-restart-refresh');
  } finally {
    warning.mockRestore();
  }
});
