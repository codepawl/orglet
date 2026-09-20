import { useSyncExternalStore } from 'react';
import { t, translated } from '../i18n';

/**
 * Two things a person can do to one message, kept beside the thread rather than inside it.
 *
 * Both reach the worker, which is the point: a quote or a reaction that only changed the screen would be
 * decoration. They ride in the next brief, so the harness sees them the same way it sees anything else the person
 * typed — no schema, no migration, and nothing stranded if the shape changes later.
 *
 * The thread and the composer are siblings under App, so the state sits in a module the way `toast` does rather
 * than being threaded through props that only exist to carry it.
 */

export type ReplyTarget = { artifactId: string; author: string; text: string };

/**
 * The reactions an orglet can be given. Each carries what it should mean to the worker next time, because a
 * reaction that the model never hears about is an emoji that does nothing (user, 2026-09-20). Kept to six: a
 * wall of faces is a decision, and picking one should take no thought.
 */
export type Reaction = 'agree' | 'delighted' | 'funny' | 'unsure' | 'watching' | 'against';
/** Stored and sent as a name rather than a codepoint, so a change of face later does not strand what was saved. */
export const reactionEmoji: Record<Reaction, string> = { agree: '👍', delighted: '🎉', funny: '😂', unsure: '🤔', watching: '👀', against: '👎' };
export const reactionMeanings: Record<Reaction, string> = translated({
  agree: 'Mình thấy ổn, giữ hướng này.',
  delighted: 'Đúng cái mình cần, làm tiếp kiểu này.',
  funny: 'Câu này vui thật, cứ thoải mái như vậy.',
  unsure: 'Mình còn nghi chỗ này, giải thích kỹ hơn.',
  watching: 'Mình đang soi kỹ đoạn này, cẩn thận với nó.',
  against: 'Chưa ổn, thử hướng khác.',
});
export const reactionOrder = Object.keys(reactionEmoji) as Reaction[];

const reactionStorageKey = 'orglet.message-reactions';

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

export function toggleReaction(messageId: string, reaction: Reaction) {
  const next = { ...reactions };
  if (next[messageId] === reaction) delete next[messageId];
  else next[messageId] = reaction;
  reactions = next;
  try { localStorage.setItem(reactionStorageKey, JSON.stringify(next)); } catch { /* a full or blocked store loses the mark, not the message */ }
  emit();
}

export function useReaction(messageId: string) {
  return useSyncExternalStore(subscribe, () => reactions[messageId], () => undefined);
}

/**
 * What the worker is told, ahead of whatever the person typed. The quote names who said it so a crew can tell
 * which of them is being answered, and a reaction is spelled out rather than left as a glyph to interpret.
 */
export function briefWithMarks(text: string, reply: ReplyTarget | undefined, reaction: Reaction | undefined) {
  const parts: string[] = [];
  if (reply) parts.push(t('Đang trả lời {0}: "{1}"', [reply.author, reply.text]));
  if (reaction) parts.push(t('Mình vừa thả {0} cho câu trả lời trước. {1}', [reactionEmoji[reaction], reactionMeanings[reaction]]));
  return parts.length ? `${parts.join('\n')}\n\n${text}` : text;
}
