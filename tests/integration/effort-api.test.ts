import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { OpenAIAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { OPENAI_MAX_OUTPUT_TOKENS } from '../../apps/desktop/src/core/adapters/catalog';
import type { NativeEffortSetting } from '../../apps/desktop/src/shared/effort';

it('sends native effort only on its evidenced OpenAI-compatible transport and keeps tool/cap controls', async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const responseChunks: Buffer[] = [];
    for await (const chunk of request) {
      responseChunks.push(chunk);
    }
    requestBodies.push(JSON.parse(Buffer.concat(responseChunks).toString()));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fixture","choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    const effortSettings: (NativeEffortSetting | undefined)[] = [{ transport: 'reasoning_effort', level: 'high' }, { transport: 'openrouter', level: 'max' }, { transport: 'ollama', level: 'ultra' }, undefined, { transport: 'codex', level: 'ultra' }];
    for (const effort of effortSettings) {
      await new OpenAIAdapter('fixture-not-real', { baseURL, model: 'fixture', effort }).request([{ role: 'user', content: 'Hello' }], [], new AbortController().signal, () => {});
    }
    expect(requestBodies[0].reasoning_effort).toBe('high');
    expect(requestBodies[1].reasoning).toEqual({ effort: 'max' });
    expect(requestBodies[2].reasoning_effort).toBe('ultra');
    for (const body of requestBodies.slice(3)) {
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('reasoning');
    }
    for (const body of requestBodies) {
      expect(body).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false, max_completion_tokens: OPENAI_MAX_OUTPUT_TOKENS });
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
