import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { auth, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SavedSignIn } from '../core/tools/mcp-oauth';
import { mcpRedirectUri, type McpOAuthState, type McpPreregisteredClient, type McpSecrets, type McpSharedClientProvider } from '../shared/mcp';

/** How long a sign-in waits for the browser to come back before it gives up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/callback';

export const MCP_SIGN_IN_TIMED_OUT = 'Hết thời gian đăng nhập. Thử lại khi sẵn sàng.';
export const MCP_SIGN_IN_REFUSED = 'Dịch vụ từ chối đăng nhập.';
export const MCP_SIGN_IN_CANCELLED = 'Đã hủy đăng nhập.';
export const MCP_SIGN_IN_WRONG_SERVICE = 'Trang đăng nhập trả về từ một dịch vụ khác. Thử lại.';
export const MCP_SIGN_IN_PORT_BUSY = 'Cổng đăng nhập cố định đang bận. Đóng chương trình đang dùng cổng đó rồi thử lại.';
export const MCP_SIGN_IN_NEEDS_CLIENT = 'Chưa có OAuth client cho dịch vụ này. Nhập client ID trong Cài đặt → Dịch vụ.';

/** Parameters of the authorization request that belong to the sign-in itself, which a configured parameter may not replace. */
const RESERVED_AUTHORIZATION_PARAMETERS = new Set(['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource']);

/** The client a sign-in uses when the service has none to give: the saved client, with the shared one's id and secret filled in. */
type ResolvedClient = McpPreregisteredClient & { clientId: string };

/** The parts of main a sign-in uses, so a test can hand in its own browser and network. */
export type McpSignInDependencies = {
  readSecrets: (serverId: string) => Promise<McpSecrets>;
  saveSecrets: (serverId: string, secrets: McpSecrets) => Promise<void>;
  /** Opens the system browser; main passes `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>;
  /** The client saved once for a provider (Settings → Connectors); main reads it from its encrypted file. */
  readSharedClient?: (provider: McpSharedClientProvider) => Promise<{ clientId: string; clientSecret?: string } | undefined>;
  /** The app's language for the page the browser shows on the way back; Vietnamese when absent. */
  translate?: (key: string) => string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
};

type Callback = { code: string } | { error: string };

/** The sign-in a browser round trip is building: PKCE verifier and state live only in memory, never on disk. */
class BrowserSignIn extends SavedSignIn {
  private verifier = '';
  readonly expectedState = randomBytes(16).toString('base64url');

  constructor(state: McpOAuthState, private open: (url: string) => Promise<void>, private extraParameters: Record<string, string> = {}) {
    // Nothing is stored until the service hands over tokens: an abandoned sign-in leaves the saved one as it was.
    super(state, () => undefined);
  }

  state() {
    return this.expectedState;
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    for (const [name, value] of Object.entries(this.extraParameters)) {
      if (!RESERVED_AUTHORIZATION_PARAMETERS.has(name)) authorizationUrl.searchParams.set(name, value);
    }
    await this.open(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier;
  }

  codeVerifier() {
    return this.verifier;
  }

  /** The service this sign-in went to, as its metadata names itself, and whether it says so on the way back. */
  issuer(): { issuer?: string; required: boolean } {
    const metadata = (this.discoveryState() as OAuthDiscoveryState | undefined)?.authorizationServerMetadata as Record<string, unknown> | undefined;
    return { issuer: typeof metadata?.issuer === 'string' ? metadata.issuer : undefined, required: metadata?.authorization_response_iss_parameter_supported === true };
  }
}

/** The short page the browser shows once it has come back; it holds no detail of the sign-in. */
function callbackPage(finished: boolean, translate: (key: string) => string) {
  const title = translate(finished ? 'Đã đăng nhập' : 'Chưa đăng nhập được');
  const line = translate(finished ? 'Quay lại Orglet để dùng ứng dụng này.' : 'Quay lại Orglet và thử lại.');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:48px;color:#222"><h1 style="font-size:20px">${title}</h1><p>${line}</p></body></html>`;
}

/**
 * Signs in to remote MCP servers in the system browser (stage 4, 2026-10-07): discovery, registration (the client
 * already registered, else dynamic registration as a native app), authorization code with PKCE S256, then the code
 * comes back to a one-time listener on 127.0.0.1 (RFC 8252). The callback must carry this sign-in's `state`, and the
 * service's `iss` when it names itself (RFC 9207; the SDK does not check it). Tokens are stored encrypted with the
 * server's other secret values; the window never sees them.
 */
export class McpSignIns {
  private active = new Map<string, { cancel: (reason?: string) => void }>();

