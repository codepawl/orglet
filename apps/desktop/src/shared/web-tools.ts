import { z } from 'zod';

export const ReadWebUrl = z.object({ url: z.string().min(1).max(4096) }).strict();
export const SearchWeb = z.object({ query: z.string().trim().min(1).max(500) }).strict();

/**
 * Where `web_search` sends a query (COD-266). Automatic is the default and needs no setup: it asks Exa's hosted MCP
 * server without a key, and DuckDuckGo's plain results page when Exa's free tier refuses or cannot be reached. Every
 * other value is exactly one provider, with no fallback. A released app (v0.13.0) reads this setting with
 * `.catch('exa')`, and the setting is neither synced nor in a backup, so a value it does not know falls back to Exa
 * there instead of failing.
 */
export const WebSearchProvider = z.enum(['auto', 'exa', 'tavily', 'brave', 'searxng', 'duckduckgo']);
export type WebSearchProvider = z.infer<typeof WebSearchProvider>;
export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = 'auto';
/** The order Settings lists them in. */
export const WEB_SEARCH_PROVIDER_ORDER: readonly WebSearchProvider[] = WebSearchProvider.options;
/** Automatic's name is a source string the window translates; the others are product names. */
export const WEB_SEARCH_PROVIDER_NAMES: Record<WebSearchProvider, string> = {
  auto: 'Tự động', exa: 'Exa', tavily: 'Tavily', brave: 'Brave Search', searxng: 'SearXNG', duckduckgo: 'DuckDuckGo',
};

/** The search providers that take a key. Exa works without one; a key lifts its free limit. Tavily and Brave need one. */
export const WebSearchKeyProvider = z.enum(['exa', 'tavily', 'brave']);
export type WebSearchKeyProvider = z.infer<typeof WebSearchKeyProvider>;
/** The providers that do nothing at all without their key. */
export const WEB_SEARCH_KEY_REQUIRED: readonly WebSearchProvider[] = ['tavily', 'brave'];

/**
 * The address of the SearXNG instance the person runs or trusts: public HTTPS on the default port, no credentials, no
 * query or fragment. It is a setting, not a secret, and is kept where `webSearchProvider` is kept.
 */
export const SearxngUrl = z.string().trim().max(500).transform((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname) throw new Error('shape');
    return url.href;
  } catch {
    context.addIssue({ code: 'custom', message: 'Địa chỉ SearXNG phải là https://, không có cổng, tài khoản, dấu ? hay #.' });
    return z.NEVER;
  }
});

/** One search hit as a worker receives it, whichever provider found it. Only some providers send an excerpt. */
export type WebSearchResult = { title: string; url: string; snippet?: string };

/** The query Settings → Web search → Test sends: plain, public, and sure to find something. */
export const WEB_SEARCH_TEST_QUERY = 'Wikipedia';

/** What Settings → Web search → Test shows: the first result of one real query, or nothing when it found none. `answeredBy` is the engine that really answered (for Automatic, Exa or DuckDuckGo). */
export type WebSearchTest = { provider: WebSearchProvider; answeredBy: string; title: string | null; url: string | null };
