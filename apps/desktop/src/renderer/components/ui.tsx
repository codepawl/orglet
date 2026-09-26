import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';
import { displayCurrency, moneySymbol } from './money';
import type { ComponentProps } from 'react';
import { Drawer as KitDrawer, MoneyInput as KitMoneyInput } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
// Moved into the kit (COD-274); re-exported so the app's many `./ui` imports need no change.
export { Button } from '@codepawl/orglet-ui';
export { FieldLabel, PanelHeading } from '@codepawl/orglet-ui';
// Moved into the kit with the dialogs (COD-274).
export { OPEN_POPUP_SELECTOR, keepOpenForPopup } from '@codepawl/orglet-ui';
/** Money entry in the chosen display currency, or explicit USD for provider bill reconciliation (the kit's input, COD-274). */
export function MoneyInput({ currencyCode, ...props }: Omit<ComponentProps<typeof KitMoneyInput>, 'symbol' | 'code'> & { currencyCode?: 'USD' }) {
  return <KitMoneyInput {...props} symbol={currencyCode === 'USD' ? '$' : moneySymbol()} code={currencyCode ?? displayCurrency().code} />;
}
/** The kit's centred panel with the app's close label and icon (COD-274). */
export function Drawer(props: Omit<ComponentProps<typeof KitDrawer>, 'closeLabel' | 'closeIcon'>) {
  return <KitDrawer {...props} closeLabel={t('Đóng panel')} closeIcon={<X size={20} />} />;
}
