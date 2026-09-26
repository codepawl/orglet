import * as Dialog from '@radix-ui/react-dialog';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';
import { displayCurrency, moneySymbol } from './money';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { Button, MoneyInput as KitMoneyInput } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
// Moved into the kit (COD-274); re-exported so the app's many `./ui` imports need no change.
export { Button } from '@codepawl/orglet-ui';
export { FieldLabel, PanelHeading } from '@codepawl/orglet-ui';
/**
 * What Escape closes before the dialog around it: an open menu, list or picker panel. A disclosure that only shows
 * more of the form (the avatar's Customize) is not one; counting it left Escape doing nothing at all.
 */
export const OPEN_POPUP_SELECTOR = '[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"], [data-popup-open]';
/** Escape should first close an open dropdown or menu inside a dialog, not the dialog itself. */
export function keepOpenForPopup(event: KeyboardEvent) {
  if (document.activeElement?.closest(OPEN_POPUP_SELECTOR)) event.preventDefault();
}
/** Money entry in the chosen display currency, or explicit USD for provider bill reconciliation (the kit's input, COD-274). */
export function MoneyInput({ currencyCode, ...props }: Omit<ComponentProps<typeof KitMoneyInput>, 'symbol' | 'code'> & { currencyCode?: 'USD' }) {
  return <KitMoneyInput {...props} symbol={currencyCode === 'USD' ? '$' : moneySymbol()} code={currencyCode ?? displayCurrency().code} />;
}
export function Drawer({ open, onClose, title, actions, description, children }: { open: boolean; onClose: () => void; title: ReactNode; actions?: ReactNode; description?: ReactNode; children: ReactNode }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="drawer-overlay" />
    <Dialog.Content className="drawer" {...(description ? {} : { 'aria-describedby': undefined })} onEscapeKeyDown={keepOpenForPopup} onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <div className="drawer-header"><div className="heading-text"><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description className="heading-description">{description}</Dialog.Description>}</div>{actions && <div className="drawer-actions">{actions}</div>}<Dialog.Close asChild><Button size="icon" aria-label={t('Đóng panel')}><X size={20} /></Button></Dialog.Close></div>
      {/* The clip and the scroll are two elements on purpose: a rounded box does not clip its own scrollbar, and
          the dialog itself cannot clip, because Select portals its menu into it and the menu may extend past it. */}
      <div className="drawer-body"><div className="drawer-scroll">{children}</div></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
