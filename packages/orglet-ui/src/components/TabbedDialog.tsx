import * as RadixDialog from '@radix-ui/react-dialog';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { Button } from './Button';
import { DialogOverlay, keepOpenForPopup } from './Dialog';
import { PanelHeading } from './PanelHeading';
import { cn } from '../cn';
import './TabbedDialog.css';

/** One section of a tabbed dialog. `buttonProps` reach the tab's button, such as a handler that prefetches on hover. */
export type DialogTab<T extends string> = {
  id: T;
  label: string;
  icon?: ReactNode;
  buttonProps?: Omit<ComponentProps<'button'>, 'id' | 'role' | 'type' | 'onClick' | 'tabIndex' | 'children'>;
};

const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];

/**
 * A vertical list of tabs (a row on a narrow window) following the WAI-ARIA tabs pattern: the arrows move to the next
 * tab and open it, and only the open tab is in the Tab order. Each tab is `${panelId}-tab-${id}` and controls `panelId`.
 */
export function DialogTabs<T extends string>({ label, tabs, value, onChange, panelId, className }: {
  label: string;
  tabs: DialogTab<T>[];
  value: T;
  onChange: (tab: T) => void;
  panelId: string;
  className?: string;
}) {
  const moveWithArrows = (event: KeyboardEvent<HTMLElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === value);
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const next = tabs[(index + (forward ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    document.getElementById(`${panelId}-tab-${next.id}`)?.focus();
  };
  return <nav className={cn('org-dialog-tabs', className)} role="tablist" aria-orientation="vertical" aria-label={label} onKeyDown={moveWithArrows}>
    {tabs.map(item => <button key={item.id} {...item.buttonProps} id={`${panelId}-tab-${item.id}`} type="button" role="tab" aria-selected={value === item.id}
      aria-controls={panelId} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}>
      {item.icon}<span>{item.label}</span>
    </button>)}
  </nav>;
}

type TabbedDialogProps<T extends string> = {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  closeIcon: ReactNode;
  /** Names the tab list; the title when left out. */
  tabsLabel?: string;
  tabs: DialogTab<T>[];
  tab: T;
  onTab: (tab: T) => void;
  panelId: string;
  /** Under the open tab's title in the panel. */
  description?: ReactNode;
  /** Right of the open tab's title, such as an Add button. */
  actions?: ReactNode;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
};

/**
 * A centred dialog with the settings layout: the title and a close button on top, the tabs on the left and the open
 * section on the right, headed by its tab's name, scrolling on its own. With `onSubmit` the body and `footer` form one
 * form; without it the dialog is for changes that apply at once.
 */
export function TabbedDialog<T extends string>({
  open, onClose, title, closeLabel, closeIcon, tabsLabel, tabs, tab, onTab, panelId, description, actions, onOpenAutoFocus, onSubmit, footer, children,
}: TabbedDialogProps<T> & { onSubmit?: () => void; footer?: ReactNode }) {
  const current = tabs.find(item => item.id === tab);
  const body = <div className="org-tabbed-dialog-body">
    <DialogTabs label={tabsLabel ?? title} tabs={tabs} value={tab} onChange={onTab} panelId={panelId} />
    <section className="org-tabbed-dialog-panel" id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${tab}`}>
      <PanelHeading title={current?.label} description={description}>{actions}</PanelHeading>
      {children}
    </section>
  </div>;
  const footerRow = footer && <div className="org-tabbed-dialog-footer">{footer}</div>;
  return <RadixDialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content className="org-tabbed-dialog" aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup} onOpenAutoFocus={onOpenAutoFocus}>
        <div className="org-tabbed-dialog-header">
          <RadixDialog.Title>{title}</RadixDialog.Title>
          <RadixDialog.Close asChild><Button size="icon" aria-label={closeLabel}>{closeIcon}</Button></RadixDialog.Close>
        </div>
        {onSubmit
          // noValidate: fields on hidden tabs are unmounted, so validation belongs to onSubmit, which can open the tab at fault.
          ? <form className="org-tabbed-dialog-form" noValidate onSubmit={event => { event.preventDefault(); onSubmit(); }}>{body}{footerRow}</form>
          : <>{body}{footerRow}</>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

/**
 * A tabbed editor: `TabbedDialog` with Cancel and Save pinned at the bottom, reachable from every tab, and `error`
 * beside them. `focusField` names the `data-field` to focus when it opens, scrolled into view, instead of the first
 * control, so a link that names one field lands on it. `fieldsClassName` styles the box the fields sit in.
 */
export function TabbedFormDialog<T extends string>({ onSubmit, submitLabel, busyLabel, cancelLabel, busy, error, focusField, fieldsClassName, children, ...dialog }:
  Omit<TabbedDialogProps<T>, 'onOpenAutoFocus'> & {
    onSubmit: () => void;
    submitLabel: string;
    busyLabel: string;
    cancelLabel: string;
    busy: boolean;
    error?: string;
    focusField?: string;
    fieldsClassName?: string;
  }) {
  const focusNamedField = (event: Event) => {
    const field = focusField ? document.querySelector<HTMLElement>(`#${dialog.panelId} [data-field="${focusField}"]`) : null;
    if (!field) return;
    event.preventDefault();
    field.scrollIntoView({ block: 'center' });
    // Opened from a pointer click, the field would take focus without its ring, and the ring shows where the dialog landed.
    field.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  };
  const footer = <>
    {error ? <p className="org-tabbed-dialog-error" role="alert">{error}</p> : <span className="org-tabbed-dialog-footer-spacer" />}
    <RadixDialog.Close asChild><Button type="button" variant="outline" disabled={busy}>{cancelLabel}</Button></RadixDialog.Close>
    <Button type="submit" variant="primary" disabled={busy}>{busy ? busyLabel : submitLabel}</Button>
  </>;
  return <TabbedDialog {...dialog} onOpenAutoFocus={focusNamedField} onSubmit={onSubmit} footer={footer}>
    <div className={fieldsClassName}>{children}</div>
  </TabbedDialog>;
}
