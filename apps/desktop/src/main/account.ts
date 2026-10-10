import { createHash, randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ACCOUNT_CLIENT_ID,
  ACCOUNT_REDIRECT_URI,
  ACCOUNT_RESOURCE,
  ACCOUNT_MARKET_RESOURCE,
  AccountResource,
  ACCOUNT_SCHEME,
  ACCOUNT_SCOPES,
  AccountProfile,
  AccountState,
  accountEndpoints,
} from '../shared/account';
import { ACCOUNT_ROUTER_RESOURCE, ACCOUNT_ROUTER_SCOPE, ROUTER_SIGN_IN_AGAIN } from '../shared/router';
import type { SecretEncryption } from './mcp-secrets';

/**
 * The CodePawl account on this computer (COD-337). Main owns every token: the refresh token sits encrypted in one file
 * next to the API keys, the access token lives in memory only, and the window hears the `AccountState` and nothing
 * else. Nothing here imports Electron, so the tests drive it against a fake identity server.
 */

/** A sign-in the person started and never finished gives up after this long. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
/** An access token this close to its end is refreshed before use rather than sent and refused. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

export const SIGN_IN_TIMED_OUT = 'Hết thời gian đăng nhập.';
export const SIGN_IN_REFUSED = 'Chưa đăng nhập xong trong trình duyệt.';
export const SIGN_IN_FAILED = 'Không đăng nhập được. Kiểm tra kết nối mạng.';
export const SIGN_IN_BROWSER_FAILED = 'Không mở được trình duyệt để đăng nhập.';
export const SIGN_IN_REPLACED = 'Đã bắt đầu một lần đăng nhập khác.';
const SIGN_IN_EXPIRED = 'Phiên đăng nhập đã hết. Đăng nhập lại.';
const NOT_SIGNED_IN = 'Chưa đăng nhập tài khoản CodePawl.';
export const MARKET_SIGN_IN_REQUIRED = 'Đăng nhập lại trong trình duyệt để dùng tài khoản với marketplace.';

/** What a sign-in can have asked for: the two audiences every sign-in asks for, and the router when the build names one. */
const SavedResource = z.union([AccountResource, z.literal(ACCOUNT_ROUTER_RESOURCE)]);

/** What the token file holds: the profile last read, and the refresh token while the sign-in is still good. */
const SavedAccount = z.object({
  refreshToken: z.string().min(1).max(4096).optional(),
  resources: z.array(SavedResource).min(1).max(3).refine(resources => new Set(resources).size === resources.length).optional(),
  profile: AccountProfile,
  /**
   * This install agreed to sync: a sign-in finished on a build that syncs, or the person started sync. A sign-in saved
   * by an earlier build has none, because that build said nothing would leave this computer (0.13.0).
   */
  syncAgreed: z.boolean().optional(),
}).strict();
type SavedAccount = z.infer<typeof SavedAccount>;

/** Where the account is kept between starts. */
export type AccountStore = {
  read(): Promise<SavedAccount | undefined>;
  save(account: SavedAccount): Promise<void>;
  remove(): Promise<void>;
};

/** One encrypted file, `account.credential`, beside the API key files; never in SQLite, so no backup carries it. */
export class AccountFile implements AccountStore {
  private path: string;
  constructor(directory: string, private encryption: SecretEncryption, private platform: NodeJS.Platform = process.platform) {
    this.path = join(directory, 'account.credential');
  }

  async read(): Promise<SavedAccount | undefined> {
    try {
      const text = this.encryption.decryptString(await readFile(this.path));
      return SavedAccount.parse(JSON.parse(text));
    } catch {
      return undefined;
    }
  }

  async save(account: SavedAccount) {
    const basicText = this.platform === 'linux' && this.encryption.getSelectedStorageBackend?.() === 'basic_text';
    if (!this.encryption.isEncryptionAvailable() || basicText) throw new Error('OS credential storage không khả dụng.');
    await writeFile(this.path, this.encryption.encryptString(JSON.stringify(SavedAccount.parse(account))), { mode: 0o600 });
  }

