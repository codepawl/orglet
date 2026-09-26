import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { DialogOverlay, keepOpenForPopup } from './Dialog';
import { cn } from '../cn';
import './Viewer.css';

/**
 * A large dialog for looking at one thing, a document, a file or a diff, modelled on macOS Quick Look: a slim toolbar
 * with close on the left, the `icon` and `title` centred (with a `meta` line under them when given) and the `actions`
 * on the right, above the content on a grey backdrop that scrolls on its own.
 */
export function Viewer({ open, onClose, title, icon, meta, actions, closeLabel, closeIcon, id, className, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
  closeIcon: ReactNode;
  id?: string;
  /** Classes for the dialog, such as one that makes it wider. */
  className?: string;
  children: ReactNode;
}) {
  const heading = <RadixDialog.Title className="org-viewer-title">{icon}<span>{title}</span></RadixDialog.Title>;
  return <RadixDialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content id={id} className={cn('org-viewer', className)} aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup}>
        <div className="org-viewer-toolbar">
          <RadixDialog.Close asChild><Button size="icon" aria-label={closeLabel} title={closeLabel}>{closeIcon}</Button></RadixDialog.Close>
          {meta === undefined ? heading : <div className="org-viewer-heading">{heading}<span className="org-viewer-meta">{meta}</span></div>}
          <div className="org-viewer-actions">{actions}</div>
        </div>
        <div className="org-viewer-scroll">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}
