import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '../cn';
import './Dialog.css';

/**
 * What Escape closes before the dialog around it: an open menu, list or picker panel. A disclosure that only shows more
 * of the form is not one; counting it would leave Escape doing nothing at all.
 */
export const OPEN_POPUP_SELECTOR = '[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"], [data-popup-open]';

/** For a dialog's `onEscapeKeyDown`: Escape closes an open dropdown or menu inside the dialog first, not the dialog. */
export function keepOpenForPopup(event: KeyboardEvent) {
  if (document.activeElement?.closest(OPEN_POPUP_SELECTOR)) event.preventDefault();
}

/**
 * Gives focus back to what opened a dialog when it closes. Radix only returns focus to a `Dialog.Trigger`, and the kit's
 * dialogs open from state with no trigger, so focus used to fall to the page. Spread the result on `Dialog.Content`;
 * `onOpenAutoFocus` is the caller's own handler, run after the opener is remembered.
 *
 * Focus goes back only when it would otherwise be lost: on the page, or still inside the dialog that closed. An action
 * in the dialog that closes it and deliberately focuses something else, such as a link to one checker in a report,
 * keeps that focus.
 */
export function useReturnFocus(onOpenAutoFocus?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<Element | null>(null);
  const rememberOpener = (event: Event) => {
    opener.current = document.activeElement as HTMLElement | null;
    dialog.current = event.target instanceof Element ? event.target : null;
    onOpenAutoFocus?.(event);
  };
  const focusOpener = (event: Event) => {
    event.preventDefault();
    const focused = document.activeElement;
    const focusLost = !focused || focused === document.body || Boolean(dialog.current?.contains(focused));
    if (focusLost && opener.current?.isConnected) opener.current.focus();
  };
  return { onOpenAutoFocus: rememberOpener, onCloseAutoFocus: focusOpener };
}

/**
 * The frosted backdrop behind every dialog: the page stays visible but out of focus. Use it inside a Radix
 * `Dialog.Portal`, as the kit's own dialogs do.
 */
export function DialogOverlay({ className }: { className?: string }) {
  return <RadixDialog.Overlay className={cn('org-dialog-overlay', className)} />;
}

/**
 * A centred panel for an editor or a list: a header with the title (a breadcrumb works too), an optional description
 * under it, the panel's own `actions` and a close button, then a body that scrolls on its own. Focus goes back to
 * what opened it when it closes, and Escape closes an open menu inside it before the panel.
 */
export function Drawer({ open, onClose, title, description, actions, closeLabel, closeIcon, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Shown left of the close button. */
  actions?: ReactNode;
  closeLabel: string;
  closeIcon: ReactNode;
  children: ReactNode;
}) {
  const returnFocus = useReturnFocus();
  const describedBy = description ? {} : { 'aria-describedby': undefined };
  return <RadixDialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content className="org-drawer" {...describedBy} onEscapeKeyDown={keepOpenForPopup} {...returnFocus}>
        <div className="org-drawer-header">
          <div className="org-drawer-heading">
            <RadixDialog.Title className="org-drawer-title">{title}</RadixDialog.Title>
            {description && <RadixDialog.Description className="org-drawer-description">{description}</RadixDialog.Description>}
          </div>
          {actions && <div className="org-drawer-actions">{actions}</div>}
          <RadixDialog.Close asChild><Button size="icon" aria-label={closeLabel}>{closeIcon}</Button></RadixDialog.Close>
        </div>
        {/* The clip and the scroll are two elements on purpose: a rounded box does not clip its own scrollbar, and the
            panel itself cannot clip, because menus portal into it and may extend past it. */}
        <div className="org-drawer-body"><div className="org-drawer-scroll">{children}</div></div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

type ConfirmRequest = { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; resolve: (confirmed: boolean) => void };

let currentRequest: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Asks one yes-or-no question in a small modal and resolves true only when the person confirms. A second question
 * while one is open answers the first with false. Render one `Confirmer` in the application for it to show.
 */
export function confirmAction({ title, description, confirmLabel, cancelLabel }: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string }) {
  currentRequest?.resolve(false);
  return new Promise<boolean>(resolve => {
    currentRequest = { title, description, confirmLabel, cancelLabel, resolve };
    emit();
  });
}

function settle(confirmed: boolean) {
  const request = currentRequest;
  currentRequest = null;
  emit();
  request?.resolve(confirmed);
}

/** Shows the question `confirmAction` asks, with these labels when the question brings none of its own. */
export function Confirmer({ confirmLabel, cancelLabel }: { confirmLabel: string; cancelLabel: string }) {
  const request = useSyncExternalStore(subscribe, () => currentRequest);
  const describedBy = request?.description ? 'org-confirm-description' : undefined;
  const cancel = useRef<HTMLButtonElement>(null);
  // The safe answer takes focus. It is placed here rather than with `autoFocus`, which would move focus before the
  // dialog could remember the button that asked.
  const focusCancel = (event: Event) => {
    event.preventDefault();
    cancel.current?.focus();
  };
  const returnFocus = useReturnFocus(focusCancel);
  return <RadixDialog.Root open={request !== null} onOpenChange={open => { if (!open) settle(false); }}>
    <RadixDialog.Portal>
      <DialogOverlay className="org-confirm-overlay" />
      <RadixDialog.Content className="org-confirm-dialog" role="alertdialog" aria-describedby={describedBy} {...returnFocus}>
        <RadixDialog.Title className="org-confirm-title">{request?.title}</RadixDialog.Title>
        {request?.description && <RadixDialog.Description id="org-confirm-description" className="org-confirm-description">{request.description}</RadixDialog.Description>}
        <div className="org-confirm-actions">
          <Button ref={cancel} variant="outline" onClick={() => settle(false)}>{request?.cancelLabel ?? cancelLabel}</Button>
          <Button variant="primary" onClick={() => settle(true)}>{request?.confirmLabel ?? confirmLabel}</Button>
        </div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}
