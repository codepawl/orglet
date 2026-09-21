import { harnessNames, isHarness } from '../../shared/harness';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';

const suggestions: Partial<Record<Worker['provider'], string>> = {
  openai: 'GPT-4.1 mini',
  anthropic: 'Claude Haiku 4.5',
  xai: 'grok-3-mini',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
};

/** The provider's own short name, for a chip or a line where the long "… trên máy này" wording would not fit. */
export function providerName(provider: Worker['provider']) {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'xai') return 'Grok';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'opencode-zen') return 'OpenCode Zen';
  if (provider === 'opencode-go') return 'OpenCode Go';
  if (provider === 'ollama') return 'Ollama';
  if (isHarness(provider)) return harnessNames[provider];
  return provider;
}

/** Short model line for the new-task recipient strip and composer notes. */
export function workerModelLabel(worker: Pick<Worker, 'provider' | 'modelId'>) {
  if (worker.provider === 'demo') return t('không gọi API');
  const name = providerName(worker.provider);
  if (worker.modelId) return `${name} · ${worker.modelId}`;
  const suggestion = suggestions[worker.provider];
  return suggestion ? `${name} · ${suggestion}` : name;
}
