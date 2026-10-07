import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { auth, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SavedSignIn } from '../core/tools/mcp-oauth';
import type { McpOAuthState, McpSecrets } from '../shared/mcp';

/** How long a sign-in waits for the browser to come back before it gives up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/callback';

export const MCP_SIGN_IN_TIMED_OUT = 'Hết thời gian đăng nhập. Thử lại khi sẵn sàng.';
export const MCP_SIGN_IN_REFUSED = 'Dịch vụ từ chối đăng nhập.';
export const MCP_SIGN_IN_CANCELLED = 'Đã hủy đăng nhập.';
export const MCP_SIGN_IN_WRONG_SERVICE = 'Trang đăng nhập trả về từ một dịch vụ khác. Thử lại.';

/** The parts of main a sign-in uses, so a test can hand in its own browser and network. */
export type McpSignInDependencies = {
  readSecrets: (serverId: string) => Promise<McpSecrets>;
  saveSecrets: (serverId: string, secrets: McpSecrets) => Promise<void>;
  /** Opens the system browser; main passes `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>;
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

  constructor(state: McpOAuthState, private open: (url: string) => Promise<void>) {
    // Nothing is stored until the service hands over tokens: an abandoned sign-in leaves the saved one as it was.
    super(state, () => undefined);
  }

  state() {
    return this.expectedState;
  }

  async redirectToAuthorization(authorizationUrl: URL) {
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
    const { listener, port, callback, stop } = await this.listen(previous?.redirectUri);
    let cancel = (_reason?: string) => undefined as void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = (reason = MCP_SIGN_IN_CANCELLED) => reject(new Error(reason));
    });
    cancelled.catch(() => undefined);
    this.active.set(serverId, { cancel });
    const timer = setTimeout(() => cancel(MCP_SIGN_IN_TIMED_OUT), this.dependencies.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
    timer.unref?.();
    try {
      const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
      // A client registered for another port cannot come back here, so it registers again.
      const keepClient = previous?.redirectUri === redirectUri;
      const provider = new BrowserSignIn({
        serverUrl, redirectUri,
        ...(keepClient && previous?.client ? { client: previous.client } : {}),
        ...(previous?.discovery ? { discovery: previous.discovery } : {}),
      }, this.dependencies.openExternal);
      const options = { serverUrl, ...(this.dependencies.fetchFn ? { fetchFn: this.dependencies.fetchFn } : {}) };
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

  /**
   * A listener on 127.0.0.1 for this sign-in only. It reuses the port the client was registered with when that port
   * is free, so a service that pins the exact address keeps accepting it; otherwise any free port.
   */
  private async listen(previousRedirect?: string): Promise<{ listener: Server; port: number; callback: (state: string, issuer: () => { issuer?: string; required: boolean }) => Promise<Callback>; stop: () => void }> {
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
    const previousPort = previousRedirect ? Number(new URL(previousRedirect).port) : 0;
    const port = await this.bind(listener, previousPort).catch(() => this.bind(listener, 0));
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
