import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { LiveIsland, type IslandView } from './LiveIsland';

/**
 * The island docks on the prompt bar, not in the thread (COD-167): it sits on the bar's top edge and moves with
 * it, so it never covers an answer and stays put while the chat scrolls. The thread knows what the worker is doing;
 * the bar owns the place it is shown. This store carries the view from one to the other, the way the reply target
 * travels from an answer to the bar in messageMarks.tsx.
 */
let docked: IslandView | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sets what the island on the prompt bar shows, or clears it once the run is over. Same view, no change. */
export function dockIsland(view: IslandView | undefined) {
  if (sameView(docked, view)) return;
  docked = view;
  for (const listener of listeners) listener();
}

function sameView(a: IslandView | undefined, b: IslandView | undefined) {
  if (!a || !b) return a === b;
  return a.state === b.state && a.label === b.label && a.receipt === b.receipt;
}

export function useDockedIsland() {
  return useSyncExternalStore(subscribe, () => docked, () => undefined);
}

/** How long the island stays mounted after the run ends, so its exit can play; matches `island-sink` in styles.css. */
const EXIT_MS = 200;

/**
 * The island's place on the prompt bar. While a run is on, it shows the docked view; when the run ends it keeps the
 * last view on screen for one short exit and then lets it go. Under `prefers-reduced-motion` the exit is a cut: the
 * island is removed before the next paint, so nothing waits on an animation the stylesheet has switched off.
 */
export function IslandDock() {
  const view = useDockedIsland();
  const lastView = useRef<IslandView>(undefined);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  if (view) lastView.current = view;
  const leaving = !view && lastView.current !== undefined;

  useLayoutEffect(() => {
    if (!leaving || !prefersReducedMotion()) return;
    lastView.current = undefined;
    rerender();
  }, [leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      lastView.current = undefined;
      rerender();
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const shown = view ?? lastView.current;
  if (!shown) return null;
  return <LiveIsland state={shown.state} label={shown.label} receipt={shown.receipt} leaving={leaving} />;
}

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
