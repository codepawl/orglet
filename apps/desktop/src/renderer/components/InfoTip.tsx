// The popover moved into the kit (COD-274); this wrapper gives it the app's icon and words, so its callers did not change.
import { InfoTip as KitInfoTip, type InfoTipRow } from '@codepawlhq/orglet-ui';
import { Info } from './icons';
import { t } from '../i18n';

export type { InfoTipRow } from '@codepawlhq/orglet-ui';

export function InfoTip({ label, rows }: { label: string; rows: InfoTipRow[] }) {
  return <KitInfoTip label={label} rows={rows} icon={<Info size={16} />} copyLabel={rowLabel => t('Sao chép {0}', [rowLabel])} />;
}
