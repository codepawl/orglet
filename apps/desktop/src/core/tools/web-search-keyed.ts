import { SearxngUrl, type WebSearchResult } from '../../shared/web-tools';
import { publicWebUrl, type WebNetwork } from './web-network';
import {
  addResult, excerpt, MAX_RESULTS, reasonOf, requestSearchJson, SearchConnectionError, type SearchJsonAnswer,
} from './web-search-common';
import type { WebSearchEngine } from './web-search';

export const TAVILY_URL = 'https://api.tavily.com/search';
export const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

const COVERAGE_SUFFIX = 'Target pages have not been read or verified; use web_read_url for evidence.';
const OUT_OF_KEY_ADVICE = 'Kiểm tra key trong Cài đặt → Tìm kiếm web.';

/** Runs one request and turns a network failure into the plain sentence for that provider. */
async function ask(name: string, network: WebNetwork, signal: AbortSignal, request: Parameters<typeof requestSearchJson>[2]): Promise<SearchJsonAnswer> {
  try {
    return await requestSearchJson(network, signal, request);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof SearchConnectionError) throw new Error(`Không kết nối được tới ${name} (${error.message}). Kiểm tra mạng rồi thử lại.`);
    throw new Error(`${name} không tìm được: ${reasonOf(error, request.secret)}`);
  }
}

/** The rate limit of a key, with how long to wait when the provider said. One whole sentence per shape, so the English can match each. */
function rateLimited(name: string, retryAfter: number | undefined): Error {
  if (retryAfter === undefined) return new Error(`${name} đang giới hạn lượt tìm kiếm của key này. Thử lại sau.`);
  if (retryAfter < 90 * 60) {
    return new Error(`${name} đang giới hạn lượt tìm kiếm của key này, khoảng ${Math.max(1, Math.ceil(retryAfter / 60))} phút nữa mới có lượt mới. Thử lại sau.`);
  }
  return new Error(`${name} đang giới hạn lượt tìm kiếm của key này, khoảng ${Math.round(retryAfter / 3600)} giờ nữa mới có lượt mới. Thử lại sau.`);
}

function httpFailure(name: string, status: number): Error {
  return new Error(`${name} trả lỗi HTTP ${status}. Thử lại sau.`);
}

function notUnderstood(name: string): Error {
  return new Error(`${name} không trả danh sách kết quả đọc được. Thử lại hoặc cung cấp URL.`);
}

/** Markup some providers leave in titles and excerpts, as plain text. */
function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|lt|gt|#39|#x27);/g, entity => (
    { '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'" }[entity] ?? entity
  ));
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Results from a list of `{ title, url, <excerptField> }` entries. */
function listResults(list: unknown[], excerptField: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const item of list) {
    const entry = recordOf(item);
    if (!entry) continue;
    addResult(results, plainText(entry.title), typeof entry.url === 'string' ? entry.url : undefined, excerpt(plainText(entry[excerptField])));
  }
  return results;
}

/**
 * Tavily's search API: `POST https://api.tavily.com/search` with the key as a Bearer token. What leaves the machine is
 * the query, the result count and the depth `basic` (1 credit), and the key in `Authorization`.
 */
export function tavilySearch(network: WebNetwork, apiKey: string, endpoint = TAVILY_URL): WebSearchEngine {
  return {
    async search(query, signal) {
      const answer = await ask('Tavily', network, signal, {
        method: 'POST', url: endpoint, secret: apiKey,
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { query, max_results: MAX_RESULTS, search_depth: 'basic' },
      });
      if (answer.status === 401) throw new Error(`Tavily từ chối API key đã lưu. ${OUT_OF_KEY_ADVICE}`);
      if (answer.status === 429) throw rateLimited('Tavily', answer.retryAfter);
      if (answer.status === 432 || answer.status === 433) {
        throw new Error('Gói Tavily của key này đã dùng hết lượt (hạn mức gói hoặc hạn mức trả theo dùng). Chờ kỳ sau hoặc nâng gói ở app.tavily.com.');
      }
      if (answer.status < 200 || answer.status >= 300) throw httpFailure('Tavily', answer.status);
      const list = recordOf(answer.json)?.results;
      if (!Array.isArray(list)) throw notUnderstood('Tavily');
      return { provider: 'Tavily', url: endpoint, results: listResults(list, 'content'),
        coverage: `Up to ten search results from Tavily, each with a short excerpt Tavily picked. ${COVERAGE_SUFFIX}` };
    },
  };
}

