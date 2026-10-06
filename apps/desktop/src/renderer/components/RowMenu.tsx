// The menu moved into the kit (COD-274); this wrapper keeps the app's defaults (the dots icon, the row-action class, the
// translated "No"), so its callers did not change.
import type { ComponentProps } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { RowMenu as KitRowMenu } from '@codepawlhq/orglet-ui';
import { t } from '../i18n';

export type { RowMenuItem } from '@codepawlhq/orglet-ui';

type KitProps = ComponentProps<typeof KitRowMenu>;

export function RowMenu({ icon = EllipsisVertical, className = 'row-action', cancelLabel, ...props }: Omit<KitProps, 'icon' | 'cancelLabel' | 'className'> & {
  icon?: KitProps['icon'];
  className?: string;
  /** The way back from a confirming item, when a plain "No" would not say what it keeps. */
  cancelLabel?: string;
}) {
  return <KitRowMenu {...props} icon={icon} className={className} cancelLabel={cancelLabel ?? t('Không')} />;
}
