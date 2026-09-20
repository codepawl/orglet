import { useSyncExternalStore } from 'react';
import { t } from '../i18n';

/**
 * Two marks a person can put on one answer, kept beside the thread rather than inside it.
 *
 * Both reach the worker, which is the point: a quote or a thumb that only changed the screen would be decoration.
 * They ride in the next brief, so the harness sees them the same way it sees anything else the person typed —
 * no schema, no migration, and nothing to strand if the shape changes later.
 *
 * The thread and the composer are siblings under App, so the state sits in a module the way `toast` does rather
 * than being threaded through props that only exist to carry it.
 */

export type ReplyTarget = { artifactId: string; author: string; text: string };
export type Reaction = 'up' | 'down';

const reactionStorageKey = 'orglet.answer-reactions';

function readReactions(): Record<string, Reaction> {
  try { return JSON.parse(localStorage.getItem(reactionStorageKey) || '{}') as Record<string, Reaction>; } catch { return {}; }
}

let target: ReplyTarget | undefined;
let reactions = readReactions();
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The first line or so of an answer: enough to recognise which one is being replied to. */
function excerpt(text: string) {
  const line = text.trim().split('\n').find(part => part.trim().length > 0) ?? '';
  return line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line;
}

export function replyToAnswer(artifactId: string, author: string, text: string) {
  target = { artifactId, author, text: excerpt(text) };
  emit();
}

export function clearReplyTarget() {
  if (!target) return;
  target = undefined;
  emit();
}

export function useReplyTarget() {
  return useSyncExternalStore(subscribe, () => target, () => undefined);
}

export function toggleReaction(artifactId: string, reaction: Reaction) {
  const next = { ...reactions };
  if (next[artifactId] === reaction) delete next[artifactId];
  else next[artifactId] = reaction;
  reactions = next;
  try { localStorage.setItem(reactionStorageKey, JSON.stringify(next)); } catch { /* a full or blocked store loses the mark, not the answer */ }
  emit();
}

export function useReaction(artifactId: string) {
  return useSyncExternalStore(subscribe, () => reactions[artifactId], () => undefined);
}

/**
 * What the worker is told, ahead of whatever the person typed. The quote names who said it so a crew can tell
 * which of them is being answered, and a thumb is stated plainly rather than as an emoji the model has to read.
 */
export function briefWithMarks(text: string, reply: ReplyTarget | undefined, reaction: Reaction | undefined, reactedTo: string | undefined) {
  const parts: string[] = [];
  if (reply) parts.push(t('Đang trả lời {0}: "{1}"', [reply.author, reply.text]));
  if (reaction && reactedTo) parts.push(reaction === 'up' ? t('Câu trả lời vừa rồi đúng hướng, giữ cách làm đó.') : t('Câu trả lời vừa rồi chưa ổn, thử hướng khác.'));
  return parts.length ? `${parts.join('\n')}\n\n${text}` : text;
}
