import { mcpRedirectUri, type McpServerDraft } from './mcp';

/**
 * Apps Orglet offers to connect with one click (stage 4, 2026-10-07), each the service's own remote MCP server. The
 * MCP Registry is still a preview with no sign-in fields, so this list is kept by hand. An app signs in through the
 * browser when its service lets Orglet register itself (Linear, Notion and Atlassian, checked 2026-10-07); GitHub
 * registers only apps made with it in advance, so it takes a token until CodePawl has one. Google's Workspace servers
 * (developer preview, 2026-10) sign in through the browser too, but only with an OAuth client the person made in
 * Google Cloud (`signIn: 'google'`): there is no dynamic registration. Settings → Connectors lists all of them.
 */
export type McpCatalogApp = {
  id: 'googlesheets' | 'googledrive' | 'gmail' | 'googlecalendar' | 'googledocs' | 'googleslides' | 'linear' | 'notion' | 'atlassian' | 'github';
  name: string;
  url: string;
  signIn: 'browser' | 'token' | 'google';
  /** Where to make the token, for an app that takes one. */
  tokenPage?: string;
  /** The OAuth scopes a Google server asks for, from https://developers.google.com/workspace/guides/configure-mcp-servers. */
  scopes?: readonly string[];
};

const GOOGLE_SCOPE_PREFIX = 'https://www.googleapis.com/auth/';
const googleScopes = (...names: string[]) => names.map(name => GOOGLE_SCOPE_PREFIX + name);

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/**
 * A client of the "Web application" type only accepts the exact redirect address it was given, so every Google server
 * comes back on this one port (and `mcpRedirectUri` is the text to paste into Google Cloud).
 */
export const GOOGLE_CONNECTOR_PORT = 53127;
export const GOOGLE_REDIRECT_URI = mcpRedirectUri(GOOGLE_CONNECTOR_PORT);
/** Without these Google hands back no refresh token, and the sign-in would end within the hour. */
const GOOGLE_AUTHORIZATION_PARAMETERS = { access_type: 'offline', prompt: 'consent' };

export const MCP_CATALOG: readonly McpCatalogApp[] = [
  { id: 'googlesheets', name: 'Google Sheets', url: 'https://sheetsmcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('drive.readonly', 'drive.file', 'spreadsheets.readonly', 'spreadsheets') },
  { id: 'googledrive', name: 'Google Drive', url: 'https://drivemcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('drive.readonly', 'drive.file') },
  { id: 'gmail', name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('gmail.readonly', 'gmail.compose') },
  { id: 'googlecalendar', name: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('calendar.calendarlist.readonly', 'calendar.events.freebusy', 'calendar.events.readonly') },
  { id: 'googledocs', name: 'Google Docs', url: 'https://docsmcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('drive.readonly', 'drive.file', 'documents.readonly', 'documents') },
  { id: 'googleslides', name: 'Google Slides', url: 'https://slidesmcp.googleapis.com/mcp/v1', signIn: 'google', scopes: googleScopes('drive.readonly', 'drive.file', 'presentations.readonly', 'presentations') },
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
  if (within('googleapis.com')) return MCP_CATALOG.find(app => app.signIn === 'google' && new URL(app.url).hostname === host)?.id;
  if (within('linear.app')) return 'linear';
  if (within('notion.com') || within('notion.so')) return 'notion';
  if (within('atlassian.com') || within('atlassian.net')) return 'atlassian';
  if (within('github.com') || within('githubcopilot.com')) return 'github';
  return undefined;
}

/** The server a catalog app becomes: browser sign-in, or a token the person pastes. */
export function catalogDraft(app: McpCatalogApp, token?: string): McpServerDraft {
  if (app.signIn === 'google') return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], oauth: true, oauthClient: googleClientOf(app) } };
  if (app.signIn === 'browser') return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], oauth: true } };
  return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], bearer: token ?? null } };
}

/** The pre-registered client a Google server signs in with: the one Google client saved once, these scopes, the fixed port. */
function googleClientOf(app: McpCatalogApp) {
  return {
    shared: 'google' as const,
    scopes: [...(app.scopes ?? [])],
    port: GOOGLE_CONNECTOR_PORT,
    authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    authorizationParameters: GOOGLE_AUTHORIZATION_PARAMETERS,
  };
}
