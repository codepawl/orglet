import { mcpRedirectUri, type McpServerDraft } from './mcp';
import { GOOGLE_SCOPES, GOOGLE_TOOLS_NAME, GOOGLE_TOOLS_URL } from './google-tools';

/**
 * Apps Orglet offers to connect with one click (stage 4, 2026-10-07), each the service's own remote MCP server. The
 * MCP Registry is still a preview with no sign-in fields, so this list is kept by hand. An app signs in through the
 * browser when its service lets Orglet register itself (Linear, Notion and Atlassian, checked 2026-10-07); GitHub
 * registers only apps made with it in advance, so it takes a token until CodePawl has one. Google signs in through the
 * browser with a client registered in advance (`signIn: 'google'`), and its tools are Orglet's own, built in over
 * Google's generally available APIs (`shared/google-tools.ts`), not Google's preview MCP servers. Settings →
 * Connectors lists all of them.
 */
export type McpCatalogApp = {
  id: 'google' | 'linear' | 'notion' | 'atlassian' | 'github';
  name: string;
  url: string;
  signIn: 'browser' | 'token' | 'google';
  /** Where to make the token, for an app that takes one. */
  tokenPage?: string;
  /** The OAuth scopes a Google sign-in asks for. */
  scopes?: readonly string[];
};

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/**
 * A client of the "Web application" type only accepts the exact redirect address it was given, so every Google server
 * comes back on this one port (and `mcpRedirectUri` is the text to paste into Google Cloud).
 */
export const GOOGLE_CONNECTOR_PORT = 53127;
export const GOOGLE_REDIRECT_URI = mcpRedirectUri(GOOGLE_CONNECTOR_PORT);
/**
 * CodePawl's own Google OAuth client (Web application, marked for an AI agent), so a person never makes one in Google
 * Cloud. The client ID is public. The secret that goes with it lives only in the token broker (services/connect), which
 * adds it to the two token requests; the app sends its token requests there and holds no secret.
 */
export const GOOGLE_CLIENT_ID = '160397178746-e5uisr4gnrj6ns7fgpnulibqtq6usilq.apps.googleusercontent.com';
export const CONNECT_BASE_URL = 'https://connect.orglet.codepawl.com';
export const GOOGLE_BROKER_TOKEN_ENDPOINT = `${CONNECT_BASE_URL}/google/token`;

/** `ORGLET_CONNECT_URL` (development builds only) names another broker; only https, or a broker on this computer. */
export function connectBaseUrl(override: string | undefined): string | undefined {
  if (!override) return undefined;
  try {
    const url = new URL(override);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    // Not an address: the real broker is used.
  }
  return undefined;
}
/** Without these Google hands back no refresh token, and the sign-in would end within the hour. */
const GOOGLE_AUTHORIZATION_PARAMETERS = { access_type: 'offline', prompt: 'consent' };

export const MCP_CATALOG: readonly McpCatalogApp[] = [
  { id: 'google', name: GOOGLE_TOOLS_NAME, url: GOOGLE_TOOLS_URL, signIn: 'google', scopes: GOOGLE_SCOPES },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', signIn: 'browser' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', signIn: 'browser' },
  { id: 'atlassian', name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp', signIn: 'browser' },
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', signIn: 'token', tokenPage: 'https://github.com/settings/personal-access-tokens/new' },
];

/**
 * The catalog app a server's address belongs to, so a server added by hand or imported still shows that company's mark.
 * Matched on the host only.
 */
export function catalogAppOf(address: string): McpCatalogApp['id'] | undefined {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const within = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (host === new URL(GOOGLE_TOOLS_URL).hostname || within('googleapis.com')) return 'google';
  if (within('linear.app')) return 'linear';
  if (within('notion.com') || within('notion.so')) return 'notion';
  if (within('atlassian.com') || within('atlassian.net')) return 'atlassian';
  if (within('github.com') || within('githubcopilot.com')) return 'github';
  return undefined;
}

/** The Google connector: one built-in server for all the services. */
export const GOOGLE_APPS = MCP_CATALOG.filter(app => app.signIn === 'google');

/** One consent asks for every scope the tools need, each scope once. */
export const GOOGLE_UNION_SCOPES: readonly string[] = [...new Set(GOOGLE_APPS.flatMap(app => app.scopes ?? []))];

/**
 * The server a catalog app becomes: browser sign-in, or a token the person pastes. A Google server signs in with
 * CodePawl's client through the broker, or, with `ownClient`, with the client the person saved themselves.
 */
export function catalogDraft(app: McpCatalogApp, token?: string, options: { ownClient?: boolean } = {}): McpServerDraft {
  if (app.signIn === 'google') return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], oauth: true, oauthClient: googleClientOf(app, options.ownClient === true) } };
  if (app.signIn === 'browser') return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], oauth: true } };
  return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], bearer: token ?? null } };
}

/** The pre-registered client a Google server signs in with: CodePawl's (token requests go via the broker) or the person's own. */
function googleClientOf(app: McpCatalogApp, ownClient: boolean) {
  const common = {
    scopes: [...(app.scopes ?? [])],
    port: GOOGLE_CONNECTOR_PORT,
    authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
    authorizationParameters: GOOGLE_AUTHORIZATION_PARAMETERS,
  };
  if (ownClient) return { ...common, shared: 'google' as const, tokenEndpoint: GOOGLE_TOKEN_ENDPOINT };
  return { ...common, clientId: GOOGLE_CLIENT_ID, tokenEndpoint: GOOGLE_BROKER_TOKEN_ENDPOINT };
}
