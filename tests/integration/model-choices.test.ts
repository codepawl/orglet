import { describe, expect, it } from 'vitest';
import { checkedChoiceValue, modelChoices, modelVendor, modelVersion } from '../../apps/desktop/src/shared/modelChoices';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';
import { claudeCodeEntries, claudeStartArgs, sameClaudeModel, startLineModel } from '../../apps/desktop/src/core/models/claudeCode';
import { harnessArgs } from '../../apps/desktop/src/core/harness/exec';

const claudeList: ModelEntry[] = [
  { provider: 'claude-code', id: 'sonnet', displayName: 'Sonnet 5', aliases: ['sonnet'], resolvedId: 'claude-sonnet-5', source: 'alias' },
  { provider: 'claude-code', id: 'opus', displayName: 'Opus 5.5', aliases: ['opus'], resolvedId: 'claude-opus-5-5', isDefault: true, source: 'alias' },
  { provider: 'claude-code', id: 'haiku', displayName: 'Haiku 4.5', aliases: ['haiku'], resolvedId: 'claude-haiku-4-5-20251001', source: 'alias' },
  { provider: 'claude-code', id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', source: 'native' },
];

const codexList: ModelEntry[] = [
  { provider: 'codex', id: 'gpt-6-astra', displayName: 'GPT-6-Astra', isDefault: true, source: 'native' },
  { provider: 'codex', id: 'gpt-6-sol', displayName: 'GPT-6-Sol', source: 'native' },
  { provider: 'codex', id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', source: 'native' },
  { provider: 'codex', id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', source: 'native' },
  { provider: 'codex', id: 'gpt-5.5', displayName: 'GPT-5.5', replacementId: 'gpt-5.6-sol', source: 'native' },
];

describe('model picker rows (COD-332)', () => {
  it('saves nothing for the row the CLI runs by default, so the orglet keeps following the CLI', () => {
    const choices = modelChoices('claude-code', claudeList, true);
    expect(choices.map(choice => [choice.value, choice.label, choice.isDefault, choice.more, choice.vendor])).toEqual([
      ['sonnet', 'Sonnet 5', false, false, 'claude'],
      ['', 'Opus 5.5', true, false, 'claude'],
      ['haiku', 'Haiku 4.5', false, false, 'claude'],
      ['claude-sonnet-5-5', 'Sonnet 5.5', false, true, 'claude'],
    ]);
    // Nothing saved, the alias saved earlier and the model it stands for all check the Default row.
    expect(checkedChoiceValue(choices, undefined)).toBe('');
    expect(checkedChoiceValue(choices, 'opus')).toBe('');
    expect(checkedChoiceValue(choices, 'claude-opus-5-5')).toBe('');
    expect(checkedChoiceValue(choices, 'sonnet')).toBe('sonnet');
    expect(checkedChoiceValue(choices, 'claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('follows the CLI when its default moves: the badge and the empty value go with it', () => {
    const moved = claudeList.map(entry => ({ ...entry, isDefault: entry.id === 'sonnet' ? true as const : undefined }));
    const choices = modelChoices('claude-code', moved, true);
    expect(choices.find(choice => choice.value === '')?.label).toBe('Sonnet 5');
    expect(choices.find(choice => choice.entry?.id === 'opus')?.value).toBe('opus');
  });

  it('keeps the newest of each family on top and the older ones, or those with a replacement, under More models', () => {
    const choices = modelChoices('codex', codexList, true);
    expect(choices.filter(choice => !choice.more).map(choice => choice.label)).toEqual(['GPT-6-Astra', 'GPT-6-Sol', 'GPT-5.6-Terra']);
    expect(choices.filter(choice => choice.more).map(choice => choice.label)).toEqual(['GPT-5.6-Sol', 'GPT-5.5']);
    expect(choices.every(choice => choice.vendor === 'openai')).toBe(true);
  });

  it('reads a family and version from a display name only, never from a date or an ID', () => {
    expect(modelVersion('Claude Opus 4.5')).toEqual({ family: 'claude opus', version: [4, 5] });
    expect(modelVersion('GPT-5.6-Sol')).toEqual({ family: 'gpt sol', version: [5, 6] });
    expect(modelVersion('Claude 4.5 Sonnet')).toEqual({ family: 'claude sonnet', version: [4, 5] });
    expect(modelVersion('Preview 20251001')).toBeUndefined();
    expect(modelVersion('Auto')).toBeUndefined();
    expect(modelVersion(undefined)).toBeUndefined();
  });

  it('gives a model its maker\'s mark whatever connection serves it', () => {
    expect(modelVendor('cursor', { id: 'sonnet-4.5', displayName: 'Claude 4.5 Sonnet' })).toBe('claude');
    expect(modelVendor('cursor', { id: 'gpt-5', displayName: 'GPT-5' })).toBe('openai');
    expect(modelVendor('cursor', { id: 'composer-1', displayName: 'Composer 1' })).toBe('cursor');
    expect(modelVendor('openrouter', { id: 'google/gemini-2.5-pro' })).toBe('gemini');
    expect(modelVendor('openrouter', { id: 'x-ai/grok-4' })).toBe('grok');
    expect(modelVendor('openrouter', { id: 'mistralai/mistral-large' })).toBe('openrouter');
    expect(modelVendor('custom:lab', { id: 'my-model' })).toBeUndefined();
  });

  it('offers an unnamed Default row when nobody knows the default, and none where there is no default', () => {
    const gemini: ModelEntry[] = [{ provider: 'gemini', id: 'pro', displayName: 'Pro', aliases: ['pro'], source: 'alias' }];
    const [first] = modelChoices('gemini', gemini, true);
    expect(first).toEqual({ value: '', vendor: 'gemini', isDefault: false, more: false });
    const plan: ModelEntry[] = [{ provider: 'opencode-go', id: 'kimi-k2', source: 'native' }];
    expect(modelChoices('opencode-go', plan, false).map(choice => choice.value)).toEqual(['kimi-k2']);
  });

  it('puts the Default badge on the suggestion an API orglet runs with when its model is left empty', () => {
    const openai: ModelEntry[] = [
      { provider: 'openai', id: 'gpt-4.1', source: 'native' },
      { provider: 'openai', id: 'gpt-4.1-mini-2025-04-14', source: 'native' },
    ];
    const choices = modelChoices('openai', openai, true);
    expect(choices.map(choice => [choice.value, choice.isDefault])).toEqual([['gpt-4.1', false], ['', true]]);
    const missing = modelChoices('anthropic', [], true);
    expect(missing).toEqual([{ value: '', label: 'claude-sonnet-5-5', vendor: 'claude', isDefault: true, more: false }]);
  });
});

describe('Claude Code start line (COD-332)', () => {
  it('asks with the flags Orglet runs with, and a command the CLI answers without a model call', () => {
    const args = claudeStartArgs('opus');
    const runFlags = harnessArgs({ harness: 'claude-code', cwd: '/task', schema: {}, model: 'opus' });
    for (const flag of ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) {
      expect(args).toContain(flag);
      expect(runFlags).toContain(flag);
    }
    expect(args.slice(0, 4)).toEqual(['-p', '/cost', '--model', 'opus']);
    // Turning slash commands off would send `/cost` to the model as a prompt.
    expect(args).not.toContain('--disable-slash-commands');
    expect(claudeStartArgs()).not.toContain('--model');
  });

  it('reads the model only from the init line', () => {
    expect(startLineModel('{"type":"system","subtype":"init","model":"claude-opus-5-5","tools":[]}')).toBe('claude-opus-5-5');
    expect(startLineModel('{"type":"system","subtype":"commands_changed"}')).toBeUndefined();
    expect(startLineModel('{"type":"assistant","model":"claude-opus-5-5"}')).toBeUndefined();
    expect(startLineModel('not json')).toBeUndefined();
  });

  it('matches a dated ID and a context tag to the same model', () => {
    expect(sameClaudeModel('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(sameClaudeModel('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(true);
    expect(sameClaudeModel('claude-opus-5', 'claude-opus-5-5')).toBe(false);
  });

  it('lists a default the aliases do not cover as its own row', () => {
    const entries = claudeCodeEntries({
      defaultModel: 'claude-opus-4-8',
      aliases: { opus: 'claude-opus-5-5' },
      named: [{ provider: 'anthropic', id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', source: 'native' }],
    });
    expect(entries.filter(entry => entry.isDefault)).toEqual([{ provider: 'claude-code', id: 'claude-opus-4-8', displayName: 'Opus 4.8', isDefault: true, source: 'native' }]);
    expect(entries.filter(entry => entry.id === 'claude-opus-4-8')).toHaveLength(1);
  });
});
