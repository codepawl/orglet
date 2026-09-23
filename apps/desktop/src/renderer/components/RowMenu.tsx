import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical, X, type LucideIcon } from 'lucide-react';
import { Button } from './ui';
import { t } from '../i18n';

/** `confirm` asks inside the same popover before running a destructive item; `danger` colours it. */
export type RowMenuItem = { label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean; confirm?: { question: string; label: string } };

/**
 * Vertical-dots menu. The panel is portaled to `document.body` so sidebar overflow and row `transform`
 * (reorder) cannot clip it to an empty sliver. It closes on selection, outside click, Escape or focus leaving.
 * A menu whose only item asks first (a lone Delete) opens straight on its question, so the trigger reads as that
 * action with its confirmation, not as a menu of one.
 */
export function RowMenu({ label, items, icon: Icon = EllipsisVertical, className = 'row-action', align = 'end' }: { label: string; items: RowMenuItem[]; icon?: LucideIcon; className?: string; align?: 'start' | 'end' }) {
  const [position, setPosition] = useState<CSSProperties>();
  const [asking, setAsking] = useState<RowMenuItem>();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = Boolean(position);
  const close = (restoreFocus = false) => { setPosition(undefined); setAsking(undefined); if (restoreFocus) trigger.current?.focus(); };
  const inside = (node: Node | null) => Boolean(node && (root.current?.contains(node) || panel.current?.contains(node)));
  useEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(); }, [open, asking]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!inside(event.target as Node)) close(); };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); };
  }, [open]);
  // Inside a modal dialog the panel goes into the dialog, like Select's menu: a modal turns pointer events off for
  // everything outside itself, so a panel in the body would show but never take a click. A dialog is transformed,
  // which makes it the containing block, so the panel is placed relative to it.
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;
  const toggle = () => {
    if (open) { close(); return; }
    const rect = trigger.current!.getBoundingClientRect();
    const host = container();
    const bounds = host === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : host.getBoundingClientRect();
    const height = (items.length + 1) * 40 + 12;
    const below = rect.bottom + 4 + height < bounds.bottom;
    const width = 240;
    const left = align === 'start' ? Math.min(rect.left, bounds.right - width - 8) : Math.max(bounds.left + 8, rect.right - width);
    const top = below ? rect.bottom + 4 : Math.max(bounds.top + 8, rect.top - 4 - height);
    setPosition({ position: host === document.body ? 'fixed' : 'absolute', left: left - bounds.left, top: top - bounds.top });
    if (items.length === 1 && items[0].confirm) setAsking(items[0]);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (asking) setAsking(undefined); else close(true); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const entries = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const index = entries.indexOf(document.activeElement as HTMLButtonElement);
      entries[(index + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]?.focus();
    }
  };
  const menu = open && createPortal(
    <div ref={panel} className="row-menu-popover" role="menu" aria-label={label} data-popup-open style={position}
      onBlur={event => { if (open && !inside(event.relatedTarget as Node | null)) close(); }} onKeyDown={onMenuKey}>
      {asking ? <>
        <p className="row-menu-question">{asking.confirm!.question}</p>
        <button type="button" role="menuitem" className="danger" onClick={() => { const item = asking; close(true); item.onSelect(); }}><asking.icon size={16} aria-hidden="true" /><span>{asking.confirm!.label}</span></button>
        <button type="button" role="menuitem" onClick={() => setAsking(undefined)}><X size={16} aria-hidden="true" /><span>{t('Không')}</span></button>
      </> : items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : undefined} onClick={() => { if (item.confirm) { setAsking(item); return; } close(true); item.onSelect(); }}><item.icon size={16} aria-hidden="true" /><span>{item.label}</span></button>)}
    </div>,
    container(),
  );
  return <div ref={root} className="row-menu" onBlur={event => { if (open && !inside(event.relatedTarget as Node | null)) close(); }} onKeyDown={event => { if (open) onMenuKey(event); }}>
    <Button ref={trigger} size="icon" className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Icon size={16} /></Button>
    {menu}
  </div>;
}
