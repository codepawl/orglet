import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingHttpHeaders } from 'node:http';
import type { WebSearchKeyProvider, WebSearchProvider, WebSearchResult } from '../../shared/web-tools';
import { extractWebDocument } from './web-content';
import { fetchWebText, MAX_WEB_BYTES, publicWebUrl, resolveAddress, type WebNetwork } from './web-network';

/** What one search found, with where it was asked, before `WebTools` adds the query, the time and the trust line. */
export type WebSearchFound = { provider: string; url: string; results: WebSearchResult[]; coverage: string };

/** One search provider behind `web_search` (COD-266). Only the query is handed in, so only the query can leave. */
export type WebSearchEngine = { search(query: string, signal: AbortSignal): Promise<WebSearchFound> };

/** The provider the person picked, and how the core reaches main for its saved key. */
export type WebSearchSettings = {
  provider: WebSearchProvider;
  readKey?: (provider: WebSearchKeyProvider) => Promise<string | null>;
};

/** How the core reaches main for a saved search key; a test hands in its own. */
export type WebSearchRuntime = { readKey?: WebSearchSettings['readKey'] };

/** Exa's hosted MCP server; it answers without a key on a free, rate-limited tier, and more with one. */
export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';
const EXA_SEARCH_TOOL = 'web_search_exa';
const MAX_RESULTS = 10;
const SNIPPET_CHARACTERS = 300;
/** How long the courtesy DELETE that ends Exa's session may take before the connection is simply dropped. */
const END_SESSION_MS = 3000;
const LINKS_COVERAGE = 'Up to ten search links. Target pages have not been read or verified; use web_read_url for evidence.';
const EXA_COVERAGE = 'Up to ten search results from Exa, each with a short excerpt Exa picked. Target pages have not been read or verified; use web_read_url for evidence.';

/** The engine for the provider the person picked. Exa's saved key is read now, right before the search goes out. */
export async function webSearchEngine(settings: WebSearchSettings, network: WebNetwork): Promise<WebSearchEngine> {
  if (settings.provider === 'duckduckgo') return duckDuckGoSearch(network);
  const apiKey = await settings.readKey?.('exa') ?? null;
  return exaSearch(network, apiKey);
}

/** DuckDuckGo's plain results page, read the way `web_read_url` reads any page. It often answers with a challenge. */
export function duckDuckGoSearch(network: WebNetwork): WebSearchEngine {
  return {
    async search(query, signal) {
      const endpoint = new URL('https://html.duckduckgo.com/html/');
      endpoint.searchParams.set('q', query);
      const page = await fetchWebText(endpoint.href, signal, network);
      if (/challenge-form|anomaly\.js/i.test(page.content)) {
        throw new Error('Dịch vụ tìm kiếm yêu cầu xác minh người dùng. Cung cấp URL hoặc thử lại sau.');
      }
      const document = extractWebDocument(page.content);
      const results: WebSearchResult[] = [];
      for (const link of document.links) {
        if (!link.className.split(/\s+/).some(name => ['result__a', 'result-link'].includes(name))) continue;
        try {
          let target = new URL(link.url, page.url);
          if (['duckduckgo.com', 'html.duckduckgo.com'].includes(target.hostname) && target.pathname === '/l/') {
            target = new URL(target.searchParams.get('uddg') ?? '');
          }
          const url = publicWebUrl(target.href).href;
          if (link.title && !results.some(result => result.url === url)) results.push({ title: link.title, url });
        } catch { /* Search results with non-public or non-web links are not usable. */ }
        if (results.length === MAX_RESULTS) break;
      }
      if (!results.length && !/No results found|result--no-result/i.test(page.content)) {
        throw new Error('Dịch vụ tìm kiếm không trả danh sách kết quả đọc được. Thử lại hoặc cung cấp URL.');
      }
      return { provider: 'DuckDuckGo HTML', url: page.url, results, coverage: LINKS_COVERAGE };
    },
  };
}

/** A failure to reach the provider at all, told apart from an answer the provider gave. */
class SearchConnectionError extends Error {}

/** A response's headers in the form `fetch` callers read. */
function fetchHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

/**
 * A `fetch` for the MCP SDK that goes out through the web tools' own boundary (COD-266): a public HTTPS address,
 * resolved, checked and pinned the same way, the same 1 MiB limit, no cookies, and the caller's signal on every request.
 * Only POST and DELETE go out. The SDK's GET opens a standing event stream for messages a server starts; a search needs
 * none, Exa answers it with 405 anyway, and answering 405 here keeps a request and an open socket off the network.
 */
