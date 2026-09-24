import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { acceptCustomModelId, hiddenOpenAIModel, MODEL_LISTS_SETTING } from '../../apps/desktop/src/shared/models';
import { canStoreModelListRow } from '../../apps/desktop/src/core/models/cache';
import { catalogHint, parseCodexModels, parseCursorModels, parseOllamaTags, parseOpenAIModels, parseOpenRouterModels } from '../../apps/desktop/src/core/models/fetch';
import { modelCatalog } from '../../apps/desktop/src/core/adapters/catalog';
import { harnessNames, SYSTEM_ACCOUNT_ID, type HarnessInfo } from '../../apps/desktop/src/shared/harness';
import type { ModelListResult } from '../../apps/desktop/src/shared/models';
import type { Probe } from '../../apps/desktop/src/core/harness/detect';

const stores: Store[] = [];
const cores: CoreService[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.runner.shutdown();
  for (const store of stores.splice(0)) store.close();
});

function store() {
  const created = new Store(':memory:');
  stores.push(created);
  return created;
}

function signedIn(id: 'claude-code' | 'codex' | 'cursor', executable: string): HarnessInfo {
  return {
    id, name: harnessNames[id], executable, version: '1.0.0', auth: 'logged_in', status: 'signed_in',
    authDetail: 'ok', loginCommand: executable, loginCommands: [], runnable: true, accountId: SYSTEM_ACCOUNT_ID, accounts: [],
  };
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((request, response) => { void handler(request, response); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close() { server.closeAllConnections(); server.close(); },
  };
}

function coreFor(db: Store, runtime: ConstructorParameters<typeof CoreService>[7], clock: () => Date = () => new Date(), harness?: ConstructorParameters<typeof CoreService>[5]) {
  const core = new CoreService(db, () => {}, async () => { throw new Error('no model'); }, undefined, clock, harness, undefined, runtime);
  cores.push(core);
  return core;
}

describe('model list fetch adapters', () => {
  it('fetches OpenAI models, caches them, and does not hit the network again while fresh', async () => {
    let hits = 0;
    const server = await listen((request, response) => {
      hits++;
      expect(request.headers.authorization).toBe('Bearer sk-test');
      expect(request.url).toBe('/v1/models');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-4.1-mini-2025-04-14', shutdown_date: null },
          { id: 'gpt-4o-2024-08-06', shutdown_date: '2026-08-31' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
        ],
      }));
    });
    try {
      const db = store();
      const core = coreFor(db, { readKey: async () => 'sk-test', endpoints: { openai: server.url } });
      const first = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(first.customIdOk).toBe(true);
      expect(first.stale).toBe(false);
      expect(first.source).toBe('native');
      expect(first.models.map(model => model.id)).toEqual(['gpt-4.1-mini-2025-04-14', 'gpt-4o-2024-08-06']);
      expect(first.models[1]).toMatchObject({ deprecated: true, sunsetAt: '2026-08-31' });
      expect(first.models.some(model => model.id.includes('embedding') || model.id.includes('whisper'))).toBe(false);
      expect(acceptCustomModelId('text-embedding-3-small')).toBe('text-embedding-3-small');
      expect(hiddenOpenAIModel('text-embedding-3-small')).toBe(true);
      const second = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(second.models).toEqual(first.models);
      expect(hits).toBe(1);
    } finally { server.close(); }
  });

  it('keeps a model with a past shutdown_date on the list', () => {
    const models = parseOpenAIModels({ data: [{ id: 'gpt-4-turbo', shutdown_date: '2025-01-01' }] });
    expect(models).toEqual([expect.objectContaining({ id: 'gpt-4-turbo', deprecated: true, sunsetAt: '2025-01-01' })]);
  });

  it('paginates Anthropic until has_more is false', async () => {
    const pages: string[] = [];
    const server = await listen((request, response) => {
      pages.push(request.url ?? '');
      expect(request.headers['x-api-key']).toBe('sk-ant');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      const url = new URL(request.url ?? '', 'http://127.0.0.1');
      const after = url.searchParams.get('after_id');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (!after) {
        response.end(JSON.stringify({
          data: [{ id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' }],
          has_more: true,
          last_id: 'claude-opus-4-6',
        }));
        return;
      }
      response.end(JSON.stringify({
        data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }],
        has_more: false,
        last_id: 'claude-haiku-4-5-20251001',
      }));
    });
    try {
      const core = coreFor(store(), { readKey: async () => 'sk-ant', endpoints: { anthropic: server.url } });
      const list = await core.command('modelList', { provider: 'anthropic' }) as ModelListResult;
      expect(list.models.map(model => model.id)).toEqual(['claude-opus-4-6', 'claude-haiku-4-5-20251001']);
      expect(list.models[0].displayName).toBe('Claude Opus 4.6');
      expect(pages.some(url => url.includes('after_id=claude-opus-4-6'))).toBe(true);
      expect(list.models[0].deprecated).toBeUndefined();
    } finally { server.close(); }
  });

  it('keeps OpenRouter text models with native tenths and drops image-only rows', async () => {
    const server = await listen((request, response) => {
      expect(request.headers.authorization).toBe('Bearer sk-or-test');
      expect(request.url).toBe('/v1/models');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: [
          { id: 'openai/gpt-4.1-mini', name: 'OpenAI: GPT-4.1 Mini', pricing: { prompt: '0.0000004', completion: '0.0000016' }, architecture: { output_modalities: ['text'] } },
          { id: 'black-forest-labs/flux', name: 'FLUX', architecture: { output_modalities: ['image'] } },
        ],
      }));
    });
    try {
      const core = coreFor(store(), { readKey: async () => 'sk-or-test', endpoints: { openrouter: server.url } });
      const list = await core.command('modelList', { provider: 'openrouter' }) as ModelListResult;
      expect(list.models).toEqual([expect.objectContaining({
        id: 'openai/gpt-4.1-mini', displayName: 'OpenAI: GPT-4.1 Mini', inputTenths: 4, outputTenths: 16, source: 'native',
      })]);
    } finally { server.close(); }
  });

  it('lists local Ollama tags without a billed key', async () => {
    const server = await listen((request, response) => {
      expect(request.url).toBe('/api/tags');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5:7b' }] }));
    });
    try {
      const core = coreFor(store(), { readKey: async () => 'ollama-local', endpoints: { ollama: server.url.replace(/\/v1$/, '') } });
      const list = await core.command('modelList', { provider: 'ollama' }) as ModelListResult;
      expect(list.models).toEqual([
        expect.objectContaining({ id: 'llama3.2:latest', displayName: 'llama3.2', source: 'native' }),
        expect.objectContaining({ id: 'qwen2.5:7b', source: 'native' }),
      ]);
    } finally { server.close(); }
  });

  it('parses OpenRouter and Ollama payloads without inventing sunset dates', () => {
    const openrouter = parseOpenRouterModels({ data: [{ id: 'meta-llama/llama-3.3-70b-instruct', pricing: { prompt: '0' } }] });
    expect(openrouter).toEqual([expect.objectContaining({ id: 'meta-llama/llama-3.3-70b-instruct', source: 'native' })]);
    expect(openrouter[0].inputTenths).toBeUndefined();
    expect(parseOllamaTags({ models: [{ name: 'llama3.2' }] })).toEqual([
      expect.objectContaining({ id: 'llama3.2', source: 'native' }),
    ]);
  });

  it('keeps xAI text models with native tenths and drops image-only rows', async () => {
    const server = await listen((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        models: [
          {
            id: 'grok-3-mini',
            aliases: ['grok-3-mini-latest'],
            output_modalities: ['text'],
            prompt_text_token_price: 3000,
            completion_text_token_price: 5000,
          },
          { id: 'grok-imagine-image', output_modalities: ['image'], prompt_text_token_price: 100000, completion_text_token_price: 100000 },
        ],
      }));
    });
    try {
      const core = coreFor(store(), { readKey: async () => 'xai-key', endpoints: { xai: server.url } });
      const list = await core.command('modelList', { provider: 'xai' }) as ModelListResult;
      expect(list.models).toEqual([expect.objectContaining({
        id: 'grok-3-mini', aliases: ['grok-3-mini-latest'], inputTenths: 3, outputTenths: 5, source: 'native',
      })]);
    } finally { server.close(); }
  });

  it('ships Claude Code aliases with no network and still accepts a custom ID', async () => {
    let hits = 0;
    const server = await listen((_request, response) => { hits++; response.writeHead(500); response.end(); });
    try {
      const core = coreFor(store(), { readKey: async () => 'must-not-use', endpoints: { anthropic: server.url } });
      const list = await core.command('modelList', { provider: 'claude-code' }) as ModelListResult;
      expect(list.source).toBe('alias');
      expect(list.models.map(model => model.id)).toEqual(['sonnet', 'opus', 'haiku', 'fable']);
      expect(hits).toBe(0);
      expect(acceptCustomModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    } finally { server.close(); }
  });

  it('parses Codex JSON and falls back to --bundled, mapping upgrade to replacementId', async () => {
    const calls: string[] = [];
    const probe: Probe = async (_executable, args) => {
      calls.push(args.join(' '));
      if (args.includes('--bundled')) {
        return { code: 0, stdout: JSON.stringify({ models: [{ slug: 'gpt-5.1', display_name: 'GPT-5.1', upgrade: 'gpt-5.4' }] }), stderr: '' };
      }
      return { code: 1, stdout: 'not-json', stderr: 'refresh failed' };
    };
    const core = coreFor(store(), { probe }, undefined, {
      detect: async () => [signedIn('codex', '/bin/codex')],
      execute: async () => { throw new Error('no exec'); },
    });
    const list = await core.command('modelList', { provider: 'codex' }) as ModelListResult;
    expect(calls).toEqual(['debug models', 'debug models --bundled']);
    expect(list.models).toEqual([expect.objectContaining({ id: 'gpt-5.1', displayName: 'GPT-5.1', replacementId: 'gpt-5.4' })]);
  });

  it('parses Cursor id - name lines and fails open when the shape changes', () => {
    expect(parseCursorModels('gpt-5 - GPT-5\nsonnet-4 - Claude Sonnet 4\n')).toEqual([
      expect.objectContaining({ id: 'gpt-5', displayName: 'GPT-5' }),
      expect.objectContaining({ id: 'sonnet-4', displayName: 'Claude Sonnet 4' }),
    ]);
    expect(() => parseCursorModels('<html><h1>Models</h1></html>')).toThrow('định dạng');
    expect(() => parseCodexModels('<!DOCTYPE html><html>docs</html>')).toThrow('định dạng');
  });

  it('returns catalog-hint and customIdOk when Cursor output is not list lines', async () => {
    const core = coreFor(store(), {
      probe: async () => ({ code: 0, stdout: 'Usage: agent [prompt]', stderr: '' }),
    }, undefined, {
      detect: async () => [signedIn('cursor', '/bin/agent')],
      execute: async () => { throw new Error('no exec'); },
    });
    const list = await core.command('modelList', { provider: 'cursor' }) as ModelListResult;
    expect(list.customIdOk).toBe(true);
    expect(list.error).toMatch(/định dạng/);
    expect(list.models).toEqual([]);
    expect(acceptCustomModelId('composer-2')).toBe('composer-2');
  });
});

