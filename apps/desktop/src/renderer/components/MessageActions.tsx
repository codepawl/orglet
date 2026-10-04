import { Bookmark, BookmarkCheck, Forward, Reply, SmilePlus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MessageReaction, Reaction } from '../../shared/message-interactions';
import type { Run } from '../../shared/contracts';
import { orglet } from '../api';
import { t } from '../i18n';
import { Button } from './ui';
import { pickReaction, reactionEmoji, reactionGroups, reactionMeanings, reactionOrder, replyToAnswer, userReactionOn } from './messageMarks';
import { ReactionBadges, ReactionBar } from './ReactionBar';
import { saveMessage, unsaveMessage, useSavedMessages, savedKey } from '../saved';

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
 * A message's toolbar: reply, forward, react and whatever the caller leads with (copy and download for an answer).
 * It floats at the message's top right and shows while the pointer is over the message or focus is inside it (COD-365,
 * the way Slack does it), so it stays in the tab order and every button keeps its name. The reactions themselves are
 * not here: they sit under the message as `MessageBadges` (COD-219). `onForward` opens the forward picker for this
 * message (COD-257); without it the toolbar has no Forward.
 */
export function MessageActions({ taskId, messageId, author, text, reactions, action, leading, onForward }: ReactionProps & {
  author: string;
  text: string;
  leading?: ReactNode;
  onForward?: () => void;
}) {
  const { current, pick } = useReactionPick({ taskId, messageId, reactions, action });
  // Save for later (COD-366): the message goes to Activity's Saved view, and the same button takes it off again.
  const isSaved = useSavedMessages().some(item => savedKey(item.taskId, item.messageId) === savedKey(taskId, messageId));
  const toggleSaved = () => isSaved ? unsaveMessage(taskId, messageId) : saveMessage({ taskId, messageId, author, text });
  return <div className="message-actions" role="group" aria-label={t('Thao tác với tin nhắn')}>
    {leading}
    <Button size="icon" aria-label={t('Trả lời tin này')} title={t('Trả lời tin này')} onClick={() => replyToAnswer(taskId, messageId, author, text)}><Reply size={15} /></Button>
    {onForward && <Button size="icon" aria-label={t('Chuyển tiếp tin này')} title={t('Chuyển tiếp tin này')} onClick={onForward}><Forward size={15} /></Button>}
    <ReactionBar options={reactionOptions()} picked={current} onPick={pick} label={t('Thả react')} icon={<SmilePlus size={15} />} />
    <Button size="icon" aria-label={isSaved ? t('Bỏ lưu tin này') : t('Lưu để xem sau')} title={isSaved ? t('Bỏ lưu tin này') : t('Lưu để xem sau')} aria-pressed={isSaved} className={isSaved ? 'message-saved' : undefined} onClick={toggleSaved}>{isSaved ? <BookmarkCheck size={15} fill="currentColor" /> : <Bookmark size={15} />}</Button>
  </div>;
}

/**
 * The reactions one message wears, the person's and the workers' together, in a row under the message (COD-365).
 * `runs` name the workers behind their marks. Nothing is drawn for a message nobody reacted to.
 */
export function MessageBadges({ taskId, messageId, reactions, runs, action }: ReactionProps & {
  runs: readonly Run[];
}) {
  const { pick } = useReactionPick({ taskId, messageId, reactions, action });
  const marks = reactions.filter(item => item.messageId === messageId);
  const badges = reactionGroups(marks, runs).map(group => ({
    name: group.emoji, emoji: reactionEmoji[group.emoji], count: group.count, mine: group.includesUser, label: group.label,
  }));
  if (badges.length === 0) return null;
  return <ReactionBadges badges={badges} align="inline" onPick={pick} />;
}

/** Whether a message wears any reaction, so its foot row can be left out when it would be empty. */
export function hasReactions(reactions: readonly MessageReaction[], messageId: string): boolean {
  return reactions.some(item => item.messageId === messageId);
}
