import { Reply } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { MessageReaction } from '../../shared/message-interactions';
import type { Run } from '../../shared/contracts';
import { orglet } from '../api';
import { t } from '../i18n';
import { Button } from './ui';
import { reactionEmoji, reactionGroups, reactionMeanings, reactionOrder, replyToAnswer } from './messageMarks';
import { ReactionBar, ReactionChip } from './ReactionBar';

export function MessageActions({ taskId, messageId, author, text, reactions, runs, action, leading }: {
  taskId: string;
  messageId: string;
  author: string;
  text: string;
  reactions: readonly MessageReaction[];
  runs: readonly Run[];
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
    {reactionGroups(marks, runs).map(group => group.includesUser
      ? <ReactionChip key={group.emoji} options={options} picked={group.emoji} count={group.count} label={group.label}
        onClear={() => { restoreFocus.current = true; setReaction(group.emoji, false); }} />
      : <span key={group.emoji} className="message-reaction" title={group.label} aria-label={group.label}>
        {reactionEmoji[group.emoji]}{group.count > 1 && <span>{group.count}</span>}
      </span>)}
  </div>;
}
