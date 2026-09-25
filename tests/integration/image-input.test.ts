import { describe, expect, it } from 'vitest';
import { harnessSeesImages, modelSeesImages } from '../../apps/desktop/src/core/models/image-input';
import { parseOpenAIModels, parseOpenRouterModels, parseXaiLanguageModels } from '../../apps/desktop/src/core/models/fetch';
import { IMAGE_TOKEN_ALLOWANCE, imageTokenAllowance } from '../../apps/desktop/src/shared/images';
import { emptyModelListCache, type ModelEntry, type ModelListCache, type ModelListProvider, type ModelListRow } from '../../apps/desktop/src/shared/models';

function cacheWith(provider: ModelListProvider, models: ModelEntry[]): ModelListCache {
  const row: ModelListRow = { fetchedAt: new Date().toISOString(), source: 'native', models };
  return { ...emptyModelListCache(), byProvider: { [provider]: row } };
}

describe('which connections see images (COD-260)', () => {
  it('reads input types from the xAI and OpenRouter lists, and from a server that copies them', () => {
    const xai = parseXaiLanguageModels({ models: [
      { id: 'grok-4', input_modalities: ['text', 'image'], output_modalities: ['text'] },
      { id: 'grok-3-mini', input_modalities: ['text'], output_modalities: ['text'] },
    ] });
    expect(xai.map(entry => [entry.id, entry.imageInput])).toEqual([['grok-4', true], ['grok-3-mini', undefined]]);
    const openRouter = parseOpenRouterModels({ data: [
      { id: 'google/gemini-2.5-flash', architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] } },
      { id: 'old/vision', architecture: { modality: 'text+image->text' } },
      { id: 'meta/text-only', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    ] });
    expect(openRouter.map(entry => [entry.id, entry.imageInput])).toEqual([['google/gemini-2.5-flash', true], ['old/vision', true], ['meta/text-only', undefined]]);
    // OpenAI's own list has no input types, and a plain OpenAI-compatible server rarely does.
    expect(parseOpenAIModels({ data: [{ id: 'gpt-4.1-mini' }] })[0]).not.toHaveProperty('imageInput');
    expect(parseOpenAIModels({ data: [{ id: 'qwen2.5-vl', architecture: { input_modalities: ['text', 'image'] } }] }, 'custom:local')[0].imageInput).toBe(true);
  });

  it('shows images to Claude models, OpenAI vision families and models their list marks, and to no one else', () => {
    expect(modelSeesImages('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(modelSeesImages('openai', undefined)).toBe(true);
    expect(modelSeesImages('openai', 'gpt-4.1-mini-2025-04-14')).toBe(true);
    expect(modelSeesImages('openai', 'gpt-5.6-sol')).toBe(true);
    expect(modelSeesImages('openai', 'o4-mini')).toBe(true);
    expect(modelSeesImages('openai', 'o3-mini')).toBe(false);
    expect(modelSeesImages('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(modelSeesImages('openai', 'gpt-4o-audio-preview')).toBe(false);
    const xai = cacheWith('xai', [{ provider: 'xai', id: 'grok-4', source: 'native', imageInput: true }]);
    expect(modelSeesImages('xai', 'grok-4', xai)).toBe(true);
    expect(modelSeesImages('xai', 'grok-3-mini', xai)).toBe(false);
    expect(modelSeesImages('openrouter', 'openai/gpt-4.1-mini')).toBe(true);
    expect(modelSeesImages('openrouter', 'meta/text-only')).toBe(false);
    const custom = cacheWith('custom:local', [{ provider: 'custom:local', id: 'qwen2.5-vl', source: 'native', imageInput: true }]);
    expect(modelSeesImages('custom:local', 'qwen2.5-vl', custom)).toBe(true);
    expect(modelSeesImages('custom:local', 'llama3', custom)).toBe(false);
    expect(modelSeesImages('ollama', 'llava')).toBe(false);
    expect(modelSeesImages('opencode-zen', 'gpt-5')).toBe(false);
  });

  it('holds gpt-4o-mini images at its own, much larger token count', () => {
    expect(imageTokenAllowance('gpt-4.1-mini-2025-04-14')).toBe(IMAGE_TOKEN_ALLOWANCE);
    expect(imageTokenAllowance('claude-haiku-4-5-20251001')).toBe(IMAGE_TOKEN_ALLOWANCE);
    expect(imageTokenAllowance('gpt-4o-mini-2024-07-18')).toBeGreaterThanOrEqual(48_169);
    expect(imageTokenAllowance('openai/gpt-4o-mini')).toBeGreaterThanOrEqual(48_169);
  });

  it('hands images to Claude Code and Codex, and not to Cursor Agent or Gemini CLI', () => {
    expect(harnessSeesImages('claude-code')).toBe(true);
    expect(harnessSeesImages('codex')).toBe(true);
    expect(harnessSeesImages('cursor')).toBe(false);
    expect(harnessSeesImages('gemini')).toBe(false);
  });
});
