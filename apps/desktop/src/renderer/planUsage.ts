import { useEffect, useRef, useSyncExternalStore } from 'react';
import { composerUsageFor, type ComposerUsage } from '../shared/composer-usage';
import { isHarness, type HarnessInfo, type HarnessUsage } from '../shared/harness';
import { orglet } from './api';

/** How often the open chat asks again while the window is in view; the core reuses a read for a minute anyway. */
const ASK_AGAIN_MS = 5 * 60_000;
/** A reset further off than this is left to the regular ask, so the timer never overflows. */
const LONGEST_RESET_WAIT_MS = 24 * 60 * 60_000;
/** A beat after the reset, so the vendor already counts from zero. */
const AFTER_RESET_MS = 5_000;

let current: HarnessUsage | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/**
 * Plan usage for the bar by the message box (COD-326): the same `harnessUsage` read Settings shows, kept once for
 * the window. `refresh` reads again past the core's one-minute reuse; without it, a read already on its way is shared.
 */
export function loadPlanUsage(refresh: boolean): Promise<void> {
  if (pending && !refresh) return pending;
  const request = orglet.call('harnessUsage', { refresh })
    .then(usage => {
      current = usage;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined)
    .finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

/** Which account each harness runs: a switch here or in Settings means other numbers. */
const accountsKey = (harnesses: readonly HarnessInfo[] | undefined) => (harnesses ?? []).map(item => `${item.id}:${item.accountId}`).join(',');

/**
 * What the bar shows for a chat whose orglets use these providers. It asks when the chat opens and when an account
 * changes, again right after a run ends (the run used some), when the shown allowance resets, and every few minutes
 * while the window is in view. Nothing is asked for a chat with no harness.
 */
export function useComposerUsage(providers: readonly string[], harnesses: readonly HarnessInfo[] | undefined, running = false): { view?: ComposerUsage; loading: boolean } {
  const usage = useSyncExternalStore(subscribe, () => current, () => current);
  const usesHarness = providers.some(isHarness);
  const accounts = accountsKey(harnesses);
  useEffect(() => {
    if (usesHarness) void loadPlanUsage(false);
  }, [usesHarness, accounts]);
  useEffect(() => {
    if (!usesHarness) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadPlanUsage(false);
    }, ASK_AGAIN_MS);
    return () => clearInterval(timer);
  }, [usesHarness]);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && usesHarness) void loadPlanUsage(true);
    wasRunning.current = running;
  }, [running, usesHarness]);
  const view = composerUsageFor(providers, harnesses, usage);
  const resetsAt = view?.shown.resetsAt;
  useEffect(() => {
    if (!resetsAt) return;
    const wait = Date.parse(resetsAt) - Date.now() + AFTER_RESET_MS;
    if (wait <= 0 || wait > LONGEST_RESET_WAIT_MS) return;
    const timer = setTimeout(() => void loadPlanUsage(true), wait);
    return () => clearTimeout(timer);
  }, [resetsAt]);
  // Nothing read yet for a chat on a harness: the ring's place is held so the bar does not jump when it lands.
  return { view, loading: usesHarness && (usage === undefined || harnesses === undefined) };
}
