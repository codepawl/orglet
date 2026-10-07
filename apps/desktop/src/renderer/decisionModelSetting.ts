import { useEffect, useState } from 'react';
import type { DecisionModelSettingView } from '../shared/decisions';
import { orglet } from './api';

/**
 * The decision model's connection as the window knows it (COD-303): read once from the core, and replaced whenever Settings saves a
 * new choice, so the composer's permission hint stops or starts at once. A window with no bridge (a test render) never
 * asks and stays undefined.
 */
let current: DecisionModelSettingView | undefined;
const listeners = new Set<(view: DecisionModelSettingView) => void>();

export function publishDecisionModelSetting(view: DecisionModelSettingView) {
  current = view;
  for (const listener of listeners) listener(view);
}

export function useDecisionModelSetting(): DecisionModelSettingView | undefined {
  const [view, setView] = useState<DecisionModelSettingView | undefined>(current);
  useEffect(() => {
    let live = true;
    const listener = (next: DecisionModelSettingView) => { if (live) setView(next); };
    listeners.add(listener);
    void orglet.call('decisionModelSetting', {}).then(next => { if (live) publishDecisionModelSetting(next); }, () => undefined);
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, []);
  return view;
}
