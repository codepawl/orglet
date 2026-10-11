import { useContext, useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, BookmarkX, Copy, Ellipsis, Forward, Reply, SmilePlus, TextCursorInput, Trash2 } from 'lucide-react';
import type { MessageReaction, Reaction } from '../../shared/message-interactions';
import type { FormatPreference, Run, TextFormat } from '../../shared/contracts';
import { orglet } from '../api';
import { t } from '../i18n';
import { formatMenuItems, FormatPreferences } from './FormatAction';
import { pickReaction, reactionEmoji, reactionGroups, reactionMeanings, reactionOrder, replyToAnswer, userReactionOn } from './messageMarks';
import { ReactionBadges, ReactionBar } from './ReactionBar';
import { Button } from './ui';
import { Tooltip } from '@codepawlhq/orglet-ui';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { saveMessage, unsaveMessage, useSavedMessages, savedKey } from '../saved';
import type { RowMenuIcon } from '@codepawlhq/orglet-ui';

/** The bridge call and the props every reaction control shares: which message, whose marks, and how to run a command. */
type ReactionProps = {
  taskId: string;
  messageId: string;
  reactions: readonly MessageReaction[];
  action: (fn: () => Promise<unknown>) => void;
};

/** What a message's menu does beyond the common actions: copy and download an answer, and anything the caller leads with. */
type ArtifactCommands = {
  onCopy: (format: TextFormat) => void;
  onDownload: (format: TextFormat) => void;
};

/** The message's own element, so a selection can be recognised as inside it. */
const MESSAGE_SELECTOR = '.person-message, .assistant-message, .details-team-message';

/** Each reaction's emoji drawn as the menu item's icon; built once so the icon components keep one identity across renders. */
const reactionIcons = {} as Record<Reaction, RowMenuIcon>;
for (const name of reactionOrder) {
  reactionIcons[name] = () => <span className="message-menu-emoji" aria-hidden="true">{reactionEmoji[name]}</span>;
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
 * The text the person has selected inside this message, read when the menu is about to open. The menu opens on a
 * right-click or from its trigger, and by then the selection is the only thing that says what to copy.
 */
function useSelectionInMessage() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const message = anchor.current?.closest(MESSAGE_SELECTOR);
    if (!message) return;
    const readSelection = () => {
      const selection = window.getSelection();
      const inside = selection && !selection.isCollapsed && message.contains(selection.anchorNode) && message.contains(selection.focusNode);
      setSelected(inside ? selection.toString().trim() : '');
    };
    // Capture phase, so the selection is read before the menu opens on the same event.
    message.addEventListener('contextmenu', readSelection, true);
    message.addEventListener('click', readSelection, true);
    return () => {
      message.removeEventListener('contextmenu', readSelection, true);
      message.removeEventListener('click', readSelection, true);
    };
  }, []);
  return { anchor, selected };
}

/** The entries of a message's actions, grouped the way the toolbar lays them out; the right-click menu is these, flattened. */
type ActionGroups = {
  selection: RowMenuItem[];
  reply: RowMenuItem;
  reactions: RowMenuItem[];
  /** Copy first, then the download choices; an answer has both, the person's message only a plain copy. */
  copy: RowMenuItem[];
  forward: RowMenuItem[];
  save: RowMenuItem;
  /** Delete message: in the right-click menu only, last. */
  remove: RowMenuItem[];
  extras: RowMenuItem[];
};

/**
 * Every action of a message once, for both the floating toolbar and the right-click menu, so the two call the same
 * handlers. Pure, so a test can read it.
 */
export function messageActionGroups({ selected, artifact, formatPreferences, extraItems, current, isSaved, onCopySelection, onCopyMessage, onReply, onForward, onPick, onToggleSaved, onDelete }: {
  selected: string;
  artifact?: ArtifactCommands;
  formatPreferences: Record<'copy' | 'download', FormatPreference>;
  extraItems?: RowMenuItem[];
  current: Reaction | undefined;
  isSaved: boolean;
  onCopySelection: () => void;
  /** Copies a message that has no answer behind it (the person's own text). */
  onCopyMessage: () => void;
  onReply: () => void;
  onForward?: () => void;
  onPick: (name: Reaction) => void;
  onToggleSaved: () => void;
  /** Present when this message can be deleted; `working` is true while the chat has a run in progress. */
  onDelete?: { working: boolean; run: () => void };
}): ActionGroups {
  return {
    selection: selected ? [{ label: t('Sao chép phần đã chọn'), icon: TextCursorInput, onSelect: onCopySelection }] : [],
    reply: { label: t('Trả lời tin này'), icon: Reply, onSelect: onReply },
    reactions: reactionOrder.map(name => ({ label: reactionMeanings[name], icon: reactionIcons[name], checked: current === name, inline: true, onSelect: () => onPick(name) })),
    copy: artifact
      ? [...formatMenuItems('copy', formatPreferences.copy, artifact.onCopy), ...formatMenuItems('download', formatPreferences.download, artifact.onDownload)]
      : [{ label: t('Sao chép'), icon: Copy, onSelect: onCopyMessage }],
    forward: onForward ? [{ label: t('Chuyển tiếp tin này'), icon: Forward, onSelect: onForward }] : [],
    save: isSaved
      ? { label: t('Bỏ lưu tin này'), icon: BookmarkX, onSelect: onToggleSaved }
      : { label: t('Lưu để xem sau'), icon: Bookmark, onSelect: onToggleSaved },
    extras: extraItems ?? [],
    remove: onDelete ? [{
      label: t('Xóa tin nhắn'), icon: Trash2, danger: true, disabled: onDelete.working, onSelect: onDelete.run,
      hint: onDelete.working ? t('Không xóa được khi cuộc trò chuyện đang chạy.') : undefined,
      confirm: { question: t('Xóa khỏi máy này và không hoàn tác được; máy khác đã đăng nhập vẫn giữ bản của nó.'), label: t('Xóa tin nhắn') },
    }] : [],
  };
}

