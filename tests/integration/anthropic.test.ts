import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { AnthropicAdapter } from '../../apps/desktop/src/core/adapters/anthropic';
import { cost } from '../../apps/desktop/src/core/budgets/ledger';

it('translates tool history and assembles Anthropic streamed tools and usage', async () => {
  let received: Record<string, unknown> = {};
  let correlation: string | string[] | undefined;
  const server = createServer(async (request, response) => {
    correlation = request.headers['x-client-request-id'];
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (data: { type: string; [key: string]: unknown }) => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    send({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
    send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_2', name: 'submit_report', input: {} } });
    send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"title":' } });
    send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Report"}' } });
    send({ type: 'content_block_stop', index: 0 });
    send({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } });
    send({ type: 'message_stop' }); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const adapter = new AnthropicAdapter('fixture-not-real', `http://127.0.0.1:${address.port}`);
    let progress = 0;
    const result = await adapter.request([
      { role: 'system', content: 'Trusted instructions' }, { role: 'user', content: 'Review' },
      { role: 'assistant', tool_calls: [{ type: 'function', id: 'call_1', function: { name: 'read_source', arguments: '{"sourceId":"fixture"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'Evidence' },
    ], [{ type: 'function', function: { name: 'submit_report', parameters: { type: 'object', properties: {} } } }], new AbortController().signal, () => progress++, 'reservation-fixture');
    expect(result).toEqual({ calls: [{ id: 'call_2', name: 'submit_report', arguments: '{"title":"Report"}' }], usage: { input: 100, output: 20 } });
    expect(progress).toBe(1); expect(correlation).toBe('reservation-fixture');
    expect(received).toMatchObject({ model: 'claude-haiku-4-5-20251001', stream: true, system: 'Trusted instructions', max_tokens: 4096, tool_choice: { type: 'any', disable_parallel_tool_use: true }, messages: [
      { role: 'user', content: 'Review' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'read_source', input: { sourceId: 'fixture' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Evidence' }] },
    ] });
    expect(cost(100, 20, 'anthropic')).toBe(200);
    expect(cost(100, 20, 'openai')).toBe(72);
  } finally { server.closeAllConnections(); server.close(); }
});
