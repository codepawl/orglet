import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export type PaneWidthBounds = { min: number; max: number; default: number; step: number };

/** The gap the shell leaves around its panels, so a drag can turn a pointer position into a panel width. */
export function shellGap(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-gap')) || 8;
}

/**
 * A shell panel the user can drag wider, with the width remembered across sessions.
 *
 * `widthFromPointer` turns the pointer's x into a width, which differs per panel: the sidebar measures from the
 * left window edge, the details panel from the right. `widerKey` says which arrow key widens it, for the same
 * reason: an arrow moves the handle, and the handle sits on opposite sides of the two panels.
 *
 * Returns the current width, whether a drag is in progress, and the props for the handle. The handle is a real
 * `separator` button, so the width is also reachable from the keyboard: arrows step it, Home and End jump to the
 * bounds, and a double click returns it to the default.
 */
export function usePaneWidth({ storageKey, bounds, widthFromPointer, widerKey }: {
  storageKey: string;
  bounds: PaneWidthBounds;
  widthFromPointer: (clientX: number) => number;
  widerKey: 'ArrowLeft' | 'ArrowRight';
}) {
  const clamp = (width: number) => Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return stored ? clamp(stored) : bounds.default;
    } catch {
      return bounds.default;
    }
  });
  const [resizing, setResizing] = useState(false);

  const remember = (next: number) => {
    setWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore quota */ }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = widerKey === 'ArrowRight'
      ? { ArrowLeft: -bounds.step, ArrowRight: bounds.step }
      : { ArrowLeft: bounds.step, ArrowRight: -bounds.step };
    if (event.key in steps) { event.preventDefault(); remember(clamp(width + steps[event.key])); return; }
    if (event.key === 'Home') { event.preventDefault(); remember(bounds.min); return; }
    if (event.key === 'End') { event.preventDefault(); remember(bounds.max); }
  };

  return {
    width,
    resizing,
    handleProps: {
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': width,
      'aria-valuemin': bounds.min,
      'aria-valuemax': bounds.max,
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizing) return;
        remember(clamp(widthFromPointer(event.clientX)));
      },
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizing) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setResizing(false);
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizing) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setResizing(false);
      },
      onKeyDown,
      onDoubleClick: () => remember(bounds.default),
    },
  };
}