  constructor(private dependencies: McpSignInDependencies) {}

  /** Whether a sign-in for this server is waiting for the browser. */
  waiting(serverId: string) {
    return this.active.has(serverId);
  }

  cancel(serverId: string) {
    this.active.get(serverId)?.cancel();
  }

  /** Runs one sign-in to the end; a second one for the same server replaces the first. */
  async signIn(serverId: string, serverUrl: string): Promise<void> {
    this.cancel(serverId);
    const saved = await this.dependencies.readSecrets(serverId);
    const previous = saved.oauth?.serverUrl === serverUrl ? saved.oauth : undefined;
    const preregistered = saved.client ? await this.resolveClient(saved.client) : undefined;
    const previousPort = previous ? Number(new URL(previous.redirectUri).port) : 0;
    const { listener, port, callback, stop } = await this.listen(preregistered?.port ?? previousPort, preregistered?.port !== undefined);
    let cancel = (_reason?: string) => undefined as void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = (reason = MCP_SIGN_IN_CANCELLED) => reject(new Error(reason));
    });
    cancelled.catch(() => undefined);
    this.active.set(serverId, { cancel });
    const timer = setTimeout(() => cancel(MCP_SIGN_IN_TIMED_OUT), this.dependencies.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
    timer.unref?.();
    try {
      const redirectUri = mcpRedirectUri(port);
      // A client registered for another port cannot come back here, so it registers again.
      const keepClient = previous?.redirectUri === redirectUri;
      const initial: McpOAuthState = preregistered
        ? preregisteredState(serverUrl, redirectUri, preregistered)
        : {
          serverUrl, redirectUri,
          ...(keepClient && previous?.client ? { client: previous.client } : {}),
          ...(previous?.discovery ? { discovery: previous.discovery } : {}),
        };
      const provider = new BrowserSignIn(initial, this.dependencies.openExternal, preregistered?.authorizationParameters);
      const scope = preregistered?.scopes.length ? preregistered.scopes.join(' ') : undefined;
      const options = { serverUrl, ...(scope ? { scope } : {}), ...(this.dependencies.fetchFn ? { fetchFn: this.dependencies.fetchFn } : {}) };
      // Listening starts before the browser opens, so a service that answers at once is not missed.
      const returned = callback(provider.expectedState, () => provider.issuer());
      const first = await Promise.race([auth(provider, options), cancelled]);
      if (first === 'REDIRECT') {
        const answer = await Promise.race([returned, cancelled]);
        if ('error' in answer) throw new Error(answer.error);
        const second = await Promise.race([auth(provider, { ...options, authorizationCode: answer.code }), cancelled]);
        if (second !== 'AUTHORIZED') throw new Error(MCP_SIGN_IN_REFUSED);
      }
      if (!provider.tokens()) throw new Error(MCP_SIGN_IN_REFUSED);
      const latest = await this.dependencies.readSecrets(serverId);
      await this.dependencies.saveSecrets(serverId, { ...latest, oauth: provider.saved });
    } finally {
      clearTimeout(timer);
      if (this.active.get(serverId)?.cancel === cancel) this.active.delete(serverId);
      stop();
      listener.close();
    }
  }

