import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import './InfoTip.css';

/** One line of the panel: a label and a value; `mono` for ids and hashes, `onCopy` adds a copy button. */
export type InfoTipRow = { label: string; value: ReactNode; mono?: boolean; onCopy?: () => void | Promise<void> };

const CLOSE_DELAY_MS = 140;
const PANEL_WIDTH = 320;
const COPIED_FOR_MS = 1200;

function CopyGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>;
}

function CopiedGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>;
}

/**
 * A small button that reveals technical detail (ids, paths, hashes) on hover and on keyboard focus, so the detail is a
 * glance away without taking room on the surface. The panel is portaled out of scrolling containers (into the open
 * dialog when there is one, since a modal turns pointer events off outside itself) and placed from the trigger within
 * that container's edges. Hovering the panel keeps it open; leaving both trigger and panel closes it after a short
 * grace; Escape and focus leaving close it at once; a click pins it open so a copy button inside can be reached.
 *
 * `label` names the trigger, `icon` is what it shows, and `copyLabel` names each row's copy button.
 */
export function InfoTip({ label, rows, icon, copyLabel }: {
  label: string;
  rows: InfoTipRow[];
  icon: ReactNode;
  copyLabel: (rowLabel: string) => string;
}) {
  const [position, setPosition] = useState<CSSProperties>();
  const [pinned, setPinned] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(undefined);
  const panelId = useId();
  const open = Boolean(position);

  const cancelClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;
  const show = () => {
    cancelClose();
    if (open || !trigger.current) return;
    const triggerBox = trigger.current.getBoundingClientRect();
    const host = container();
    const bounds = host === document.body
      ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      : host.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, Math.min(triggerBox.left, bounds.right - PANEL_WIDTH - 8));
    const fitsBelow = triggerBox.bottom + 8 + 240 < bounds.bottom;
    const top = fitsBelow ? triggerBox.bottom + 6 : Math.max(bounds.top + 8, triggerBox.top - 6 - 240);
    // A dialog is transformed, which makes it the containing block, so inside one the panel is placed relative to it.
    setPosition({ position: host === document.body ? 'fixed' : 'absolute', left: left - bounds.left, top: top - bounds.top });
  };
  const hide = () => {
    cancelClose();
    setPosition(undefined);
    setPinned(false);
    setCopiedIndex(undefined);
  };
  const hideSoon = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPosition(undefined), CLOSE_DELAY_MS);
  };
  const isInside = (node: EventTarget | null) => node instanceof Node
    && Boolean(trigger.current?.contains(node) || panel.current?.contains(node));

  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!isInside(event.target)) hide();
    };
    const closeOnResize = () => hide();
    // A hover-opened panel has no focus of its own, so Escape is caught on the window's capture phase, ahead of a
    // dialog underneath that listens on the document: the panel closes and the dialog stays.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hide();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    hide();
    trigger.current?.focus();
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (open && !isInside(event.relatedTarget)) hide();
  };
  const toggle = () => {
    if (open && pinned) {
      hide();
      return;
    }
    show();
    setPinned(true);
  };
  const copy = async (row: InfoTipRow, index: number) => {
    await row.onCopy?.();
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex(current => current === index ? undefined : current), COPIED_FOR_MS);
  };

  const popover = open && createPortal(
    <div ref={panel} id={panelId} role="tooltip" className="org-info-tip-panel" data-popup-open style={{ ...position, width: PANEL_WIDTH }}
      onPointerEnter={cancelClose} onPointerLeave={hideSoon} onKeyDown={onKeyDown} onBlur={onBlur}>
      <dl className="org-info-tip-rows">
        {rows.map((row, index) => <div key={index} className="org-info-tip-row">
          <dt>{row.label}</dt>
          <dd className={row.mono ? 'org-info-tip-mono' : undefined}>
            <span className="org-info-tip-value">{row.value}</span>
            {row.onCopy && <Button size="icon" className="org-info-tip-copy" aria-label={copyLabel(row.label)} title={copyLabel(row.label)}
              onClick={() => void copy(row, index)}>
              {copiedIndex === index ? <CopiedGlyph /> : <CopyGlyph />}
            </Button>}
          </dd>
        </div>)}
      </dl>
    </div>,
    container(),
  );

  return <span className="org-info-tip" onKeyDown={onKeyDown} onBlur={onBlur}>
    <Button ref={trigger} size="icon" className="org-info-tip-trigger" aria-label={label} aria-describedby={open ? panelId : undefined}
      aria-expanded={open} onPointerEnter={show} onPointerLeave={hideSoon} onFocus={show} onClick={toggle}>
      {icon}
    </Button>
    {popover}
  </span>;
}
