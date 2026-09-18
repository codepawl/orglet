import type { Connections, ProviderScope } from '../../shared/contracts';
import { harnessReady, isHarness, type HarnessInfo } from '../../shared/harness';
import { t } from '../i18n';

export type Readiness = Record<ProviderScope, boolean>;
const labels: Record<ProviderScope, string> = { openai: 'OpenAI', anthropic: 'Anthropic', 'claude-code': 'Claude Code trên máy này', codex: 'Codex trên máy này' };
export const providerLabel = (provider: ProviderScope) => t(labels[provider]);

/** API providers need a stored key; local harnesses need a signed-in, runnable install — detected-on-disk is not enough. */
export function readiness(connections: Connections, harnesses: HarnessInfo[]): Readiness {
  const item = (id: 'claude-code' | 'codex') => harnesses.find(entry => entry.id === id);
  return { ...connections, 'claude-code': harnessReady(item('claude-code') ?? { auth: 'missing', runnable: true }), codex: harnessReady(item('codex') ?? { auth: 'missing', runnable: true }) };
}

export const setupHint = (provider: ProviderScope, harnesses: HarnessInfo[] = []) => {
  if (!isHarness(provider)) return t('Kết nối {0}', [providerLabel(provider)]);
  const item = harnesses.find(entry => entry.id === provider);
  if (!item || item.status === 'not_installed') return t('Cài và đăng nhập {0}', [providerLabel(provider)]);
  if (item.status === 'auth_error') return t('Sửa đăng nhập {0}', [providerLabel(provider)]);
  return t('Đăng nhập {0}', [providerLabel(provider)]);
};

export const settingsTabFor = (providers: ProviderScope[]) => providers.some(isHarness) ? 'harness' as const : 'connections' as const;
