import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { MAX_WEB_BYTES, webNetwork, type WebConnection, type WebNetwork, type WebResponse } from '../../apps/desktop/src/core/tools/web-network';
import { EXA_MCP_URL, exaSearch, publicWebFetch } from '../../apps/desktop/src/core/tools/web-search';
import { WebTools } from '../../apps/desktop/src/core/tools/web-tools';
import { WebSearchKeys } from '../../apps/desktop/src/main/web-search-keys';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { emptyConnections } from '../../apps/desktop/src/shared/contracts';

const signal = () => new AbortController().signal;

/** What the fake Exa saw of one request: everything that left the machine for it. */
type Exchange = { method: string; url: string; headers: Record<string, string>; body: string };
type ToolAnswer = { status?: number; headers?: IncomingHttpHeaders; result?: unknown; raw?: string };

const EXA_TEXT = [
  'Title: Node.js — Documentation',
  'URL: https://nodejs.org/docs/latest/api/',
  'Published: 2026-01-10',
  'Author: N/A',
  'Highlights:',
  'Node.js® is a JavaScript runtime.\nThe API reference documentation provides detailed information.',
  '',
  '---',
  '',
  'Title: A private address',
  'URL: http://127.0.0.1/admin',
  'Highlights:',
  'Should never reach a worker.',
  '',
  '---',
  '',
  'Title: Node.js — Documentation again',
  'URL: https://nodejs.org/docs/latest/api/#fragment',
  'Text: The same page twice.',
  '',
  '---',
  '',
  'Title: ',
  'URL: https://example.com/untitled',
  'Text: ' + 'Long excerpt. '.repeat(60),
].join('\n');

function sse(payload: unknown, headers: IncomingHttpHeaders = {}): WebResponse {
  return { status: 200, headers: { 'content-type': 'text/event-stream', ...headers }, body: Buffer.from(`event: message\ndata: ${JSON.stringify(payload)}\n\n`) };
}

/**
 * Exa's hosted MCP server as the network sees it: the handshake answered as event streams with a session id, the
 * initialized notification with 202, and `tools/call` with whatever the test says. Every request is recorded.
 */
function fakeExa(answer: (argumentsValue: Record<string, unknown>) => ToolAnswer = () => ({ result: { content: [{ type: 'text', text: EXA_TEXT }] } })) {
  const exchanges: Exchange[] = [];
  const network = {
    resolve: vi.fn<WebNetwork['resolve']>(async () => [{ address: '104.18.26.84', family: 4 }]),
    connect: vi.fn<WebNetwork['connect']>(async (connection: WebConnection) => {
      const body = connection.request?.body?.toString('utf8') ?? '';
      exchanges.push({ method: connection.request?.method ?? 'GET', url: connection.url.href, headers: connection.request?.headers ?? {}, body });
      if (connection.request?.method === 'DELETE') return { status: 200, headers: {}, body: Buffer.alloc(0) };
      const message = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      if (message.method === 'initialize') {
        return sse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'exa-fixture', version: '1' } } }, { 'mcp-session-id': 'session-fixture' });
      }
      if (message.method === 'notifications/initialized') return { status: 202, headers: {}, body: Buffer.alloc(0) };
      if (message.method === 'tools/call') {
        const reply = answer((message.params?.arguments ?? {}) as Record<string, unknown>);
        if (reply.raw !== undefined) return { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers }, body: Buffer.from(reply.raw) };
        return sse({ jsonrpc: '2.0', id: message.id, result: reply.result }, reply.headers);
      }
      return { status: 400, headers: {}, body: Buffer.alloc(0) };
    }),
  };
  return { network, exchanges };
}

const rateLimited = (retryAfter?: string): ToolAnswer => ({
  status: 429,
  headers: retryAfter ? { 'retry-after': retryAfter } : {},
  raw: JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: "You've hit Exa's free MCP rate limit." }, id: null }),
});

afterEach(() => vi.restoreAllMocks());