  /** The saved pre-registered client with its id and secret in hand; a shared one is read from main's store. */
  private async resolveClient(client: McpPreregisteredClient): Promise<ResolvedClient> {
    if (!client.shared) return { ...client, clientId: client.clientId! };
    const shared = await this.dependencies.readSharedClient?.(client.shared);
    if (!shared) throw new Error(MCP_SIGN_IN_NEEDS_CLIENT);
    return { ...client, clientId: shared.clientId, ...(shared.clientSecret ? { clientSecret: shared.clientSecret } : {}) };
  }

  /**
   * A listener on 127.0.0.1 for this sign-in only. It reuses the port the client was registered with when that port
   * is free, so a service that pins the exact address keeps accepting it; otherwise any free port. A fixed port (the
   * redirect a pre-registered client was given) is never swapped for another: the sign-in stops and says it is busy.
   */
  private async listen(preferredPort: number, fixedPort: boolean): Promise<{ listener: Server; port: number; callback: (state: string, issuer: () => { issuer?: string; required: boolean }) => Promise<Callback>; stop: () => void }> {
    let deliver: ((request: URL) => Callback | undefined) | undefined;
    let settle: ((answer: Callback) => void) | undefined;
    const listener = createServer((request, response) => {
      const address = listener.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      // Only this listener's own address is answered, so a page elsewhere cannot reach it under another name.
      if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(400).end();
        return;
      }
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const answer = url.pathname === CALLBACK_PATH ? deliver?.(url) : undefined;
      if (!answer) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(callbackPage('code' in answer, this.dependencies.translate ?? (key => key)));
      settle?.(answer);
    });
    const port = await this.bind(listener, preferredPort).catch(() => {
      if (fixedPort) throw new Error(MCP_SIGN_IN_PORT_BUSY);
      return this.bind(listener, 0);
    });
    const callback = (expectedState: string, serviceOf: () => { issuer?: string; required: boolean }) => new Promise<Callback>(resolve => {
      settle = resolve;
      deliver = url => {
        const parameters = url.searchParams;
        // A callback without this sign-in's state is someone else's (or forged): it is dropped and the wait goes on.
        if (parameters.get('state') !== expectedState) return undefined;
        const issuer = parameters.get('iss');
        // Read now: discovery ran after listening started, and it is what names the service.
        const service = serviceOf();
        if (issuer !== null ? issuer !== service.issuer : service.required) return { error: MCP_SIGN_IN_WRONG_SERVICE };
        if (parameters.get('error')) return { error: MCP_SIGN_IN_REFUSED };
        const code = parameters.get('code');
        return code ? { code } : undefined;
      };
    });
    return { listener, port, callback, stop: () => { deliver = undefined; settle = undefined; } };
  }

  private bind(listener: Server, port: number) {
    return new Promise<number>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      listener.once('error', failed);
      listener.listen(port, '127.0.0.1', () => {
        listener.off('error', failed);
        const address = listener.address();
        resolve(address && typeof address === 'object' ? address.port : port);
      });
    });
  }
}

/** The sign-in a pre-registered client starts from: its own client information, and the endpoints it names in place of discovery. */
function preregisteredState(serverUrl: string, redirectUri: string, client: ResolvedClient): McpOAuthState {
  const information = {
    client_id: client.clientId,
    redirect_uris: [redirectUri],
    ...(client.clientSecret ? { client_secret: client.clientSecret } : { token_endpoint_auth_method: 'none' }),
  };
  return {
    serverUrl, redirectUri, client: information, withoutResource: true,
    ...(client.authorizationEndpoint && client.tokenEndpoint ? { discovery: discoveryFromEndpoints(client.authorizationEndpoint, client.tokenEndpoint) } : {}),
  };
}

/** What discovery would have found, built from the two addresses the person or the preset gave. */
function discoveryFromEndpoints(authorizationEndpoint: string, tokenEndpoint: string): Record<string, unknown> {
  const issuer = new URL(authorizationEndpoint).origin;
  return {
    authorizationServerUrl: issuer,
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    },
  };
}
