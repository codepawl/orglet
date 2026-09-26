import type { ComponentProps } from 'react';
import { X } from 'lucide-react';
import { TabbedFormDialog as KitTabbedFormDialog, type DialogTab } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export type { DialogTab };

type KitProps<T extends string> = ComponentProps<typeof KitTabbedFormDialog<T>>;

/**
 * The kit's tabbed editor (COD-274) with the app's labels: tab names are Vietnamese source strings translated here, and
 * the fields sit in the app's `.form` layout.
 */
export function TabbedFormDialog<T extends string>({ tabs, title, ...props }: Omit<KitProps<T>, 'closeLabel' | 'closeIcon' | 'busyLabel' | 'cancelLabel' | 'fieldsClassName'>) {
  return <KitTabbedFormDialog {...props} title={title} tabs={tabs.map(tab => ({ ...tab, label: t(tab.label) }))}
    closeLabel={t('Đóng {0}', [title.toLowerCase()])} closeIcon={<X size={18} />} busyLabel={t('Đang lưu…')} cancelLabel={t('Hủy')} fieldsClassName="form" />;
}
