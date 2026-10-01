import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { AnthropicAdapter, acceptsForcedToolChoice } from '../../apps/desktop/src/core/adapters/anthropic';
import { ANTHROPIC_MAX_OUTPUT_TOKENS } from '../../apps/desktop/src/core/adapters/catalog';
import type { ModelReply, RunMessage } from '../../apps/desktop/src/core/adapters/openai';
import { BudgetLedger, affordableOutputTokens, cost, holdFor } from '../../apps/desktop/src/core/budgets/ledger';
import { resolveWorkerModel } from '../../apps/desktop/src/core/models/resolve';
import { MISSING_CALL_INSTRUCTION, MODEL_STOP_MESSAGES } from '../../apps/desktop/src/core/orchestration/runner';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CATALOG_HINT_IDS } from '../../apps/desktop/src/shared/models';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

type StreamedBlock =
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'text'; text: string };
type Scripted = {
  blocks: StreamedBlock[];
  stopReason: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

/** A local stand-in for the Messages API: records each request body and streams the next scripted reply. */
async function fakeAnthropic(script: Scripted[]) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    const reply = script.shift()!;
    const usage = reply.usage ?? { input_tokens: 10, output_tokens: 5 };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (data: { type: string; [key: string]: unknown }) => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_read_input_tokens: usage.cache_read_input_tokens ?? null, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null } } });
    reply.blocks.forEach((block, index) => {
      if (block.type === 'tool_use') {
        send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
        send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      } else if (block.type === 'thinking') {
        send({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        send({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
        send({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
      } else {
        send({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        send({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
      }
      send({ type: 'content_block_stop', index });
    });
    send({ type: 'message_delta', delta: { stop_reason: reply.stopReason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
    send({ type: 'message_stop' });
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  return {
    bodies,
    adapter: (model?: string) => new AnthropicAdapter('fixture-not-real', `http://127.0.0.1:${address.port}`, model),
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

const replyTool: ChatCompletionTool = { type: 'function', function: { name: 'reply', parameters: { type: 'object', properties: { message: { type: 'string' } } } } };
const readTool: ChatCompletionTool = { type: 'function', function: { name: 'read_source', parameters: { type: 'object', properties: { sourceId: { type: 'string' } } } } };
const callReply = (text = 'Done.'): Scripted => ({ blocks: [{ type: 'tool_use', id: id(), name: 'reply', input: { message: text } }], stopReason: 'tool_use' });
const signal = () => new AbortController().signal;
const countBreakpoints = (body: unknown) => JSON.stringify(body).split('"cache_control"').length - 1;
type SentMessage = { role: string; content: string | { type: string; [key: string]: unknown }[] };
const lastBlock = (message: SentMessage) => typeof message.content === 'string' ? undefined : message.content.at(-1);

describe('Anthropic prompt caching (COD-358)', () => {
  it('marks the system prompt, the end of earlier turns and the last message, the same way on every request', async () => {
    const fake = await fakeAnthropic([callReply(), callReply()]);
    try {
      const messages: RunMessage[] = [
        { role: 'system', content: 'Trusted instructions' },
        { role: 'user', content: '{"earlierTurn":{"id":"1","from":"user","text":"Hi"}}' },
        { role: 'user', content: '{"earlierTurn":{"id":"2","from":"you","text":"Hello"}}', cacheBreak: true },
        { role: 'user', content: '{"brief":"What did I say?"}' },
      ];
      await fake.adapter().request(messages, [readTool, replyTool], signal(), () => {});
      await fake.adapter().request(messages, [readTool, replyTool], signal(), () => {});
      const [first, second] = fake.bodies;
      expect(second).toEqual(first);
      expect(first.system).toEqual([{ type: 'text', text: 'Trusted instructions', cache_control: { type: 'ephemeral' } }]);
      const sent = first.messages as SentMessage[];
      expect(lastBlock(sent[1])).toEqual({ type: 'text', text: '{"earlierTurn":{"id":"2","from":"you","text":"Hello"}}', cache_control: { type: 'ephemeral' } });
      expect(lastBlock(sent[2])).toMatchObject({ cache_control: { type: 'ephemeral' } });
      expect(sent[0].content).toBe('{"earlierTurn":{"id":"1","from":"user","text":"Hi"}}');
      expect(countBreakpoints(first)).toBe(3);
      expect((first.tools as { name: string }[]).map(tool => tool.name)).toEqual(['read_source', 'reply']);
    } finally { fake.close(); }
  });

  it('splits cache reads and writes out of the input and prices them at the cache rates', async () => {
    const fake = await fakeAnthropic([{ ...callReply(), usage: { input_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, output_tokens: 20 } }]);
    try {
      const reply = await fake.adapter().request([{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }], [replyTool], signal(), () => {});
      expect(reply.usage).toEqual({ input: 950, output: 20, cacheRead: 800, cacheWrite: 100 });
    } finally { fake.close(); }
    // Claude Sonnet 5.5: 50 uncached at $2, 100 written at $2.50, 800 read at $0.20, 20 out at $10 per million tokens.
    expect(cost(950, 20, 'anthropic', { read: 800, write: 100 })).toBe(100 + 250 + 160 + 200);
    expect(cost(950, 20, 'anthropic')).toBe(1900 + 200);
    // A price without cache rates bills cached tokens as plain input.
    expect(cost(950, 20, 'openai', { read: 800, write: 100 })).toBe(cost(950, 20, 'openai'));
    expect(() => cost(10, 0, 'anthropic', { read: 8, write: 3 })).toThrow('Usage');
  });

  it('never holds less than a request can cost, whatever share of it is cached', () => {
    const sonnet = resolveWorkerModel({ provider: 'anthropic' }).rates!;
    const haiku = resolveWorkerModel({ provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' }).rates!;
    for (const rates of [sonnet, haiku]) {
      for (const input of [1, 999, 40_000]) {
        const hold = holdFor(input, ANTHROPIC_MAX_OUTPUT_TOKENS, rates);
        for (const written of [0, Math.floor(input / 2), input]) {
          for (const read of [0, input - written]) {
            expect(cost(input, ANTHROPIC_MAX_OUTPUT_TOKENS, rates, { read, write: written })).toBeLessThanOrEqual(hold);
          }
        }
      }
    }
    expect(holdFor(1000, 0, sonnet)).toBe(cost(1000, 0, sonnet, { read: 0, write: 1000 }));
  });

  it('asks for a shorter answer when the budget left cannot hold the full output cap, never holding more than is left', () => {
    const sonnet = resolveWorkerModel({ provider: 'anthropic' }).rates!;
    expect(affordableOutputTokens(20_000, 4096, 16_000, sonnet, 1_000_000)).toBe(16_000);
    const cap = affordableOutputTokens(20_000, 4096, 16_000, sonnet, 100_000);
    expect(cap).toBeGreaterThan(4096);
    expect(cap).toBeLessThan(16_000);
    expect(holdFor(20_000, cap, sonnet)).toBeLessThanOrEqual(100_000);
    expect(holdFor(20_000, cap + 1, sonnet)).toBeGreaterThan(100_000);
    // Not even the floor fits: the full cap goes to the reservation, which refuses it.
    expect(affordableOutputTokens(20_000, 4096, 16_000, sonnet, 1000)).toBe(16_000);
  });

  it('turns max_tokens, a full context and a refusal into stopped replies that run nothing', async () => {
    const fake = await fakeAnthropic([
      { blocks: [{ type: 'tool_use', id: 'cut', name: 'reply', input: { message: 'half' } }], stopReason: 'max_tokens' },
      { blocks: [], stopReason: 'refusal' },
      { blocks: [{ type: 'text', text: 'Partial' }], stopReason: 'model_context_window_exceeded' },
    ]);
    try {
      const messages: RunMessage[] = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }];
      const cut = await fake.adapter().request(messages, [replyTool], signal(), () => {});
      const refused = await fake.adapter().request(messages, [replyTool], signal(), () => {});
      const full = await fake.adapter().request(messages, [replyTool], signal(), () => {});
      expect(cut).toMatchObject({ calls: [], stopped: 'output_limit' });
      expect(cut.usage).toBeDefined();
      expect(refused).toMatchObject({ calls: [], stopped: 'refusal' });
      expect(full).toMatchObject({ calls: [], stopped: 'context_limit', notes: 'Partial' });
    } finally { fake.close(); }
  });

  it('sends a forced tool_choice only to models that accept one', async () => {
    expect(acceptsForcedToolChoice('claude-sonnet-5-5')).toBe(false);
    expect(acceptsForcedToolChoice('claude-opus-5-5')).toBe(false);
    expect(acceptsForcedToolChoice('claude-fable-5-1')).toBe(false);
    expect(acceptsForcedToolChoice('claude-haiku-4-5-20251001')).toBe(true);
    const fake = await fakeAnthropic([callReply()]);
    try {
      await fake.adapter('claude-haiku-4-5-20251001').request([{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }], [replyTool], signal(), () => {});
      expect(fake.bodies[0].tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true });
    } finally { fake.close(); }
  });

  it('sends thinking back unchanged while the prefix is the same, and as plain notes from the first edited message on', async () => {
    const fake = await fakeAnthropic([
      { blocks: [{ type: 'thinking', thinking: 'Read it first.', signature: 'sig-1' }, { type: 'tool_use', id: 'call_1', name: 'read_source', input: { sourceId: 'a' } }], stopReason: 'tool_use' },
      callReply(), callReply(), callReply(),
    ]);
    try {
      const start: RunMessage[] = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Read a' }];
      const first = await fake.adapter().request(start, [readTool, replyTool], signal(), () => {});
      expect(first.anthropicTurn?.blocks).toEqual([{ type: 'thinking', thinking: 'Read it first.', signature: 'sig-1' }]);
      const step = (toolContent: string): RunMessage[] => [...start,
        { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_source', arguments: '{"sourceId":"a"}' } }], anthropicTurn: first.anthropicTurn },
        { role: 'tool', tool_call_id: 'call_1', content: toolContent },
      ];
      await fake.adapter().request(step('Page text'), [readTool, replyTool], signal(), () => {});
      // An earlier message shortened, as the runner does with old pages: the block would be refused, so it is not sent.
      await fake.adapter().request([{ role: 'system', content: 'S' }, { role: 'user', content: 'Read a (shortened)' }, ...step('Page text').slice(2)], [readTool, replyTool], signal(), () => {});
      // The tool list changed, as for a wrap-up.
      await fake.adapter().request(step('Page text'), [replyTool], signal(), () => {});
      const assistantOf = (index: number) => (fake.bodies[index].messages as SentMessage[])[1];
      expect(assistantOf(1).content).toEqual([
        { type: 'thinking', thinking: 'Read it first.', signature: 'sig-1' },
        { type: 'tool_use', id: 'call_1', name: 'read_source', input: { sourceId: 'a' } },
      ]);
      expect(assistantOf(2).content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'read_source', input: { sourceId: 'a' } }]);
      expect(assistantOf(3).content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'read_source', input: { sourceId: 'a' } }]);
    } finally { fake.close(); }
  });

  it('defaults to Claude Sonnet 5.5 and keeps an orglet that saved the old default on its own model and price', () => {
    expect(CATALOG_HINT_IDS.anthropic).toBe('claude-sonnet-5-5');
    expect(resolveWorkerModel({ provider: 'anthropic' })).toMatchObject({ id: 'claude-sonnet-5-5',
      rates: { inputTenths: 20, outputTenths: 100, cacheWriteHundredths: 250, cacheReadHundredths: 20 } });
    const saved = resolveWorkerModel({ provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' });
    expect(saved).toMatchObject({ id: 'claude-haiku-4-5-20251001', rates: { inputTenths: 10, outputTenths: 50, cacheWriteHundredths: 125, cacheReadHundredths: 10 } });
    expect(cost(1000, 100, saved.rates!)).toBe(1000 + 500);
    expect(resolveWorkerModel({ provider: 'anthropic', modelId: 'claude-opus-5-5' })).toEqual({ id: 'claude-opus-5-5', pricingVersion: 'unknown:claude-opus-5-5' });
  });
});

describe('Anthropic runs in the runner (COD-358)', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let replies: ModelReply[];
  let sent: RunMessage[][];
  let outputCaps: (number | undefined)[];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-anthropic-cache-'));
    store = new Store(join(directory, 'test.sqlite'));
    replies = [];
    sent = [];
    outputCaps = [];
    core = new CoreService(store, () => {}, async () => ({ async request(messages, _tools, _signal, _progress, _correlationId, maxOutputTokens) {
      sent.push(structuredClone(messages));
      outputCaps.push(maxOutputTokens);
      const reply = replies.shift();
      if (!reply) throw new Error('Fixture exhausted');
      return reply;
    } }));
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

  const scope = { sourceIds: [], consent: true, providerScopes: ['anthropic' as const], budgetMicros: 1_000_000 };
  const answer = (message: string, usage: ModelReply['usage'] = { input: 1000, output: 50, cacheRead: 800, cacheWrite: 100 }): ModelReply =>
    ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage });
  const until = async (check: () => boolean) => {
    for (let tries = 0; tries < 400 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(check()).toBe(true);
  };
  async function anthropicWorker() {
    const worker = store.all<Worker>('workers')[0];
    return await core.command('saveWorker', { ...worker, provider: 'anthropic' }) as Worker;
  }
  async function firstTurn(brief: string) {
    const worker = await anthropicWorker();
    const taskId = await core.command('createTask', { workerId: worker.id, brief, ...scope }) as string;
    await until(() => store.detail(taskId).task.status !== 'running' && !core.runner.isActive(taskId));
    return { worker, taskId };
  }
  async function nextTurn(taskId: string, brief: string, turns: number) {
    await core.command('reviseTask', { taskId, brief, ...scope });
    await until(() => store.detail(taskId).runs.length === turns && store.detail(taskId).task.status !== 'running' && !core.runner.isActive(taskId));
  }

  it('settles the cached share at the cache prices and shows it in the chat usage', async () => {
    replies.push(answer('Hi.'));
    const { taskId } = await firstTurn('Hello');
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.usage).toMatchObject({ inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 100, reservedMicros: 0, uncertainCount: 0 });
    expect(detail.usage.chargedMicros).toBe(cost(1000, 50, 'anthropic', { read: 800, write: 100 }));
    expect(store.db.prepare('SELECT cache_read_tokens AS readTokens, cache_write_tokens AS writeTokens FROM ledger_cache').all()).toEqual([{ readTokens: 800, writeTokens: 100 }]);
  });

  it('runs a chat whose budget cannot hold the full output cap with a smaller cap instead of waiting', async () => {
    const worker = await anthropicWorker();
    replies.push(answer('Hi.'));
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Hello', ...scope, budgetMicros: 200_000 }) as string;
    await until(() => store.detail(taskId).task.status !== 'running' && !core.runner.isActive(taskId));
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(outputCaps[0]).toBeGreaterThanOrEqual(4096);
    expect(outputCaps[0]).toBeLessThan(ANTHROPIC_MAX_OUTPUT_TOKENS);
  });

  it('asks for the full output cap when the budget holds it', async () => {
    replies.push(answer('Hi.'));
    await firstTurn('Hello');
    expect(outputCaps).toEqual([ANTHROPIC_MAX_OUTPUT_TOKENS]);
  });

  it('holds a cached request at the write price and never charges more than it held', async () => {
    const ledger = new BudgetLedger(store);
    const rates = resolveWorkerModel({ provider: 'anthropic' }).rates!;
    replies.push(answer('Hi.'));
    const { taskId } = await firstTurn('Hello');
    const run = store.detail(taskId).runs[0];
    const hold = holdFor(5000, ANTHROPIC_MAX_OUTPUT_TOKENS, rates);
    const reservation = ledger.reserve(run.id, taskId, 'anthropic', hold, 1_000_000, 5_000_000);
    ledger.settle(reservation, 5000, ANTHROPIC_MAX_OUTPUT_TOKENS, rates, { read: 0, write: 5000 });
    const settled = Number(store.db.prepare('SELECT amount FROM ledger WHERE reservation_id=?').get(reservation)!.amount);
    expect(settled).toBe(hold);
    expect(() => ledger.reserve(run.id, taskId, 'anthropic', 1_000_000, 1_000_000, 5_000_000)).toThrow('Ngân sách');
  });

  it('stops a refused or cut-off reply with its reason after settling what it cost', async () => {
    replies.push({ calls: [], usage: { input: 500, output: 10, cacheRead: 0, cacheWrite: 400 }, stopped: 'refusal' });
    const { taskId } = await firstTurn('Hello');
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('failed');
    expect(detail.runs[0].error).toBe(MODEL_STOP_MESSAGES.refusal);
    expect(detail.usage).toMatchObject({ uncertainCount: 0, reservedMicros: 0, chargedMicros: cost(500, 10, 'anthropic', { read: 0, write: 400 }) });
    expect(detail.artifacts).toEqual([]);
  });

  it('asks a model that skipped the tool once to send its answer through it, then gives up', async () => {
    replies.push({ calls: [], notes: 'Hi there!', usage: { input: 100, output: 5 } }, answer('Hi there!'));
    const { taskId } = await firstTurn('Hello');
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(sent).toHaveLength(2);
    expect(sent[1].at(-2)).toMatchObject({ role: 'assistant', content: 'Hi there!' });
    expect(sent[1].at(-1)).toEqual({ role: 'user', content: JSON.stringify({ instruction: MISSING_CALL_INSTRUCTION }) });

    replies.push({ calls: [], notes: 'Again', usage: { input: 100, output: 5 } }, { calls: [], notes: 'And again', usage: { input: 100, output: 5 } });
    await nextTurn(taskId, 'Hello again', 2);
    expect(store.detail(taskId).runs.at(-1)!.error).toBe('Model không trả về đúng một tool call hợp lệ.');
  });

  it('starts two turns of the same chat with the same messages, up to what changes per message', async () => {
    replies.push(answer('First answer.'));
    const { worker, taskId } = await firstTurn('Plan the garden beds');
    // A note that loads for the next messages only: their words match it, the first message's did not.
    await core.command('saveKnowledge', { title: 'Tomato spacing', content: 'Tomatoes need sixty centimetres.', tags: ['tomatoes'], pinned: false, scope: { type: 'worker', id: worker.id } }) as Knowledge;
    replies.push(answer('Second answer.'));
    await nextTurn(taskId, 'Where do the tomatoes go?', 2);
    replies.push(answer('Third answer.'));
    await nextTurn(taskId, 'And how far apart are the tomatoes?', 3);
    const [, second, third] = sent;
    const breakAt = second.findIndex(message => message.cacheBreak);
    expect(breakAt).toBeGreaterThan(0);
    const withoutMarker = (messages: RunMessage[]) => messages.map(({ cacheBreak: _cacheBreak, ...message }) => message);
    expect(withoutMarker(third.slice(0, breakAt + 1))).toEqual(withoutMarker(second.slice(0, breakAt + 1)));
    // The note loaded on both turns, after the history: it is ranked against each message.
    const noteAt = (messages: RunMessage[]) => messages.findIndex(message => String(message.content).includes('approvedKnowledge'));
    expect(noteAt(second)).toBeGreaterThan(breakAt);
    expect(noteAt(third)).toBeGreaterThan(third.findIndex(message => message.cacheBreak));
    expect(third.findIndex(message => message.cacheBreak)).toBe(breakAt + 2);
  });
});
