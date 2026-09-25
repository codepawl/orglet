import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Store, now } from '../../apps/desktop/src/core/storage/database';
import { Checkpoints } from '../../apps/desktop/src/core/storage/checkpoints';
import { CoreService } from '../../apps/desktop/src/core/service';
import { FULL_WEB_PAGES_KEPT, trimOlderWebPages } from '../../apps/desktop/src/core/orchestration/runner';
import { WebTools } from '../../apps/desktop/src/core/tools/web-tools';
import type { HarnessRequest, HarnessResult } from '../../apps/desktop/src/core/harness/exec';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import type { Run, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/** Every CLI step of a tool-loop run resends this whole context (COD-183), so its bytes are the cost driver. */
const PAGE_CHARACTERS = 24_000;
const READS = 11;
/** The runner's request limit and the allowance it adds for framing, as COD-184 set them. */
const MAX_REQUEST_BYTES = 200_000;
const FRAMING_BYTES = 8192;

function pageFor(url: string) {
  const title = `Page ${url}`;
  return {
    source: { requestedUrl: url, url, redirects: [], fetchedAt: now(), title },
    trust: 'Untrusted web data. Fixture only.',
    content: `${title}. ${'Evidence paragraph. '.repeat(PAGE_CHARACTERS / 20)}`,
    truncated: false,
    coverage: 'Fixture page.',
  };
}

function pageMessage(url: string): ChatCompletionMessageParam {
  return { role: 'tool', tool_call_id: url, content: JSON.stringify(pageFor(url)) };
}

/** The JSON context the harness tool bridge appends to its fixed preamble. */
function contextOf(request: HarnessRequest) {
  const jsonStart = request.prompt.lastIndexOf('\n\n') + 2;
  return { preambleBytes: Buffer.byteLength(request.prompt.slice(0, jsonStart), 'utf8'), context: JSON.parse(request.prompt.slice(jsonStart)) as { tools: unknown; messages: ChatCompletionMessageParam[] } };
}

/** Waits until the runner is no longer working on any task. */
async function idle(store: Store, core: CoreService) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const busy = store.all<Task>('tasks').some(task => core.runner.isActive(task.id));
    if (!busy) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture never went idle');
}

describe('trimOlderWebPages', () => {
  it('keeps the latest pages whole and cuts the ones before them to an excerpt', () => {
    const messages = [pageMessage('https://a.example'), pageMessage('https://b.example'), pageMessage('https://c.example'), pageMessage('https://d.example')];
    expect(trimOlderWebPages(messages, 2)).toBe(true);
    const pages = messages.map(message => JSON.parse(message.content as string));
    expect(pages.slice(0, 2).every(page => page.trimmedForContext && page.truncated && Array.from(page.content).length === 1_500)).toBe(true);
    expect(pages.slice(0, 2).map(page => page.source.url)).toEqual(['https://a.example', 'https://b.example']);
    expect(pages.slice(2).every(page => page.trimmedForContext === undefined && Array.from(page.content).length > PAGE_CHARACTERS)).toBe(true);
    // Trimming is idempotent, so a step that changed nothing does not report a trim.
    expect(trimOlderWebPages(messages, 2)).toBe(false);
    // The last resort before the context limit cuts everything but the latest page.
    expect(trimOlderWebPages(messages, 1)).toBe(true);
    expect(JSON.parse(messages[2].content as string).trimmedForContext).toBeDefined();
    expect(JSON.parse(messages[3].content as string).trimmedForContext).toBeUndefined();
  });

  it('leaves non-page tool results alone', () => {
    const search = { role: 'tool', tool_call_id: 'search', content: JSON.stringify({ query: 'q', results: [], trust: 'Untrusted web data.', source: { provider: 'DuckDuckGo HTML', url: 'https://duckduckgo.com' } }) } as ChatCompletionMessageParam;
    const source = { role: 'tool', tool_call_id: 'source', content: JSON.stringify({ sourceId: 'source-1', content: 'x'.repeat(5_000) }) } as ChatCompletionMessageParam;
    const messages = [search, source, pageMessage('https://a.example'), pageMessage('https://b.example')];
    trimOlderWebPages(messages, 1);
    expect(messages[0]).toBe(search);
    expect(messages[1]).toBe(source);
  });
});

