import { connectionPricing, findCustomConnection, isCustomProvider, type CustomConnection } from '../shared/custom-connections';
import type { ModelListResult } from '../shared/models';
import { t, tMessage } from './i18n';
import { formatMoney } from './components/money';

/**
 * The custom connections of the workspace on screen, so a label, a mark or a byline can name a `custom:<id>` provider
 * without every caller passing the workspace down. `App` refreshes it from each workspace it renders; it holds names
 * and addresses only, which the core already sends to the window.
 */
let known: readonly CustomConnection[] = [];

export function rememberCustomConnections(connections: readonly CustomConnection[] | undefined) {
  known = connections ?? [];
}

export function knownCustomConnections(): readonly CustomConnection[] {
  return known;
}

/** The person's name for the connection, or a plain word once it has been deleted (an old chat's byline keeps working). */
export function customConnectionName(provider: string): string | undefined {
  if (!isCustomProvider(provider)) return undefined;
  return findCustomConnection(known, provider)?.name ?? t('Kết nối đã xóa');
}

/**
 * One quiet phrase for what a connection's requests cost: free because it is local, the price entered, or unknown.
 * Short enough for a row's meta line ("$0.40 / $1.60 per 1M"); `full` spells out input and output for a tooltip.
 */
export function pricingLabel(connection: Pick<CustomConnection, 'baseUrl' | 'price'>, full = false): string {
  const pricing = connectionPricing(connection);
  if (pricing.kind === 'local') return t('Trên máy · miễn phí');
  if (pricing.kind === 'unknown') return t('Chưa rõ giá');
  const input = formatMoney(pricing.price.inputMicrosPerMillion);
  const output = formatMoney(pricing.price.outputMicrosPerMillion);
  if (full) return t('{0} vào · {1} ra mỗi 1M token', [input, output]);
  return t('{0} / {1} mỗi 1M', [input, output]);
}

/**
 * What testing a custom connection found (COD-292): the test asks its server for its model list again, so an answer
 * means the address and key work and says how many models it offers, and a failure carries the server's own reason.
 */
export function connectionTestOutcome(name: string, result: Pick<ModelListResult, 'models' | 'error'>): { ok: boolean; text: string } {
  if (result.error) return { ok: false, text: t('{0} không trả lời: {1}', [name, tMessage(result.error)]) };
  const count = result.models.length;
  if (count === 0) return { ok: true, text: t('{0} đã trả lời nhưng chưa có model nào.', [name]) };
  if (count === 1) return { ok: true, text: t('{0} đã trả lời · 1 model', [name]) };
  return { ok: true, text: t('{0} đã trả lời · {1} model', [name, count]) };
}
