import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { Button } from './ui';
import { Info } from './icons';
import { t } from '../i18n';

/** One line of the popover: a label and a value; `mono` for ids and hashes, `onCopy` adds a copy button. */
export type InfoTipRow = { label: string; value: ReactNode; mono?: boolean; onCopy?: () => void | Promise<void> };

const CLOSE_DELAY_MS = 140;
const PANEL_WIDTH = 320;

/**
 * A small "i" button that reveals technical detail on hover and on keyboard focus, so the detail is a glance away
 * without taking room on the surface. The panel is portaled to `document.body` and positioned from the trigger,
 * so a scrolling dialog cannot clip it. Hovering the panel keeps it open (a copy button lives there); the pointer
 * leaving both trigger and panel closes it after a short grace, Escape and focus leaving close it at once, and a
 * click pins it open for people who want to move into it.
 */
export function InfoTip({ label, rows }: { label: string; rows: InfoTipRow[] }) {
  const [position, setPosition] = useState<CSSProperties>();
  const [pinned, setPinned] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(undefined);
  const panelId = useId();
  const open = Boolean(position);

  const cancelClose = () => { window.clearTimeout(closeTimer.current); closeTimer.current = undefined; };
  // Inside a modal dialog the panel is portaled into the dialog, like Select's menu: a modal turns pointer events
  // off for everything outside itself, so a panel in the body would show but never take a click. A dialog is
  // transformed, which makes it the containing block, so the panel is placed relative to it, within its edges.
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;
  const show = () => {
    cancelClose();
    if (open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const host = container();
    const bounds = host === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : host.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - PANEL_WIDTH - 8));
    const fitsBelow = rect.bottom + 8 + 240 < bounds.bottom;
    const top = fitsBelow ? rect.bottom + 6 : Math.max(bounds.top + 8, rect.top - 6 - 240);
    setPosition({ position: host === document.body ? 'fixed' : 'absolute', left: left - bounds.left, top: top - bounds.top });
  };
  const hide = () => { cancelClose(); setPosition(undefined); setPinned(false); setCopiedIndex(undefined); };
  const hideSoon = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPosition(undefined), CLOSE_DELAY_MS);
  };
  const inside = (node: EventTarget | null) => node instanceof Node && Boolean(trigger.current?.contains(node) || panel.current?.contains(node));

  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!inside(event.target)) hide(); };
    const dismiss = () => hide();
    // A hover-opened panel has no focus of its own, so Escape is caught on the window's capture phase, ahead of
    // the dialog underneath (which listens on the document): the panel closes and the dialog stays.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hide();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', dismiss); };
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    hide();
    trigger.current?.focus();
  };
  const onBlur = (event: React.FocusEvent<HTMLElement>) => { if (open && !inside(event.relatedTarget)) hide(); };
  const toggle = () => {
    if (open && pinned) { hide(); return; }
    show();
    setPinned(true);
  };
  const copy = async (row: InfoTipRow, index: number) => {
    await row.onCopy?.();
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex(current => current === index ? undefined : current), 1200);
  };

  const popover = open && createPortal(
    <div ref={panel} id={panelId} role="tooltip" className="info-tip-panel" data-popup-open style={{ ...position, width: PANEL_WIDTH }}
      onPointerEnter={cancelClose} onPointerLeave={hideSoon} onKeyDown={onKey} onBlur={onBlur}>
      <dl className="info-tip-rows">
        {rows.map((row, index) => <div key={index} className="info-tip-row">
          <dt>{row.label}</dt>
          <dd className={row.mono ? 'mono' : undefined}>
            <span className="info-tip-value">{row.value}</span>
            {row.onCopy && <Button size="icon" className="info-tip-copy" aria-label={t('Sao chép {0}', [row.label])} title={t('Sao chép {0}', [row.label])} onClick={() => void copy(row, index)}>
              {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
            </Button>}
          </dd>
        </div>)}
      </dl>
    </div>,
    container(),
  );

  return <span className="info-tip" onKeyDown={onKey} onBlur={onBlur}>
    <Button ref={trigger} size="icon" className="info-tip-trigger" aria-label={label} aria-describedby={open ? panelId : undefined} aria-expanded={open}
      onPointerEnter={show} onPointerLeave={hideSoon} onFocus={show} onClick={toggle}>
      <Info size={16} />
    </Button>
    {popover}
  </span>;
}
