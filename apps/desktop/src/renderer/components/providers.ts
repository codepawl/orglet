import type { Connections, ProviderScope } from '../../shared/contracts';
import { isHarness, type HarnessInfo } from '../../shared/harness';
import { t } from '../i18n';

export type Readiness = Record<ProviderScope, boolean>;
const labels: Record<ProviderScope, string> = { openai: 'OpenAI', anthropic: 'Anthropic', xai: 'Grok (xAI)', 'claude-code': 'Claude Code trên máy này', codex: 'Codex trên máy này' };
export const providerLabel = (provider: ProviderScope) => t(labels[provider]);

/** API providers need a stored key; local harnesses need a detected install that is not known to be logged out. */
export function readiness(connections: Connections, harnesses: HarnessInfo[]): Readiness {
  const harnessReady = (id: 'claude-code' | 'codex') => harnesses.some(item => item.id === id && item.auth !== 'logged_out');
  return { ...connections, 'claude-code': harnessReady('claude-code'), codex: harnessReady('codex') };
}
export const setupHint = (provider: ProviderScope) => isHarness(provider) ? t('Cài và đăng nhập {0}', [providerLabel(provider)]) : t('Kết nối {0}', [providerLabel(provider)]);
