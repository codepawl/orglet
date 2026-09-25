import { z } from 'zod';

export const ReadWebUrl = z.object({ url: z.string().min(1).max(4096) }).strict();
export const SearchWeb = z.object({ query: z.string().trim().min(1).max(500) }).strict();

/**
 * Where `web_search` sends a query (COD-266). Exa's hosted MCP server is the default for new and existing workspaces:
 * it answers without a key on a free, rate-limited tier. DuckDuckGo's plain results page stays as an option; it often
 * answers an app with a human-verification page instead of results.
 */
export const WebSearchProvider = z.enum(['exa', 'duckduckgo']);
export type WebSearchProvider = z.infer<typeof WebSearchProvider>;
export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = 'exa';
export const WEB_SEARCH_PROVIDER_NAMES: Record<WebSearchProvider, string> = { exa: 'Exa', duckduckgo: 'DuckDuckGo' };

/** The search providers that take a key. Exa works without one; a key lifts its free limit. */
export const WebSearchKeyProvider = z.enum(['exa']);
export type WebSearchKeyProvider = z.infer<typeof WebSearchKeyProvider>;

/** One search hit as a worker receives it, whichever provider found it. Only some providers send an excerpt. */
export type WebSearchResult = { title: string; url: string; snippet?: string };

/** The query Settings → Web search → Test sends: plain, public, and sure to find something. */
export const WEB_SEARCH_TEST_QUERY = 'Wikipedia';

/** What Settings → Web search → Test shows: the first result of one real query, or nothing when it found none. */
export type WebSearchTest = { provider: WebSearchProvider; title: string | null; url: string | null };