/** The right-click menu, in the toolbar's order: copy selection, reply, the reactions, copy and download, forward, save, extras. */
export function messageMenuItems(parts: Parameters<typeof messageActionGroups>[0]): RowMenuItem[] {
  const groups = messageActionGroups(parts);
  return [...groups.selection, groups.reply, ...groups.reactions, ...groups.copy, ...groups.forward, groups.save, ...groups.extras, ...groups.remove];
}

/** A toolbar button for an item, so the toolbar and the menu share one handler and one label. */
function ItemButton({ item }: { item: RowMenuItem }) {
  const Icon = item.icon;
  return <Tooltip label={item.label}><Button size="icon" aria-label={item.label} disabled={item.disabled} onClick={item.onSelect}><Icon size={15} /></Button></Tooltip>;
}

/**
 * A message's actions in two places that share their handlers. The toolbar floats at the message's top right and shows
 * while the pointer is over the message or focus is inside it (COD-365, the way Slack does it): Reply, React, Copy
 * (which holds Download), Forward, Save for later, then whatever the caller adds, then a visible "more" button. A
 * right-click anywhere on the message opens the full menu at the pointer; so do the "more" button, Shift+F10 and the
 * context-menu key. The reactions themselves also sit under the message as `MessageBadges` (COD-219). `onForward`
 * opens the forward picker (COD-257); without it there is no Forward. The person's own message has no answer to
 * download, so its Copy is one button that copies its text.
 */
export function MessageActions({ taskId, messageId, author, text, reactions, action, artifact, extraItems, onForward, chatWorking }: ReactionProps & {
  author: string;
  text: string;
  /** Copy and download, for an answer. */
  artifact?: ArtifactCommands;
  /** Items after Save for later, such as bringing a side thread's answer into the main chat. */
  extraItems?: RowMenuItem[];
  onForward?: () => void;
  /** Offers Delete message in the right-click menu (never in the toolbar): true while the chat has a run in progress, which disables it. Absent: no Delete. */
  chatWorking?: boolean;
}) {
  const { current, pick } = useReactionPick({ taskId, messageId, reactions, action });
  const formatPreferences = useContext(FormatPreferences);
  const { anchor, selected } = useSelectionInMessage();
  // Save for later (COD-366): the message goes to Activity's Saved view, and the same button takes it off again.
  const isSaved = useSavedMessages().some(item => savedKey(item.taskId, item.messageId) === savedKey(taskId, messageId));
  const toggleSaved = () => isSaved ? unsaveMessage(taskId, messageId) : saveMessage({ taskId, messageId, author, text });
  const parts = {
    selected, artifact, formatPreferences, extraItems, current, isSaved,
    onCopySelection: () => void orglet.copyText(selected),
    onCopyMessage: () => void orglet.copyText(text),
    onReply: () => replyToAnswer(taskId, messageId, author, text),
    onForward, onPick: pick, onToggleSaved: toggleSaved,
    onDelete: chatWorking === undefined ? undefined : {
      working: chatWorking,
      run: () => action(async () => {
        await orglet.call('deleteMessage', { taskId, messageId });
        // A saved entry that points at a message that is gone would open on nothing.
        unsaveMessage(taskId, messageId);
      }),
    },
  };
  const groups = messageActionGroups(parts);
  const options = reactionOrder.map(name => ({ name, emoji: reactionEmoji[name], meaning: reactionMeanings[name] }));
  return <div className="message-actions" role="group" aria-label={t('Thao tác với tin nhắn')}>
    <span ref={anchor} className="message-menu-anchor" hidden />
    <ItemButton item={groups.reply} />
    <ReactionBar options={options} picked={current} onPick={pick} label={t('Thả react')} icon={<SmilePlus size={15} />} />
    {groups.copy.length === 1
      ? <ItemButton item={groups.copy[0]} />
      : <RowMenu label={t('Sao chép')} icon={Copy} className="format-action" align="start" items={groups.copy} />}
    {groups.forward.map(item => <ItemButton key={item.label} item={item} />)}
    <Tooltip label={groups.save.label}><Button size="icon" aria-label={groups.save.label} aria-pressed={isSaved} className={isSaved ? 'message-saved' : undefined} onClick={groups.save.onSelect}>{isSaved ? <BookmarkCheck size={15} fill="currentColor" /> : <Bookmark size={15} />}</Button></Tooltip>
    {groups.extras.map(item => <ItemButton key={item.label} item={item} />)}
    <RowMenu label={t('Thêm thao tác')} icon={Ellipsis} className="format-action" contextMenuOf={MESSAGE_SELECTOR} items={messageMenuItems(parts)} />
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
