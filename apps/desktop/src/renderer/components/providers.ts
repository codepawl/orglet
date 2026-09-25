import { API_PROVIDER_NAMES, type Connections, type ProviderScope } from '../../shared/contracts';
import { harnessReady, isHarness, type HarnessId, type HarnessInfo } from '../../shared/harness';
import { customProviderId, type CustomConnection } from '../../shared/custom-connections';
import { t } from '../i18n';
import { customConnectionName } from '../customConnections';

export type Readiness = Record<ProviderScope, boolean>;
const labels: Partial<Record<ProviderScope, string>> = {
  ...API_PROVIDER_NAMES,
  'claude-code': 'Claude Code trên máy này',
  codex: 'Codex trên máy này',
  cursor: 'Cursor Agent trên máy này',
  gemini: 'Gemini CLI trên máy này',
};
export const providerLabel = (provider: ProviderScope) => customConnectionName(provider) ?? t(labels[provider] ?? provider);

/**
 * API providers need a stored key; local harnesses need a signed-in, runnable install — detected-on-disk is not enough.
 * A custom connection is ready once it exists: its key is optional, since a local server usually takes none.
 * `harnesses` is undefined while detection is still running; a harness then counts as ready rather than flashing "not ready".
 */
export function readiness(connections: Connections, harnesses: HarnessInfo[] | undefined, customConnections: readonly CustomConnection[] = []): Readiness {
  const item = (id: HarnessId) => harnesses?.find(entry => entry.id === id);
  const ready = (id: HarnessId) => harnesses === undefined || harnessReady(item(id) ?? { auth: 'missing', runnable: true });
  const { custom: _customKeys, ...builtIn } = connections;
  const custom = Object.fromEntries(customConnections.map(connection => [customProviderId(connection.id), true]));
  return {
    ...builtIn,
    ...custom,
    'claude-code': ready('claude-code'),
    codex: ready('codex'),
    cursor: ready('cursor'),
    gemini: ready('gemini'),
  };
}

/** Whether anything can run a model yet: a saved key, a local Ollama, or a custom connection (key or not). */
export function hasConnection(connections: Connections, customConnections: readonly CustomConnection[] = []): boolean {
  const { custom: _customKeys, ...builtIn } = connections;
  return Object.values(builtIn).some(Boolean) || customConnections.length > 0;
}

/** A row of the provider menu with whether it can run right now. */
export type ProviderChoice<Option> = { option: Option; ready: boolean };

/**
 * Puts what can run right now first (COD-255). Ready rows keep their order and their own group; the rest follow under
 * one `notReadyGroup`, so a signed-in harness is no longer listed under seven API rows that have no key. Demo is
 * always ready, so it stays at the top.
 */
export function readyFirst<Option extends { group?: string }>(choices: ProviderChoice<Option>[], notReadyGroup: string): Option[] {
  const ready = choices.filter(choice => choice.ready).map(choice => choice.option);
  const notReady = choices.filter(choice => !choice.ready).map(choice => ({ ...choice.option, group: notReadyGroup }));
  return [...ready, ...notReady];
}

export const setupHint =(provider: ProviderScope, harnesses: HarnessInfo[] = []) => {
  if (!isHarness(provider)) return t('Kết nối {0}', [providerLabel(provider)]);
  const item = harnesses.find(entry => entry.id === provider);
  if (!item || item.status === 'not_installed') return t('Cài và đăng nhập {0}', [providerLabel(provider)]);
  if (item.status === 'auth_error') return t('Sửa đăng nhập {0}', [providerLabel(provider)]);
  return t('Đăng nhập {0}', [providerLabel(provider)]);
};

export const settingsTabFor = (providers: ProviderScope[]) => providers.some(isHarness) ? 'harness' as const : 'connections' as const;
