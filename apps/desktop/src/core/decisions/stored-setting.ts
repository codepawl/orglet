import { parseStoredDecisionModelSetting, type DecisionModelSetting } from '../../shared/decisions';

/** Where the choice is kept, and where it was kept before the feature was renamed from Tacet to the decision model. */
export const DECISION_MODEL_SETTING_KEY = 'decisionModel';
export const LEGACY_TACET_SETTING_KEY = 'tacet';

/** The part of the store this reads and writes. */
export type SettingStore = {
  setting<T>(key: string, fallback: T): T;
  setSetting(key: string, value: unknown): void;
  clearSetting(key: string): void;
};

/**
 * The saved priority list, or undefined when the person has made none. The setting used to be 'off' or one connection;
 * that value is rewritten as a list (empty, or of one) the first time it is read. A choice saved under the older
 * `tacet` key moves to `decisionModel` the same way, and the old row is dropped, so nobody has to choose again. A value
 * in either key that is not a choice is ignored; an unreadable old row is dropped too, since nothing reads it any more.
 */
export function readDecisionModelSetting(store: SettingStore): DecisionModelSetting | undefined {
  const stored = store.setting<unknown>(DECISION_MODEL_SETTING_KEY, undefined);
  const current = parseStoredDecisionModelSetting(stored);
  if (current !== undefined) {
    if (!Array.isArray(stored)) store.setSetting(DECISION_MODEL_SETTING_KEY, current);
    return current;
  }
  const legacyValue = store.setting<unknown>(LEGACY_TACET_SETTING_KEY, undefined);
  if (legacyValue === undefined) return undefined;
  const legacy = parseStoredDecisionModelSetting(legacyValue);
  if (legacy !== undefined) store.setSetting(DECISION_MODEL_SETTING_KEY, legacy);
  store.clearSetting(LEGACY_TACET_SETTING_KEY);
  return legacy;
}

export function saveDecisionModelSetting(store: SettingStore, setting: DecisionModelSetting): void {
  store.setSetting(DECISION_MODEL_SETTING_KEY, setting);
  // A stale old row must not come back if the new one is ever cleared.
  store.clearSetting(LEGACY_TACET_SETTING_KEY);
}
