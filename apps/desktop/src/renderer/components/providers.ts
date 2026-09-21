import { API_PROVIDER_NAMES, type Connections, type ProviderScope } from '../../shared/contracts';
import { harnessReady, isHarness, type HarnessInfo } from '../../shared/harness';
import { t } from '../i18n';

export type Readiness = Record<ProviderScope, boolean>;
const labels: Record<ProviderScope, string> = {
  ...API_PROVIDER_NAMES,
  'claude-code': 'Claude Code trên máy này',
  codex: 'Codex trên máy này',
  cursor: 'Cursor Agent trên máy này',
};
export const providerLabel = (provider: ProviderScope) => t(labels[provider]);

/** API providers need a stored key; local harnesses need a signed-in, runnable install — detected-on-disk is not enough. */
/** `harnesses` is undefined while detection is still running; a harness then counts as ready rather than flashing "not ready". */
export function readiness(connections: Connections, harnesses: HarnessInfo[] | undefined): Readiness {
  const item = (id: 'claude-code' | 'codex' | 'cursor') => harnesses?.find(entry => entry.id === id);
  const ready = (id: 'claude-code' | 'codex' | 'cursor') => harnesses === undefined || harnessReady(item(id) ?? { auth: 'missing', runnable: true });
  return {
    ...connections,
    'claude-code': ready('claude-code'),
    codex: ready('codex'),
    cursor: ready('cursor'),
  };
}

export const setupHint = (provider: ProviderScope, harnesses: HarnessInfo[] = []) => {
  if (!isHarness(provider)) return t('Kết nối {0}', [providerLabel(provider)]);
  const item = harnesses.find(entry => entry.id === provider);
  if (!item || item.status === 'not_installed') return t('Cài và đăng nhập {0}', [providerLabel(provider)]);
  if (item.status === 'auth_error') return t('Sửa đăng nhập {0}', [providerLabel(provider)]);
  return t('Đăng nhập {0}', [providerLabel(provider)]);
};

export const settingsTabFor = (providers: ProviderScope[]) => providers.some(isHarness) ? 'harness' as const : 'connections' as const;
