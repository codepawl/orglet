import type { McpServerDraft } from './mcp';

/**
 * Apps Orglet offers to connect with one click (stage 4, 2026-10-07), each the service's own remote MCP server. The
 * MCP Registry is still a preview with no sign-in fields, so this list is kept by hand. An app signs in through the
 * browser when its service lets Orglet register itself (Linear, Notion and Atlassian, checked 2026-10-07); GitHub
 * registers only apps made with it in advance, so it takes a token until CodePawl has one.
 */
export type McpCatalogApp = {
  id: 'linear' | 'notion' | 'atlassian' | 'github';
  name: string;
  url: string;
  signIn: 'browser' | 'token';
  /** Where to make the token, for an app that takes one. */
  tokenPage?: string;
};

export const MCP_CATALOG: readonly McpCatalogApp[] = [
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
  if (within('linear.app')) return 'linear';
  if (within('notion.com') || within('notion.so')) return 'notion';
  if (within('atlassian.com') || within('atlassian.net')) return 'atlassian';
  if (within('github.com') || within('githubcopilot.com')) return 'github';
  return undefined;
}

/** The server a catalog app becomes: browser sign-in, or a token the person pastes. */
export function catalogDraft(app: McpCatalogApp, token?: string): McpServerDraft {
  if (app.signIn === 'browser') return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], oauth: true } };
  return { name: app.name, enabled: true, transport: { kind: 'http', url: app.url, headers: [], bearer: token ?? null } };
}
