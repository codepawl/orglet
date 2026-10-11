import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { WebConnection, WebNetwork, WebResponse } from '../../apps/desktop/src/core/tools/web-network';
import { automaticSearch } from '../../apps/desktop/src/core/tools/web-search';
import { braveSearch, searxngSearch, tavilySearch } from '../../apps/desktop/src/core/tools/web-search-keyed';
import { WebTools } from '../../apps/desktop/src/core/tools/web-tools';
import { WebSearchKeys } from '../../apps/desktop/src/main/web-search-keys';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { SyncData } from '../../apps/desktop/src/shared/sync-records';
import { SearxngUrl, WEB_SEARCH_PROVIDER_NAMES, WebSearchKeyProvider, WebSearchProvider } from '../../apps/desktop/src/shared/web-tools';

const signal = () => new AbortController().signal;
const TAVILY_KEY = 'tvly-dev-0123456789abcdefSECRET';
const BRAVE_KEY = 'BSA0123456789abcdefSECRET';

type Seen = { method: string; url: string; headers: Record<string, string>; body: string };

/** A network whose servers answer from `answer`; every request that would leave the machine is recorded. */
function fakeNetwork(answer: (connection: WebConnection, seen: Seen) => WebResponse | Promise<WebResponse>, address = '93.184.216.34') {
  const requests: Seen[] = [];
  const network = {
    resolve: vi.fn<WebNetwork['resolve']>(async () => [{ address, family: 4 }]),
    connect: vi.fn<WebNetwork['connect']>(async (connection: WebConnection) => {
      const seen: Seen = { method: connection.request?.method ?? 'GET', url: connection.url.href,
        headers: connection.request?.headers ?? {}, body: connection.request?.body?.toString('utf8') ?? '' };
      requests.push(seen);
      return answer(connection, seen);
    }),
  };
  return { network, requests };
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}): WebResponse =>
  ({ status, headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(value)) });

/** Everything an error or log line could say about a search, to check a key never appears in it. */
const allText = (error: unknown) => `${(error as Error).message}\n${(error as Error).stack ?? ''}`;

afterEach(() => vi.restoreAllMocks());

