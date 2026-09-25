import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUp, ChevronUp, MessageSquarePlus, Reply, Square, X } from 'lucide-react';
import type { FolderIntake, Source, TaskDetail, Worker, Workspace } from '../../shared/contracts';
import { addToNextMessage } from '../../shared/incoming';
import { SourcePicker } from './SourcePicker';
import { insertMention, mentionOptions, mentionQueryAt } from '../../shared/mentions';
import { completeShortcodeAt, emojiChoices, insertEmoji, shortcodeQueryAt } from '../../shared/emoji-shortcodes';
import { Button } from './ui';
import { Avatar } from './Avatar';
import { Attachment } from './Attachment';
import { MentionText } from './mentions';
import { providerLabel, settingsTabFor, type Readiness } from './providers';
import { t, tMessage } from '../i18n';
import { taskWorkers } from '../assignees';
import { orglet } from '../api';
import { briefWithReaction, clearReplyTarget, useReplyTarget } from './messageMarks';
import { IslandDock } from './islandDock';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { canStartSideThread } from '../../shared/side-threads';

const SINGLE_LINE = 40;

export type MentionRoster = { people: readonly Worker[]; allNames?: readonly string[] };

/** A file attached to the message being written. `bytes` shows as the size on the card. */
export type ComposerAttachment = { id: string; name: string; bytes?: number };

/**
 * Where the strip should come to rest: as far along as it can go while a card still starts exactly at its left
 * edge (user, 2026-09-20). Scrolling to the very end lands mid-card, and the part left showing is a card's tail,
 * which is blank past the meta line — it reads as an empty tile rather than as "there is more this way". Stopping
 * on a whole number of cards puts the clipping on the right instead, where a card's icon and name are what peek.
 */
function restingScrollLeft(strip: HTMLUListElement) {
  const furthest = strip.scrollWidth - strip.clientWidth;
  const [first, second] = strip.children;
  if (!(first instanceof HTMLElement) || furthest <= 0) return Math.max(furthest, 0);
  const pitch = second instanceof HTMLElement ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  if (pitch <= 0) return furthest;
  return Math.floor(furthest / pitch) * pitch;
}

/**
 * ChatGPT-style prompt bar: a one-line pill with the add button, input and send button on one row.
 * It grows into a multi-line box once the text wraps or attachments appear, and stays grown until cleared
 * so the layout does not flip back and forth at the wrap point. Grown, it reads as three zones from the top:
 * the attached files as a strip of cards that scrolls sideways, the text, and the controls (add, who, send).
 * Team and group chats can pass `mentions` so `@` opens a worker picker. In every chat `:sk` offers matching emoji
 * and a finished `:skull:` turns into its emoji (COD-233).
 */
