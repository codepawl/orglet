import { useSyncExternalStore } from 'react';
import type { MessageReaction, Reaction } from '../../shared/message-interactions';
import type { Run } from '../../shared/contracts';
import { t, translated } from '../i18n';

export type ReplyTarget = { taskId: string; messageId: string; author: string; text: string };
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

export type ReactionGroup = { emoji: Reaction; count: number; includesUser: boolean; label: string };

function reactorName(mark: MessageReaction, runs: readonly Run[]): string {
  if (mark.actor === 'user') return t('Bạn');
  const run = runs.find(item => item.snapshot.worker.id === mark.workerId);
  return run?.snapshot.worker.name ?? t('Tí');
}

/** The reactions on one message, one group per emoji in the bar's order, each naming who reacted. */
export function reactionGroups(marks: readonly MessageReaction[], runs: readonly Run[]): ReactionGroup[] {
  return reactionOrder.flatMap(emoji => {
    const matching = marks.filter(mark => mark.emoji === emoji);
    if (matching.length === 0) return [];
    const people = matching.map(mark => reactorName(mark, runs));
    const label = t('{0} người thả {1}: {2}', [matching.length, reactionEmoji[emoji], people.join(', ')]);
    return [{ emoji, count: matching.length, includesUser: matching.some(mark => mark.actor === 'user'), label }];
  });
}

/** Scrolls the original message into view and moves focus there, so a keyboard user lands on it too. */
export function focusMessage(messageId: string) {
  const original = document.getElementById(`message-${messageId}`);
  original?.scrollIntoView({ block: 'center' });
  original?.focus();
}

let target: ReplyTarget | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** One line of a Markdown answer as the reader sees it: no heading hashes, quote or list markers, emphasis or link syntax. */
export function plainExcerptLine(markdown: string) {
  const lines = markdown.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('```'));
  const first = lines[0] ?? '';
  return first
    .replace(/^(#{1,6}|>+|[-*+]|\d+[.)])\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, '$2')
    .trim();
}

export function replyToAnswer(taskId: string, messageId: string, author: string, text: string) {
  const line = plainExcerptLine(text);
  target = { taskId, messageId, author, text: line.length > 140 ? `${line.slice(0, 139).trimEnd()}…` : line };
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

export function briefWithReaction(text: string, reaction?: Reaction) {
  if (!reaction) return text;
  return `${t('Mình vừa thả {0} cho câu trả lời trước. {1}', [reactionEmoji[reaction], reactionMeanings[reaction]])}\n\n${text}`;
}
