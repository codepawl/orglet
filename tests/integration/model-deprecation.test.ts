import { describe, expect, it } from 'vitest';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';
import { CATALOG_HINT_IDS } from '../../apps/desktop/src/shared/models';
import { deprecationNotice, formatSunsetDay, listedModel, pickerListedModel } from '../../apps/desktop/src/shared/modelDeprecation';
import { parseAnthropicModels, parseOpenAIModels, parseXaiLanguageModels } from '../../apps/desktop/src/core/models/fetch';

const openai = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  provider: 'openai', id, source: 'native', ...extra,
});

describe('deprecated model chip mapping', () => {
  it('chips a selected OpenAI model with shutdown_date and keeps a past date', () => {
    const models = parseOpenAIModels({
      data: [
        { id: 'gpt-4.1-mini-2025-04-14', shutdown_date: null },
        { id: 'gpt-4o-2024-08-06', shutdown_date: '2026-08-31' },
        { id: 'gpt-4-turbo', shutdown_date: '2025-01-01' },
      ],
    });
    expect(deprecationNotice(listedModel(models, 'gpt-4.1-mini-2025-04-14'))).toBeUndefined();
    expect(deprecationNotice(listedModel(models, 'gpt-4o-2024-08-06'))).toEqual({
      deprecated: true, sunsetAt: '2026-08-31',
    });
    expect(deprecationNotice(listedModel(models, 'gpt-4-turbo'))).toEqual({
      deprecated: true, sunsetAt: '2025-01-01',
    });
  });

  it('chips the catalog suggestion when the field is empty, and ignores a typed ID that is not on the list', () => {
    const models = [
      openai(CATALOG_HINT_IDS.openai),
      openai('gpt-4o-2024-08-06', { deprecated: true, sunsetAt: '2026-08-31' }),
    ];
    expect(deprecationNotice(pickerListedModel(models, '', CATALOG_HINT_IDS.openai))).toBeUndefined();
    expect(deprecationNotice(pickerListedModel(
      [openai(CATALOG_HINT_IDS.openai, { deprecated: true, sunsetAt: '2026-10-01' })],
      '   ',
      CATALOG_HINT_IDS.openai,
    ))).toEqual({ deprecated: true, sunsetAt: '2026-10-01' });
    expect(listedModel(models, 'gpt-5-custom')).toBeUndefined();
    expect(deprecationNotice(pickerListedModel(models, 'gpt-5-custom', CATALOG_HINT_IDS.openai))).toBeUndefined();
  });

  it('matches aliases and does not invent a sunset day', () => {
    const grok = listedModel(
      [{ provider: 'xai', id: 'grok-3', aliases: ['grok-3-latest'], source: 'native', deprecated: true }],
      'grok-3-latest',
    );
    expect(deprecationNotice(grok)).toEqual({ deprecated: true });
    expect(formatSunsetDay(grok?.sunsetAt, 'en-US')).toBeUndefined();
    expect(formatSunsetDay('2026-08-31', 'en-US')).toBe('Aug 31, 2026');
    expect(formatSunsetDay('2026-13-40', 'en-US')).toBeUndefined();
    expect(formatSunsetDay('soon', 'en-US')).toBeUndefined();
  });

  it('does not chip Anthropic, xAI, or HTML-shaped payloads that have no native sunset', () => {
    const anthropic = parseAnthropicModels({
      data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' }],
      has_more: false,
    }).models;
    expect(anthropic[0].deprecated).toBeUndefined();
    expect(anthropic[0].sunsetAt).toBeUndefined();
    expect(deprecationNotice(anthropic[0])).toBeUndefined();

    const xai = parseXaiLanguageModels({
      models: [{ id: 'grok-3-mini', output_modalities: ['text'], prompt_text_token_price: 3000, completion_text_token_price: 5000 }],
    });
    expect(deprecationNotice(xai[0])).toBeUndefined();

    const html = parseOpenAIModels({ data: [{ id: 'gpt-4o', shutdown_date: '<p>August 2026</p>' }] });
    expect(html[0].deprecated).toBeUndefined();
    expect(html[0].sunsetAt).toBeUndefined();
    expect(deprecationNotice(html[0])).toBeUndefined();
  });

  it('keeps Codex upgrade as replacement text, not a deprecated chip or a date', () => {
    const entry: ModelEntry = { provider: 'codex', id: 'gpt-5.1', source: 'native', replacementId: 'gpt-5.4' };
    expect(deprecationNotice(entry)).toBeUndefined();
    expect(entry.sunsetAt).toBeUndefined();
    expect(listedModel([entry], 'gpt-5.1')?.replacementId).toBe('gpt-5.4');
  });
});