describe('Tavily over its search API', () => {
  const answer = {
    results: [
      { title: 'Node.js docs', url: 'https://nodejs.org/docs/', content: 'The   Node.js\n API reference.' },
      { title: 'A private page', url: 'http://127.0.0.1/admin', content: 'never' },
      { title: 'No excerpt', url: 'https://example.com/a' },
      { title: 'Long', url: 'https://example.com/long', content: 'word '.repeat(200) },
      ...Array.from({ length: 12 }, (_, index) => ({ title: `Extra ${index}`, url: `https://example.com/extra-${index}`, content: 'x' })),
    ],
  };

  it('sends one POST with a Bearer key and a body that holds only the query, and parses the results', async () => {
    const { network, requests } = fakeNetwork(() => json(answer));
    const found = await tavilySearch(network, TAVILY_KEY).search('grouped query attention', signal());
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('https://api.tavily.com/search');
    expect(requests[0].headers.Authorization).toBe(`Bearer ${TAVILY_KEY}`);
    expect(requests[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(requests[0].body)).toEqual({ query: 'grouped query attention', max_results: 10, search_depth: 'basic' });
    expect(requests[0].headers).not.toHaveProperty('cookie');
    expect(found.provider).toBe('Tavily');
    expect(found.results).toHaveLength(10);
    expect(found.results[0]).toEqual({ title: 'Node.js docs', url: 'https://nodejs.org/docs/', snippet: 'The Node.js API reference.' });
    expect(found.results[1]).toEqual({ title: 'No excerpt', url: 'https://example.com/a' });
    expect(Array.from(found.results[2].snippet!)).toHaveLength(301);
    expect(found.results.some(result => result.url.includes('127.0.0.1'))).toBe(false);
  });

  it('maps each documented error to a plain sentence that never carries the key', async () => {
    const cases: Array<[WebResponse, string]> = [
      [json({ detail: 'bad' }, 401), 'Tavily từ chối API key đã lưu. Kiểm tra key trong Cài đặt → Tìm kiếm web.'],
      [json({}, 429, { 'retry-after': '120' }), 'Tavily đang giới hạn lượt tìm kiếm của key này, khoảng 2 phút nữa mới có lượt mới. Thử lại sau.'],
      [json({}, 429, { 'retry-after': '14400' }), 'khoảng 4 giờ nữa'],
      [json({}, 429), 'Tavily đang giới hạn lượt tìm kiếm của key này. Thử lại sau.'],
      [json({}, 432), 'Gói Tavily của key này đã dùng hết lượt'],
      [json({}, 433), 'Gói Tavily của key này đã dùng hết lượt'],
      [json({}, 500), 'Tavily trả lỗi HTTP 500. Thử lại sau.'],
      [json({ nothing: true }), 'Tavily không trả danh sách kết quả đọc được.'],
      [{ status: 200, headers: {}, body: Buffer.from('<html>blocked</html>') }, 'Tavily không trả danh sách kết quả đọc được.'],
    ];
    for (const [response, message] of cases) {
      const { network } = fakeNetwork(() => response);
      const failure = await tavilySearch(network, TAVILY_KEY).search('q', signal()).catch((error: unknown) => error);
      expect((failure as Error).message).toContain(message);
      expect(allText(failure)).not.toContain(TAVILY_KEY);
    }
    expect((await tavilySearch(fakeNetwork(() => json({ results: [] })).network, TAVILY_KEY).search('q', signal())).results).toEqual([]);
    const unreachable = fakeNetwork(() => { throw new Error(`socket hang up while sending ${TAVILY_KEY}`); });
    const failure = await tavilySearch(unreachable.network, TAVILY_KEY).search('q', signal()).catch((error: unknown) => error);
    expect((failure as Error).message).toMatch(/^Không kết nối được tới Tavily \(/);
    expect(allText(failure)).not.toContain(TAVILY_KEY);
  });
});

describe('Brave Search over its web search API', () => {
  it('sends one GET with the key in X-Subscription-Token, only q and count in the address, and no body', async () => {
    const { network, requests } = fakeNetwork(() => json({ web: { results: [
      { title: 'Node<strong>.js</strong> &amp; docs', url: 'https://nodejs.org/docs/', description: 'The <strong>API</strong> reference &quot;here&quot;.' },
      { title: 'No description', url: 'https://example.com/a' },
      { title: 'Private', url: 'https://192.168.1.4/x', description: 'never' },
    ] } }));
    const found = await braveSearch(network, BRAVE_KEY).search('grouped query attention', signal());
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('https://api.search.brave.com/res/v1/web/search?q=grouped+query+attention&count=10');
    expect(requests[0].headers['X-Subscription-Token']).toBe(BRAVE_KEY);
    expect(requests[0].headers.Accept).toBe('application/json');
    expect(requests[0].headers).not.toHaveProperty('Authorization');
    expect(requests[0].body).toBe('');
    expect(found.provider).toBe('Brave Search');
    expect(found.results).toEqual([
      { title: 'Node .js & docs', url: 'https://nodejs.org/docs/', snippet: 'The API reference "here".' },
      { title: 'No description', url: 'https://example.com/a' },
    ]);
  });

  it('maps each documented error, reads Retry-After, and accepts an answer with no web section', async () => {
    const cases: Array<[WebResponse, string]> = [
      [json({}, 401), 'Brave Search từ chối API key đã lưu.'],
      [json({}, 403), 'Brave Search từ chối API key đã lưu.'],
      [json({}, 429, { 'retry-after': '30' }), 'Brave Search đang giới hạn lượt tìm kiếm của key này, khoảng 1 phút nữa mới có lượt mới.'],
      [json({}, 429), 'Brave Search đang giới hạn lượt tìm kiếm của key này. Thử lại sau.'],
      [json({}, 502), 'Brave Search trả lỗi HTTP 502. Thử lại sau.'],
      [json({ web: { results: 'nope' } }), 'Brave Search không trả danh sách kết quả đọc được.'],
      [{ status: 200, headers: {}, body: Buffer.from('not json') }, 'Brave Search không trả danh sách kết quả đọc được.'],
    ];
    for (const [response, message] of cases) {
      const failure = await braveSearch(fakeNetwork(() => response).network, BRAVE_KEY).search('q', signal()).catch((error: unknown) => error);
      expect((failure as Error).message).toContain(message);
      expect(allText(failure)).not.toContain(BRAVE_KEY);
    }
    const none = await braveSearch(fakeNetwork(() => json({ type: 'search', query: { original: 'q' } })).network, BRAVE_KEY).search('q', signal());
    expect(none.results).toEqual([]);
  });
});

describe('SearXNG instance', () => {
  const instance = 'https://searx.example.org/';

  it('asks the instance for JSON with only q and format, with no key, and sends no excerpt when none comes', async () => {
    const { network, requests } = fakeNetwork(() => json({ query: 'q', results: [
      { title: 'Node.js', url: 'https://nodejs.org/', content: 'Runtime  docs.', engine: 'duckduckgo' },
      { title: 'No content', url: 'https://example.com/a' },
      ...Array.from({ length: 20 }, (_, index) => ({ title: `Extra ${index}`, url: `https://example.com/e${index}`, content: 'x' })),
    ] }));
    const found = await searxngSearch(network, instance).search('grouped query attention', signal());
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('https://searx.example.org/search?q=grouped+query+attention&format=json');
    expect(Object.keys(requests[0].headers).sort()).toEqual(['Accept']);
    expect(requests[0].body).toBe('');
    expect(found.provider).toBe('SearXNG (searx.example.org)');
    expect(found.results).toHaveLength(10);
    expect(found.results[0]).toEqual({ title: 'Node.js', url: 'https://nodejs.org/', snippet: 'Runtime docs.' });
    expect(found.results[1]).toEqual({ title: 'No content', url: 'https://example.com/a' });
    // An instance under a path keeps it.
    const nested = fakeNetwork(() => json({ results: [] }));
    await searxngSearch(nested.network, 'https://example.org/searx').search('q', signal());
    expect(nested.requests[0].url).toBe('https://example.org/searx/search?q=q&format=json');
  });

  it('says a 403 means JSON is off and names search.formats, and maps the other answers', async () => {
    const cases: Array<[WebResponse, string]> = [
      [json({}, 403), 'search.formats'],
      [json({}, 429), 'đang giới hạn lượt tìm kiếm'],
      [json({}, 500), 'trả lỗi HTTP 500'],
      [{ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>no json</html>') }, 'không trả danh sách kết quả đọc được'],
    ];
    for (const [response, message] of cases) {
      const failure = await searxngSearch(fakeNetwork(() => response).network, instance).search('q', signal()).catch((error: unknown) => error);
      expect((failure as Error).message).toContain(message);
    }
  });

  it('refuses an address that is not public HTTPS before any request goes out, and a host that resolves privately', async () => {
    for (const address of [null, 'http://searx.example.org/', 'https://localhost/', 'https://127.0.0.1/', 'https://192.168.1.10/', 'https://nas.local/', 'https://searx.example.org:8443/']) {
      const { network, requests } = fakeNetwork(() => json({ results: [] }));
      const failure = await searxngSearch(network, address).search('q', signal()).catch((error: unknown) => error);
      expect((failure as Error).message).toMatch(address === null ? /cần địa chỉ máy chủ/ : /chỉ dùng được máy chủ công khai qua HTTPS/);
      expect(requests).toHaveLength(0);
    }
    const privateHost = fakeNetwork(() => json({ results: [] }), '10.0.0.5');
    const failure = await searxngSearch(privateHost.network, instance).search('q', signal()).catch((error: unknown) => error);
    expect((failure as Error).message).toMatch(/chỉ dùng được máy chủ công khai qua HTTPS/);
    expect(privateHost.requests).toHaveLength(0);
  });

  it('only accepts a plain public https:// address as a setting', () => {
    expect(SearxngUrl.parse(' https://searx.example.org/ ')).toBe('https://searx.example.org/');
    for (const bad of ['http://searx.example.org', 'https://user:pass@searx.example.org', 'https://searx.example.org:8443', 'https://searx.example.org/?q=1', 'https://searx.example.org/#a', 'searx.example.org', '']) {
      expect(SearxngUrl.safeParse(bad).success).toBe(false);
    }
  });
});

describe('choosing the engine', () => {
  it('fails a keyed provider with no key at once, without any network call, and asks main for exactly that key', async () => {
    for (const provider of ['tavily', 'brave'] as const) {
      const { network, requests } = fakeNetwork(() => json({ results: [] }));
      const readKey = vi.fn(async () => null);
      await expect(new WebTools(network, { provider, readKey }).search({ query: 'q' }, signal()))
        .rejects.toThrow(provider === 'tavily' ? 'Tavily cần API key.' : 'Brave Search cần API key.');
      expect(readKey).toHaveBeenCalledWith(provider);
      expect(readKey).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(0);
    }
    const { network } = fakeNetwork(() => json({ results: [{ title: 'T', url: 'https://example.com/' }] }));
    const result = await new WebTools(network, { provider: 'tavily', readKey: async provider => provider === 'tavily' ? TAVILY_KEY : null }).search({ query: 'q' }, signal());
    expect(result.source).toMatchObject({ provider: 'Tavily', url: 'https://api.tavily.com/search' });
  });

  it('reads the SearXNG address from the settings and never a key', async () => {
    const { network, requests } = fakeNetwork(() => json({ results: [{ title: 'T', url: 'https://example.com/' }] }));
    const readKey = vi.fn(async () => 'should-not-be-asked-for');
    const result = await new WebTools(network, { provider: 'searxng', instanceUrl: 'https://searx.example.org/', readKey }).search({ query: 'q' }, signal());
    expect(result.source.provider).toBe('SearXNG (searx.example.org)');
    expect(readKey).not.toHaveBeenCalled();
    expect(requests[0].headers).not.toHaveProperty('Authorization');
  });
});

/** Exa's hosted MCP server and DuckDuckGo's page as one network, each answering as the test says. */
function twoEngines(exa: 'ok' | 'limited' | 'down', duckduckgo: 'ok' | 'challenge' | 'down') {
  const sse = (payload: unknown, headers: Record<string, string> = {}): WebResponse =>
    ({ status: 200, headers: { 'content-type': 'text/event-stream', ...headers }, body: Buffer.from(`event: message\ndata: ${JSON.stringify(payload)}\n\n`) });
  return fakeNetwork((connection, seen) => {
    if (connection.url.hostname === 'html.duckduckgo.com') {
      if (duckduckgo === 'down') throw new Error('connection reset');
      if (duckduckgo === 'challenge') return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<form id="challenge-form"></form>') };
      return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<a class="result__a" href="https://en.wikipedia.org/">Wikipedia</a>') };
    }
    if (exa === 'down') throw new Error('getaddrinfo ENOTFOUND mcp.exa.ai');
    if (exa === 'limited') {
      return { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '600' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'rate limit' }, id: null })) };
    }
    if (seen.method === 'DELETE') return { status: 200, headers: {}, body: Buffer.alloc(0) };
    const message = JSON.parse(seen.body) as { id?: number; method: string; params?: Record<string, unknown> };
    if (message.method === 'initialize') {
      return sse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'exa', version: '1' } } }, { 'mcp-session-id': 's' });
    }
    if (message.method === 'notifications/initialized') return { status: 202, headers: {}, body: Buffer.alloc(0) };
    return sse({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'Title: Exa result\nURL: https://example.com/exa\nText: hello' }] } });
  });
}