describe('web research on the Claude Code tool bridge', () => {
  let store: Store;
  let core: CoreService;
  let requests: HarnessRequest[];
  let respond: (request: HarnessRequest, step: number) => HarnessResult;
  beforeEach(() => {
    store = new Store(':memory:');
    requests = [];
    vi.spyOn(WebTools.prototype, 'read').mockImplementation(async raw => pageFor((raw as { url: string }).url));
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [
        { ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', version: '2.1.280', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua claude.ai' },
        { ...missingHarness('codex', 'win32'), executable: 'codex.exe', version: '0.155.0', auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập qua ChatGPT' },
      ],
      execute: async request => {
        requests.push(request);
        return respond(request, requests.length);
      },
    });
  });
  afterEach(() => { vi.restoreAllMocks(); store.close(); });

  async function research(provider: 'claude-code' | 'codex' = 'claude-code') {
    // A limit of the orglet's own, so Claude Code gets the remaining amount as its cap (COD-253).
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider, taskBudgetMicros: 4_000_000 }) as Worker;
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Survey the literature', sourceIds: [], consent: true, providerScopes: [provider], budgetMicros: 4_000_000, toolCapabilities: ['network.web'] }) as string;
    await idle(store, core);
    return taskId;
  }

  it('sends far fewer bytes over a twelve-step run because pages answered on earlier go out as excerpts', async () => {
    const requestBytes: number[] = [];
    const previousBytes: number[] = [];
    // What each step sent before this change: the same conversation, shortened only when it would pass the request
    // limit (COD-184). The runner appends one call record and one tool result per step, and the newest page always
    // arrives whole, so replaying that rule on the tail of every request reproduces the earlier policy exactly.
    const previousMessages: ChatCompletionMessageParam[] = [];
    const measure = (messages: unknown, tools: unknown) => Buffer.byteLength(JSON.stringify({ messages, tools }), 'utf8') + FRAMING_BYTES;
    respond = (request, step) => {
      const { preambleBytes, context } = contextOf(request);
      requestBytes.push(Buffer.byteLength(request.prompt, 'utf8'));
      previousMessages.push(...context.messages.slice(previousMessages.length));
      let previous = measure(previousMessages, context.tools);
      if (previous > MAX_REQUEST_BYTES && trimOlderWebPages(previousMessages, 1)) previous = measure(previousMessages, context.tools);
      expect(previous).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
      previousBytes.push(preambleBytes + previous - FRAMING_BYTES);
      if (step <= READS) return { output: { call: { name: 'web_read_url', arguments: { url: `https://example.com/${step}` } } }, costUsd: 0.01 };
      return { output: { call: { name: 'reply', arguments: { message: 'Eleven pages read.' } } }, costUsd: 0.01 };
    };
    const taskId = await research();
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(requests).toHaveLength(READS + 1);

    const pageBytes = Buffer.byteLength(JSON.stringify(pageMessage('https://example.com/1')), 'utf8');
    const excerptMessages = [pageMessage('https://example.com/1'), pageMessage('https://example.com/2')];
    trimOlderWebPages(excerptMessages, 1);
    const excerptBytes = Buffer.byteLength(JSON.stringify(excerptMessages[0]), 'utf8');
    // Before: the request kept growing by a whole page per step until the limit forced a cut.
    expect(Math.max(...previousBytes) - previousBytes[0]).toBeGreaterThan(6 * pageBytes);
    // After: it grows by the latest pages plus an excerpt and a call record per earlier page, and stays there.
    expect(Math.max(...requestBytes) - requestBytes[0]).toBeLessThan(FULL_WEB_PAGES_KEPT * pageBytes + READS * (excerptBytes + 512));
    const before = previousBytes.reduce((sum, bytes) => sum + bytes, 0);
    const after = requestBytes.reduce((sum, bytes) => sum + bytes, 0);
    expect(Math.max(...requestBytes)).toBeLessThan(Math.max(...previousBytes) * 0.5);
    expect(after).toBeLessThan(before * 0.75);
    // Claude Code's working directory is part of the fixed prompt it sends, so every step of a run uses the same one.
    expect(new Set(requests.map(request => request.cwd)).size).toBe(1);

    // The last request still carries the latest pages whole and every earlier page's address, title and start.
    const { context } = contextOf(requests.at(-1)!);
    const pages = context.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content as string));
    expect(pages).toHaveLength(READS);
    expect(pages.slice(-FULL_WEB_PAGES_KEPT).every(page => page.trimmedForContext === undefined)).toBe(true);
    expect(pages.slice(0, -FULL_WEB_PAGES_KEPT).every(page => page.trimmedForContext && page.source.url && page.source.title && page.content.startsWith('Page https://example.com/'))).toBe(true);
    const events = store.detail(taskId).events.map(event => event.message);
    expect(events.filter(message => message === 'Đã rút gọn các trang web đọc trước đó; các bước sau chỉ gửi lại phần đầu của chúng.')).toHaveLength(READS - FULL_WEB_PAGES_KEPT);
  });

  it('still gives Codex a fresh call directory per step, because it writes its schema and answer files there', async () => {
    respond = (_request, step) => {
      if (step === 1) return { output: { call: { name: 'web_read_url', arguments: JSON.stringify({ url: 'https://example.com/1' }) } }, costUsd: null };
      return { output: { call: { name: 'reply', arguments: JSON.stringify({ message: 'Done.' }) } }, costUsd: null };
    };
    const taskId = await research('codex');
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(requests[0].cwd).not.toBe(requests[1].cwd);
    expect(store.detail(taskId).events.map(event => event.message).filter(message => message === 'Codex đã trả lời; không báo chi phí.')).toHaveLength(2);
  });

  it('keeps a running total of the CLI estimates in activity and says when a call reported none', async () => {
    const costs: (number | null)[] = [0.2, null, 0.3];
    let checkpointBeforeLastStep: ReturnType<Checkpoints['get']>;
    respond = (_request, step) => {
      const costUsd = costs[step - 1];
      if (step === 3) checkpointBeforeLastStep = new Checkpoints(store).get(store.all<Run>('runs')[0].id);
      if (step <= 2) return { output: { call: { name: 'web_read_url', arguments: { url: `https://example.com/${step}` } } }, costUsd };
      return { output: { call: { name: 'reply', arguments: { message: 'Done.' } } }, costUsd };
    };
    const taskId = await research();
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    const events = detail.events.map(event => event.message);
    expect(events).toContain('Claude Code đã trả lời; harness ước tính $0.2000 cho bước này, tổng $0.2000 trong lượt chạy này theo gói hoặc tài khoản của nó. Khoản này tính vào giới hạn mỗi task của chat này, không trừ vào ngân sách tháng.');
    expect(events).toContain('Claude Code đã trả lời; không báo chi phí.');
    expect(events).toContain('Claude Code đã trả lời; harness ước tính $0.3000 cho bước này, tổng ít nhất $0.5000 trong lượt chạy này, 1 lần gọi không báo chi phí theo gói hoặc tài khoản của nó. Khoản này tính vào giới hạn mỗi task của chat này, không trừ vào ngân sách tháng.');
    // The second call's allowance is the task limit minus the running total, still in integer micros.
    expect(requests[0].maxBudgetUsd).toBe(4);
    expect(requests[1].maxBudgetUsd).toBe(3.8);
    expect(requests[2].maxBudgetUsd).toBe(3.8);
    // The count survives with the checkpoint, so a resumed run carries the same floor.
    expect(checkpointBeforeLastStep?.harnessCostMicros).toBe(200_000);
    expect(checkpointBeforeLastStep?.harnessCallsWithoutCost).toBe(1);
  });

  it('keeps the notes a step wrote after the page they came from is cut, and says to use them (COD-264)', async () => {
    const lastContext: { messages: ChatCompletionMessageParam[] }[] = [];
    respond = (request, step) => {
      lastContext.push(contextOf(request).context);
      if (step <= 4) return { output: { call: { name: 'web_read_url', arguments: { url: `https://example.com/${step}` } }, notes: step === 2 ? 'Page 1: Pro plan costs $14 a month; free plan allows five clients.' : '' }, costUsd: 0.01 };
      return { output: { call: { name: 'reply', arguments: { message: 'Compared.' } } }, costUsd: 0.01 };
    };
    const taskId = await research();
    expect(store.detail(taskId).task.status).toBe('completed');
    const final = lastContext.at(-1)!.messages;
    // The note stays with the call it was written beside, as the assistant's own words.
    expect(final.some(message => message.role === 'assistant' && message.content === 'Page 1: Pro plan costs $14 a month; free plan allows five clients.')).toBe(true);
    // Empty notes add nothing.
    expect(final.filter(message => message.role === 'assistant' && message.content !== undefined)).toHaveLength(1);
    // The first page has been cut by now, and its note points at the notes instead of reading it again.
    const firstPage = final.find(message => message.role === 'tool' && String(message.content).includes('https://example.com/1'));
    expect(JSON.parse(String(firstPage!.content)).trimmedForContext).toContain('Use what your notes kept from it');
  });
});
