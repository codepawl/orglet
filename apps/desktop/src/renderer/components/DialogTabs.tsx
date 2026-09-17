import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, PanelHeading, keepOpenForPopup } from './ui';
import { t } from '../i18n';

export type DialogTab<T extends string> = { id: T; label: string; icon: ReactNode };

/** Vertical tab list for settings-style dialogs; arrow keys move and select, matching the WAI-ARIA tabs pattern. */
export function DialogTabs<T extends string>({ label, tabs, value, onChange, panelId }: { label: string; tabs: DialogTab<T>[]; value: T; onChange: (tab: T) => void; panelId: string }) {
  return <nav className="settings-tabs" role="tablist" aria-orientation="vertical" aria-label={label} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === value);
    const next = tabs[(index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id); document.getElementById(`${panelId}-tab-${next.id}`)?.focus();
  }}>
    {tabs.map(item => <button key={item.id} id={`${panelId}-tab-${item.id}`} type="button" role="tab" aria-selected={value === item.id} aria-controls={panelId} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}>{item.icon}<span>{t(item.label)}</span></button>)}
  </nav>;
}

/**
 * Centred editor with the Settings layout: tabs on the left, the current section on the right and Save/Cancel pinned
 * at the bottom so they stay reachable whichever section is open.
 */
export function TabbedFormDialog<T extends string>({ open, onClose, title, tabs, tab, onTab, panelId, onSubmit, submitLabel, busy, actions, description, children }: { open: boolean; onClose: () => void; title: string; tabs: DialogTab<T>[]; tab: T; onTab: (tab: T) => void; panelId: string; onSubmit: () => void; submitLabel: string; busy: boolean; actions?: ReactNode; description?: ReactNode; children: ReactNode }) {
  const current = tabs.find(item => item.id === tab);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className="settings-dialog" aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup}>
        <div className="settings-header"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button size="icon" aria-label={t('Đóng {0}', [title.toLowerCase()])}><X size={18} /></Button></Dialog.Close></div>
        {/* noValidate: fields on hidden tabs are unmounted, so validation happens in onSubmit and switches to the tab at fault. */}
        <form className="dialog-form" noValidate onSubmit={event => { event.preventDefault(); onSubmit(); }}>
          <div className="settings-body">
            <DialogTabs label={title} tabs={tabs} value={tab} onChange={onTab} panelId={panelId} />
            <section className="settings-panel" id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${tab}`}>
              <PanelHeading title={current ? t(current.label) : undefined} description={description}>{actions}</PanelHeading>
              <div className="form">{children}</div>
            </section>
          </div>
          <div className="dialog-footer">
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={busy}>{t('Hủy')}</Button></Dialog.Close>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Đang lưu…') : submitLabel}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
