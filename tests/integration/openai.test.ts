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
    const model = new OpenAIAdapter('fixture-not-a-real-key', { baseURL: `http://127.0.0.1:${address.port}/v1` });
    let progress = 0;
    const reply = await model.request([{ role: 'user', content: 'Test' }], [], new AbortController().signal, () => progress++);
    expect(reply.calls).toEqual([{ id: 'call_1', name: 'read_source', arguments: '{"sourceId":"fixture"}' }]);
    expect(reply.usage).toEqual({ input: 100, output: 20 }); expect(progress).toBe(1);
    expect(received).toMatchObject({ model: 'gpt-4.1-mini-2025-04-14', stream: true, max_completion_tokens: 4096, parallel_tool_calls: false });
  } finally { server.closeAllConnections(); server.close(); }
});

it('sends an image a tool returned as an image part in the next user message, never the image slot itself (COD-260)', async () => {
  let received: { messages: Record<string, unknown>[] } = { messages: [] };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4.1-mini-2025-04-14' };
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'reply', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const model = new OpenAIAdapter('fixture-not-a-real-key', { baseURL: `http://127.0.0.1:${address.port}/v1` });
    const image = { hash: 'a'.repeat(64), mime: 'image/png' as const, data: 'iVBORw0KGgo=' };
    await model.request([
      { role: 'user', content: 'What is in the screenshot?' },
      { role: 'assistant', tool_calls: [{ type: 'function', id: 'call_1', function: { name: 'read_source', arguments: '{"sourceId":"shot"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"sourceId":"shot"}', images: [image] },
    ], [], new AbortController().signal, () => {});
    expect(received.messages).toEqual([
      { role: 'user', content: 'What is in the screenshot?' },
      { role: 'assistant', tool_calls: [{ type: 'function', id: 'call_1', function: { name: 'read_source', arguments: '{"sourceId":"shot"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"sourceId":"shot"}' },
      { role: 'user', content: [
        { type: 'text', text: 'The image returned by the tool call above:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ] },
    ]);
  } finally { server.closeAllConnections(); server.close(); }
});

it('refuses to send an image whose bytes were not attached', async () => {
  const model = new OpenAIAdapter('fixture-not-a-real-key', { baseURL: 'http://127.0.0.1:9/v1' });
  await expect(model.request([{ role: 'user', content: 'Look', images: [{ hash: 'a'.repeat(64), mime: 'image/png' }] }], [], new AbortController().signal, () => {}))
    .rejects.toThrow('Image bytes were not attached');
});

it('points the same adapter at xAI with the Grok catalog model', async () => {
  let received: Record<string, unknown> = {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'grok-3-mini' };
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'submit_report', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
    send({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address() as { port: number };
    const model = new OpenAIAdapter('xai-fixture-not-a-real-key', { baseURL: `http://127.0.0.1:${address.port}/v1`, provider: 'xai' });
    const reply = await model.request([{ role: 'user', content: 'Test' }], [], new AbortController().signal, () => {});
    expect(reply.calls[0]?.name).toBe('submit_report');
    expect(received).toMatchObject({ model: 'grok-3-mini' });
  } finally { server.closeAllConnections(); server.close(); }
});
