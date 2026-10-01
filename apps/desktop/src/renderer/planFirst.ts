import { useSyncExternalStore } from 'react';

/**
 * Which message bars have Plan first chosen for their next message (COD-367), keyed like the drafts (`task:<id>`, or an
 * empty chat's `worker:`/`team:`/`channel:` key from `drafts.ts`). It is how the next message will be sent, not a
 * permission, so it lives with the bar while the app is open; the core only ever sees it on the message itself.
 * It stays set after a message goes, so a back-and-forth about the plan stays in Plan first until the person picks
 * another mode or presses Follow the plan.
 */
const chosen = new Set<string>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function planFirstChosen(key: string | undefined): boolean {
  return key !== undefined && chosen.has(key);
}

export function setPlanFirst(key: string | undefined, on: boolean) {
  if (!key || chosen.has(key) === on) return;
  if (on) chosen.add(key);
  else chosen.delete(key);
  changed();
}

/** The empty chat's choice follows its first message onto the chat that message created. */
export function movePlanFirst(from: string | undefined, to: string) {
  if (!from || !chosen.has(from)) return;
  chosen.delete(from);
  chosen.add(to);
  changed();
}

export function usePlanFirst(key: string | undefined): boolean {
  const read = () => planFirstChosen(key);
  return useSyncExternalStore(subscribe, read, read);
}
