import { useSyncExternalStore } from 'react';
import type { RunProgressUpdate } from '../shared/progress';
import { orglet } from './api';

/*
 * The newest live progress of every streaming run, across all chats (COD-244). A chat keeps its own copy for the
 * open thread (`useRunProgress`); the Running view needs every run's step, including runs that started while it
 * was closed, so this one listens from launch. Memory only: progress is never saved, and a run that stops
 * streaming sends a final null that removes it.
 */

let byRun: Readonly<Record<string, RunProgressUpdate>> = {};
const listeners = new Set<() => void>();

function receive(update: RunProgressUpdate) {
  const next = { ...byRun };
  if (update.progress) next[update.runId] = update;
  else delete next[update.runId];
  byRun = next;
  for (const listener of listeners) listener();
}

/** Starts listening for progress; returns the unsubscribe. The app calls it once, on mount. */
export function watchRunProgress(): () => void {
  return orglet.onProgress(receive);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return byRun;
}

/** Live progress keyed by run id, re-rendering the caller as it changes. */
export function useAllRunProgress(): Readonly<Record<string, RunProgressUpdate>> {
  return useSyncExternalStore(subscribe, snapshot);
}
