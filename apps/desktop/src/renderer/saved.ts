import { useSyncExternalStore } from 'react';

/**
 * Messages saved for later (COD-366): "Save for later" on a message puts it in Activity's Saved view, the way Slack's
 * Saved items work. Like the notification list and the read stamps, this is UI chrome kept in this browser's storage,
 * not work in the workspace: a saved message only points at a chat and a message, with a short copy of its words so
 * the list reads without opening anything. A chat deleted since leaves its saved message as plain text.
 */
export type SavedMessage = {
  taskId: string;
  messageId: string;
  /** Who wrote it, as the chat showed it. */
  author: string;
  /** The first words of the message, enough to recognise it. */
  text: string;
  savedAt: string;
};

export const SAVED_LIMIT = 200;
export const SAVED_TEXT_LIMIT = 240;
const storageKey = 'orglet.saved';

export function savedKey(taskId: string, messageId: string): string {
  return `${taskId}:${messageId}`;
}

/** The words kept with a saved message: whitespace squeezed to single spaces, cut at a word and marked when cut. */
export function savedExcerpt(text: string): string {
  const squeezed = text.replace(/\s+/g, ' ').trim();
  if (squeezed.length <= SAVED_TEXT_LIMIT) return squeezed;
  const cut = squeezed.slice(0, SAVED_TEXT_LIMIT - 1);
  const wordEnd = cut.lastIndexOf(' ');
  return `${(wordEnd > SAVED_TEXT_LIMIT / 2 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

/** The list with this message saved, newest first and bounded; a message already saved moves to the top. */
export function withSaved(list: readonly SavedMessage[], message: SavedMessage): SavedMessage[] {
  const others = list.filter(item => savedKey(item.taskId, item.messageId) !== savedKey(message.taskId, message.messageId));
  return [message, ...others].slice(0, SAVED_LIMIT);
}

export function withoutSaved(list: readonly SavedMessage[], taskId: string, messageId: string): SavedMessage[] {
  return list.filter(item => savedKey(item.taskId, item.messageId) !== savedKey(taskId, messageId));
}

function isSavedMessage(value: unknown): value is SavedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return ['taskId', 'messageId', 'author', 'text', 'savedAt'].every(field => typeof item[field] === 'string');
}

function read(): SavedMessage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.filter(isSavedMessage).slice(0, SAVED_LIMIT) : [];
  } catch {
    return [];
  }
}

let saved = read();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function replace(next: SavedMessage[]) {
  saved = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    /* a blocked store costs the list its memory, not the app */
  }
  for (const listener of listeners) listener();
}

export function saveMessage(message: Omit<SavedMessage, 'savedAt' | 'text'> & { text: string }) {
  replace(withSaved(saved, { ...message, text: savedExcerpt(message.text), savedAt: new Date().toISOString() }));
}

export function unsaveMessage(taskId: string, messageId: string) {
  replace(withoutSaved(saved, taskId, messageId));
}

export function useSavedMessages(): readonly SavedMessage[] {
  return useSyncExternalStore(subscribe, () => saved, () => saved);
}