describe('Automatic', () => {
  it('uses keyless Exa first and never touches DuckDuckGo or a key when Exa answers', async () => {
    const { network, requests } = twoEngines('ok', 'ok');
    const readKey = vi.fn(async () => 'exa-key-0123456789abcdef');
    const result = await new WebTools(network, { provider: 'auto', readKey }).search({ query: 'q' }, signal());
    expect(result.source.provider).toBe('Exa');
    expect(result.results[0].url).toBe('https://example.com/exa');
    expect(requests.every(request => new URL(request.url).hostname === 'mcp.exa.ai')).toBe(true);
    expect(readKey).not.toHaveBeenCalled();
    for (const request of requests) {
      expect(Object.keys(request.headers).map(name => name.toLowerCase())).not.toContain('x-api-key');
      expect(Object.keys(request.headers).map(name => name.toLowerCase())).not.toContain('authorization');
    }
  });

  it('falls back to DuckDuckGo when Exa is rate limited or cannot be reached, and says who answered', async () => {
    for (const exa of ['limited', 'down'] as const) {
      const { network, requests } = twoEngines(exa, 'ok');
      const result = await new WebTools(network, { provider: 'auto' }).search({ query: 'q' }, signal());
      expect(result.source.provider).toBe('DuckDuckGo HTML');
      expect(result.results).toEqual([{ title: 'Wikipedia', url: 'https://en.wikipedia.org/' }]);
      expect(requests.some(request => new URL(request.url).hostname === 'html.duckduckgo.com')).toBe(true);
    }
  });

  it('names both reasons in one message when both engines fail', async () => {
    const { network } = twoEngines('limited', 'challenge');
    const failure = await new WebTools(network, { provider: 'auto' }).search({ query: 'q' }, signal()).catch((error: unknown) => error);
    const message = (failure as Error).message;
    expect(message).toContain('Tìm kiếm tự động không được.');
    expect(message).toContain('Exa: Tìm kiếm miễn phí của Exa đang bị giới hạn lượt, khoảng 10 phút nữa');
    expect(message).toContain('DuckDuckGo: Dịch vụ tìm kiếm yêu cầu xác minh người dùng.');
  });

  it('does not start the second engine when the search was stopped', async () => {
    const { network } = twoEngines('limited', 'ok');
    const controller = new AbortController();
    controller.abort();
    await expect(automaticSearch(network).search('q', controller.signal)).rejects.toThrow();
    expect(network.resolve.mock.calls.some(([hostname]) => hostname === 'html.duckduckgo.com')).toBe(false);
  });

  it('gives a chosen provider exactly that provider and no fallback', async () => {
    for (const provider of ['exa', 'duckduckgo', 'tavily', 'brave', 'searxng'] as const) {
      const { network, requests } = twoEngines('limited', 'down');
      const readKey = async () => 'key-0123456789abcdefghij';
      await expect(new WebTools(network, { provider, readKey, instanceUrl: 'https://searx.example.org/' }).search({ query: 'q' }, signal())).rejects.toThrow();
      const hosts = new Set(requests.map(request => new URL(request.url).hostname));
      const expected = { exa: 'mcp.exa.ai', duckduckgo: 'html.duckduckgo.com', tavily: 'api.tavily.com', brave: 'api.search.brave.com', searxng: 'searx.example.org' }[provider];
      expect([...hosts]).toEqual([expected]);
    }
  });
});

