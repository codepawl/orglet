import { createHash, randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ACCOUNT_CLIENT_ID,
  ACCOUNT_REDIRECT_URI,
  ACCOUNT_RESOURCE,
  ACCOUNT_SCHEME,
  ACCOUNT_SCOPES,
  AccountProfile,
  AccountState,
  accountEndpoints,
} from '../shared/account';
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

/** What the token file holds: the profile last read, and the refresh token while the sign-in is still good. */
const SavedAccount = z.object({
  refreshToken: z.string().min(1).max(4096).optional(),
  profile: AccountProfile,
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

type PendingSignIn = {
  state: string;
  verifier: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (state: AccountState) => void;
  reject: (error: Error) => void;
  /** Set once a callback with the right state arrived, so a second copy of the link cannot spend the code again. */
  exchanging: boolean;
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
  private accessToken: { value: string; expiresAt: number } | undefined;
  private refreshing: Promise<string> | undefined;
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
    this.saved = await this.dependencies.store.read();
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

  /**
   * Opens the browser at the sign-in page and waits for it to come back through `handleCallback`. Resolves with the
   * signed-in state, or with the earlier state when the person cancels; rejects with a Vietnamese reason otherwise.
   * A second call replaces a sign-in still waiting.
   */
  async signIn(): Promise<AccountState> {
    this.pending?.reject(new Error(SIGN_IN_REPLACED));
    this.clearPending();
    const { verifier, challenge } = pkcePair();
    const state = base64Url(randomBytes(16));
    const address = new URL(this.endpoints.authorize);
    address.search = new URLSearchParams({
      response_type: 'code',
      client_id: ACCOUNT_CLIENT_ID,
      redirect_uri: ACCOUNT_REDIRECT_URI,
      scope: ACCOUNT_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: ACCOUNT_RESOURCE,
    }).toString();
    const finished = new Promise<AccountState>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(state, new Error(SIGN_IN_TIMED_OUT)), this.dependencies.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
      this.pending = { state, verifier, timer, resolve, reject, exchanging: false };
    });
    this.announce();
    try {
      await this.dependencies.openExternal(address.toString());
    } catch {
      this.fail(state, new Error(SIGN_IN_BROWSER_FAILED));
    }
    return finished;
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
    const pending = this.pending;
    if (!pending || pending.exchanging) return false;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol.toLowerCase() !== `${ACCOUNT_SCHEME}:` || url.pathname.replace(/^\/+/, '/') !== '/auth/callback') return false;
    const parameters = url.searchParams;
    if (parameters.get('state') !== pending.state) return false;
    // RFC 9207: when the service names itself, it must be the issuer this sign-in went to.
    const issuer = parameters.get('iss');
    if (issuer !== null && issuer !== this.endpoints.issuer) return false;
    if (parameters.get('error')) {
      this.fail(pending.state, new Error(SIGN_IN_REFUSED));
      return true;
    }
    const code = parameters.get('code');
    if (!code) return false;
    pending.exchanging = true;
    void this.finishSignIn(pending, code);
    return true;
  }

  /**
   * An access token for the sync server (a later phase), refreshed when it is about to end. Concurrent callers share
   * one refresh: the service rotates refresh tokens, and a rotated-out one sent again revokes every device.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - ACCESS_TOKEN_MARGIN_MS > this.now()) return this.accessToken.value;
    return this.refresh();
  }

  /** Refreshes the sign-in and reads `/me` again; a network failure leaves the saved account as it is. */
  async refreshProfile(): Promise<AccountState> {
    if (!this.saved?.refreshToken) return this.state();
    try {
      const profile = await this.readProfile(await this.getAccessToken());
      await this.keep({ ...this.saved, profile });
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
    this.saved = undefined;
    this.accessToken = undefined;
    this.refreshing = undefined;
    await this.dependencies.store.remove();
    this.announce();
    pending?.resolve(this.state());
    if (token) await this.revoke(token).catch(() => undefined);
    return this.state();
  }

  private refresh(): Promise<string> {
    this.refreshing ??= this.refreshOnce().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async refreshOnce(): Promise<string> {
    const saved = this.saved;
    if (!saved?.refreshToken) throw new Error(saved ? SIGN_IN_EXPIRED : NOT_SIGNED_IN);
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: ACCOUNT_CLIENT_ID, resource: ACCOUNT_RESOURCE });
    } catch (error) {
      if (error instanceof GrantRefused && this.saved === saved) await this.expire(saved);
      throw error;
    }
    // Signed out while the request was out: the account stays gone and the new token is revoked, not kept.
    if (this.saved !== saved) {
      if (tokens.refresh_token) await this.revoke(tokens.refresh_token).catch(() => undefined);
      throw new Error(NOT_SIGNED_IN);
    }
    // The new refresh token replaces the old one before anything else runs, so the old one is never sent again.
    await this.keep({ ...saved, refreshToken: tokens.refresh_token ?? saved.refreshToken });
    this.rememberAccessToken(tokens);
    return tokens.access_token;
  }

  /** The service refused the saved sign-in: the token goes, the profile stays so Settings can say whose it was. */
  private async expire(saved: SavedAccount) {
    this.accessToken = undefined;
    const { refreshToken: _refreshToken, ...rest } = saved;
    await this.keep(rest);
  }

  private async finishSignIn(pending: PendingSignIn, code: string) {
    try {
      const tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ACCOUNT_REDIRECT_URI,
        client_id: ACCOUNT_CLIENT_ID,
        code_verifier: pending.verifier,
        resource: ACCOUNT_RESOURCE,
      });
      if (!tokens.refresh_token) throw new Error(SIGN_IN_FAILED);
      const profile = await this.readProfile(tokens.access_token);
      // Cancelled while the code was being exchanged: the new sign-in is thrown away at the service too.
      if (this.pending !== pending) {
        await this.revoke(tokens.refresh_token).catch(() => undefined);
        return;
      }
      await this.keep({ refreshToken: tokens.refresh_token, profile });
      this.rememberAccessToken(tokens);
      this.clearPending();
      this.announce();
      pending.resolve(this.state());
    } catch (error) {
      this.fail(pending.state, new Error(error instanceof GrantRefused ? SIGN_IN_REFUSED : SIGN_IN_FAILED));
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
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }

  private rememberAccessToken(tokens: TokenResponse) {
    const lifetime = (tokens.expires_in ?? 900) * 1000;
    this.accessToken = { value: tokens.access_token, expiresAt: this.now() + lifetime };
  }

  private async keep(account: SavedAccount) {
    this.saved = account;
    await this.dependencies.store.save(account);
    this.announce();
  }

  private announce() {
    this.dependencies.onChange?.(this.state());
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