export function Composer({ value, onChange, onSubmit, onAlternateSubmit, label, placeholder, sendLabel, leading, trailing, attachments, onRemoveAttachment, context, disabled, sendDisabled, textareaRef, mentions, onStop }: { value: string; onChange: (value: string) => void; onSubmit: () => void;
  /** Ctrl+Shift+Enter (Cmd on macOS): the other way to send, where the bar has one ("in a new thread", COD-247). */
  onAlternateSubmit?: () => void; label: string; placeholder: string; sendLabel: string; leading: ReactNode; /** Sits left of the send button (e.g. who this message goes to). */ trailing?: ReactNode; attachments?: readonly ComposerAttachment[]; onRemoveAttachment?: (id: string) => void;
  /** The top zone of the grown bar, above the files: what this message answers, for example. */
  context?: ReactNode; disabled?: boolean; sendDisabled?: boolean; textareaRef?: RefObject<HTMLTextAreaElement | null>; mentions?: MentionRoster;
  /**
   * Set while a run is in progress: the send button becomes the stop button, turning a ring so the eye lands on
   * it (user, 2026-09-19). Stop belongs where send was, because that is where the hand already is, and nothing
   * can be sent while the worker is still answering.
   */
  onStop?: () => void }) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownRef;
  const highlight = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number>();
  const canSend = !disabled && !sendDisabled && value.trim().length > 0;
  const attachmentCount = attachments?.length ?? 0;
  const hasAttachments = attachmentCount > 0;
  const grown = hasAttachments || Boolean(context);
  // A file just added lands at the end of the strip, which may already be scrolled away; bring it into view so
  // the person sees what they attached. Removing one leaves the strip where it is.
  const previousAttachmentCount = useRef(attachmentCount);
  useLayoutEffect(() => {
    const grew = attachmentCount > previousAttachmentCount.current;
    previousAttachmentCount.current = attachmentCount;
    const element = strip.current;
    if (!grew || !element) return;
    // The bar grows to its expanded width in a later render than this one, so wait a frame before measuring:
    // a resting place worked out against the width the strip is about to stop having lands mid-card.
    const frame = requestAnimationFrame(() => {
      const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollTo({ left: restingScrollLeft(element), behavior: instant ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [attachmentCount]);
  // The strip scrolls sideways and hides its scrollbar, which leaves a plain mouse with no way to reach the files
  // scrolled off the edge. Take the wheel over the strip and scroll it sideways instead, but only while it has
  // somewhere to go, so an ordinary scroll of the page is never swallowed. The listener cannot be passive: it has
  // to stop the page from scrolling under the gesture it just consumed.
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const furthest = element.scrollWidth - element.clientWidth;
      if (furthest < 1) return;
      const next = Math.min(Math.max(element.scrollLeft + event.deltaY, 0), furthest);
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [hasAttachments]);
  const mentionable = Boolean(mentions && (mentions.people.length > 1 || mentions.allNames?.length));
  const query = mentionable && !disabled ? mentionQueryAt(value, cursor) : undefined;
  const options = query && query.start !== dismissed ? mentionOptions(query.query, mentions!.people) : [];
  const mentionOpen = options.length > 0;
  // A shortcode only opens its menu when an emoji fits, so ordinary writing never sets it off.
  const emojiQuery = !mentionOpen && !disabled ? shortcodeQueryAt(value, cursor) : undefined;
  const emojis = emojiQuery && emojiQuery.start !== dismissed ? emojiChoices(emojiQuery.query) : [];
  const emojiOpen = emojis.length > 0;
  const menuOpen = mentionOpen || emojiOpen;
  const optionCount = mentionOpen ? options.length : emojis.length;
  const activeIndex = Math.min(active, Math.max(0, optionCount - 1));
  const selected = mentionOpen ? options[activeIndex] : undefined;
  const selectedEmoji = emojiOpen ? emojis[activeIndex] : undefined;
  const activeOptionId = selected ? `${listId}-${selected.kind}-${selected.name}` : selectedEmoji ? `${listId}-emoji-${selectedEmoji.name}` : undefined;
  useLayoutEffect(() => { setActive(0); }, [query?.start, query?.query, emojiQuery?.start, emojiQuery?.query]);
  useLayoutEffect(() => {
    const element = textarea.current; if (!element) return;
    const measure = () => {
      // An empty bar is always one line; measuring then would pick up transient widths while the layout settles.
      if (!element.value) { element.style.height = ''; element.style.overflowY = 'hidden'; setExpanded(grown); return; }
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, 250)}px`;
      element.style.overflowY = element.scrollHeight > 250 ? 'auto' : 'hidden';
      setExpanded(current => grown || current || element.scrollHeight > SINGLE_LINE);
    };
    measure();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; measure(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, grown, textarea]);
  const syncCursor = (element: HTMLTextAreaElement) => setCursor(element.selectionStart ?? 0);
  const placeCursor = (position: number) => {
    requestAnimationFrame(() => {
      const element = textarea.current; if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
      setCursor(position);
    });
  };
  const pick = (option: typeof selected) => {
    if (!option) return;
    const next = insertMention(value, cursor, option.name);
    onChange(next.text);
    setDismissed(query?.start);
    placeCursor(next.cursor);
  };
  const pickEmoji = (choice: typeof selectedEmoji) => {
    if (!choice || !emojiQuery) return;
    const next = insertEmoji(value, cursor, emojiQuery, choice.emoji);
    onChange(next.text);
    placeCursor(next.cursor);
  };
  const changeText = (element: HTMLTextAreaElement) => {
    const completed = completeShortcodeAt(element.value, element.selectionStart ?? 0);
    if (completed) {
      onChange(completed.text);
      placeCursor(completed.cursor);
    } else {
      onChange(element.value);
      syncCursor(element);
    }
    setDismissed(undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const alternate = event.key === 'Enter' && event.shiftKey && (event.ctrlKey || event.metaKey);
    if (alternate && onAlternateSubmit && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onAlternateSubmit();
      return;
    }
    if (menuOpen) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % optionCount); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + optionCount) % optionCount); return; }
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(mentionOpen ? query?.start : emojiQuery?.start); return; }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (mentionOpen) pick(selected);
        else pickEmoji(selectedEmoji);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) onSubmit(); }
  };
  return <form className={`composer${expanded ? ' expanded' : ''}${trailing ? ' has-trailing' : ''}${context ? ' has-context' : ''}`} onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }}>
    {emojiOpen && <ul id={listId} className="mention-menu emoji-menu" role="listbox" aria-label={t('Chèn emoji')}>
      {emojis.map((choice, index) => {
        const optionId = `${listId}-emoji-${choice.name}`;
        return <li key={optionId} role="presentation">
          <button type="button" id={optionId} role="option" aria-selected={choice === selectedEmoji} className={index === activeIndex ? 'active' : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => pickEmoji(choice)}>
            <span className="emoji-glyph" aria-hidden="true">{choice.emoji}</span>
            <strong>:{choice.name}:</strong>
          </button>
        </li>;
      })}
    </ul>}
    {mentionOpen && <ul id={listId} className="mention-menu" role="listbox" aria-label={t('Gắn thẻ Tí')}>
      {options.map((option, index) => {
        const worker = option.kind === 'worker' ? mentions!.people.find(item => item.id === option.id) : undefined;
        const optionId = `${listId}-${option.kind}-${option.name}`;
        return <li key={optionId} role="presentation">
          <button type="button" id={optionId} role="option" aria-selected={option === selected} className={index === activeIndex ? 'active' : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => pick(option)}>
            {worker
              ? <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />
              : <span className="mention-all" aria-hidden="true">@</span>}
            <span><strong>@{option.name}</strong>{(option.kind === 'all' || worker?.description) && <small>{option.kind === 'all' ? t('Tất cả trong cuộc trò chuyện này') : worker?.description}</small>}</span>
          </button>
        </li>;
      })}
    </ul>}
    {context && <div className="composer-context">{context}</div>}
    {attachments && hasAttachments && <ul className="composer-attachments" ref={strip} aria-label={t('Tệp đính kèm')}>
      {attachments.map(item => <Attachment key={item.id} name={item.name} bytes={item.bytes} onRemove={onRemoveAttachment ? () => onRemoveAttachment(item.id) : undefined} />)}
    </ul>}
    <div className="composer-leading">{leading}</div>
    {/* The same string, painted above the box, so a tag is coloured while it is typed. The trailing newline gives
        the overlay the extra line a textarea shows for a trailing Enter, so the two never disagree on height. */}
    {mentionable && <div className="composer-highlight" ref={highlight} aria-hidden="true"><MentionText text={value} people={mentions!.people} allNames={mentions!.allNames} />{'\n'}</div>}
    <textarea ref={textarea} className={mentionable ? 'has-highlight' : undefined} aria-label={label} placeholder={placeholder} value={value} disabled={disabled} rows={1} maxLength={16000}
      onScroll={event => { if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop; }}
      aria-autocomplete="list" aria-controls={menuOpen ? listId : undefined} aria-expanded={menuOpen} aria-activedescendant={menuOpen ? activeOptionId : undefined}
      onChange={event => changeText(event.target)}
      onKeyUp={event => syncCursor(event.currentTarget)} onClick={event => syncCursor(event.currentTarget)} onSelect={event => syncCursor(event.currentTarget)}
      onKeyDown={onKeyDown} />
    {trailing && <div className="composer-trailing">{trailing}</div>}
    {onStop && canSend && <Button type="button" variant="primary" size="icon" className="send stop" aria-label={t('Dừng')} title={t('Dừng')} onClick={onStop}>
        <span className="send-spin" aria-hidden="true" />
        <Square size={11} fill="currentColor" />
      </Button>}
    {onStop && !canSend
      ? <Button type="button" variant="primary" size="icon" className="send stop" aria-label={t('Dừng')} title={t('Dừng')} onClick={onStop}>
        <span className="send-spin" aria-hidden="true" />
        <Square size={11} fill="currentColor" />
      </Button>
      : <Button type="submit" variant="primary" size="icon" className="send" aria-label={sendLabel} disabled={!canSend}><ArrowUp size={19} /></Button>}
  </form>;
}

/**
 * What arrives in the bar from outside it (COD-246): an `orglet://new` link's text, or files sent from Explorer or
 * carried over from an empty chat. `at` tells two arrivals with the same content apart.
 */
export type ComposerPrefill = { text?: string; intake?: FolderIntake; at: number };

/** A link's text goes after a draft already in the bar, never over it. */
export function withPrefill(current: string, prefill: string): string {
  if (!current.trim()) return prefill;
  return `${current}\n\n${prefill}`;
}

/**
 * Follow-up bar under a task: the next message of a chat that already has one. It carries the files the latest
 * message had, plus any added here with + (or sent from Explorer), which sit on the bar as cards the way an empty
 * chat's do (COD-257; an older "Attach files" dialog used to take them). While a run is on, the island saying what the
 * worker is doing sits on the bar's top edge (COD-167, `IslandDock`). `prefill` fills it without sending;
 * `onPrefilled` lets the caller forget it once it is in.
 */
export function FollowUpComposer({ detail, workspace, ready, openSettings, openChat, action, prefill, onPrefilled }: { detail: TaskDetail; workspace: Workspace; ready: Readiness; openSettings: (tab?: 'connections' | 'harness') => void; /** Opens another chat, such as a side thread just started from this one. */ openChat: (taskId: string) => void; action: (fn: () => Promise<unknown>) => void; prefill?: ComposerPrefill; onPrefilled?: () => void }) {
  const [text, setText] = useState('');
  // Files added for the next message, and what could not be added with the reason, as in the empty chat.
  const [added, setAdded] = useState<FolderIntake>({ sources: [], skipped: [] });
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!prefill) return;
    if (prefill.text) {
      const prefillText = prefill.text;
      setText(current => withPrefill(current, prefillText));
    }
    if (prefill.intake) addFiles(prefill.intake);
    textarea.current?.focus();
    onPrefilled?.();
  }, [prefill?.at]);
  const [submitting, setSubmitting] = useState(false);
  const input = detail.task.currentInput ?? detail.task;
  const workers = taskWorkers(detail.task, workspace);
  const team = detail.task.teamId ? workspace.teams.find(item => item.id === detail.task.teamId) : undefined;
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const missing = providers.filter(provider => !ready[provider]);
  const selectedReply = useReplyTarget();
  const reply = selectedReply?.taskId === detail.task.id ? selectedReply : undefined;
  // Only the newest answer can be marked as the one to keep going from; an older thumb is history, not an instruction.
  const latestAnswer = detail.artifacts.at(-1)?.id;
  const reaction = detail.task.messageReactions?.findLast(item => item.messageId === latestAnswer && item.actor === 'user')?.emoji;
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const blocked = missing.length > 0;
  // An MCP approval card is answered with its buttons; typing sends a new message instead (COD-241).
  const pendingDecision = detail.task.decisionRequests?.findLast(request => request.inputRevision === (detail.task.inputRevision ?? 0) && !request.answer && !request.interruptedAt && !request.approval);
  const send = () => {
    const extra = text.trim(); if (!extra || blocked || detail.task.pendingStart || submitting) return;
    setSubmitting(true);
    // A question is answered in words; a message that brings files is a new message instead.
    if (detail.task.status === 'waiting_input' && pendingDecision && added.sources.length === 0) {
      action(async () => { try { await orglet.call('answerDecision', { taskId: detail.task.id, requestId: pendingDecision.id, answer: extra }); setText(current => current === text ? '' : current); clearReplyTarget(); } finally { setSubmitting(false); } });
      return;
    }
    const brief = briefWithReaction(extra, reaction);
    const sent = added.sources;
    action(async () => {
      try {
        await orglet.call('reviseTask', { taskId: detail.task.id, brief, replyTo: reply?.messageId, sourceIds: nextSourceIds(), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros });
        setText(current => current === text ? '' : current);
        clearSentFiles(sent);
        clearReplyTarget();
      } finally { setSubmitting(false); }
    });
  };
  /** The files the next message carries: the latest turn's, minus any whose access was taken back. */
  function carriedSources() {
    return input.sourceIds.filter(id => !detail.sources.find(source => source.id === id)?.revoked);
  }
  /** What the next message sends: the files it carries, then the ones added on the bar. */
  function nextSourceIds() {
    return [...new Set([...carriedSources(), ...added.sources.map(source => source.id)])];
  }
  /**
   * Adds picked or sent files after the ones already going with the next message; past 20 in all, or a file the
   * picker could not take, is listed under the bar with the reason, as the empty chat lists it.
   */
  function addFiles(intake: FolderIntake) {
    const carried = detail.sources.filter(source => carriedSources().includes(source.id));
    setAdded(current => addToNextMessage(carried, current, intake));
  }
  /** Once a message went, its files are part of the chat; anything added while it was on its way stays. */
  function clearSentFiles(sent: readonly Source[]) {
    const sentIds = sent.map(source => source.id);
    setAdded(current => ({ sources: current.sources.filter(source => !sentIds.includes(source.id)), skipped: [] }));
  }
  const removeFile = (sourceId: string) => setAdded(current => ({ ...current, sources: current.sources.filter(source => source.id !== sourceId) }));
  // An orglet's own main chat can send a message into a new side thread instead (COD-247); crews and group chats cannot.
  const sideThreads = canStartSideThread(detail.task);
  const sendInNewThread = () => {
    const brief = text.trim();
    if (!brief || blocked || submitting) return;
    setSubmitting(true);
    const orgletName = workers[0]?.name ?? 'Orglet';
    const sent = added.sources;
    action(async () => {
      try {
        const sideTaskId = await orglet.call('startSideThread', { taskId: detail.task.id, brief, sourceIds: nextSourceIds(), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros });
        setText(current => current === text ? '' : current);
        clearSentFiles(sent);
        toast(t('Đã mở chat phụ'), 'success', orgletName, { action: { label: t('Mở'), onSelect: () => openChat(sideTaskId) } });
      } finally { setSubmitting(false); }
    });
  };
  const sendOptions = sideThreads ? <RowMenu className="composer-send-options" label={t('Tùy chọn gửi')} icon={ChevronUp} disabled={!text.trim() || blocked || submitting}
    items={[{ label: t('Gửi trong chat phụ mới'), icon: MessageSquarePlus, shortcut: 'Ctrl+Shift+Enter', onSelect: sendInNewThread }]} /> : undefined;
  return <div className="thread-composer">
    <IslandDock />
    <Composer textareaRef={textarea} value={text} onChange={setText} onSubmit={send} onAlternateSubmit={sideThreads ? sendInNewThread : undefined} trailing={sendOptions} label={t('Tin nhắn')} placeholder={detail.task.pendingStart ? t('Đang chuyển sang yêu cầu mới…') : busy ? t('Nhắn để đổi hướng đang làm…') : pendingDecision ? t('Trả lời câu hỏi…') : t('Nhắn tiếp…')} sendLabel={t('Gửi tin nhắn')} disabled={Boolean(detail.task.pendingStart) || submitting} sendDisabled={blocked}
      onStop={busy || detail.task.pendingStart ? () => action(() => orglet.call('cancel', { id: detail.task.id })) : undefined}
      mentions={workers.length > 1 || team ? { people: workers, ...(team ? { allNames: [team.name] } : {}) } : undefined}
      context={reply && !pendingDecision ? <div className="composer-reply">
        <Reply size={14} aria-hidden="true" />
        <p><strong>{reply.author}</strong><span>{reply.text}</span></p>
        <Button type="button" size="icon" aria-label={t('Bỏ trả lời')} title={t('Bỏ trả lời')} onClick={clearReplyTarget}><X size={14} /></Button>
      </div> : undefined}
      attachments={added.sources} onRemoveAttachment={removeFile}
      leading={<SourcePicker onFiles={() => action(async () => addFiles({ sources: await orglet.pickSources(), skipped: [] }))} onFolder={() => action(async () => addFiles(await orglet.pickFolder()))} />} />
    {added.skipped.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [added.skipped.length])}</summary><ul>{added.skipped.map((item, index) => <li key={index}>{item.name}: {tMessage(item.reason)}</li>)}</ul></details>}
    {!busy && blocked && <p className="composer-note">{t('Cần kết nối {0} trước khi gửi.', [missing.map(providerLabel).join(t(' và '))])}<button type="button" onClick={() => openSettings(settingsTabFor(missing))}>{t('Mở Cài đặt')}</button></p>}
  </div>;
}
