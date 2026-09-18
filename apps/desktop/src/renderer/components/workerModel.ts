import { harnessNames, isHarness } from '../../shared/harness';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';

/** Short model line for the new-task recipient strip and composer notes. */
export function workerModelLabel(provider: Worker['provider']) {
  if (provider === 'demo') return t('không gọi API');
  if (provider === 'openai') return 'OpenAI · GPT-4.1 mini';
  if (provider === 'anthropic') return 'Anthropic · Claude Haiku 4.5';
  if (provider === 'xai') return 'Grok · grok-3-mini';
  if (isHarness(provider)) return harnessNames[provider];
  return provider;
}