describe('the setting, the migration and the keys', () => {
  const settings = { theme: 'system' as const, connectionLimitMicros: 5_000_000 };
  const newCore = (store: Store, readKey: (provider: string) => Promise<string | null>) =>
    new CoreService(store, () => {}, async () => { throw new Error('No model in this test.'); }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { readKey });
  const migrated = (store: Store) => vi.waitFor(() => expect(store.setting<boolean>('webSearchMigrated', false)).toBe(true));

  it('moves a saved Exa choice without an Exa key to Automatic, once, and leaves every other choice alone', async () => {
    const withoutKey = new Store(':memory:');
    const withKey = new Store(':memory:');
    const duckDuckGo = new Store(':memory:');
    const never = new Store(':memory:');
    try {
      withoutKey.setSetting('webSearchProvider', 'exa');
      withKey.setSetting('webSearchProvider', 'exa');
      duckDuckGo.setSetting('webSearchProvider', 'duckduckgo');
      const readKey = vi.fn(async () => null);
      newCore(withoutKey, readKey);
      newCore(withKey, async () => 'exa-key-0123456789abcdef');
      newCore(duckDuckGo, readKey);
      newCore(never, readKey);
      for (const store of [withoutKey, withKey, duckDuckGo, never]) await migrated(store);
      expect(withoutKey.workspace().webSearchProvider).toBe('auto');
      expect(withKey.workspace().webSearchProvider).toBe('exa');
      expect(duckDuckGo.workspace().webSearchProvider).toBe('duckduckgo');
      expect(never.workspace().webSearchProvider).toBe('auto');
      expect(readKey).toHaveBeenCalledTimes(1);
      // A person who picks Exa again after the move keeps it.
      const again = newCore(withoutKey, async () => null);
      await again.command('settings', { ...settings, webSearchProvider: 'exa' });
      await Promise.resolve();
      expect(withoutKey.workspace().webSearchProvider).toBe('exa');
    } finally {
      for (const store of [withoutKey, withKey, duckDuckGo, never]) store.close();
    }
  });

  it('checks the provider and the SearXNG address at the settings command, and clears the address with an empty one', async () => {
    const store = new Store(':memory:');
    try {
      const core = newCore(store, async () => null);
      for (const provider of ['tavily', 'brave', 'searxng', 'auto'] as const) {
        await core.command('settings', { ...settings, webSearchProvider: provider });
        expect(store.workspace().webSearchProvider).toBe(provider);
      }
      expect(store.workspace().searxngUrl).toBeNull();
      await core.command('settings', { ...settings, searxngUrl: ' https://searx.example.org/ ' });
      expect(store.workspace().searxngUrl).toBe('https://searx.example.org/');
      for (const bad of ['http://searx.example.org/', 'https://u:p@searx.example.org/', 'https://searx.example.org:9/', 'javascript:alert(1)']) {
        await expect(core.command('settings', { ...settings, searxngUrl: bad })).rejects.toThrow();
      }
      expect(store.workspace().searxngUrl).toBe('https://searx.example.org/');
      await core.command('settings', { ...settings, searxngUrl: '' });
      expect(store.workspace().searxngUrl).toBeNull();
      await expect(core.command('settings', { ...settings, webSearchProvider: 'bing' })).rejects.toThrow();
    } finally { store.close(); }
  });

  it('reports the engine that answered in Settings → Test', async () => {
    const store = new Store(':memory:');
    try {
      const { network } = twoEngines('limited', 'ok');
      const { webNetwork } = await import('../../apps/desktop/src/core/tools/web-network');
      vi.spyOn(webNetwork, 'resolve').mockImplementation(network.resolve);
      vi.spyOn(webNetwork, 'connect').mockImplementation(network.connect);
      const core = newCore(store, async () => null);
      expect(await core.command('testWebSearch', {})).toEqual({ provider: 'auto', answeredBy: 'DuckDuckGo HTML', title: 'Wikipedia', url: 'https://en.wikipedia.org/' });
    } finally { store.close(); }
  });

  it('keeps one encrypted credential file per keyed provider, and refuses providers that have no key', async () => {
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(Buffer.from(text).toString('base64').split('').reverse().join('')),
      decryptString: (data: Buffer) => Buffer.from(data.toString().split('').reverse().join(''), 'base64').toString(),
    };
    const directory = await mkdtemp(join(tmpdir(), 'orglet-search-keys-'));
    try {
      const keys = new WebSearchKeys(directory, encryption);
      await keys.save('tavily', TAVILY_KEY);
      await keys.save('brave', BRAVE_KEY);
      expect((await readdir(directory)).sort()).toEqual(['search-brave.credential', 'search-tavily.credential']);
      expect(await keys.read('tavily')).toBe(TAVILY_KEY);
      expect(await keys.read('brave')).toBe(BRAVE_KEY);
      expect(await keys.status()).toEqual({ exa: false, tavily: true, brave: true });
      await keys.remove('tavily');
      expect(await keys.status()).toEqual({ exa: false, tavily: false, brave: true });
      expect(WebSearchKeyProvider.options).toEqual(['exa', 'tavily', 'brave']);
      for (const notKeyed of ['auto', 'searxng', 'duckduckgo', '../exa']) expect(WebSearchKeyProvider.safeParse(notKeyed).success).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('names every provider, and keeps the new values out of what a released app (v0.13.0) parses', async () => {
    expect(Object.keys(WEB_SEARCH_PROVIDER_NAMES).sort()).toEqual([...WebSearchProvider.options].sort());
    // v0.13.0 reads the setting as `z.enum(['exa', 'duckduckgo']).catch('exa')`: a value it does not know is Exa, never an error.
    const releasedRead = z.enum(['exa', 'duckduckgo']).catch('exa');
    for (const value of ['auto', 'tavily', 'brave', 'searxng']) expect(releasedRead.parse(value)).toBe('exa');
    // The setting is not a sync record (v0.13.0's SyncSetting holds only theme, language and sidebarOrder) ...
    for (const key of ['webSearchProvider', 'searxngUrl', 'webSearchMigrated']) {
      expect(SyncData.safeParse({ kind: 'setting', change: { key, value: 'auto' } }).success).toBe(false);
    }
    // ... and a backup (a strict schema) carries neither the provider, the address nor a key.
    const store = new Store(':memory:');
    try {
      const core = newCore(store, async () => 'a-key-0123456789abcdefghij');
      await core.command('settings', { ...settings, webSearchProvider: 'searxng', searxngUrl: 'https://searx.example.org/' });
      const backup = new Backups(store, () => false, () => {}).export();
      for (const text of ['webSearchProvider', 'searxng', 'searx.example.org', 'webSearchMigrated', 'a-key-0123456789abcdefghij']) expect(backup).not.toContain(text);
    } finally { store.close(); }
  });
});
