import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthClientInformationFullSchema, OAuthTokensSchema,
  type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthState } from '../../shared/mcp';

/** A remote server whose sign-in is missing or ran out: the person signs in again from Settings → MCP. */
export class McpSignInNeeded extends Error {
  constructor() {
    super('Máy chủ MCP này cần đăng nhập. Mở Cài đặt → MCP và bấm Đăng nhập.');
  }
}

/**
 * How Orglet presents itself when it registers with a service: a native app with no client secret, coming back to a
 * loopback address on this computer (RFC 8252), which every service in the catalog accepts.
 */
export function signInClientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: 'Orglet',
    client_uri: 'https://orglet.codepawl.com',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
  } as OAuthClientMetadata;
}

/**
 * One server's sign-in as the SDK reads and writes it. Every change goes to `persist`, so a refreshed token is kept
 * the moment the service rotates it (reusing a rotated refresh token can end the sign-in). This base never opens a
 * browser: the core uses it as is, and a run that finds the sign-in gone stops with `McpSignInNeeded` instead.
 * Main's interactive sign-in extends it.
 */
export class SavedSignIn implements OAuthClientProvider {
  constructor(protected current: McpOAuthState, private persist: (state: McpOAuthState) => void | Promise<void>) {}

  get saved(): McpOAuthState {
    return this.current;
  }

  get redirectUrl() {
    return this.current.redirectUri;
  }

  get clientMetadata() {
    return signInClientMetadata(this.current.redirectUri);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const parsed = OAuthClientInformationFullSchema.safeParse(this.current.client);
    return parsed.success ? parsed.data : undefined;
  }

  async saveClientInformation(client: OAuthClientInformationMixed) {
    await this.update({ client: { ...client } });
  }

  tokens(): OAuthTokens | undefined {
    const parsed = OAuthTokensSchema.safeParse(this.current.tokens);
    return parsed.success ? parsed.data : undefined;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.update({ tokens: { ...tokens } });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.current.discovery as OAuthDiscoveryState | undefined;
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    await this.update({ discovery: JSON.parse(JSON.stringify(discovery)) as Record<string, unknown> });
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    const next = { ...this.current };
    if (scope === 'all' || scope === 'client') delete next.client;
    if (scope === 'all' || scope === 'tokens') delete next.tokens;
    if (scope === 'all' || scope === 'discovery') delete next.discovery;
    this.current = next;
    await this.persist(next);
  }

  redirectToAuthorization(_authorizationUrl: URL): void | Promise<void> {
    throw new McpSignInNeeded();
  }

  saveCodeVerifier(_codeVerifier: string): void | Promise<void> {
    throw new McpSignInNeeded();
  }

  codeVerifier(): string | Promise<string> {
    throw new McpSignInNeeded();
  }

  protected async update(patch: Partial<McpOAuthState>) {
    this.current = { ...this.current, ...patch };
    await this.persist(this.current);
  }
}
