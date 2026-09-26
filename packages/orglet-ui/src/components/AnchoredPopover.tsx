import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import './AnchoredPopover.css';

const GAP = 8;
const EDGE = 12;

type Placement = { style: CSSProperties; above: boolean };

/** The open dialog around the anchor, or the page when there is none. */
function hostOf(anchor: HTMLElement | null) {
  const dialog = anchor?.closest('[role=dialog]') as HTMLElement | null;
  return dialog ?? document.body;
}

/** Below the anchor when it fits, above when there is more room there; never past the window edges. */
function placeNear(anchor: HTMLElement, popover: HTMLElement): Placement {
  const anchorBox = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const roomBelow = innerHeight - anchorBox.bottom - GAP - EDGE;
  const roomAbove = anchorBox.top - GAP - EDGE;
  const above = roomBelow < height && roomAbove > roomBelow;
  const preferredLeft = anchorBox.left + anchorBox.width / 2 > innerWidth / 2 ? anchorBox.right - width : anchorBox.left;
  const left = Math.min(Math.max(preferredLeft, EDGE), innerWidth - width - EDGE);
  const top = above ? anchorBox.top - GAP - height : anchorBox.bottom + GAP;
  const host = hostOf(anchor);
  // A fixed-position dialog is the containing block for the popover, so it is placed relative to the dialog.
  const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
  // Whole pixels keep text and hairlines inside the popover sharp.
  return {
    above,
    style: {
      position: host === document.body ? 'fixed' : 'absolute',
      left: Math.round(left - origin.left),
      top: Math.round(top - origin.top),
    },
  };
}

/**
 * A popover attached to a trigger: it floats beside the anchor instead of pushing the layout down, flips above when
 * there is no room below, and closes on a click outside or Escape, handing focus back to the anchor. Inside an open
 * dialog it portals into that dialog, so the dialog's focus trap and scrolling still hold. It sets
 * `data-popup-open`, so a dialog can tell that Escape belongs to the popover and stay open.
 */
export function AnchoredPopover({ anchor, open, onClose, label, className, children }: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** The popover's accessible name. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>();

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(undefined);
      return;
    }
    const update = () => {
      if (anchor.current && popover.current) setPlacement(placeNear(anchor.current, popover.current));
    };
    update();
    // Content that grows after opening moves the popover too; an environment without ResizeObserver still places it.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (popover.current) observer?.observe(popover.current);
    addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [open, anchor]);

  // Focus moves into the popover once it is placed (hidden elements cannot take focus), so the keyboard reaches its
  // controls and Escape reaches its handler.
  const placed = placement !== undefined;
  useEffect(() => {
    if (!open || !placed) return;
    const firstControl = popover.current?.querySelector<HTMLElement>('button, input, [tabindex="0"]');
    firstControl?.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideAnchor = anchor.current?.contains(target) ?? false;
      const insidePopover = popover.current?.contains(target) ?? false;
      if (!insideAnchor && !insidePopover) onClose();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [open, anchor, onClose]);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
    anchor.current?.focus();
  };

  if (!open) return null;
  const hidden: CSSProperties = { position: 'fixed', left: 0, top: 0, visibility: 'hidden' };
  const classes = cn('org-anchored-popover', placement?.above && 'org-anchored-popover-above', className);
  return createPortal(
    <div ref={popover} role="dialog" aria-label={label} className={classes} style={placement?.style ?? hidden} data-popup-open onKeyDown={closeOnEscape}>
      {children}
    </div>,
    hostOf(anchor.current),
  );
}
