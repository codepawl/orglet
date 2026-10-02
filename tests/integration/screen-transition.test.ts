// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { holdForSmile, swapScreen } from '../../apps/desktop/src/renderer/screenTransition';

/*
 * COD-341: startup, the first-run account choice and the app swap as a view transition, and as a plain cut under
 * reduced motion or without the API. The `.screen-swap` class that names the card and the face must not outlive the
 * swap, or the main pane would stay its own stacking context.
 */

/** The parts of a ViewTransition the swap uses: eady rejects when the browser skips the transition. */
type FakeTransition = { ready: Promise<void>; finished: Promise<void> };

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }));
}

function installViewTransitions({ skipped = false }: { skipped?: boolean } = {}) {
  let finish: () => void = () => undefined;
  const start = vi.fn((callback: () => void): FakeTransition => {
    callback();
    const ready = skipped ? Promise.reject(new DOMException('Transition was skipped', 'AbortError')) : Promise.resolve();
    return { ready, finished: new Promise<void>(resolve => { finish = resolve; }) };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  return { start, finish: () => finish() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'startViewTransition');
  document.documentElement.classList.remove('screen-swap');
});

it('runs the swap as a view transition and drops the naming class once it has finished', async () => {
  setReducedMotion(false);
  const transitions = installViewTransitions();
  const update = vi.fn();
  swapScreen(update);
  expect(transitions.start).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains('screen-swap')).toBe(true);
  transitions.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.documentElement.classList.contains('screen-swap')).toBe(false);
});

it('treats a skipped transition as done, not as an error', async () => {
  setReducedMotion(false);
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const transitions = installViewTransitions({ skipped: true });
    const update = vi.fn();
    swapScreen(update);
    expect(update).toHaveBeenCalledTimes(1);
    transitions.finish();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(unhandled).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('screen-swap')).toBe(false);
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
it('cuts straight to the new screen under reduced motion', () => {
  setReducedMotion(true);
  const transitions = installViewTransitions();
  const update = vi.fn();
  swapScreen(update);
  expect(transitions.start).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains('screen-swap')).toBe(false);
});

it('cuts straight to the new screen where view transitions do not exist', () => {
  setReducedMotion(false);
  const update = vi.fn();
  swapScreen(update);
  expect(update).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains('screen-swap')).toBe(false);
});

it('holds a beat for the smile only when motion is allowed', async () => {
  setReducedMotion(true);
  await expect(holdForSmile()).resolves.toBeUndefined();
  setReducedMotion(false);
  vi.useFakeTimers();
  let held = true;
  const hold = holdForSmile().then(() => { held = false; });
  await vi.advanceTimersByTimeAsync(100);
  expect(held).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  await hold;
  expect(held).toBe(false);
});
