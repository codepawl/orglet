import { useEffect, type ReactNode } from 'react';
import { ChatHeader } from './ChatViews';

/**
 * Library and Schedules in the main panel. They are places of the app, reached from the area rail, so they take
 * the main column like Friends and Activity do and leave the rail and the sidebar in reach; a dialog over the app
 * read as a setting. There is no close button (user, 2026-10-04): a close button belongs to a dialog in the middle of
 * the screen, and a page is left by going somewhere else, or with Escape unless a dialog or a menu is open above it.
 */
export function PanelPage({ pageKey, icon, title, description, actions, onClose, children }: {
  /** What is on the page, so the header measures itself again when it changes. */
  pageKey: string;
  icon: ReactNode;
  title: ReactNode;
  description?: string;
  /** The page's own buttons, at the end of the header. */
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
      actions={actions ?? null} />
    <div className="page-scroll"><div className="page-body panel-page">
      {description && <p className="muted panel-page-description">{description}</p>}
      {children}
    </div></div>
  </>;
}
