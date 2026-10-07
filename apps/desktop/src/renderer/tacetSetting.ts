import { useEffect, useState } from 'react';
import type { TacetSettingView } from '../shared/decisions';
import { orglet } from './api';

/**
 * Tacet's connection as the window knows it (COD-303): read once from the core, and replaced whenever Settings saves a
 * new choice, so the composer's permission hint stops or starts at once. A window with no bridge (a test render) never
 * asks and stays undefined.
 */
let current: TacetSettingView | undefined;
const listeners = new Set<(view: TacetSettingView) => void>();

export function publishTacetSetting(view: TacetSettingView) {
  current = view;
  for (const listener of listeners) listener(view);
}

export function useTacetSetting(): TacetSettingView | undefined {
  const [view, setView] = useState<TacetSettingView | undefined>(current);
  useEffect(() => {
    let live = true;
    const listener = (next: TacetSettingView) => { if (live) setView(next); };
    listeners.add(listener);
    void orglet.call('tacetSetting', {}).then(next => { if (live) publishTacetSetting(next); }, () => undefined);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return view;
}
