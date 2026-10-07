import { useEffect, useState, type ReactNode } from 'react';
import type { PermissionState } from '../shared/capability-status';
import { hintKind, missingNeed, PERMISSION_NEEDS_MIN_CHARS, type PermissionHintKind, type PermissionNeed } from '../shared/permission-needs';
import { orglet } from './api';
import { useTacetSetting } from './tacetSetting';
import { PermissionHint } from './components/PermissionHint';

/**
 * The composer's reading of what a message needs (COD-305). It asks the core only while Tacet has a connection, and
 * only once typing has paused, so a sentence being written is read once rather than at every key. While the person
 * keeps typing, the last answer stays until the next one arrives, so the line does not blink at every word; an emptied
 * box (the message was sent) clears it at once. The core answers `null` when a newer request is already waiting.
 */

/** Typing pauses about this long between words; a longer wait makes the line arrive after the person looked away. */
export const PERMISSION_HINT_DEBOUNCE_MS = 450;

export function usePermissionNeeds(text: string, enabled: boolean): PermissionNeed[] {
  const tacet = useTacetSetting();
  const ready = enabled && tacet !== undefined && tacet.setting !== 'off';
  const [needs, setNeeds] = useState<PermissionNeed[]>([]);
  const message = text.trim();
  const readable = ready && message.length >= PERMISSION_NEEDS_MIN_CHARS;
  useEffect(() => {
    if (!readable) {
      setNeeds([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void orglet.call('suggestPermissions', { text: message }).then(result => {
        if (current && result) setNeeds(result.needs);
      }, () => undefined);
    }, PERMISSION_HINT_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [readable, message]);
  return readable ? needs : [];
}

/**
 * The hints waved away, per chat, for as long as the app is open. Waving the web hint away in one chat leaves every
 * other chat's hints alone; restarting the app offers them again.
 */
const dismissedByChat = new Map<string, Set<PermissionHintKind>>();

export function useDismissedHints(chatKey: string): [ReadonlySet<PermissionHintKind>, (kind: PermissionHintKind) => void] {
  const [dismissed, setDismissed] = useState<ReadonlySet<PermissionHintKind>>(() => new Set(dismissedByChat.get(chatKey)));
  useEffect(() => setDismissed(new Set(dismissedByChat.get(chatKey))), [chatKey]);
  const dismiss = (kind: PermissionHintKind) => {
    const next = new Set(dismissedByChat.get(chatKey));
    next.add(kind);
    dismissedByChat.set(chatKey, next);
    setDismissed(next);
  };
  return [dismissed, dismiss];
}

/**
 * What a composer needs to offer a permission: the chat it belongs to, what the chat allows now, whether a hint may
 * show at all, and the step each need takes. The caller owns the permission commands, as it does for Details.
 */
export type PermissionHintControls = {
  /** The chat, or the empty chat's orglet, crew or group, that waved-away hints are kept under. */
  chatKey: string;
  permissions: PermissionState;
  /** Off where a hint could not be acted on: Demo, a model with no connection, a side thread, a closed chat. */
  enabled: boolean;
  /** A permission change is on its way; the link waits for it. */
  busy: boolean;
  onApply: (need: PermissionNeed) => void;
};

/**
 * The hint line for the text in a message box, or `fallback` when there is no hint: a line that matters less than a
 * permission the message is about to need, such as a plan nearly used up (COD-326).
 */
export function ComposerPermissionHint({ text, controls, fallback }: { text: string; controls: PermissionHintControls; fallback?: ReactNode }) {
  const needs = usePermissionNeeds(text, controls.enabled);
  const [dismissed, dismiss] = useDismissedHints(controls.chatKey);
  const need = missingNeed(needs, controls.permissions, dismissed);
  if (!need) return fallback ?? null;
  return <PermissionHint need={need} folder={controls.permissions.workspace} disabled={controls.busy}
    onApply={() => controls.onApply(need)} onDismiss={() => dismiss(hintKind(need))} />;
}
