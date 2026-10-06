import { useEffect, type ReactNode } from 'react';

/**
 * Activity, Library and Schedules in the main panel. They are places of the app, reached from the area rail, so they
 * take the main column and leave the rail and the sidebar in reach; a dialog over the app read as a setting.
 *
 * The three share this one frame (user, 2026-10-06), so going from one to the next changes what is listed and
 * nothing about where it sits: a centred column, the page's one line of description with its buttons beside it, then
 * the list. There is no title row and no tabs across the top: the sidebar beside the page already names the page and
 * lists its parts, and saying both twice only pushed the list down.
 *
 * There is no close button (user, 2026-10-04): a page is left by going somewhere else, or with Escape unless a dialog
 * or a menu is open above it.
 */
export function PanelPage({ description, actions, onClose, className = '', children }: {
  description?: string;
  /** The page's own buttons, at the end of the description's line. */
  actions?: ReactNode;
  /** Escape leaves the page; a page that is an area of its own passes nothing and stays. */
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-popup-open]')) return;
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="page-scroll"><div className={`page-body panel-page ${className}`}>
    {(description || actions) && <div className="page-lead">
      {description && <p className="muted panel-page-description">{description}</p>}
      {actions && <div className="page-lead-actions">{actions}</div>}
    </div>}
    {children}
  </div></div>;
}
