import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { OpenAIAdapter } from '../../apps/desktop/src/core/adapters/openai';

it('uses the official SDK to assemble streamed tool arguments and usage over HTTP', async () => {
  let received: Record<string, unknown> = {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4.1-mini-2025-04-14' };
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_source', arguments: '{"source' } }] } }] });
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":"fixture"}' } }] }, finish_reason: 'tool_calls' }] });
    send({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const model = new OpenAIAdapter('fixture-not-a-real-key', `http://127.0.0.1:${address.port}/v1`);
    let progress = 0;
    const reply = await model.request([{ role: 'user', content: 'Test' }], [], new AbortController().signal, () => progress++);
    expect(reply.calls).toEqual([{ id: 'call_1', name: 'read_source', arguments: '{"sourceId":"fixture"}' }]);
    expect(reply.usage).toEqual({ input: 100, output: 20 }); expect(progress).toBe(1);
    expect(received).toMatchObject({ model: 'gpt-4.1-mini-2025-04-14', stream: true, max_completion_tokens: 4096, parallel_tool_calls: false });
  } finally { server.closeAllConnections(); server.close(); }
});
