import { Viewer } from '@codepawl/orglet-ui';
import type { ReactNode } from 'react';
import { FileText, X } from 'lucide-react';
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
  return <Viewer open={open} onClose={onClose} title={name} icon={<FileText size={15} aria-hidden="true" />} actions={actions}
    closeLabel={t('Đóng tài liệu')} closeIcon={<X size={18} />}>
    <article className="doc-page">{children}</article>
  </Viewer>;
}
