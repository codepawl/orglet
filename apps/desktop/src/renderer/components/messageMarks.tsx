import { useSyncExternalStore } from 'react';
import type { Reaction } from '../../shared/message-interactions';
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

let target: ReplyTarget | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function replyToAnswer(taskId: string, messageId: string, author: string, text: string) {
  const line = text.trim().split('\n').find(part => part.trim().length > 0) ?? '';
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
