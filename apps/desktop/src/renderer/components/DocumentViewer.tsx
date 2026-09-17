import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { FileText, X } from 'lucide-react';
import { Button, keepOpenForPopup } from './ui';
import { t } from '../i18n';

/**
 * Orglet document attachment and viewer, modelled on macOS Quick Look / Preview (user decision 2026-09-17): in a chat a
 * document is a quiet file card; opening it shows a slim toolbar (close left, name centred, actions right) above a white
 * page on a grey backdrop, in plain monochrome type.
 */
export function DocumentCard({ name, meta, onOpen }: { name: string; meta: string; onOpen: () => void }) {
  return <button type="button" className="report report-file" aria-haspopup="dialog" onClick={onOpen}>
    <span className="file-icon" aria-hidden="true"><FileText size={22} strokeWidth={1.6} /></span>
    <span className="file-text"><strong className="file-name">{name}</strong><span className="file-meta">{meta}</span></span>
  </button>;
}

export function DocumentViewer({ open, onClose, name, actions, children }: { open: boolean; onClose: () => void; name: string; actions?: ReactNode; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className="doc-viewer" aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup}>
        <div className="doc-toolbar">
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng tài liệu')} title={t('Đóng tài liệu')}><X size={18} /></Button></Dialog.Close>
          <Dialog.Title className="doc-title"><FileText size={15} aria-hidden="true" /><span>{name}</span></Dialog.Title>
          <div className="doc-actions">{actions}</div>
        </div>
        <div className="doc-scroll"><article className="doc-page">{children}</article></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
