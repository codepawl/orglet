import { flushSync } from 'react-dom';

/*
 * The first-run screens (startup, the account choice, the app) are three separate trees, so moving between them used
 * to be a hard cut that also remounted the 3D orglet, which then hopped in a second time (COD-341). A screen change now
 * runs as a view transition whose root is a cut: nothing on screen fades or slides, and the startup orglet hops to its
 * place on the next screen by its `view-transition-name` (styles.css, "First-run motion"). Under `prefers-reduced-motion`, or where the browser has no
 * view transitions, the change is a plain cut.
 */

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Applies a state change that swaps the whole screen, as a view transition when motion is allowed. */
export function swapScreen(update: () => void): void {
  if (prefersReducedMotion() || typeof document === 'undefined' || !document.startViewTransition) {
    update();
    return;
  }
  // The name that carries the face across exists only while a swap runs, so the rest of the time the face is not
  // its own stacking context for no reason.
  const root = document.documentElement;
  root.classList.add(SWAP_CLASS);
  // The new screen must be in the DOM when the callback returns, or the transition snapshots the old one twice.
  const transition = document.startViewTransition(() => flushSync(update));
  // A swap the browser skips (a second swap starting, a hidden window) rejects `ready`; the update has still run, so
  // the skip is not an error, and left unhandled it surfaced as a page error in the desktop smoke.
  void transition.ready.catch(() => undefined);
  void transition.finished.finally(() => root.classList.remove(SWAP_CLASS));
}

const SWAP_CLASS = 'screen-swap';

// Long enough to see the orglet smile, short enough that nobody waits on it.
const SMILE_HOLD_MS = 280;

/** Holds a beat after the face smiles, before the screen it sits on goes; no beat under reduced motion. */
export function holdForSmile(): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, SMILE_HOLD_MS));
}
