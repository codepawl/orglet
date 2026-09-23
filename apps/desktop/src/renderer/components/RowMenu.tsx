import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical, X, type LucideIcon } from 'lucide-react';
import { Button } from './ui';
import { t } from '../i18n';

/** `confirm` asks inside the same popover before running a destructive item; `danger` colours it. */
export type RowMenuItem = { label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean; confirm?: { question: string; label: string } };

/** What the panel opens beside: the trigger's box, or a zero-size box at the pointer for a right-click. */
type MenuAnchor = { rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>; side: 'start' | 'end' };

const GAP = 4;
const EDGE = 8;
const hiddenForMeasuring: CSSProperties = { position: 'fixed', left: 0, top: 0, visibility: 'hidden' };

/**
 * Where the panel goes, from its measured size: under the anchor, or above it when there is no room below, lined up
 * with the anchor's start or end edge and kept inside the host (the window, or the dialog it lives in).
 */
function placePanel(anchor: MenuAnchor, panel: HTMLElement, host: HTMLElement): CSSProperties {
  const bounds = host === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : host.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const { rect, side } = anchor;
  const fitsBelow = rect.bottom + GAP + height <= bounds.bottom - EDGE;
  const top = fitsBelow ? rect.bottom + GAP : Math.max(bounds.top + EDGE, rect.top - GAP - height);
  const preferredLeft = side === 'start' ? rect.left : rect.right - width;
  const left = Math.min(Math.max(bounds.left + EDGE, preferredLeft), bounds.right - width - EDGE);
  return { position: host === document.body ? 'fixed' : 'absolute', left: left - bounds.left, top: top - bounds.top };
}

/**
 * Vertical-dots menu. The panel is portaled to `document.body` so sidebar overflow and row `transform`
 * (reorder) cannot clip it to an empty sliver. It closes on selection, outside click, Escape or focus leaving.
 * With `asksOnOpen`, a menu of one item that asks first (a lone Delete) opens straight on its question, so the
 * trigger reads as that action with its confirmation, not as a menu of one. Other menus keep the two steps.
 * With `contextMenuOf`, a right-click anywhere in the closest ancestor matching that selector opens the same menu at
 * the pointer; the innermost menu takes the click, so a nested row's menu wins over its parent's.
 */
export function RowMenu({ label, items, icon: Icon = EllipsisVertical, className = 'row-action', align = 'end', asksOnOpen = false, contextMenuOf }: { label: string; items: RowMenuItem[]; icon?: LucideIcon; className?: string; align?: 'start' | 'end'; asksOnOpen?: boolean; contextMenuOf?: string }) {
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [position, setPosition] = useState<CSSProperties>();
  const [asking, setAsking] = useState<RowMenuItem>();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = Boolean(anchor);
  const close = (restoreFocus = false) => { setAnchor(undefined); setPosition(undefined); setAsking(undefined); if (restoreFocus) trigger.current?.focus(); };
  const inside = (node: Node | null) => Boolean(node && (root.current?.contains(node) || panel.current?.contains(node)));
  // Focus moves in once the panel is placed and visible; a hidden element cannot take focus.
  const placed = Boolean(position);
  useEffect(() => { if (placed) panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(); }, [placed, asking]);
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
    openBeside(trigger.current!.getBoundingClientRect());
  };
  /** Opens the panel beside `rect`; it is placed once its real size is known (see the layout effect below). */
  const openBeside = (rect: MenuAnchor['rect'], side: MenuAnchor['side'] = align) => {
    setPosition(undefined);
    setAnchor({ rect, side });
    if (asksOnOpen && items.length === 1 && items[0].confirm) setAsking(items[0]);
  };
  // The panel first renders hidden, then sits against its button by its measured size, again when the confirm
  // question changes its height. A guessed size left it floating far from the button (user, 2026-09-23).
  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    setPosition(placePanel(anchor, panel.current, container()));
  }, [anchor, asking]);
  useEffect(() => {
    if (!contextMenuOf) return;
    const area = root.current?.closest<HTMLElement>(contextMenuOf);
    if (!area) return;
    const openAtPointer = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setAsking(undefined);
      // At the pointer the panel opens to its right, the way a desktop context menu does.
      openBeside({ left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY }, 'start');
    };
    area.addEventListener('contextmenu', openAtPointer);
    return () => area.removeEventListener('contextmenu', openAtPointer);
  });
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
    <div ref={panel} className="row-menu-popover" role="menu" aria-label={label} data-popup-open style={position ?? hiddenForMeasuring}
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
    <Button ref={trigger} type="button" size="icon" className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Icon size={16} /></Button>
    {menu}
  </div>;
}