describe('model list cache TTL and invalidation', () => {
  it('returns a stale row immediately after 24h and refreshes in the background', async () => {
    let hits = 0;
    let body = { object: 'list', data: [{ id: 'gpt-4.1-mini-2025-04-14' }] };
    const server = await listen((_request, response) => {
      hits++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    });
    try {
      let now = new Date('2026-09-18T12:00:00.000Z');
      const core = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: server.url } }, () => now);
      const first = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(first.stale).toBe(false);
      expect(hits).toBe(1);
      now = new Date('2026-09-19T12:00:01.000Z');
      body = { object: 'list', data: [{ id: 'gpt-5' }] };
      const stale = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(stale.stale).toBe(true);
      expect(stale.models[0].id).toBe('gpt-4.1-mini-2025-04-14');
      await core.waitForModelListRefresh('openai');
      const fresh = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(fresh.stale).toBe(false);
      expect(fresh.models[0].id).toBe('gpt-5');
      expect(hits).toBe(2);
    } finally { server.close(); }
  });

  it('invalidates on key change and on harness rediscover', async () => {
    let hits = 0;
    const server = await listen((_request, response) => {
      hits++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: `gpt-hit-${hits}` }] }));
    });
    const probeCalls: string[] = [];
    try {
      const db = store();
      const core = coreFor(db, {
        readKey: async () => 'sk',
        endpoints: { openai: server.url },
        probe: async (_executable, args) => {
          probeCalls.push(args.join(' '));
          return { code: 0, stdout: JSON.stringify({ models: [{ slug: `codex-${probeCalls.length}` }] }), stderr: '' };
        },
      }, undefined, {
        detect: async () => [signedIn('codex', '/bin/codex')],
        execute: async () => { throw new Error('no exec'); },
      });
      await core.command('modelList', { provider: 'openai' });
      expect(hits).toBe(1);
      core.invalidateModelList('openai');
      const afterKey = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(afterKey.models[0].id).toBe('gpt-hit-2');
      await core.command('modelList', { provider: 'codex' });
      expect(probeCalls).toEqual(['debug models']);
      await core.command('harnesses', { refresh: true });
      await core.command('modelList', { provider: 'codex' });
      expect(probeCalls).toEqual(['debug models', 'debug models']);
    } finally { server.close(); }
  });

  it('explicit refresh bypasses a fresh cache', async () => {
    let hits = 0;
    const server = await listen((_request, response) => {
      hits++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: `m${hits}` }] }));
    });
    try {
      const core = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: server.url } });
      await core.command('modelList', { provider: 'openai' });
      const refreshed = await core.command('modelList', { provider: 'openai', refresh: true }) as ModelListResult;
      expect(refreshed.models[0].id).toBe('m2');
      expect(hits).toBe(2);
    } finally { server.close(); }
  });

  it('keeps last good cache on 401 and still allows a custom ID', async () => {
    let hits = 0;
    const server = await listen((_request, response) => {
      hits++;
      if (hits === 1) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4.1-mini-2025-04-14' }] }));
        return;
      }
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid' } }));
    });
    try {
      let now = new Date('2026-09-18T00:00:00.000Z');
      const core = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: server.url } }, () => now);
      await core.command('modelList', { provider: 'openai' });
      now = new Date('2026-09-19T00:00:01.000Z');
      const stale = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(stale.models[0].id).toBe('gpt-4.1-mini-2025-04-14');
      await core.waitForModelListRefresh('openai');
      const after = await core.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(after.models[0].id).toBe('gpt-4.1-mini-2025-04-14');
      expect(after.customIdOk).toBe(true);
      expect(hits).toBe(2);
    } finally { server.close(); }
  });

  it('returns catalog-hint and customIdOk on timeout or 401 with no prior cache', async () => {
    const timeoutServer = await listen(() => { /* hang until client abort */ });
    const unauthorized = await listen((_request, response) => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    try {
      const timedOut = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: timeoutServer.url }, timeoutMs: 50 });
      const timeoutList = await timedOut.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(timeoutList.customIdOk).toBe(true);
      expect(timeoutList.models[0]).toEqual(catalogHint('openai'));
      expect(timeoutList.error).toMatch(/Hết thời gian/);
      const failed = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: unauthorized.url } });
      const unauthorizedList = await failed.command('modelList', { provider: 'openai' }) as ModelListResult;
      expect(unauthorizedList.customIdOk).toBe(true);
      expect(unauthorizedList.models[0].id).toBe(modelCatalog.openai.model);
      expect(unauthorizedList.error).toMatch(/\(401\)/);
    } finally {
      timeoutServer.close();
      unauthorized.close();
    }
  });

  it('does not export modelLists in a backup', () => {
    const db = store();
    db.setSetting(MODEL_LISTS_SETTING, { version: 1, byProvider: { openai: { fetchedAt: new Date().toISOString(), source: 'native', models: [{ provider: 'openai', id: 'secret-model-id', source: 'native' }] } } });
    const text = new Backups(db, () => false, () => {}).export();
    expect(text).not.toContain('secret-model-id');
    expect(text).not.toContain('modelLists');
  });

  it('rejects an oversized provider payload and keeps the previous row', () => {
    const huge = {
      fetchedAt: new Date().toISOString(),
      source: 'native' as const,
      models: Array.from({ length: 500 }, (_, index) => ({
        provider: 'xai' as const,
        id: `m${index}`,
        aliases: Array.from({ length: 50 }, (__, alias) => `alias-${index}-${alias}-${'x'.repeat(160)}`),
        source: 'native' as const,
      })),
    };
    expect(canStoreModelListRow(huge)).toBe(false);
  });

  it('returns an empty demo list without fetching', async () => {
    let hits = 0;
    const server = await listen(() => { hits++; });
    try {
      const core = coreFor(store(), { readKey: async () => 'sk', endpoints: { openai: server.url } });
      const list = await core.command('modelList', { provider: 'demo' }) as ModelListResult;
      expect(list.models).toEqual([]);
      expect(list.customIdOk).toBe(true);
      expect(hits).toBe(0);
    } finally { server.close(); }
  });

  it('does not ship an HTML parser for model lists', () => {
    const root = join(__dirname, '../../apps/desktop/src');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
    const files = walk(root).filter(file => /\.(ts|tsx|js|cjs|mjs)$/.test(file));
    const banned = /cheerio|jsdom|linkedom|node-html-parser|htmlparser2|parse5/;
    const hits = files.filter(file => banned.test(readFileSync(file, 'utf8')));
    expect(hits).toEqual([]);
  });
});
