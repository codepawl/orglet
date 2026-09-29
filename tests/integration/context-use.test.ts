import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import { claudeContextUse } from '../../apps/desktop/src/core/harness/context-use';
import { parseClaudeOutput } from '../../apps/desktop/src/core/harness/exec';
import { parseOpenRouterModels } from '../../apps/desktop/src/core/models/fetch';
import { modelContextTokens, writeModelListCache } from '../../apps/desktop/src/core/models/cache';
import { MODEL_LIST_CACHE_VERSION, type ModelListCache } from '../../apps/desktop/src/shared/models';

// The `result` line of `claude -p --output-format stream-json --verbose` from Claude Code 2.1.283, one call on Sonnet,
// trimmed to the fields COD-326 reads (measured 2026-09-29).
const measuredResult = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"title":"t"}',
  total_cost_usd: 0.13378,
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 33_434,
    cache_read_input_tokens: 0,
    output_tokens: 4,
    iterations: [{ input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 33_434, type: 'message' }],
  },
  modelUsage: { 'claude-sonnet-5': { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 0, cacheCreationInputTokens: 33_434, contextWindow: 1_000_000, maxOutputTokens: 64_000 } },
};

describe('how full the context was on a Claude Code run (COD-326)', () => {
  it('reads the last call and the window Claude Code runs the model with', () => {
    expect(claudeContextUse(measuredResult)).toEqual({ usedTokens: 33_436, windowTokens: 1_000_000 });
    expect(parseClaudeOutput(JSON.stringify(measuredResult)).context).toEqual({ usedTokens: 33_436, windowTokens: 1_000_000 });
  });

  it('takes the last of several calls, not their sum, and the window of the model that took the most', () => {
    const result = {
      usage: { input_tokens: 30, iterations: [
        { input_tokens: 5, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 0 },
        { input_tokens: 7, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 10_000 },
      ] },
      modelUsage: {
        'claude-haiku': { inputTokens: 300, contextWindow: 200_000 },
        'claude-opus': { inputTokens: 12, cacheCreationInputTokens: 12_000, cacheReadInputTokens: 10_000, contextWindow: 1_000_000 },
      },
    };
    expect(claudeContextUse(result)).toEqual({ usedTokens: 12_007, windowTokens: 1_000_000 });
  });

  it('says nothing without the list of calls, since the totals add every call together', () => {
    expect(claudeContextUse({ usage: { input_tokens: 2, cache_creation_input_tokens: 33_434 }, modelUsage: measuredResult.modelUsage })).toBeUndefined();
    expect(claudeContextUse({ usage: measuredResult.usage })).toEqual({ usedTokens: 33_436 });
  });
});

describe('the window an API model list gives (COD-326)', () => {
  it('keeps OpenRouter\'s context_length and ignores a value that is not a whole number of tokens', () => {
    const models = parseOpenRouterModels({ data: [
      { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', context_length: 1_000_000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'vendor/odd', context_length: 'lots', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    ] });
    expect(models.map(model => model.contextTokens)).toEqual([1_000_000, undefined]);
    const cache: ModelListCache = { version: MODEL_LIST_CACHE_VERSION, byProvider: { openrouter: { fetchedAt: '2026-09-29T08:00:00.000Z', source: 'native', models } } };
    expect(modelContextTokens(cache, 'openrouter', 'anthropic/claude-sonnet-5')).toBe(1_000_000);
    expect(modelContextTokens(cache, 'openrouter', 'vendor/odd')).toBeUndefined();
    expect(modelContextTokens(cache, 'openai', 'gpt-5')).toBeUndefined();
  });
});

describe('how full the context was on an API run (COD-326)', () => {
  let directory: string; let store: Store; let core: CoreService; let replies: ModelReply[];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-context-use-'));
    store = new Store(join(directory, 'test.sqlite')); replies = [];
    core = new CoreService(store, () => {}, async () => ({ async request() { const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply; } }));
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const answer = (input: number): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Xong.', title: null, knowledgeProposals: [] }) }], usage: { input, output: 50 } });
  async function ask(provider: Worker['provider'], modelId?: string) {
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider, ...(modelId ? { modelId } : {}) });
    replies.push(answer(150_400));
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Một câu hỏi', sourceIds: [], consent: true, providerScopes: [provider], budgetMicros: 2_000_000 }) as string;
    for (let tries = 0; tries < 200 && !['completed', 'failed'].includes(store.detail(taskId).task.status); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    const detail = store.detail(taskId);
    return detail.runs.at(-1);
  }

  it('keeps the prompt tokens the provider billed, with the window only where the model list gives one', async () => {
    const models = parseOpenRouterModels({ data: [{ id: 'anthropic/claude-sonnet-5', context_length: 200_000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] });
    writeModelListCache(store, { version: MODEL_LIST_CACHE_VERSION, byProvider: { openrouter: { fetchedAt: new Date().toISOString(), source: 'native', models } } });
    expect((await ask('openrouter', 'anthropic/claude-sonnet-5'))?.contextUse).toEqual({ usedTokens: 150_400, windowTokens: 200_000 });
    expect((await ask('openai'))?.contextUse).toEqual({ usedTokens: 150_400 });
  });
});
