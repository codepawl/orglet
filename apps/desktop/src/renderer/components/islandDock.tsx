import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { AccountIsland, KnowledgeIsland, LiveIsland, type IslandView } from './LiveIsland';

/**
 * The island docks on the prompt bar, not in the thread (COD-167): it sits on the bar's top edge and moves with
 * it, so it never covers an answer and stays put while the chat scrolls. The thread knows what the worker is doing;
 * the bar owns the place it is shown. This store carries the view from one to the other, the way the reply target
 * travels from an answer to the bar in messageMarks.tsx.
 *
 * Two kinds of view take the tab (COD-208): a working run, and, once no run is on, the chat's knowledge suggestions
 * waiting for review. The thread picks which one is docked (`showsKnowledgeIsland`); the dock only shows it. A third,
 * a harness account that ran out of plan usage (COD-225), takes the tab before the suggestions: it blocks the chat.
 */
export type DockedIsland =
  | ({ kind: 'run' } & IslandView)
  | { kind: 'knowledge'; /** The set of suggestions, so a new set is a new view. */ key: string; count: number; review: () => void; dismiss: () => void }
  | { kind: 'account'; /** The run that ran out, so a later one is a new view. */ key: string; harnessName: string; target?: { label: string; usedPercent: number }; resetsAt?: string; switchAccount: () => void; dismiss: () => void };

let docked: DockedIsland | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sets what the island on the prompt bar shows, or clears it once there is nothing to show. Same view, no change. */
export function dockIsland(view: DockedIsland | undefined) {
  if (sameView(docked, view)) return;
  docked = view;
  for (const listener of listeners) listener();
}

function sameView(a: DockedIsland | undefined, b: DockedIsland | undefined) {
  if (!a || !b) return a === b;
  if (a.kind === 'knowledge') return b.kind === 'knowledge' && a.key === b.key && a.count === b.count;
  if (a.kind === 'account') return b.kind === 'account' && a.key === b.key && a.target?.label === b.target?.label && a.target?.usedPercent === b.target?.usedPercent && a.resetsAt === b.resetsAt;
  if (b.kind !== 'run') return false;
  return a.state === b.state && a.label === b.label && a.receipt === b.receipt && actionsKey(a) === actionsKey(b) && sameWorkers(a, b);
}

function actionsKey(view: IslandView) {
  return (view.actions ?? []).map(action => `${action.kind}:${action.label}`).join(',');
}

function sameWorkers(a: IslandView, b: IslandView) {
  if (a.workers.length !== b.workers.length) return false;
  return a.workers.every((worker, index) => worker.id === b.workers[index].id);
}

export function useDockedIsland() {
  return useSyncExternalStore(subscribe, () => docked, () => undefined);
}

/**
 * How long the island stays mounted after the run ends, so its exit can play: a touch over `island-settle` in
 * styles.css, so the settle's last frame is painted before the element goes.
 */
const EXIT_MS = 240;

/**
 * The island's place on the prompt bar. While a view is docked, it shows it; when the view goes it keeps the last
 * one on screen for one short exit and then lets it go. A view of the other kind (the suggestions after a run)
 * waits for that exit too, then rises on its own, so the tab settles into the bar and comes back rather than
 * changing its contents in place. Under `prefers-reduced-motion` the exit is a cut: the island is removed before
 * the next paint, so nothing waits on an animation the stylesheet has switched off.
 */
export function IslandDock() {
  const view = useDockedIsland();
  const lastView = useRef<DockedIsland>(undefined);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const handingOver = view !== undefined && lastView.current !== undefined && lastView.current.kind !== view.kind;
  if (view && !handingOver) lastView.current = view;
  const leaving = lastView.current !== undefined && (!view || handingOver);

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

  const shown = lastView.current;
  if (!shown) return null;
  if (shown.kind === 'knowledge') return <KnowledgeIsland count={shown.count} review={shown.review} dismiss={shown.dismiss} leaving={leaving} />;
  if (shown.kind === 'account') return <AccountIsland harnessName={shown.harnessName} target={shown.target} resetsAt={shown.resetsAt} switchAccount={shown.switchAccount} dismiss={shown.dismiss} leaving={leaving} />;
  return <LiveIsland state={shown.state} label={shown.label} named={shown.named} receipt={shown.receipt} workers={shown.workers} actions={shown.actions} leaving={leaving} />;
}

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
