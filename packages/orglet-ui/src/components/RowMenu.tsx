import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cn } from '../cn';
import './RowMenu.css';

/** Any icon component that takes a size, such as one from lucide-react. */
export type RowMenuIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/**
 * One entry. `confirm` asks inside the same panel before running a destructive item; `danger` colours it; `shortcut`
 * names the keys that do the same thing, shown quietly at the item's end.
 */
export type RowMenuItem = {
  label: string;
  icon: RowMenuIcon;
  onSelect: () => void;
  danger?: boolean;
  confirm?: { question: string; label: string };
  shortcut?: string;
};

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
  const bounds = host === document.body
    ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    : host.getBoundingClientRect();
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
 * A menu behind an icon button, for a row's actions. The panel is portaled out of the row (into the open dialog when
 * there is one), so overflow and a row's transform cannot clip it, and placed from its measured size. It closes on a
 * choice, a pointer outside, Escape or focus leaving; arrow keys move between items.
 *
 * An item with `confirm` asks inside the panel first, with `cancelLabel` on the way back. With `asksOnOpen`, a menu of
 * one such item opens straight on its question, so the trigger reads as that action. With `contextMenuOf`, a
 * right-click anywhere in the closest ancestor matching that selector opens the menu at the pointer; the innermost menu
 * takes the click, so a nested row's menu wins over its parent's.
 */
export function RowMenu({ label, items, icon: Icon, cancelLabel, className, align = 'end', asksOnOpen = false, contextMenuOf, disabled = false }: {
  label: string;
  items: RowMenuItem[];
  /** What the trigger shows. */
  icon: RowMenuIcon;
  /** The way back from a question, such as "No". */
  cancelLabel: string;
  /** Classes for the trigger button. */
  className?: string;
  align?: 'start' | 'end';
  asksOnOpen?: boolean;
  contextMenuOf?: string;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [position, setPosition] = useState<CSSProperties>();
  const [asking, setAsking] = useState<RowMenuItem>();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = Boolean(anchor);
  const placed = Boolean(position);

  const close = (restoreFocus = false) => {
    setAnchor(undefined);
    setPosition(undefined);
    setAsking(undefined);
    if (restoreFocus) trigger.current?.focus();
  };
  const isInside = (node: Node | null) => Boolean(node && (root.current?.contains(node) || panel.current?.contains(node)));
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;

  // Focus moves in once the panel is placed and visible; a hidden element cannot take focus.
  useEffect(() => {
    if (placed) panel.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
  }, [placed, asking]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!isInside(event.target as Node)) close();
    };
    const closeOnResize = () => close();
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  /** Opens the panel beside `rect`; it is placed once its real size is known. */
  const openBeside = (rect: MenuAnchor['rect'], side: MenuAnchor['side'] = align) => {
    setPosition(undefined);
    setAnchor({ rect, side });
    if (asksOnOpen && items.length === 1 && items[0].confirm) setAsking(items[0]);
  };
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    openBeside(trigger.current!.getBoundingClientRect());
  };
  // The panel renders hidden first, then sits against its trigger by its measured size, again when a question
  // changes its height.
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
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (asking) setAsking(undefined);
      else close(true);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // The panel is portaled, but React still bubbles its events to the root's handler; without this each arrow
      // press moved two items.
      event.stopPropagation();
      const entries = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const index = entries.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : entries.length - 1;
      entries[(index + step) % entries.length]?.focus();
    }
  };
  const closeOnFocusLeaving = (relatedTarget: EventTarget | null) => {
    if (open && !isInside(relatedTarget as Node | null)) close();
  };
  const choose = (item: RowMenuItem) => {
    if (item.confirm) {
      setAsking(item);
      return;
    }
    close(true);
    item.onSelect();
  };
  const confirmAsked = () => {
    const item = asking!;
    close(true);
    item.onSelect();
  };

  const question = asking && <>
    <p className="org-row-menu-question">{asking.confirm!.question}</p>
    <button type="button" role="menuitem" className="org-row-menu-danger" onClick={confirmAsked}>
      <asking.icon size={16} aria-hidden="true" /><span>{asking.confirm!.label}</span>
    </button>
    <button type="button" role="menuitem" onClick={() => setAsking(undefined)}>
      <CancelGlyph /><span>{cancelLabel}</span>
    </button>
  </>;
  const entries = items.map(item => <button key={item.label} type="button" role="menuitem"
    className={item.danger ? 'org-row-menu-danger' : undefined} onClick={() => choose(item)}>
    <item.icon size={16} aria-hidden="true" />
    <span>{item.label}</span>
    {item.shortcut && <kbd className="org-row-menu-shortcut" aria-hidden="true">{item.shortcut}</kbd>}
  </button>);
  const menu = open && createPortal(
    <div ref={panel} className="org-row-menu-panel" role="menu" aria-label={label} data-popup-open style={position ?? hiddenForMeasuring}
      onBlur={event => closeOnFocusLeaving(event.relatedTarget)} onKeyDown={onMenuKey}>
      {question || entries}
    </div>,
    container(),
  );
  const shortcut = items.find(item => item.shortcut)?.shortcut?.replaceAll('Ctrl', 'Control');
  return <div ref={root} className="org-row-menu" onBlur={event => closeOnFocusLeaving(event.relatedTarget)}
    onKeyDown={event => { if (open) onMenuKey(event); }}>
    <Button ref={trigger} type="button" size="icon" className={cn(className)} aria-label={label} title={label} aria-haspopup="menu"
      aria-expanded={open} aria-keyshortcuts={shortcut} disabled={disabled} onClick={toggle}><Icon size={16} /></Button>
    {menu}
  </div>;
}

/** The cross on the way back from a question; drawn here so the kit needs no icon library. */
function CancelGlyph() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>;
}
