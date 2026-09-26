import { Forward, Reply, SmilePlus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MessageReaction, Reaction } from '../../shared/message-interactions';
import type { Run } from '../../shared/contracts';
import { orglet } from '../api';
import { t } from '../i18n';
import { Button } from './ui';
import { pickReaction, reactionEmoji, reactionGroups, reactionMeanings, reactionOrder, replyToAnswer, userReactionOn } from './messageMarks';
import { ReactionBadges, ReactionBar } from './ReactionBar';

/** The bridge call and the props every reaction control shares: which message, whose marks, and how to run a command. */
type ReactionProps = {
  taskId: string;
  messageId: string;
  reactions: readonly MessageReaction[];
  action: (fn: () => Promise<unknown>) => void;
};

/** Built at render, not at import: the meanings are translated, and the language can change after the module loads. */
function reactionOptions() {
  return reactionOrder.map(name => ({ name, emoji: reactionEmoji[name], meaning: reactionMeanings[name] }));
}

function useReactionPick({ taskId, messageId, reactions, action }: ReactionProps) {
  const current = userReactionOn(reactions, messageId);
  const pick = (name: Reaction) => {
    const { emoji, active } = pickReaction(current, name);
    action(() => orglet.call('setMessageReaction', { taskId, messageId, emoji, active }));
  };
  return { current, pick };
}

/**
 * The action row under a message: reply, forward, react and whatever the caller leads with (copy and download for
 * an answer). The reactions themselves are not here: they sit on the bubble's corner as `MessageBadges` (COD-219).
 * `onForward` opens the forward picker for this message (COD-257); without it the row has no Forward.
 */
export function MessageActions({ taskId, messageId, author, text, reactions, action, leading, onForward }: ReactionProps & {
  author: string;
  text: string;
  leading?: ReactNode;
  onForward?: () => void;
}) {
  const { current, pick } = useReactionPick({ taskId, messageId, reactions, action });
  return <div className="message-actions">
    {leading}
    <Button size="icon" aria-label={t('Trả lời tin này')} title={t('Trả lời tin này')} onClick={() => replyToAnswer(taskId, messageId, author, text)}><Reply size={15} /></Button>
    {onForward && <Button size="icon" aria-label={t('Chuyển tiếp tin này')} title={t('Chuyển tiếp tin này')} onClick={onForward}><Forward size={15} /></Button>}
    <ReactionBar options={reactionOptions()} picked={current} onPick={pick} label={t('Thả react')} icon={<SmilePlus size={15} />} />
  </div>;
}

/**
 * The reactions one message wears, the person's and the workers' together, anchored to the bubble that renders
 * it. `runs` name the workers behind their marks.
 */
export function MessageBadges({ taskId, messageId, reactions, runs, action, align }: ReactionProps & {
  runs: readonly Run[];
  align: 'start' | 'end' | 'inline';
}) {
  const { pick } = useReactionPick({ taskId, messageId, reactions, action });
  const marks = reactions.filter(item => item.messageId === messageId);
  const badges = reactionGroups(marks, runs).map(group => ({
    name: group.emoji, emoji: reactionEmoji[group.emoji], count: group.count, mine: group.includesUser, label: group.label,
  }));
  return <ReactionBadges badges={badges} align={align} onPick={pick} />;
}
