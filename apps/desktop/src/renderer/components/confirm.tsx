import * as Dialog from '@radix-ui/react-dialog';
import { useSyncExternalStore } from 'react';
import { Button } from './ui';
import { t } from '../i18n';

type Request = { title: string; description?: string; confirmLabel: string; cancelLabel: string; resolve: (ok: boolean) => void };
let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** Asks one yes/no question in a small modal; resolves true only when the user confirms. */
export function confirmAction({ title, description, confirmLabel = t('Đồng ý'), cancelLabel = t('Hủy') }: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string }) {
  current?.resolve(false);
  return new Promise<boolean>(resolve => { current = { title, description, confirmLabel, cancelLabel, resolve }; emit(); });
}

const settle = (ok: boolean) => { const request = current; current = null; emit(); request?.resolve(ok); };

export function Confirmer() {
  const request = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
  return <Dialog.Root open={request !== null} onOpenChange={open => { if (!open) settle(false); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay confirm-overlay" />
      <Dialog.Content className="confirm-dialog" role="alertdialog" aria-describedby={request?.description ? 'confirm-description' : undefined}>
        <Dialog.Title>{request?.title}</Dialog.Title>
        {request?.description && <Dialog.Description id="confirm-description" className="muted">{request.description}</Dialog.Description>}
        <div className="confirm-actions">
          <Button variant="outline" autoFocus onClick={() => settle(false)}>{request?.cancelLabel}</Button>
          <Button variant="primary" onClick={() => settle(true)}>{request?.confirmLabel}</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
