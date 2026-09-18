import * as Dialog from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X, type LucideIcon } from 'lucide-react';
import { displayCurrency, moneySymbol } from './money';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { t } from '../i18n';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const variants = cva('button', { variants: { variant: { primary: 'button-primary', ghost: 'button-ghost', outline: 'button-outline' }, size: { default: '', icon: 'button-icon' } }, defaultVariants: { variant: 'ghost', size: 'default' } });
export function Button({ className, variant, size, asChild, ...props }: ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(variants({ variant, size }), className)} {...props} />;
}
/** Section title on the left with the section's own actions (create, import, export) on the right. */
export function PanelHeading({ title, description, level = 2, children }: { title: ReactNode; description?: ReactNode; level?: 2 | 3; children?: ReactNode }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <div className="panel-heading"><div className="heading-text"><Heading>{title}</Heading>{description && <p className="heading-description">{description}</p>}</div>{children && <div className="panel-heading-actions">{children}</div>}</div>;
}
/** Escape should first close an open dropdown or menu inside a dialog, not the dialog itself. */
export function keepOpenForPopup(event: KeyboardEvent) {
  if (document.activeElement?.closest('[aria-expanded="true"], [data-popup-open]')) event.preventDefault();
}
/** Money entry in the chosen display currency; callers convert to USD micros with toMicros before saving. */
export function MoneyInput({ value, onChange, invalid, flash, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; invalid?: boolean; flash?: number }) {
  return <span className={cn('money-input', invalid && 'invalid')} data-flash={invalid ? flash : undefined}><span aria-hidden="true">{moneySymbol()}</span><input {...props} inputMode="decimal" value={value} aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} /><span className="money-currency" aria-hidden="true">{displayCurrency().code}</span></span>;
}
/** Field title with a small leading icon; the icon is decorative so the accessible name stays the text. */
export function FieldLabel({ icon: Icon, required, children }: { icon: LucideIcon; required?: boolean; children: ReactNode }) {
  // The asterisk is drawn in CSS with empty alternative text, so it never becomes part of the field's accessible name.
  return <span className={cn('field-label', required && 'required')}><Icon size={15} aria-hidden="true" />{children}</span>;
}
export function Drawer({ open, onClose, title, actions, description, children }: { open: boolean; onClose: () => void; title: ReactNode; actions?: ReactNode; description?: ReactNode; children: ReactNode }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="drawer-overlay" />
    <Dialog.Content className="drawer" {...(description ? {} : { 'aria-describedby': undefined })} onEscapeKeyDown={keepOpenForPopup} onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <div className="drawer-header"><div className="heading-text"><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description className="heading-description">{description}</Dialog.Description>}</div>{actions && <div className="drawer-actions">{actions}</div>}<Dialog.Close asChild><Button size="icon" aria-label={t('Đóng panel')}><X size={20} /></Button></Dialog.Close></div>
      <div className="drawer-body">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
