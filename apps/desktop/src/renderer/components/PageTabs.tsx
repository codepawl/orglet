import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { currentLocale } from '../i18n';

export type PageTab<Id extends string> = { id: Id; label: string; count?: number; icon?: ReactNode };

/**
 * The tabs on a page's header (COD-366): the Friends page's All, Working and Add friend, Activity's four views. The
 * same quiet text buttons as a chat's views: the chosen one on the sidebar's active tint, one Tab stop, arrows, Home
 * and End move between them. Never a track, never a line.
 */
export function PageTabs<Id extends string>({ tabs, current, onSelect, label }: { tabs: readonly PageTab<Id>[]; current: Id; onSelect: (id: Id) => void; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent) => {
    const index = tabs.findIndex(tab => tab.id === current);
    const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1 : undefined;
    if (target === undefined) return;
    event.preventDefault();
    onSelect(tabs[target].id);
    list.current?.querySelectorAll<HTMLElement>('[role=tab]')[target]?.focus();
  };
  return <div ref={list} className="chat-views page-tabs" role="tablist" aria-label={label} onKeyDown={move}>
    {tabs.map(tab => <button key={tab.id} type="button" role="tab" className="chat-view-tab" aria-selected={tab.id === current} tabIndex={tab.id === current ? 0 : -1}
      aria-label={tab.count === undefined ? tab.label : `${tab.label} (${tab.count})`} onClick={() => onSelect(tab.id)}>
      {tab.icon}<span>{tab.label}</span>
      {tab.count !== undefined && <span className="chat-view-count" aria-hidden="true">{tab.count.toLocaleString(currentLocale())}</span>}
    </button>)}
  </div>;
}
