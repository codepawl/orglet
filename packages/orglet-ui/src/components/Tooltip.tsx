import {
  cloneElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type FocusEvent, type PointerEvent, type ReactElement, type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import './Tooltip.css';

export type TooltipSide = 'top' | 'bottom';

type TriggerProps = {
  'aria-describedby'?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;
};

type Placement = { style: CSSProperties; side: TooltipSide };

const HOVER_DELAY_MS = 400;
const GAP = 6;
const EDGE = 8;

/** The open dialog around the trigger, or the page when there is none. */
function hostOf(trigger: HTMLElement | null) {
  return (trigger?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;
}

/** A click gives a button focus too, and a label over a button that was just pressed is noise: only keys show it. */
function focusCameFromKeyboard(element: HTMLElement) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Centred on the trigger on the wanted side, on the other side when there is no room, never past the window. */
function placeBeside(trigger: HTMLElement, tooltip: HTMLElement, wantedSide: TooltipSide): Placement {
  const triggerBox = trigger.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const roomAbove = triggerBox.top - GAP - EDGE;
  const roomBelow = innerHeight - triggerBox.bottom - GAP - EDGE;
  const otherSide: TooltipSide = wantedSide === 'top' ? 'bottom' : 'top';
  const roomWanted = wantedSide === 'top' ? roomAbove : roomBelow;
  const roomOther = wantedSide === 'top' ? roomBelow : roomAbove;
  const side = roomWanted >= height || roomOther < height ? wantedSide : otherSide;
  const centredLeft = triggerBox.left + triggerBox.width / 2 - width / 2;
  const left = Math.min(Math.max(centredLeft, EDGE), Math.max(EDGE, innerWidth - width - EDGE));
  const top = side === 'top' ? triggerBox.top - GAP - height : triggerBox.bottom + GAP;
  const host = hostOf(trigger);
  // A transformed dialog is the containing block of what is placed inside it, so the offset is taken from the dialog.
  const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
  return {
    side,
    style: {
      position: host === document.body ? 'fixed' : 'absolute',
      left: Math.round(left - origin.left),
      top: Math.round(top - origin.top),
    },
  };
}

/**
 * A short text label for a control, shown on hover after a short delay and at once on keyboard focus, hidden by
 * Escape, the pointer leaving, a press and focus leaving. It wraps exactly one element and adds `aria-describedby` to
 * it while shown; the element keeps its own accessible name, so an icon-only button still needs `aria-label`. The
 * label is portaled into the open dialog or the page, placed on `side` and moved to the other side when there is no
 * room. Escape closes the tooltip and leaves a dialog around it open. It holds no interactive content: that is an
 * `InfoTip`.
 */
export function Tooltip({ label, shortcut, side = 'top', className, children }: {
  /** The text shown. */
  label: string;
  /** A key combination shown after the label, such as `Ctrl+K`. Handling the key is the caller's job. */
  shortcut?: string;
  side?: TooltipSide;
  className?: string;
  children: ReactElement<TriggerProps>;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>();
  const trigger = useRef<HTMLElement | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number>(undefined);
  const tooltipId = useId();

  const cancelHover = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };
  const hide = () => {
    cancelHover();
    setOpen(false);
    setPlacement(undefined);
  };
  const showAtOnce = () => {
    cancelHover();
    setOpen(true);
  };
  const showAfterDelay = () => {
    cancelHover();
    hoverTimer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };

  useEffect(() => cancelHover, []);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return;
    setPlacement(placeBeside(trigger.current, tooltip.current, side));
  }, [open, side, label, shortcut]);

  useEffect(() => {
    if (!open) return;
    // Hover alone gives the trigger no focus, so Escape is caught on the window's capture phase, ahead of a dialog
    // underneath: the tooltip closes and the dialog stays.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      hide();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  const childProps = children.props;
  const describedBy = open
    ? [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ')
    : childProps['aria-describedby'];
  const keepChildRef = (node: HTMLElement | null) => {
    trigger.current = node;
    const childRef = childProps.ref;
    if (typeof childRef === 'function') childRef(node);
    else if (childRef) childRef.current = node;
  };
  const wired = cloneElement(children, {
    'aria-describedby': describedBy,
    ref: keepChildRef,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(event);
      showAfterDelay();
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      if (focusCameFromKeyboard(event.currentTarget)) showAtOnce();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      hide();
    },
  });

  const hidden: CSSProperties = { position: 'fixed', left: 0, top: 0, visibility: 'hidden' };
  const bubble = open && trigger.current && createPortal(
    <div ref={tooltip} id={tooltipId} role="tooltip" data-popup-open data-side={placement?.side ?? side}
      className={cn('org-tooltip', className)} style={placement?.style ?? hidden}>
      {label}
      {shortcut && <kbd className="org-tooltip-shortcut">{shortcut}</kbd>}
    </div>,
    hostOf(trigger.current),
  );

  return <>
    {wired}
    {bubble}
  </>;
}
