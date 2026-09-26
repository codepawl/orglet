// The menu moved into the kit (COD-274); this wrapper keeps the app's defaults (the dots icon, the row-action class, the
// translated "No"), so its callers did not change.
import type { ComponentProps } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { RowMenu as KitRowMenu } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export type { RowMenuItem } from '@codepawl/orglet-ui';

type KitProps = ComponentProps<typeof KitRowMenu>;

export function RowMenu({ icon = EllipsisVertical, className = 'row-action', ...props }: Omit<KitProps, 'icon' | 'cancelLabel' | 'className'> & {
  icon?: KitProps['icon'];
  className?: string;
}) {
  return <KitRowMenu {...props} icon={icon} className={className} cancelLabel={t('Không')} />;
}
