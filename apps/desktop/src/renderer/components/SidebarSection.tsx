import { useState, type ReactNode } from 'react';
import { ChevronDown } from './icons';

const storageKey = (id: string) => `orglet.sidebar.${id}.collapsed`;
function readCollapsed(id: string) {
  try { return localStorage.getItem(storageKey(id)) === '1'; } catch { return false; }
}

/** Sidebar group whose title toggles its items; the collapsed choice is a per-machine convenience. */
export function SidebarSection({ id, title, action, as: Tag = 'div', label, className = '', children }: { id: string; title: string; action?: ReactNode; as?: 'div' | 'nav'; label?: string; className?: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const toggle = () => setCollapsed(value => {
    try { localStorage.setItem(storageKey(id), value ? '0' : '1'); } catch { /* storage unavailable: keep in memory only */ }
    return !value;
  });
  return <Tag className={`sidebar-section ${className}`} aria-label={label}>
    <div className="section-heading">
      <button type="button" className="section-toggle" aria-expanded={!collapsed} aria-controls={`sidebar-${id}`} onClick={toggle}>
        <span>{title}</span><ChevronDown size={14} className="section-chevron" aria-hidden="true" />
      </button>
      {action}
    </div>
    <div id={`sidebar-${id}`} className="section-items" hidden={collapsed}>{children}</div>
  </Tag>;
}