export function publicWebFetch(network: WebNetwork, signal: AbortSignal): FetchLike {
  return async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'POST' && method !== 'DELETE') return new Response(null, { status: 405 });
    const url = publicWebUrl(String(input));
    if (url.protocol !== 'https:') throw new Error('Tìm kiếm chỉ đi qua HTTPS.');
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    requestSignal.throwIfAborted();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? Buffer.from(init.body) : undefined;
    let response;
    try {
      const address = await resolveAddress(url, requestSignal, network);
      response = await network.connect({ url, address, signal: requestSignal, request: { method, headers, body } });
    } catch (error) {
      requestSignal.throwIfAborted();
      throw new SearchConnectionError(error instanceof Error ? error.message : String(error));
    }
    requestSignal.throwIfAborted();
    // A page read keeps the first 1 MiB of a longer page, but a cut JSON-RPC answer is no answer.
    if (response.cut || response.body.length >= MAX_WEB_BYTES) throw new Error('Kết quả tìm kiếm vượt giới hạn 1 MiB.');
    const encoding = response.headers['content-encoding'];
    if (encoding && encoding !== 'identity') throw new Error('Dịch vụ tìm kiếm dùng kiểu nén chưa được hỗ trợ.');
    const emptyBody = [204, 205, 304].includes(response.status);
    return new Response(emptyBody ? null : new Uint8Array(response.body), { status: response.status, headers: fetchHeaders(response.headers) });
  };
}