describe('Exa search over its hosted MCP server (COD-266)', () => {
  it('maps Exa results to web_search results and keeps only public, distinct pages', async () => {
    const { network, exchanges } = fakeExa();
    const result = await new WebTools(network, { provider: 'exa' }).search({ query: 'Node.js documentation' }, signal());
    expect(result.source).toMatchObject({ provider: 'Exa', url: EXA_MCP_URL });
    expect(result.trust).toContain('Untrusted');
    expect(result.coverage).toContain('have not been read');
    expect(result.results.map(entry => entry.url)).toEqual(['https://nodejs.org/docs/latest/api/', 'https://example.com/untitled']);
    expect(result.results[0]).toEqual({ title: 'Node.js — Documentation', url: 'https://nodejs.org/docs/latest/api/',
      snippet: 'Node.js® is a JavaScript runtime. The API reference documentation provides detailed information.' });
    // No title falls back to the address; a long excerpt is cut with an ellipsis.
    expect(result.results[1].title).toBe('https://example.com/untitled');
    expect(Array.from(result.results[1].snippet!)).toHaveLength(301);
    expect(exchanges.every(exchange => exchange.url === EXA_MCP_URL)).toBe(true);
  });

  it('sends the query and nothing else, and the key header only when a key is saved', async () => {
    const keyless = fakeExa();
    await new WebTools(keyless.network, { provider: 'exa', readKey: async () => null }).search({ query: 'grouped query attention' }, signal());
    // The standing event stream (GET) never goes out; the session is ended with DELETE.
    expect(keyless.exchanges.map(exchange => exchange.method)).toEqual(['POST', 'POST', 'POST', 'DELETE']);
    const call = keyless.exchanges.map(exchange => exchange.body ? JSON.parse(exchange.body) : null).find(message => message?.method === 'tools/call');
    expect(call.params).toEqual({ name: 'web_search_exa', arguments: { query: 'grouped query attention', objective: 'grouped query attention', numResults: 10 } });
    for (const exchange of keyless.exchanges) {
      expect(Object.keys(exchange.headers).map(name => name.toLowerCase())).not.toContain('x-api-key');
      expect(exchange.headers).not.toHaveProperty('cookie');
      expect(exchange.headers).not.toHaveProperty('authorization');
    }
    const keyed = fakeExa();
    await new WebTools(keyed.network, { provider: 'exa', readKey: async provider => provider === 'exa' ? 'exa-key-0123456789abcdef' : null }).search({ query: 'q' }, signal());
    const postsAndDelete = keyed.exchanges;
    expect(postsAndDelete.length).toBeGreaterThan(0);
    for (const exchange of postsAndDelete) expect(exchange.headers['x-api-key']).toBe('exa-key-0123456789abcdef');
  });

  it('says plainly when the free tier is rate-limited, and never falls back to another engine', async () => {
    const { network, exchanges } = fakeExa(() => rateLimited('12496'));
    const failure = new WebTools(network, { provider: 'exa' }).search({ query: 'q' }, signal());
    await expect(failure).rejects.toThrow('Tìm kiếm miễn phí của Exa đang bị giới hạn lượt, khoảng 3 giờ nữa mới có lượt mới. Thêm Exa API key trong Cài đặt → Tìm kiếm web, hoặc thử lại sau.');
    expect(exchanges.every(exchange => new URL(exchange.url).hostname === 'mcp.exa.ai')).toBe(true);
    expect(network.resolve.mock.calls.every(([hostname]) => hostname === 'mcp.exa.ai')).toBe(true);
    await expect(new WebTools(fakeExa(() => rateLimited('600')).network, { provider: 'exa' }).search({ query: 'q' }, signal()))
      .rejects.toThrow('khoảng 10 phút nữa');
    await expect(new WebTools(fakeExa(() => rateLimited()).network, { provider: 'exa' }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Tìm kiếm miễn phí của Exa đang bị giới hạn lượt. Thêm Exa API key');
    // The same limit reported inside a tool result instead of as HTTP 429.
    const inResult = fakeExa(() => ({ result: { isError: true, content: [{ type: 'text', text: 'Rate limit exceeded for this IP.' }] } }));
    await expect(new WebTools(inResult.network, { provider: 'exa' }).search({ query: 'q' }, signal())).rejects.toThrow('giới hạn lượt');
  });

  it('tells a rejected key and a limited key apart from the free tier', async () => {
    const readKey = async () => 'exa-key-0123456789abcdef';
    const rejected = fakeExa(() => ({ status: 401, raw: JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid API key' }, id: null }) }));
    await expect(new WebTools(rejected.network, { provider: 'exa', readKey }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Exa từ chối API key đã lưu. Kiểm tra key trong Cài đặt → Tìm kiếm web.');
    await expect(new WebTools(fakeExa(() => rateLimited('60')).network, { provider: 'exa', readKey }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Exa đang giới hạn lượt tìm kiếm của API key này. Thử lại sau.');
    await expect(new WebTools(fakeExa(() => ({ status: 500, raw: 'oops' })).network, { provider: 'exa' }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Exa trả lỗi HTTP 500. Thử lại sau.');
  });

  it('reports an unreachable Exa or a refused address as a connection failure, before any request is sent', async () => {
    const offline = fakeExa();
    offline.network.resolve.mockRejectedValue(new Error('getaddrinfo ENOTFOUND mcp.exa.ai'));
    await expect(new WebTools(offline.network, { provider: 'exa' }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Không kết nối được tới Exa (getaddrinfo ENOTFOUND mcp.exa.ai). Kiểm tra mạng rồi thử lại.');
    const privateAddress = fakeExa();
    privateAddress.network.resolve.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    await expect(new WebTools(privateAddress.network, { provider: 'exa' }).search({ query: 'q' }, signal())).rejects.toThrow('Không kết nối được tới Exa');
    expect(privateAddress.network.connect).not.toHaveBeenCalled();
  });

  it('refuses an answer at the byte limit and one it cannot read, and accepts an empty search', async () => {
    const huge = fakeExa(() => ({ raw: 'x'.repeat(MAX_WEB_BYTES) }));
    await expect(new WebTools(huge.network, { provider: 'exa' }).search({ query: 'q' }, signal())).rejects.toThrow('1 MiB');
    const unreadable = fakeExa(() => ({ result: { content: [{ type: 'text', text: 'Something went sideways.' }] } }));
    await expect(new WebTools(unreadable.network, { provider: 'exa' }).search({ query: 'q' }, signal()))
      .rejects.toThrow('Exa không trả danh sách kết quả đọc được.');
    const empty = fakeExa(() => ({ result: { content: [{ type: 'text', text: 'No search results found. Please try a different query.' }] } }));
    expect((await new WebTools(empty.network, { provider: 'exa' }).search({ query: 'q' }, signal())).results).toEqual([]);
    const json = fakeExa(() => ({ result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'JSON page', url: 'https://example.org/a', highlights: ['One.', 'Two.'] }] }) }] } }));
    expect((await new WebTools(json.network, { provider: 'exa' }).search({ query: 'q' }, signal())).results)
      .toEqual([{ title: 'JSON page', url: 'https://example.org/a', snippet: 'One. Two.' }]);
  });

  it('stops at once when cancelled, sends nothing more, and rethrows the cancellation itself', async () => {
    const controller = new AbortController();
    const { network, exchanges } = fakeExa(() => {
      controller.abort(new Error('cancelled by the person'));
      return { result: { content: [{ type: 'text', text: EXA_TEXT }] } };
    });
    await expect(exaSearch(network, null).search('q', controller.signal)).rejects.toThrow('cancelled by the person');
    expect(exchanges.map(exchange => exchange.method)).toEqual(['POST', 'POST', 'POST']);
    const before = new AbortController();
    before.abort(new Error('already cancelled'));
    const idle = fakeExa();
    await expect(exaSearch(idle.network, null).search('q', before.signal)).rejects.toThrow('already cancelled');
    expect(idle.network.connect).not.toHaveBeenCalled();
  });

  it('sends only POST and DELETE over HTTPS through the public-web boundary', async () => {
    const { network } = fakeExa();
    const fetch = publicWebFetch(network, signal());
    expect((await fetch('https://mcp.exa.ai/mcp', { method: 'GET' })).status).toBe(405);
    await expect(fetch('http://mcp.exa.ai/mcp', { method: 'POST', body: '{}' })).rejects.toThrow('HTTPS');
    await expect(fetch('https://127.0.0.1/mcp', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(network.connect).not.toHaveBeenCalled();
  });

  it('talks to a real MCP server through the production HTTP transport', async () => {
    const seen: { method: string; headers: IncomingHttpHeaders }[] = [];
    const calls: unknown[] = [];
    const server: Server = createServer(async (request, response) => {
      seen.push({ method: request.method ?? '', headers: request.headers });
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const mcp = new McpServer({ name: 'exa-fixture', version: '1' });
      mcp.registerTool('web_search_exa', { inputSchema: { query: z.string(), objective: z.string(), numResults: z.number().optional() } }, async argumentsValue => {
        calls.push(argumentsValue);
        return { content: [{ type: 'text', text: EXA_TEXT }] };
      });
      // Stateless: each request gets its own server, the way a hosted endpoint behind a load balancer may answer.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      // Production refuses loopback before connecting; this pins the checked connection onto the local fixture.
      const pinned: WebNetwork = {
        resolve: async () => [{ address: '104.18.26.84', family: 4 }],
        connect: connection => webNetwork.connect({ ...connection, url: new URL(`http://127.0.0.1:${port}${connection.url.pathname}`), address: { address: '127.0.0.1', family: 4 } }),
      };
      const found = await exaSearch(pinned, 'exa-key-0123456789abcdef').search('real transport', AbortSignal.timeout(10_000));
      expect(found.results[0].url).toBe('https://nodejs.org/docs/latest/api/');
      expect(calls).toEqual([{ query: 'real transport', objective: 'real transport', numResults: 10 }]);
      expect(seen.every(entry => entry.method === 'POST')).toBe(true);
      expect(seen.every(entry => entry.headers['x-api-key'] === 'exa-key-0123456789abcdef')).toBe(true);
      expect(seen.every(entry => entry.headers['user-agent'] === 'Orglet/0.2 WebTools' && entry.headers['accept-encoding'] === 'identity')).toBe(true);
      expect(seen.every(entry => entry.headers.cookie === undefined)).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

describe('web search in a run and in Settings (COD-266)', () => {
  function fixture() {
    const store = new Store(':memory:');
    const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
    const skill = store.all<Skill>('skills')[0];
    const task: Task = { id: id(), workerId: worker.id, brief: 'Private plan SECRET-PLAN-42: compare attention papers', sourceIds: [], consent: true,
      providerScopes: ['openai'], budgetMicros: 100_000, status: 'queued', accepted: false, createdAt: now(), toolCapabilities: ['network.web'] };
    const run: Run = { id: id(), taskId: task.id, status: 'queued', snapshot: { worker, skill, toolCapabilities: ['network.web'] }, startedAt: now(), error: null };
    store.put('tasks', task);
    store.put('runs', run, { column: 'task_id', value: task.id });
    return { store, task, run };
  }

  it('sends only the query from a chat that holds private text, and names Exa in the result', async () => {
    const { store, task, run } = fixture();
    try {
      const { network, exchanges } = fakeExa();
      vi.spyOn(webNetwork, 'resolve').mockImplementation(network.resolve);
      vi.spyOn(webNetwork, 'connect').mockImplementation(network.connect);
      let calls = 0;
      let toolOutput = '';
      const core = new CoreService(store, () => {}, async () => ({ request: async messages => {
        if (++calls === 1) return { calls: [{ id: 'search', name: 'web_search', arguments: '{"query":"grouped query attention"}' }], usage: { input: 1, output: 1 } };
        toolOutput = String(messages.find(message => message.role === 'tool')?.content ?? '');
        return { calls: [{ id: 'answer', name: 'reply', arguments: JSON.stringify({ message: 'Found the GQA paper.' }) }], usage: { input: 1, output: 1 } };
      } }), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { readKey: async () => null });
      await core.runner.run(task, run);
      expect(store.detail(task.id).task.status).toBe('completed');
      expect(JSON.parse(toolOutput).source.provider).toBe('Exa');
      const everything = JSON.stringify(exchanges);
      expect(everything).not.toContain('SECRET-PLAN-42');
      expect(everything).not.toContain('compare attention papers');
      const sent = exchanges.flatMap(exchange => exchange.body ? [JSON.parse(exchange.body)] : []);
      expect(sent.map(message => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
      expect(sent[2].params.arguments).toEqual({ query: 'grouped query attention', objective: 'grouped query attention', numResults: 10 });
      expect(sent[0].params.clientInfo).toEqual({ name: 'Orglet', version: '1' });
    } finally { store.close(); }
  });

  it('defaults new and existing workspaces to Exa, keeps the choice, and leaves it and any key out of backups', async () => {
    const store = new Store(':memory:');
    try {
      const core = new CoreService(store, () => {}, async () => { throw new Error('No model in this test.'); });
      expect(store.workspace().webSearchProvider).toBe('exa');
      // A value a later build wrote, or a hand edit, reads as the default instead of breaking the workspace.
      store.setSetting('webSearchProvider', 'bing');
      expect(store.workspace().webSearchProvider).toBe('exa');
      await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, webSearchProvider: 'duckduckgo' });
      expect(store.workspace().webSearchProvider).toBe('duckduckgo');
      await core.command('settings', { theme: 'dark', connectionLimitMicros: 5_000_000 });
      expect(store.workspace().webSearchProvider).toBe('duckduckgo');
      await expect(core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, webSearchProvider: 'google' })).rejects.toThrow();
      const backup = new Backups(store, () => false, () => {}).export();
      expect(backup).not.toContain('webSearchProvider');
      expect(backup).not.toContain('exa-key');
    } finally { store.close(); }
  });

  it('runs Settings → Test through the saved provider and returns the first result, or the plain error', async () => {
    const store = new Store(':memory:');
    try {
      const { network, exchanges } = fakeExa();
      vi.spyOn(webNetwork, 'resolve').mockImplementation(network.resolve);
      vi.spyOn(webNetwork, 'connect').mockImplementation(network.connect);
      const readKey = vi.fn(async () => 'exa-key-0123456789abcdef');
      const core = new CoreService(store, () => {}, undefined as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { readKey });
      expect(await core.command('testWebSearch', {})).toEqual({ provider: 'exa', title: 'Node.js — Documentation', url: 'https://nodejs.org/docs/latest/api/' });
      expect(readKey).toHaveBeenCalledWith('exa');
      expect(exchanges.some(exchange => exchange.headers['x-api-key'] === 'exa-key-0123456789abcdef')).toBe(true);
      network.connect.mockImplementation(async () => rateLimitedResponse());
      await expect(core.command('testWebSearch', {})).rejects.toThrow('Exa đang giới hạn lượt');
      await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, webSearchProvider: 'duckduckgo' });
      network.connect.mockImplementation(async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
        body: Buffer.from('<a class="result__a" href="https://en.wikipedia.org/">Wikipedia</a>') }));
      expect(await core.command('testWebSearch', {})).toEqual({ provider: 'duckduckgo', title: 'Wikipedia', url: 'https://en.wikipedia.org/' });
      expect(network.resolve).toHaveBeenLastCalledWith('html.duckduckgo.com');
    } finally { store.close(); }
  });
});

function rateLimitedResponse(): WebResponse {
  return { status: 429, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'rate limit' }, id: null })) };
}

describe('web search keys in main (COD-266)', () => {
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).toString('base64').split('').reverse().join('')),
    decryptString: (data: Buffer) => Buffer.from(data.toString().split('').reverse().join(''), 'base64').toString(),
  };

  it('encrypts the key beside the API keys, reads it back only in main, and forgets it on remove', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-search-keys-'));
    try {
      const keys = new WebSearchKeys(directory, encryption);
      expect(await keys.status()).toEqual({ exa: false });
      expect(await keys.read('exa')).toBeNull();
      await keys.save('exa', '0a1b2c3d-4e5f-6789-abcd-ef0123456789');
      expect(await readdir(directory)).toEqual(['search-exa.credential']);
      expect(await readFile(join(directory, 'search-exa.credential'), 'utf8')).not.toContain('0a1b2c3d');
      expect(await keys.read('exa')).toBe('0a1b2c3d-4e5f-6789-abcd-ef0123456789');
      expect(await keys.status()).toEqual({ exa: true });
      await expect(keys.save('exa', 'short')).rejects.toThrow('API key không hợp lệ.');
      await expect(keys.save('exa', 'has spaces in the middle of it')).rejects.toThrow('API key không hợp lệ.');
      await keys.remove('exa');
      await keys.remove('exa');
      expect(await keys.status()).toEqual({ exa: false });
      await expect(new WebSearchKeys(directory, { ...encryption, isEncryptionAvailable: () => false }).save('exa', '0a1b2c3d-4e5f-6789-abcd-ef0123456789'))
        .rejects.toThrow('OS credential storage không khả dụng.');
      await expect(new WebSearchKeys(directory, { ...encryption, getSelectedStorageBackend: () => 'basic_text' }, 'linux').save('exa', '0a1b2c3d-4e5f-6789-abcd-ef0123456789'))
        .rejects.toThrow('OS credential storage không khả dụng.');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('tells the window only whether a search key is saved', () => {
    expect(emptyConnections().search).toEqual({ exa: false });
  });
});
