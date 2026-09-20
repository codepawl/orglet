import { Reply } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { MessageReaction } from '../../shared/message-interactions';
import { orglet } from '../api';
import { t } from '../i18n';
import { Button } from './ui';
import { reactionEmoji, reactionMeanings, reactionOrder, replyToAnswer } from './messageMarks';
import { ReactionBar, ReactionChip } from './ReactionBar';

export function MessageActions({ taskId, messageId, author, text, reactions, action, leading }: {
  taskId: string;
  messageId: string;
  author: string;
  text: string;
  reactions: readonly MessageReaction[];
  action: (fn: () => Promise<unknown>) => void;
  leading?: ReactNode;
}) {
  const options = reactionOrder.map(name => ({ name, emoji: reactionEmoji[name], meaning: reactionMeanings[name] }));
  const marks = reactions.filter(item => item.messageId === messageId);
  const userMarks = marks.filter(item => item.actor === 'user');
  const root = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!restoreFocus.current) return;
    const next = root.current?.querySelector<HTMLButtonElement>(userMarks.length > 0 ? '.reaction-chip' : '.reaction-bar > button');
    if (!next) return;
    next.focus();
    restoreFocus.current = false;
  }, [userMarks.length]);
  const setReaction = (emoji: MessageReaction['emoji'], active: boolean) => action(() => orglet.call('setMessageReaction', { taskId, messageId, emoji, active }));
  return <div className="message-actions" ref={root}>
    {leading}
    <Button size="icon" aria-label={t('Trả lời tin này')} title={t('Trả lời tin này')} onClick={() => replyToAnswer(taskId, messageId, author, text)}><Reply size={15} /></Button>
    {userMarks.length === 0 && <ReactionBar options={options} onPick={emoji => { restoreFocus.current = true; setReaction(emoji, true); }} />}
    {marks.map(mark => mark.actor === 'user'
      ? <ReactionChip key={`${mark.actor}:${mark.emoji}`} options={options} picked={mark.emoji} onClear={() => { restoreFocus.current = true; setReaction(mark.emoji, false); }} />
      : <span key={`${mark.actor}:${mark.workerId}:${mark.emoji}`} className="message-reaction" title={t('Tí đã thả {0}', [reactionMeanings[mark.emoji]])} aria-label={t('Tí đã thả {0}', [reactionMeanings[mark.emoji]])}>{reactionEmoji[mark.emoji]}</span>)}
  </div>;
}
