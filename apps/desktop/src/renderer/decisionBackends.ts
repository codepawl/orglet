import { CODEX_DECISION_CONNECTION } from '../shared/decisions';
import { providerLabel } from './components/providers';
import { t } from './i18n';
import type { ProviderScope } from '../shared/contracts';

/** How a backend of the decision model's list is named on screen: the Codex CLI by the account it runs on, any other by its connection. */
export function decisionBackendName(connection: string): string {
  if (connection === CODEX_DECISION_CONNECTION) return t('ChatGPT (Codex)');
  return providerLabel(connection as ProviderScope);
}
