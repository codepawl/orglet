import { demoReplies } from '../demoReplies';
import { harnessNames, isHarness } from '../../shared/harness';
import { isLocalApi, type Worker } from '../../shared/contracts';
import { CATALOG_HINT_IDS, type ModelEntry } from '../../shared/models';
import { isCustomProvider } from '../../shared/custom-connections';
import { isOpenCodePlan } from '../../shared/opencode';
import { t } from '../i18n';
import { customConnectionName } from '../customConnections';

const suggestions: Partial<Record<Worker['provider'], string>> = {
  openai: 'GPT-4.1 mini',
  anthropic: 'Claude Sonnet 5.5',
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
  if (provider === 'codepawl') return 'CodePawl';
  if (provider === 'ollama') return 'Ollama';
  if (isHarness(provider)) return harnessNames[provider];
  return customConnectionName(provider) ?? provider;
}

/** Short model line for the new-task recipient strip and composer notes. */
export function workerModelLabel(worker: Pick<Worker, 'provider' | 'modelId'>) {
  if (worker.provider === 'demo') return demoReplies() ? t('không gọi API') : t('chưa kết nối model');
  const name = providerName(worker.provider);
  if (worker.modelId) return `${name} · ${worker.modelId}`;
  const suggestion = suggestions[worker.provider];
  return suggestion ? `${name} · ${suggestion}` : name;
}

/**
 * The model ID a worker starts on once its connection's list is known and the field is still empty (COD-293: a
 * newcomer's custom connection listed exactly one model, the field stayed empty and Save refused it). Empty means
 * "keep the empty field": a harness then runs its CLI default, and a built-in paid API runs its catalog suggestion,
 * which that provider always offers. A connection with nothing to fall back on (a custom connection, an OpenCode plan)
 * starts on the first model its list offers that Orglet can call; so does Ollama when its suggestion is not installed.
 */
export function startingModelId(provider: Worker['provider'], models: readonly ModelEntry[], runnable: (modelId: string) => boolean = () => true): string {
  if (provider === 'demo' || isHarness(provider)) return '';
  const offered = models.filter(entry => runnable(entry.id));
  const first = offered[0]?.id ?? '';
  if (isCustomProvider(provider) || isOpenCodePlan(provider) || provider === 'codepawl') return first;
  if (isLocalApi(provider)) {
    const suggestion = CATALOG_HINT_IDS.ollama;
    const suggestionInstalled = offered.some(entry => entry.id === suggestion || entry.id.startsWith(`${suggestion}:`));
    return suggestionInstalled ? '' : first;
  }
  return '';
}

/** Whether a worker on this connection cannot be saved without a model ID: nothing to fall back on. */
export function modelIdRequired(provider: Worker['provider']): boolean {
  return isCustomProvider(provider) || isOpenCodePlan(provider) || provider === 'codepawl';
}
