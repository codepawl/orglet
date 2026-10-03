import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import { Button } from './ui';
import { ChatHeader } from './ChatViews';

/**
 * Library and Schedules in the main panel. They are places of the app, reached from the area rail, so they take
 * the main column like Friends and Activity do and leave the rail and the sidebar in reach; a dialog over the app
 * read as a setting. The header carries the page's own actions and a way back to the chat, which Escape takes too
 * unless a dialog or a menu is open above the page.
 */
export function PanelPage({ pageKey, icon, title, description, actions, onClose, children }: {
  /** What is on the page, so the header measures itself again when it changes. */
  pageKey: string;
  icon: ReactNode;
  title: ReactNode;
  description?: string;
  /** Shown left of the close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-popup-open]')) return;
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <>
    <ChatHeader contentKey={pageKey} views={null}
      lead={<span className="topbar-title">{icon}<span className="topbar-name">{title}</span></span>}
      actions={<>{actions}<Button size="icon" aria-label={t('Đóng panel')} title={t('Đóng panel')} onClick={onClose}><X size={18} /></Button></>} />
    <div className="page-scroll"><div className="page-body panel-page">
      {description && <p className="muted panel-page-description">{description}</p>}
      {children}
    </div></div>
  </>;
}