/** Seconds from a Retry-After header, when it gives a plain number. */
function retryAfterSeconds(value: string | null): number | undefined {
  const seconds = Number(value);
  if (!value || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/** The rate-limit message for the free tier, with when the next searches come back when Exa said so. */
function freeLimitMessage(retryAfter: number | undefined): string {
  if (retryAfter === undefined) return 'Tìm kiếm miễn phí của Exa đang bị giới hạn lượt. Thêm Exa API key trong Cài đặt → Tìm kiếm web, hoặc thử lại sau.';
  if (retryAfter < 90 * 60) {
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    return `Tìm kiếm miễn phí của Exa đang bị giới hạn lượt, khoảng ${minutes} phút nữa mới có lượt mới. Thêm Exa API key trong Cài đặt → Tìm kiếm web, hoặc thử lại sau.`;
  }
  const hours = Math.round(retryAfter / 3600);
  return `Tìm kiếm miễn phí của Exa đang bị giới hạn lượt, khoảng ${hours} giờ nữa mới có lượt mới. Thêm Exa API key trong Cài đặt → Tìm kiếm web, hoặc thử lại sau.`;
}

/** A short, single-line reason from whatever failed, without a stack. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Lỗi không rõ.';
}

/**
 * A plain sentence the worker can act on and the chat can show, for anything that stopped an Exa search. There is
 * never a quiet switch to another engine: the person picked Exa, so a failure says what went wrong with Exa.
 */
export function exaFailure(error: unknown, keyed: boolean, retryAfter?: number): Error {
  const status = error instanceof StreamableHTTPError ? error.code : undefined;
  const reason = reasonOf(error);
  if (status === 429 || /rate.?limit/i.test(reason)) {
    return new Error(keyed ? 'Exa đang giới hạn lượt tìm kiếm của API key này. Thử lại sau.' : freeLimitMessage(retryAfter));
  }
  if (keyed && (status === 401 || status === 403 || /api key|unauthori[sz]ed|forbidden/i.test(reason))) {
    return new Error('Exa từ chối API key đã lưu. Kiểm tra key trong Cài đặt → Tìm kiếm web.');
  }
  if (error instanceof SearchConnectionError) return new Error(`Không kết nối được tới Exa (${reason}). Kiểm tra mạng rồi thử lại.`);
  if (status !== undefined) return new Error(`Exa trả lỗi HTTP ${status}. Thử lại sau.`);
  return new Error(`Exa không tìm được: ${reason}`);
}

/** Text a search result's excerpt may show: one line, capped. */
function excerpt(value: unknown): string | undefined {
  const text = Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '';
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  const characters = Array.from(line);
  return characters.length > SNIPPET_CHARACTERS ? `${characters.slice(0, SNIPPET_CHARACTERS).join('')}…` : line;
}

/** A result Exa described, kept only when its address is a public web page; the excerpt is Exa's, never Orglet's. */
function addResult(results: WebSearchResult[], title: string | undefined, url: string | undefined, snippet: string | undefined) {
  if (!url || results.length >= MAX_RESULTS) return;
  let address: string;
  try {
    address = publicWebUrl(url).href;
  } catch {
    return;
  }
  if (results.some(result => result.url === address)) return;
  const name = title?.replace(/\s+/g, ' ').trim().slice(0, 500) || address;
  results.push(snippet ? { title: name, url: address, snippet } : { title: name, url: address });
}

/** Results from a JSON answer: `{ results: [...] }` or a bare list, with Exa's field names. */
function jsonResults(value: unknown): WebSearchResult[] | undefined {
  const list = Array.isArray(value) ? value : (value as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return undefined;
  const results: WebSearchResult[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const snippet = excerpt(entry.highlights) ?? excerpt(entry.summary) ?? excerpt(entry.text);
    addResult(results, typeof entry.title === 'string' ? entry.title : undefined, typeof entry.url === 'string' ? entry.url : undefined, snippet);
  }
  return results;
}

/** Results from Exa's text answer: blocks split by `---`, each with `Title:`, `URL:` and then its highlights or text. */
function textResults(text: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const block of text.split(/\n\s*-{3,}\s*\n/)) {
    // Spaces only, never a line break, between a label and its value: an empty title must not take the next line.
    const url = /^[ \t]*URL:[ \t]*(\S+)/im.exec(block)?.[1];
    const title = /^[ \t]*Title:[ \t]*(.*)$/im.exec(block)?.[1];
    const body = /^[ \t]*(?:Highlights|Summary|Text):[ \t]*([\s\S]*)$/im.exec(block)?.[1];
    addResult(results, title, url, excerpt(body));
  }
  return results;
}

/** Everything the tool said, as text. */
function toolText(result: CallToolResult): string {
  return result.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n');
}

/** Exa's answer as `web_search` results. An answer that is neither results nor "nothing found" is a failure. */
export function exaResults(result: CallToolResult): WebSearchResult[] {
  const structured = jsonResults(result.structuredContent);
  if (structured?.length) return structured;
  const text = toolText(result).trim();
  let parsed: WebSearchResult[] | undefined;
  if (/^[[{]/.test(text)) {
    try {
      parsed = jsonResults(JSON.parse(text));
    } catch {
      parsed = undefined;
    }
  }
  const results = parsed ?? textResults(text);
  if (!results.length && !/no (?:search )?results/i.test(text)) {
    throw new Error('Exa không trả danh sách kết quả đọc được. Thử lại hoặc cung cấp URL.');
  }
  return results;
}

/** Ends the session politely when Exa gave one, then drops the connection whatever happened. */
async function endSession(transport: StreamableHTTPClientTransport, client: Client) {
  const ending = transport.terminateSession().catch(() => undefined);
  await Promise.race([ending, new Promise(resolve => setTimeout(resolve, END_SESSION_MS).unref())]);
  await client.close().catch(() => undefined);
}

/**
 * Exa's `web_search_exa` tool on its hosted MCP server, spoken to with the MCP SDK's Streamable HTTP client through
 * `publicWebFetch`. Each search is its own short session. What leaves the machine is the MCP handshake (protocol
 * version and the client name "Orglet"), the query, and the saved key as `x-api-key` when there is one.
 */
export function exaSearch(network: WebNetwork, apiKey: string | null, endpoint = EXA_MCP_URL): WebSearchEngine {
  return {
    async search(query, signal) {
      const keyed = Boolean(apiKey);
      const limit: { retryAfter?: number } = {};
      const guarded = publicWebFetch(network, signal);
      const fetch: FetchLike = async (input, init) => {
        const response = await guarded(input, init);
        if (response.status === 429) limit.retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
        return response;
      };
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch,
        ...(apiKey ? { requestInit: { headers: { 'x-api-key': apiKey } } } : {}),
      });
      const client = new Client({ name: 'Orglet', version: '1' }, { capabilities: {} });
      try {
        let result: CallToolResult;
        try {
          await client.connect(transport, { signal });
          // The hosted tool asks for an objective beside the query. The query is sent as both, so nothing else leaves.
          const answer = await client.callTool({ name: EXA_SEARCH_TOOL, arguments: { query, objective: query, numResults: MAX_RESULTS } }, CallToolResultSchema, { signal });
          result = answer as CallToolResult;
        } catch (error) {
          signal.throwIfAborted();
          throw exaFailure(error, keyed, limit.retryAfter);
        }
        if (result.isError) throw exaFailure(new Error(toolText(result)), keyed, limit.retryAfter);
        return { provider: 'Exa', url: endpoint, results: exaResults(result), coverage: EXA_COVERAGE };
      } finally {
        await endSession(transport, client);
      }
    },
  };
}