  async remove() {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** The path the identity service sends the browser back to, on the loopback address and on the custom scheme alike. */
const CALLBACK_PATH = '/auth/callback';
const LOOPBACK_ADDRESS = '127.0.0.1';

/**
 * Answers one request to the loopback callback with the query it carried. It returns the address the browser is sent
 * on to (303), or nothing when the request is not a callback for the sign-in in progress.
 */
export type LoopbackHandler = (query: URLSearchParams) => Promise<string | undefined>;

/** A listener on 127.0.0.1 for the length of one sign-in. */
export type LoopbackServer = { port: number; close(): void };
export type LoopbackStarter = (handle: LoopbackHandler) => Promise<LoopbackServer>;

/**
 * RFC 8252 section 7.3: a one-shot HTTP listener on the loopback interface, on a port the system picks. It serves
 * `GET /auth/callback` and nothing else (no CORS, no other route), and it never writes the query anywhere.
 */
export const listenOnLoopback: LoopbackStarter = async handle => {
  const server = createServer((request, response) => {
    const notFound = () => {
      response.writeHead(404, { connection: 'close' });
      response.end();
    };
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${LOOPBACK_ADDRESS}`);
    } catch {
      return notFound();
    }
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) return notFound();
    handle(url.searchParams).then(location => {
      if (!location) return notFound();
      response.writeHead(303, { location, connection: 'close', 'cache-control': 'no-store' });
      response.end();
    }, notFound);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_ADDRESS, () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.on('error', () => undefined);
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    // A response still being written finishes on its own: every reply carries `connection: close`.
    close: () => {
      server.close();
      server.closeIdleConnections();
    },
  };
};

export type AccountDependencies = {
  /** `https://accounts.codepawl.com`, or a development service named by `ORGLET_ACCOUNTS_URL`. */
  baseUrl: string;
  store: AccountStore;
  /** Opens the system browser; main passes `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
  signInTimeoutMs?: number;
  onChange?: (state: AccountState) => void;
  /**
   * Starts the loopback listener the browser returns to. Main passes `listenOnLoopback`; without it, or when it
   * fails to listen, the sign-in returns through the custom scheme instead.
   */
  loopback?: LoopbackStarter;
  /** This build names a CodePawl router, so the sign-in asks for its audience and scope too (a refresh cannot add them later). */
  routerConfigured?: boolean;
};

const TokenResponse = z.object({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(4096).optional(),
  expires_in: z.number().positive().max(86_400 * 30).optional(),
  token_type: z.string().optional(),
});
type TokenResponse = z.infer<typeof TokenResponse>;

/** The token endpoint said no to this grant for good (RFC 6749 §5.2), as opposed to the network failing. */
class GrantRefused extends Error {}
/** The service does not know the resource (or the scope asked for it): not a refusal of the sign-in itself. */
export class ResourceRefused extends Error {}
/** The saved sign-in did not ask for the router, so the service is not asked: it could only refuse. */
export class RouterSignInRequired extends Error {}
/** The audiences an access token can be asked for: the two a sign-in is granted, and the router, asked for on its own. */
type TokenResource = AccountResource | typeof ACCOUNT_ROUTER_RESOURCE;

/**
 * The registered redirect is `com.codepawl.orglet:/auth/callback`, but the service sends the browser back to
 * `com.codepawl.orglet://auth/callback`, where URL parsing reads `auth` as the host and `/callback` as the path.
 * Both forms are the same callback.
 */
export function isCallbackPath(url: URL): boolean {
  const location = `${url.host}${url.pathname}`.replace(/^\/+/, '');
  return location === 'auth/callback';
}

type PendingSignIn = {
  generation: number;
  state: string;
  verifier: string;
  /** The exact `redirect_uri` sent to authorize, which the token exchange must repeat. */
  redirectUri: string;
  /** The address opened in the browser; it carries only the state and the PKCE challenge. */
  authorizeUrl: string;
  loopback?: LoopbackServer;
  timer: ReturnType<typeof setTimeout>;
  resolve: (state: AccountState) => void;
  reject: (error: Error) => void;
  /** Set once a callback with the right state arrived, so a second copy of the link cannot spend the code again. */
  exchanging: boolean;
  /** Whether the sign-in page was asked for the router too, which decides what the saved sign-in records. */
  askedForRouter: boolean;
};

export function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** RFC 7636: a 43-character verifier from 32 random bytes, and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** The state exactly as the window may see it: parsed strictly, so an extra field fails here rather than leaking. */
export function accountPayload(state: AccountState): AccountState {
  return AccountState.parse(state);
}

export class AccountService {
  private saved: SavedAccount | undefined;
  private accessTokens = new Map<TokenResource, { value: string; expiresAt: number }>();
  private refreshing = new Map<TokenResource, Promise<string>>();
  private rotationTail: Promise<void> = Promise.resolve();
  private persistenceTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private persistenceError: Error | undefined;
  private pending: PendingSignIn | undefined;
  private endpoints: ReturnType<typeof accountEndpoints>;
  private fetch: typeof fetch;
  private now: () => number;

  constructor(private dependencies: AccountDependencies) {
    this.endpoints = accountEndpoints(dependencies.baseUrl);
    this.fetch = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  /** Reads the saved account. A saved sign-in counts as signed in straight away; `refreshProfile` checks it later. */
  async load(): Promise<AccountState> {
    const generation = this.generation;
    const saved = await this.dependencies.store.read();
    if (generation !== this.generation) return this.state();
    this.saved = saved;
    this.announce();
    return this.state();
  }

  state(): AccountState {
    if (this.pending) return { status: 'signing_in' };
    const profile = this.saved?.profile;
    if (!profile) return { status: 'local' };
    const status = this.saved?.refreshToken ? 'signed_in' : 'expired';
    return accountPayload({
      status,
      email: profile.email,
      ...(profile.name ? { name: profile.name } : {}),
      plan: profile.plan,
      entitlements: profile.entitlements,
    });
  }

  /** Main/core binding only: no token, subject or claim-derived publishing allowance reaches the window. */
  publishingContext() {
    const profile = this.saved?.profile;
    const accountKey = profile ? createHash('sha256').update(`${this.endpoints.issuer}:${profile.id}`).digest('hex') : null;
    const status = !this.saved?.refreshToken || this.persistenceError ? 'local' as const
      : !(this.saved.resources ?? [ACCOUNT_RESOURCE]).includes(ACCOUNT_MARKET_RESOURCE) ? 'upgradeRequired' as const
      : profile?.emailVerified !== true ? 'unverified' as const : 'available' as const;
    return { accountKey, generation: this.generation, status };
  }

  /** Whether the saved sign-in asked for the router, so a token for it can be had without signing in again. */
  signInCoversRouter(): boolean {
    return this.saved?.resources?.includes(ACCOUNT_ROUTER_RESOURCE) === true;
  }

  /** Main/core binding only: the account local changes are recorded for, or nothing while no sign-in is usable. */
  syncContext(): { accountKey: string; generation: number } | undefined {
    const { accountKey, generation } = this.publishingContext();
    if (!accountKey || !this.saved?.refreshToken || this.persistenceError) return undefined;
    return { accountKey, generation };
  }

  /** Whether this install agreed to sync, by signing in on a build that syncs or by starting sync. */
  syncAgreed(): boolean {
    return this.saved?.syncAgreed === true;
  }

  /** Remembers, beside the saved sign-in, that the person started sync. Signing out forgets it with the sign-in. */
  async agreeToSync(): Promise<void> {
    if (!this.saved?.refreshToken || this.saved.syncAgreed) return;
    await this.keep(saved => ({ ...saved!, syncAgreed: true }), this.generation);
  }

  /**
   * Opens the browser at the sign-in page and waits for it to come back, through the loopback listener or, when that
   * cannot start, through `handleCallback`. Resolves with the signed-in state, or with the earlier state when the
   * person cancels; rejects with a Vietnamese reason otherwise. A second call replaces a sign-in still waiting.
   */
  async signIn(): Promise<AccountState> {
    this.pending?.reject(new Error(SIGN_IN_REPLACED));
    this.clearPending();
    const generation = this.generation;
    const { verifier, challenge } = pkcePair();
    const state = base64Url(randomBytes(16));
    const finished = new Promise<AccountState>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(state, new Error(SIGN_IN_TIMED_OUT)), this.dependencies.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
      this.pending = { state, verifier, redirectUri: ACCOUNT_REDIRECT_URI, authorizeUrl: '', timer, resolve, reject, exchanging: false, generation, askedForRouter: this.dependencies.routerConfigured === true };
    });
    const pending = this.pending!;
    this.announce();
    // Without a listener the browser opens in this same turn, as it did before the loopback redirect.
    const loopback = this.dependencies.loopback ? await this.startLoopback(pending) : undefined;
    // Replaced, cancelled or timed out while the listener was starting: it has no sign-in left to serve.
    if (this.pending !== pending) {
      loopback?.close();
      return finished;
    }
    if (loopback) {
      pending.loopback = loopback;
      pending.redirectUri = `http://${LOOPBACK_ADDRESS}:${loopback.port}${CALLBACK_PATH}`;
    }
    pending.authorizeUrl = this.authorizeAddress(pending, challenge);
    try {
      await this.dependencies.openExternal(pending.authorizeUrl);
    } catch {
      this.fail(state, new Error(SIGN_IN_BROWSER_FAILED));
    }
    return finished;
  }

  /** Opens the sign-in page in the browser again, for a browser that was closed or never came forward. */
  async reopenSignIn(): Promise<void> {
    const pending = this.pending;
    if (!pending?.authorizeUrl) return;
    try {
      await this.dependencies.openExternal(pending.authorizeUrl);
    } catch {
      this.fail(pending.state, new Error(SIGN_IN_BROWSER_FAILED));
    }
  }

  /** The sign-in page's address while a sign-in waits, to paste into another browser. */
  signInLink(): string | undefined {
    return this.pending?.authorizeUrl || undefined;
  }

  private async startLoopback(pending: PendingSignIn): Promise<LoopbackServer | undefined> {
    const start = this.dependencies.loopback;
    if (!start) return undefined;
    try {
      return await start(query => this.answerLoopback(pending, query));
    } catch {
      return undefined;
    }
  }

  /** Where the browser goes after the callback: the service's page for a sign-in that worked or one that did not. */
  private async answerLoopback(pending: PendingSignIn, query: URLSearchParams): Promise<string> {
    const base = this.dependencies.baseUrl.replace(/\/+$/, '');
    const failed = `${base}/signed-in?failed=1`;
    if (this.pending !== pending) return failed;
    const finished = this.acceptCallback(query);
    return (finished && await finished) ? `${base}/signed-in` : failed;
  }

  private authorizeAddress(pending: PendingSignIn, challenge: string): string {
    const state = pending.state;
    const address = new URL(this.endpoints.authorize);
    address.search = new URLSearchParams({
      response_type: 'code',
      client_id: ACCOUNT_CLIENT_ID,
      redirect_uri: pending.redirectUri,
      scope: pending.askedForRouter ? `${ACCOUNT_SCOPES} ${ACCOUNT_ROUTER_SCOPE}` : ACCOUNT_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: ACCOUNT_RESOURCE,
    }).toString();
    address.searchParams.append('resource', ACCOUNT_MARKET_RESOURCE);
    if (pending.askedForRouter) address.searchParams.append('resource', ACCOUNT_ROUTER_RESOURCE);
    return address.toString();
  }

  /** The person gave up in the app: the sign-in stops and the account goes back to how it was. */
  cancelSignIn(): AccountState {
    const pending = this.pending;
    this.clearPending();
    this.announce();
    pending?.resolve(this.state());
    return this.state();
  }

  /**
   * The browser came back through `com.codepawl.orglet:/auth/callback`. Only a callback carrying the state of the
   * sign-in in progress is used; any other is dropped and the sign-in keeps waiting, so a stray or forged link can
   * neither finish nor cancel it. Returns whether the callback was taken.
   */
  handleCallback(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol.toLowerCase() !== `${ACCOUNT_SCHEME}:` || !isCallbackPath(url)) return false;
    return this.acceptCallback(url.searchParams) !== undefined;
  }

  /**
   * The checks both ways back share: the state of the sign-in in progress, the issuer, then the code. Returns nothing
   * when the callback is not taken, otherwise whether the sign-in ended up signed in.
   */
  private acceptCallback(parameters: URLSearchParams): Promise<boolean> | undefined {
    const pending = this.pending;
    if (!pending || pending.exchanging) return undefined;
    if (parameters.get('state') !== pending.state) return undefined;
    // RFC 9207: when the service names itself, it must be the issuer this sign-in went to.
    const issuer = parameters.get('iss');
    if (issuer !== null && issuer !== this.endpoints.issuer) return undefined;
    if (parameters.get('error')) {
      this.fail(pending.state, new Error(SIGN_IN_REFUSED));
      return Promise.resolve(false);
    }
    const code = parameters.get('code');
    if (!code) return undefined;
    pending.exchanging = true;
    return this.finishSignIn(pending, code);
  }

  /**
   * Main-only access to a fixed resource; sync remains the default. Refresh rotations are serialized across resources
   * and persisted before another dispatch, because reusing a rotated token revokes the client family.
   */
  async getAccessToken(resource: TokenResource = ACCOUNT_RESOURCE): Promise<string> {
    // A refresh can only give an audience and scope the sign-in asked for. The router is asked for only by a build that
    // names one; for a sign-in that did not, the service is not called. A service that does not know the router
    // answers invalid_target even so, which reaches the caller as a ResourceRefused.
    const isRouter = resource === ACCOUNT_ROUTER_RESOURCE;
    if (!isRouter) AccountResource.parse(resource);
    if (this.persistenceError) throw this.persistenceError;
    const resources = this.saved?.resources ?? [ACCOUNT_RESOURCE];
    if (!resources.includes(resource)) throw isRouter ? new RouterSignInRequired(ROUTER_SIGN_IN_AGAIN) : new Error(MARKET_SIGN_IN_REQUIRED);
    const token = this.accessTokens.get(resource);
    if (token && token.expiresAt - ACCESS_TOKEN_MARGIN_MS > this.now()) return token.value;
    return this.refresh(resource);
  }

  /** Refreshes the sign-in and reads `/me` again; a network failure leaves the saved account as it is. */
  async refreshProfile(): Promise<AccountState> {
    if (!this.saved?.refreshToken) return this.state();
    const generation = this.generation;
    try {
      const profile = await this.readProfile(await this.getAccessToken());
      await this.keep(saved => ({ ...saved!, profile }), generation);
    } catch (error) {
      if (!(error instanceof GrantRefused)) return this.state();
    }
    return this.state();
  }

  /**
   * Signs out: the refresh token is deleted here first, so nothing on this computer can use it again, and only then
   * is the service asked to revoke it. That request may fail (offline); the sign-out still counts. An access token
   * already handed out stays valid at the service until it ends, at most 15 minutes.
   */
  async signOut(): Promise<AccountState> {
    const token = this.saved?.refreshToken;
    const pending = this.pending;
    this.clearPending();
    this.nextGeneration();
    this.saved = undefined;
    this.persistenceError = undefined;
    await this.persist(() => this.dependencies.store.remove());
    this.announce();
    pending?.resolve(this.state());
    if (token) await this.revoke(token).catch(() => undefined);
    return this.state();
  }

  private refresh(resource: TokenResource): Promise<string> {
    const existing = this.refreshing.get(resource);
    if (existing) return existing;
    const generation = this.generation;
    const pending = this.rotationTail.then(() => this.refreshOnce(resource, generation));
    this.rotationTail = pending.then(() => undefined, () => undefined);
    this.refreshing.set(resource, pending);
    void pending.finally(() => {
      if (this.refreshing.get(resource) === pending) this.refreshing.delete(resource);
    }).catch(() => undefined);
    return pending;
  }

  private async refreshOnce(resource: TokenResource, generation: number): Promise<string> {
    if (generation !== this.generation) throw new Error(NOT_SIGNED_IN);
    if (this.persistenceError) throw this.persistenceError;
    const saved = this.saved;
    if (!saved?.refreshToken) throw new Error(saved ? SIGN_IN_EXPIRED : NOT_SIGNED_IN);
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: ACCOUNT_CLIENT_ID, resource, ...(resource === ACCOUNT_ROUTER_RESOURCE ? { scope: ACCOUNT_ROUTER_SCOPE } : {}) });
    } catch (error) {
      if (error instanceof GrantRefused && generation === this.generation) await this.expire(saved, generation);
      throw error;
    }
    // Signed out while the request was out: the account stays gone and the new token is revoked, not kept.
    if (generation !== this.generation) {
      if (tokens.refresh_token) await this.revoke(tokens.refresh_token).catch(() => undefined);
      throw new Error(NOT_SIGNED_IN);
    }
    // The new refresh token replaces the old one before anything else runs, so the old one is never sent again.
    try {
      await this.keep(current => ({ ...current!, refreshToken: tokens.refresh_token ?? saved.refreshToken }), generation);
    } catch (error) {
      if (generation === this.generation) {
        this.persistenceError = new Error(SIGN_IN_FAILED);
        this.saved = { ...this.saved!, refreshToken: undefined };
        await this.persist(async () => {
          if (generation === this.generation) await this.dependencies.store.remove();
        }).catch(() => undefined);
        this.announce();
      } else if (tokens.refresh_token) {
        await this.revoke(tokens.refresh_token).catch(() => undefined);
      }
      throw error;
    }
    if (generation !== this.generation) {
      if (tokens.refresh_token) await this.revoke(tokens.refresh_token).catch(() => undefined);
      throw new Error(NOT_SIGNED_IN);
    }
    this.rememberAccessToken(tokens, resource);
    return tokens.access_token;
  }

  /** The service refused the saved sign-in: the token goes, the profile stays so Settings can say whose it was. */
  private async expire(saved: SavedAccount, generation: number) {
    this.accessTokens.clear();
    const { refreshToken: _refreshToken, ...rest } = saved;
    await this.keep(rest, generation);
  }

  private async finishSignIn(pending: PendingSignIn, code: string): Promise<boolean> {
    let tokens: TokenResponse | undefined;
    let committedGeneration: number | undefined;
    try {
      tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri,
        client_id: ACCOUNT_CLIENT_ID,
        code_verifier: pending.verifier,
        resource: ACCOUNT_RESOURCE,
      });
      if (!tokens.refresh_token) throw new Error(SIGN_IN_FAILED);
      const profile = await this.readProfile(tokens.access_token);
      // Cancelled while the code was being exchanged: the new sign-in is thrown away at the service too.
      if (this.pending !== pending || pending.generation !== this.generation) {
        await this.revoke(tokens.refresh_token).catch(() => undefined);
        return false;
      }
      const generation = await this.commitSignIn({ refreshToken: tokens.refresh_token, profile, resources: pending.askedForRouter ? [ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE, ACCOUNT_ROUTER_RESOURCE] : [ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE], syncAgreed: true }, pending);
      committedGeneration = generation;
      if (this.pending !== pending || generation !== this.generation) throw new Error(NOT_SIGNED_IN);
      this.rememberAccessToken(tokens, ACCOUNT_RESOURCE);
      this.clearPending();
      this.announce();
      pending.resolve(this.state());
      return true;
    } catch (error) {
      if (tokens?.refresh_token && committedGeneration === undefined) await this.revoke(tokens.refresh_token).catch(() => undefined);
      this.fail(pending.state, new Error(error instanceof GrantRefused ? SIGN_IN_REFUSED : SIGN_IN_FAILED));
      return false;
    }
  }

  private fail(state: string, error: Error) {
    const pending = this.pending;
    if (!pending || pending.state !== state) return;
    this.clearPending();
    this.announce();
    pending.reject(error);
  }

  private clearPending() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.loopback?.close();
    }
    this.pending = undefined;
  }

  private rememberAccessToken(tokens: TokenResponse, resource: TokenResource) {
    const lifetime = (tokens.expires_in ?? 900) * 1000;
    this.accessTokens.set(resource, { value: tokens.access_token, expiresAt: this.now() + lifetime });
  }

  private async keep(update: SavedAccount | ((saved: SavedAccount | undefined) => SavedAccount), generation: number) {
    await this.persist(async () => {
      if (generation !== this.generation) throw new Error(NOT_SIGNED_IN);
      const account = typeof update === 'function' ? update(this.saved) : update;
      await this.dependencies.store.save(account);
      if (generation !== this.generation) {
        await this.dependencies.store.remove();
        throw new Error(NOT_SIGNED_IN);
      }
      this.saved = account;
      this.announce();
    });
  }

  private async commitSignIn(account: SavedAccount, pending: PendingSignIn): Promise<number> {
    let committedGeneration = pending.generation;
    await this.persist(async () => {
      if (this.pending !== pending || pending.generation !== this.generation) throw new Error(NOT_SIGNED_IN);
      await this.dependencies.store.save(account);
      if (pending.generation !== this.generation) {
        await this.dependencies.store.remove();
        throw new Error(NOT_SIGNED_IN);
      }
      if (this.pending !== pending) {
        // Cancellation keeps the active grant, including rotations committed before this save began.
        try {
          if (this.saved) await this.dependencies.store.save(this.saved);
          else await this.dependencies.store.remove();
        } catch (error) {
          if (pending.generation === this.generation) {
            this.persistenceError = new Error(SIGN_IN_FAILED);
            if (this.saved) this.saved = { ...this.saved, refreshToken: undefined };
          }
          throw error;
        }
        throw new Error(NOT_SIGNED_IN);
      }
      // Commit inside the persistence queue: queued old rotations must see the new generation before writing.
      committedGeneration = this.nextGeneration();
      this.saved = account;
      this.persistenceError = undefined;
      this.announce();
    });
    return committedGeneration;
  }

  private persist(operation: () => Promise<void>): Promise<void> {
    const pending = this.persistenceTail.then(operation);
    this.persistenceTail = pending.catch(() => undefined);
    return pending;
  }

  private nextGeneration(): number {
    this.generation += 1;
    this.accessTokens.clear();
    this.refreshing.clear();
    this.rotationTail = Promise.resolve();
    return this.generation;
  }

  private announce() {
    const state = this.state();
    try {
      this.dependencies.onChange?.(state);
    } catch {
      console.warn('Không gửi được cập nhật trạng thái tài khoản.');
    }
  }

  private async tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    if (!response.ok) {
      const refused = response.status === 400 || response.status === 401;
      const code = typeof body?.error === 'string' ? body.error : '';
      if (refused && (code === 'invalid_target' || code === 'invalid_scope')) throw new ResourceRefused(MARKET_SIGN_IN_REQUIRED);
      if (refused && ['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_request', 'invalid_token'].includes(code)) throw new GrantRefused(code);
      throw new Error(SIGN_IN_FAILED);
    }
    const parsed = TokenResponse.safeParse(body);
    if (!parsed.success) throw new Error(SIGN_IN_FAILED);
    return parsed.data;
  }

  private async readProfile(accessToken: string): Promise<AccountProfile> {
    const response = await this.fetch(this.endpoints.me, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(SIGN_IN_FAILED);
    const parsed = AccountProfile.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new Error(SIGN_IN_FAILED);
    return parsed.data;
  }

  private async revoke(token: string) {
    await this.fetch(this.endpoints.revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: ACCOUNT_CLIENT_ID }).toString(),
    });
  }
}