/**
 * Brave Search API: `GET https://api.search.brave.com/res/v1/web/search?q=…&count=10` with the key in
 * `X-Subscription-Token`. What leaves the machine is the query, the count, and the key in that header.
 */
export function braveSearch(network: WebNetwork, apiKey: string, endpoint = BRAVE_URL): WebSearchEngine {
  return {
    async search(query, signal) {
      const url = new URL(endpoint);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(MAX_RESULTS));
      const answer = await ask('Brave Search', network, signal, {
        method: 'GET', url: url.href, secret: apiKey, headers: { 'X-Subscription-Token': apiKey },
      });
      if (answer.status === 401 || answer.status === 403) throw new Error(`Brave Search từ chối API key đã lưu. ${OUT_OF_KEY_ADVICE}`);
      if (answer.status === 429) throw rateLimited('Brave Search', answer.retryAfter);
      if (answer.status < 200 || answer.status >= 300) throw httpFailure('Brave Search', answer.status);
      const body = recordOf(answer.json);
      if (!body) throw notUnderstood('Brave Search');
      // With nothing found Brave leaves `web` out altogether.
      const web = body.web === undefined ? { results: [] } : recordOf(body.web);
      if (!web || !Array.isArray(web.results)) throw notUnderstood('Brave Search');
      return { provider: 'Brave Search', url: endpoint, results: listResults(web.results, 'description'),
        coverage: `Up to ten search results from Brave Search, each with a short excerpt. ${COVERAGE_SUFFIX}` };
    },
  };
}

/** Said when the saved address cannot be used by this app, whatever the reason. */
const INSTANCE_REFUSED = 'SearXNG chỉ dùng được máy chủ công khai qua HTTPS trên cổng mặc định. Máy chủ trên máy này hoặc trong mạng riêng chưa dùng được.';

/**
 * A SearXNG instance's JSON results: `GET <instance>/search?q=…&format=json`, no key. The query goes to whoever runs that
 * instance, and on to the engines it uses. An instance answers 403 when `json` is missing from `search.formats`.
 */
export function searxngSearch(network: WebNetwork, instanceUrl: string | null | undefined): WebSearchEngine {
  return {
    async search(query, signal) {
      if (!instanceUrl) throw new Error('SearXNG cần địa chỉ máy chủ. Nhập địa chỉ trong Cài đặt → Tìm kiếm web.');
      let base: URL;
      try {
        const checked = SearxngUrl.parse(instanceUrl);
        base = publicWebUrl(checked);
      } catch {
        throw new Error(INSTANCE_REFUSED);
      }
      if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
      const endpoint = new URL('search', base);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('format', 'json');
      const name = `SearXNG (${base.hostname})`;
      let answer: SearchJsonAnswer;
      try {
        answer = await ask(name, network, signal, { method: 'GET', url: endpoint.href, headers: {} });
      } catch (error) {
        // An address that resolves inside a private network is the boundary's refusal, not a connection problem.
        if (error instanceof Error && /địa chỉ mạng không được phép/.test(error.message)) throw new Error(INSTANCE_REFUSED);
        throw error;
      }
      if (answer.status === 403) {
        throw new Error(`${name} chưa bật kết quả JSON. Trên máy chủ, thêm json vào search.formats trong settings.yml rồi khởi động lại.`);
      }
      if (answer.status === 429) throw new Error(`${name} đang giới hạn lượt tìm kiếm. Thử lại sau, hoặc dùng máy chủ khác.`);
      if (answer.status < 200 || answer.status >= 300) throw httpFailure(name, answer.status);
      const list = recordOf(answer.json)?.results;
      if (!Array.isArray(list)) throw notUnderstood(name);
      const shown = new URL('search', base);
      return { provider: name, url: shown.href, results: listResults(list, 'content'),
        coverage: `Up to ten search results from the SearXNG instance ${base.hostname}, with the excerpts its engines gave. ${COVERAGE_SUFFIX}` };
    },
  };
}
