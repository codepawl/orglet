import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { GoogleToolError } from '../../shared/google-tools';
import type { McpOAuthState } from '../../shared/mcp';

/** Shown when the sign-in is gone for good (revoked, or the refresh token expired): the Connectors row asks again. */
export const GOOGLE_SIGN_IN_NEEDED = 'Google cần đăng nhập lại. Mở Cài đặt → Dịch vụ và bấm Đăng nhập lại Google.';

const REFRESH_MARGIN_MS = 60_000;

export type GoogleFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a session tells its owner when Google no longer accepts the saved sign-in. */
export type GoogleSessionEvents = { onSignInLost: () => void };

/**
 * The saved Google sign-in as the tools use it: the access token to send, and the refresh that trades the saved refresh
 * token for a new one through the same token address the sign-in used (the CodePawl broker, or Google for a person's own
 * client). Google does not rotate the refresh token, so it is kept as it was unless Google sends another.
 */
export class GoogleSession {
  private expiresAt = 0;
  private refreshing?: Promise<void>;

  constructor(
    private state: McpOAuthState,
    private persist: (state: McpOAuthState) => void | Promise<void>,
    private fetchFn: GoogleFetch,
    private events: GoogleSessionEvents,
  ) {}

  /** The token to send now; one that is about to run out is refreshed first. */
  async accessToken(): Promise<string> {
    if (this.expiresAt && Date.now() > this.expiresAt - REFRESH_MARGIN_MS) await this.refresh();
    const accessToken = this.currentTokens()?.access_token;
    if (!accessToken) throw this.signInLost();
    return accessToken;
  }

  /** Trades the refresh token for a new access token. Calls arriving together share one request. */
  refresh(): Promise<void> {
    this.refreshing ??= this.requestNewToken().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  signInLost(): GoogleToolError {
    this.events.onSignInLost();
    return new GoogleToolError(GOOGLE_SIGN_IN_NEEDED);
  }

  private currentTokens() {
    const parsed = OAuthTokensSchema.safeParse(this.state.tokens);
    return parsed.success ? parsed.data : undefined;
  }

  private tokenEndpoint(): string | undefined {
    const metadata = (this.state.discovery as { authorizationServerMetadata?: { token_endpoint?: unknown } } | undefined)?.authorizationServerMetadata;
    return typeof metadata?.token_endpoint === 'string' ? metadata.token_endpoint : undefined;
  }

  private async requestNewToken(): Promise<void> {
    const tokens = this.currentTokens();
    const endpoint = this.tokenEndpoint();
    const clientId = this.state.client?.client_id;
    if (!tokens?.refresh_token || !endpoint || typeof clientId !== 'string') throw await this.dropSignIn();
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    const clientSecret = this.state.client?.client_secret;
    if (typeof clientSecret === 'string') form.set('client_secret', clientSecret);
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form });
    } catch {
      throw new GoogleToolError('Không kết nối được tới Google để làm mới đăng nhập. Kiểm tra mạng rồi thử lại.');
    }
    // 400 and 401 are Google saying the refresh token is no longer valid; anything else is worth trying again later.
    if (response.status === 400 || response.status === 401) throw await this.dropSignIn();
    if (!response.ok) throw new GoogleToolError('Google chưa làm mới được đăng nhập. Thử lại sau ít phút.');
    const renewed = OAuthTokensSchema.safeParse(await response.json().catch(() => undefined));
    if (!renewed.success) throw new GoogleToolError('Google chưa làm mới được đăng nhập. Thử lại sau ít phút.');
    const merged = { ...tokens, ...renewed.data, refresh_token: renewed.data.refresh_token ?? tokens.refresh_token };
    this.state = { ...this.state, tokens: merged };
    this.expiresAt = renewed.data.expires_in ? Date.now() + renewed.data.expires_in * 1000 : 0;
    await this.persist(this.state);
  }

  /** Forgets the tokens, so the next start of the server waits for the person to sign in again. */
  private async dropSignIn(): Promise<GoogleToolError> {
    const { tokens: _tokens, ...rest } = this.state;
    this.state = rest;
    await this.persist(this.state);
    return this.signInLost();
  }
}

/** Short Vietnamese messages for what Google answers, so an orglet and the person see the same plain reason. */
export function googleErrorMessage(status: number, reasons: readonly string[]): string {
  if (status === 429 || reasons.some(reason => /rateLimit|quotaExceeded/i.test(reason))) return 'Google đang giới hạn số yêu cầu. Chờ một lát rồi thử lại.';
  if (reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED')) return 'Dịch vụ Google này chưa được bật cho client đăng nhập. Chủ client cần bật API đó trong Google Cloud.';
  if (status === 403) return 'Tài khoản Google đang đăng nhập không có quyền với mục này. Nhờ chủ tệp chia sẻ cho tài khoản đó.';
  if (status === 404) return 'Không tìm thấy mục này trong Google. Kiểm tra lại địa chỉ hoặc mã.';
  if (status === 400) return 'Google không hiểu yêu cầu này. Kiểm tra lại giá trị đã nhập.';
  return 'Google đang gặp lỗi. Thử lại sau ít phút.';
}

function reasonsOf(body: unknown): string[] {
  const error = (body as { error?: { status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } } | undefined)?.error;
  const found = [error?.status, ...(error?.errors ?? []).map(item => item.reason), ...(error?.details ?? []).map(item => item.reason)];
  return found.filter((reason): reason is string => typeof reason === 'string');
}

/** Calls Google's REST APIs with the session's token: one refresh and one retry on a 401, errors turned into short messages. */
export class GoogleApi {
  constructor(private session: GoogleSession, private fetchFn: GoogleFetch) {}

  async json<Result = unknown>(url: string, options: { query?: Record<string, string | number | boolean | readonly string[] | undefined>; method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<Result> {
    const response = await this.send(url, options);
    return await response.json() as Result;
  }

  async text(url: string, query?: Record<string, string | number | boolean | undefined>): Promise<string> {
    const response = await this.send(url, { query });
    return await response.text();
  }

  private async send(url: string, options: { query?: Record<string, string | number | boolean | readonly string[] | undefined>; method?: string; body?: unknown }): Promise<Response> {
    const address = withQuery(url, options.query);
    const first = await this.attempt(address, options);
    if (first.status !== 401) return await this.checked(first);
    await this.session.refresh();
    const second = await this.attempt(address, options);
    if (second.status === 401) throw this.session.signInLost();
    return await this.checked(second);
  }

  private async attempt(address: string, options: { method?: string; body?: unknown }): Promise<Response> {
    const token = await this.session.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await this.fetchFn(address, { method: options.method ?? 'GET', headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    } catch {
      throw new GoogleToolError('Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.');
    }
  }

  private async checked(response: Response): Promise<Response> {
    if (response.ok) return response;
    const body = await response.json().catch(() => undefined);
    throw new GoogleToolError(googleErrorMessage(response.status, reasonsOf(body)));
  }
}

function withQuery(url: string, query: Record<string, string | number | boolean | readonly string[] | undefined> | undefined): string {
  const address = new URL(url);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) address.searchParams.append(name, String(item));
  }
  return address.toString();
}
