import { useEffect, useState, type ReactNode } from 'react';
import type { PermissionState } from '../shared/capability-status';
import { hintKind, missingNeed, PERMISSION_NEEDS_MIN_CHARS, type PermissionHintKind, type PermissionNeed } from '../shared/permission-needs';
import { orglet } from './api';
import { PermissionHint } from './components/PermissionHint';

/**
 * The composer's reading of what a message needs (COD-305). The decision model reads a message when the person sends
 * it, never while it is still being typed, so an unsent draft does not leave the computer. The send does not wait for
 * the answer: the line appears under the message bar a moment after, about the message that was just sent, and goes
 * away when the person starts the next one, grants the permission, or waves it off. The core answers `null` when it has
 * nothing to say (the decision model is off, the message is too short, a newer request is already waiting).
 */

/** The needs found for the last message sent in each chat, kept until that chat's next message starts or a newer one is sent. */
const needsByChat = new Map<string, PermissionNeed[]>();
const latestRequest = new Map<string, number>();
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of watchers) watcher();
}

/**
 * Reads the message that was just sent to the chat `taskId`, when `enabled` (the chat could act on a hint). The answer
 * lands in `needsByChat`; a failure shows nothing, as before the decision model.
 */
export function readSentMessage(taskId: string, message: string, enabled: boolean): void {
  const text = message.trim();
  const request = (latestRequest.get(taskId) ?? 0) + 1;
  latestRequest.set(taskId, request);
  if (needsByChat.delete(taskId)) announce();
  if (!enabled || text.length < PERMISSION_NEEDS_MIN_CHARS) return;
  void orglet.call('suggestPermissions', { text, taskId }).then(result => {
    if (!result || latestRequest.get(taskId) !== request) return;
    needsByChat.set(taskId, result.needs);
    announce();
  }, () => undefined);
}

/** What the last sent message in this chat needs, hidden while a new message is being typed. */
export function useSentMessageNeeds(taskId: string, typing: boolean): PermissionNeed[] {
  const [needs, setNeeds] = useState<PermissionNeed[]>(() => needsByChat.get(taskId) ?? []);
  useEffect(() => {
    const update = () => setNeeds(needsByChat.get(taskId) ?? []);
    update();
    watchers.add(update);
    return () => void watchers.delete(update);
  }, [taskId]);
  useEffect(() => {
    // The next message has begun, so the line about the last one is done.
    if (typing && needsByChat.delete(taskId)) announce();
  }, [typing, taskId]);
  return typing ? [] : needs;
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
 * The hint line about the last message sent from this box, or `fallback` when there is none: a line that matters less than
 * a permission the message needed, such as a plan nearly used up (COD-326). It stays out of the way while the next
 * message is typed.
 */
export function ComposerPermissionHint({ text, controls, fallback }: { text: string; controls: PermissionHintControls; fallback?: ReactNode }) {
  const needs = useSentMessageNeeds(controls.chatKey, text.trim().length > 0);
  const [dismissed, dismiss] = useDismissedHints(controls.chatKey);
  const need = controls.enabled ? missingNeed(needs, controls.permissions, dismissed) : undefined;
  if (!need) return fallback ?? null;
  return <PermissionHint need={need} folder={controls.permissions.workspace} disabled={controls.busy}
    onApply={() => controls.onApply(need)} onDismiss={() => dismiss(hintKind(need))} />;
}
