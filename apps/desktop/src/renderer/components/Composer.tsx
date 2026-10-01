import { Children, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUp, ChevronRight, ChevronUp, MessageSquarePlus, Plug, Reply, Square, X } from 'lucide-react';
import type { FolderIntake, Run, Source, TaskDetail, Worker, Workspace } from '../../shared/contracts';
import { addToNextMessage } from '../../shared/incoming';
import { MessageBoxFocus, SourcePicker } from './SourcePicker';
import { insertMention, mentionOptions, mentionQueryAt } from '../../shared/mentions';
import { completeShortcodeAt, emojiChoices, insertEmoji, shortcodeQueryAt } from '../../shared/emoji-shortcodes';
import { Button } from './ui';
import { Avatar } from './Avatar';
import { Attachment } from './Attachment';
import { MentionText } from './mentions';
import { providerLabel, settingsTabFor, type Readiness } from './providers';
import { t, tMessage } from '../i18n';
import { taskWorkers } from '../assignees';
import { demoWorkerToConnect } from '../chatSettings';
import { orglet } from '../api';
import { clearReplyTarget, useReplyTarget } from './messageMarks';
import { IslandDock, useDockedIsland } from './islandDock';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { canStartSideThread } from '../../shared/side-threads';
import { keepDraft, readDraft, taskDraftKey } from '../drafts';
import { planFirstChosen, setPlanFirst } from '../planFirst';
import { overflowAttributes, useStripOverflow } from '../stripOverflow';
import { ComposerPermissionHint, type PermissionHintControls } from '../permissionHints';
import type { HarnessInfo } from '../../shared/harness';
import { useComposerUsage } from '../planUsage';
import { PlanUsageNote, UsageRing } from './PlanUsage';
import { chatContextFor, usageRingFor, type ContextWorker } from '../../shared/composer-usage';
import { isHarness } from '../../shared/harness';
import { modelLists } from '../caches';
import { useCachedEach } from '../prefetch';
import { Skeleton } from '@codepawl/orglet-ui';

const SINGLE_LINE = 40;

export type MentionRoster = { people: readonly Worker[]; allNames?: readonly string[] };

/**
 * The bar empties the moment a message is sent, so the next one can be typed while the first is on its way (COD-284).
 * If sending fails, the message comes back in front of whatever was typed since.
 */
export function restoreUnsent(unsent: string, typedSince: string): string {
  if (!typedSince.trim()) return unsent;
  return `${unsent}\n\n${typedSince}`;
}

/** Files a pick could not add, folded under one line that counts them, with the app's own chevron (COD-292). */
export function SkippedFiles({ items }: { items: readonly { name: string; reason: string }[] }) {
  if (!items.length) return null;
  const summary = items.length === 1 ? t('1 mục không được thêm vào chat') : t('{0} mục không được thêm vào chat', [items.length]);
  return <details className="intake-skipped">
    <summary className="activity-summary"><ChevronRight size={13} aria-hidden="true" className="activity-chevron" />{summary}</summary>
    <ul>{items.map((item, index) => <li key={index}>{item.name}: {tMessage(item.reason)}</li>)}</ul>
  </details>;
}

/** A file attached to the message being written. `bytes` shows as the size on the card. */
export type ComposerAttachment = { id: string; name: string; bytes?: number };

/**
 * Where the strip comes to rest after a file is added: its very end, so the card just added shows whole (COD-292).
 * It used to stop on a whole card (user, 2026-09-20), because a card cut at the left edge shows its blank tail and read
 * as an empty tile; but that left the newest card cut on the right and the first file gone with no sign. The strip's
 * left end now fades out while cards are scrolled past it, so the cut card reads as "there is more this way".
 */
function restingScrollLeft(strip: HTMLUListElement) {
  return Math.max(strip.scrollWidth - strip.clientWidth, 0);
}

/**
 * The prompt bar: a box holding only the text and the send button, with a toolbar row directly under it (owner's
 * reference, 2026-09-30): the add button at its left, and at its right the model or recipient control followed by the
 * plan usage ring, all on one centred line. The box grows into a multi-line box once the text wraps or attachments
 * appear, and stays grown until cleared so the layout does not flip back and forth at the wrap point. Grown, it reads
 * as zones from the top: what the message answers, the attached files as a strip of cards that scrolls sideways, then
 * the text with send beside its last line.
 * Team and group chats can pass `mentions` so `@` opens a worker picker. In every chat `:sk` offers matching emoji
 * and a finished `:skull:` turns into its emoji (COD-233).
 */
export function Composer({ value, onChange, onSubmit, onAlternateSubmit, label, placeholder, sendLabel, leading, mode, trailing, usage, attachments, onRemoveAttachment, context, disabled, sendDisabled, textareaRef, mentions, onStop }: { value: string; onChange: (value: string) => void; onSubmit: () => void;
  /** Ctrl+Shift+Enter (Cmd on macOS): the other way to send, where the bar has one ("in a new thread", COD-247). */
  onAlternateSubmit?: () => void; label: string; placeholder: string; sendLabel: string; /** The toolbar's left end: the add button. */ leading: ReactNode;
  /** Right after the add button: the approval mode (COD-367), an item of the row itself so it shares the row's line. */ mode?: ReactNode;
  /** The toolbar's right end, before the usage ring: who this message goes to, the model, or the send options. */ trailing?: ReactNode;
  /** The plan usage ring (or its waiting placeholder) at the toolbar's far right (COD-326, `usePlanUsageBar`). */ usage?: ReactNode;
  attachments?: readonly ComposerAttachment[]; onRemoveAttachment?: (id: string) => void;
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
  // Which ends of the strip have cards scrolled past them. Each such end fades out, so a card hidden off the left
  // after a new one scrolled into view is announced instead of silently gone (COD-292).
  const stripMore = useStripOverflow(strip, `${hasAttachments}:${attachmentCount}`);
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
  const focusMessageBox = () => textarea.current?.focus();
  /** Sending keeps the message box focused, even when it went with the send button, so the next words land in it. */
  const submit = () => {
    onSubmit();
    focusMessageBox();
  };
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
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) submit(); }
  };
  const toolbarShown = hasContent(leading) || hasContent(mode) || hasContent(trailing) || hasContent(usage);
  return <>
  <form className={`composer${expanded ? ' expanded' : ''}${context ? ' has-context' : ''}${hasAttachments ? ' has-attachments' : ''}`} onSubmit={event => { event.preventDefault(); if (canSend) submit(); }}>
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
    {attachments && hasAttachments && <ul className="composer-attachments" ref={strip} aria-label={t('Tệp đính kèm')}
      {...overflowAttributes(stripMore)}>
      {attachments.map(item => <Attachment key={item.id} name={item.name} bytes={item.bytes} onRemove={onRemoveAttachment ? () => onRemoveAttachment(item.id) : undefined} />)}
    </ul>}
    {/* The same string, painted above the box, so a tag is coloured while it is typed. The trailing newline gives
        the overlay the extra line a textarea shows for a trailing Enter, so the two never disagree on height. */}
    {mentionable && <div className="composer-highlight" ref={highlight} aria-hidden="true"><MentionText text={value} people={mentions!.people} allNames={mentions!.allNames} />{'\n'}</div>}
    <textarea ref={textarea} className={mentionable ? 'has-highlight' : undefined} aria-label={label} placeholder={placeholder} value={value} disabled={disabled} rows={1} maxLength={16000}
      onScroll={event => { if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop; }}
      aria-autocomplete="list" aria-controls={menuOpen ? listId : undefined} aria-expanded={menuOpen} aria-activedescendant={menuOpen ? activeOptionId : undefined}
      onChange={event => changeText(event.target)}
      onKeyUp={event => syncCursor(event.currentTarget)} onClick={event => syncCursor(event.currentTarget)} onSelect={event => syncCursor(event.currentTarget)}
      onKeyDown={onKeyDown} />
    {/* Send is a small round button at the box's bottom right, on the last line of text. It stays quiet (an outline of
        an arrow, no fill) until there is something to send, then fills with the accent, so ready and not ready read at
        a glance (owner, 2026-09-30: smaller). While a run works, stop takes the slot; words typed meanwhile bring send
        back beside it, so stopping stays one click away. */}
    <div className="composer-send">
      {onStop && <Button type="button" variant="primary" size="icon" className="send stop" aria-label={t('Dừng')} title={t('Dừng')} onClick={onStop}>
        <span className="send-spin" aria-hidden="true" />
        <Square size={9} fill="currentColor" />
      </Button>}
      {(!onStop || canSend) && <Button type="submit" variant={canSend ? 'primary' : 'ghost'} size="icon" className="send" aria-label={sendLabel} title={sendLabel} disabled={!canSend}>
        <ArrowUp size={16} strokeWidth={2.25} />
      </Button>}
    </div>
  </form>
  {/* Directly under the box, one line: add at the left, the model or recipient and then the usage ring at the right.
      Out here rather than inside the box, so the box stays the text and its send button, and the model sits on the
      same row as the ring (owner, 2026-09-30). */}
  {toolbarShown && <div className="composer-toolbar">
    <div className="composer-leading"><MessageBoxFocus.Provider value={focusMessageBox}>{leading}</MessageBoxFocus.Provider></div>
    {hasContent(mode) && <MessageBoxFocus.Provider value={focusMessageBox}>{mode}</MessageBoxFocus.Provider>}
    <div className="composer-toolbar-end">
      {hasContent(trailing) && <div className="composer-trailing">{trailing}</div>}
      {usage}
    </div>
  </div>}
  </>;
}

/** What a message from this bar adds when Plan first is chosen for it (COD-367); nothing otherwise. */
export function planFirstInput(barKey: string | undefined): { planFirst?: true } {
  return planFirstChosen(barKey) ? { planFirst: true } : {};
}

/** Whether a slot was given something to draw; `false`, `null` and `undefined` draw nothing. */
function hasContent(node: ReactNode) {
  return Children.toArray(node).length > 0;
}

/**
 * What arrives in the bar from outside it (COD-246): an `orglet://new` link's text, or files sent from Explorer or
 * carried over from an empty chat. `at` tells two arrivals with the same content apart.
 */
export type ComposerPrefill = { text?: string; intake?: FolderIntake; at: number };

/**
 * Why a chat takes no new message (COD-282): it was archived, or its orglet or crew was archived or deleted. The bar
 * stays where it was, turned off, with this sentence under it and the one step that opens it again, if there is one.
 */
export type ReadOnlyChat = { note: string; action?: { label: string; onSelect: () => void } };

/** A link's text goes after a draft already in the bar, never over it. */
export function withPrefill(current: string, prefill: string): string {
  if (!current.trim()) return prefill;
  return `${current}\n\n${prefill}`;
}

/**
 * The line under a message box while its chat runs on Demo, with the one step out of it (COD-293). A newcomer read the
 * Demo answer's pointer to "the orglet settings… local harness" and found no button; this is that button, in the
 * words the answer uses. `onConnect` decides where it leads (`connectModelStep`).
 */
export function DemoNote({ someOnDemo, preflight, onConnect }: { /** Only some of the chat's orglets are on Demo. */ someOnDemo?: string; /** A crew with a local check before its sample report. */ preflight?: boolean; onConnect: () => void }) {
  const sentence = someOnDemo ? t('{0} đang dùng Demo: câu trả lời mẫu, chưa đọc tệp.', [someOnDemo])
    : preflight ? t('Demo · không gọi API; checker local sẽ chạy trước báo cáo mẫu.')
    : t('Đang dùng Demo: câu trả lời mẫu, chưa đọc tệp.');
  return <div className="demo-note">
    <p>{sentence}</p>
    <Button type="button" variant="outline" onClick={onConnect}><Plug size={14} aria-hidden="true" />{t('Kết nối model')}</Button>
  </div>;
}

/** Runs whose reported window has already sent their connection's model list to be read again, this session. */
const windowsReread = new Set<string>();

/**
 * When a harness run in the chat reports its model's window, the core keeps it and adds it to that connection's model
 * list (COD-326). Reading the list again once per such run lets every other chat on that model show its capacity
 * before its own first run. The core answers from its own copy, so this costs no call to the vendor.
 */
function useReportedWindowRefresh(runs: readonly Run[]) {
  const latest = runs.findLast(run => run.contextUse?.windowTokens && isHarness(run.snapshot.worker.provider));
  useEffect(() => {
    if (!latest || windowsReread.has(latest.id)) return;
    windowsReread.add(latest.id);
    modelLists.refresh(latest.snapshot.worker.provider).catch(() => { /* the chat's own run already gives this chat its window */ });
  }, [latest?.id]);
}

/** What a message box's foot shows for plan usage and context (COD-326); see `usePlanUsageBar`. */
export type UsageFoot = { ring?: ReactNode; note?: ReactNode; out: boolean };

/**
 * Plan usage and context under a message box (COD-326): the ring at the far right of the toolbar row under the bar
 * (`Composer`'s `usage`), and the note line under that row from 80% of a plan allowance on. Once the account is out,
 * that line comes before a permission hint, since nothing would run; nearly out, it gives way to one. The island already says the account is out after a
 * run stopped on it (COD-225), so the line waits while it does. Switching selects the other account, as Settings
 * would; the next message runs on it. `workers` answer in the chat, and `runs` are the chat's (none in an empty chat),
 * for the context window of the model each orglet will use next.
 */
export function usePlanUsageBar({ workers, harnesses, running, runs = [], action, openSettings }: {
  workers: readonly ContextWorker[];
  harnesses: readonly HarnessInfo[] | undefined;
  running: boolean;
  runs?: readonly Run[];
  action: (fn: () => Promise<unknown>) => void;
  openSettings: () => void;
}): UsageFoot {
  const providers = workers.map(worker => worker.provider);
  const { view: usage, loading } = useComposerUsage(providers, harnesses, running);
  const island = useDockedIsland();
  const listed = [...new Set(providers.filter(provider => provider !== 'demo'))];
  const lists = useCachedEach(modelLists, listed);
  const context = chatContextFor(workers, Object.fromEntries(listed.map(provider => [provider, lists[provider]?.models])), runs);
  useReportedWindowRefresh(runs);
  const ring = usageRingFor(usage, context)
    ? <UsageRing plans={usage} context={context} onOpenSettings={openSettings} />
    : loading ? <span className="usage-ring-waiting" aria-hidden="true"><Skeleton shape="circle" width={16} height={16} /></span> : undefined;
  if (!usage) return { ring, out: false };
  const switchAccount = (harness: HarnessInfo, accountId: string) => action(() => orglet.call('selectHarnessAccount', { harness: harness.id, id: accountId }));
  const out = usage.shown.tone === 'out';
  const noteShown = usage.shown.tone !== 'normal' && !(out && island?.kind === 'account');
  return { ring, note: noteShown ? <PlanUsageNote usage={usage} onSwitch={switchAccount} /> : undefined, out };
}

/**
 * The note line under a message box and its toolbar (COD-326): one centred line at most, saying what to do first, a
 * plan nearly out, or a permission hint. It has a line of its own rather than a place in the toolbar, because a note
 * is a sentence with a button or links after it: squeezed between the add button and the model it would wrap at the
 * narrow window and push the controls around. An empty line takes no room.
 */
export function ComposerFoot({ children }: { children?: ReactNode }) {
  if (!hasContent(children)) return null;
  return <div className="composer-foot">{children}</div>;
}

/**
 * Follow-up bar under a task: the next message of a chat that already has one. It carries the files the latest
 * message had, plus any added here with + (or sent from Explorer), which sit on the bar as cards the way an empty
 * chat's do (COD-257; an older "Attach files" dialog used to take them). While a run is on, the island saying what the
 * worker is doing sits on the bar's top edge (COD-167, `IslandDock`). `prefill` fills it without sending;
 * `onPrefilled` lets the caller forget it once it is in. What is typed and added but not sent stays with the chat
 * across restarts (COD-257, `drafts.ts`), so leaving the chat and coming back finds it on the bar.
 */
export function FollowUpComposer({ detail, workspace, harnesses, ready, openSettings, openChat, action, prefill, onPrefilled, readOnly, onConnectModel, permissionHint, modePicker }: { detail: TaskDetail; workspace: Workspace; /** Which account each harness runs, for the plan usage by the bar (COD-326). */ harnesses?: readonly HarnessInfo[]; ready: Readiness; openSettings: (tab?: 'connections' | 'harness') => void; /** Opens another chat, such as a side thread just started from this one. */ openChat: (taskId: string) => void; action: (fn: () => Promise<unknown>) => void; prefill?: ComposerPrefill; onPrefilled?: () => void; readOnly?: ReadOnlyChat; /** Sets up a real model for this orglet on Demo (COD-293); the note under the bar offers it. */ onConnectModel?: (worker: Worker) => void; /** Offers a permission the message seems to need (COD-305), when Tacet is on this computer. */ permissionHint?: PermissionHintControls; /** The approval mode beside the add button (COD-367, `ChatModePicker`). */ modePicker?: ReactNode }) {
  const draftKey = taskDraftKey(detail.task.id);
  const [text, setText] = useState(() => readDraft(draftKey)?.text ?? '');
  // Files added for the next message, and what could not be added with the reason, as in the empty chat.
  const [added, setAdded] = useState<FolderIntake>(() => readDraft(draftKey)?.intake ?? { sources: [], skipped: [] });
  useEffect(() => { keepDraft(draftKey, { text, intake: added }); }, [draftKey, text, added]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Before paint, so a key pressed while this bar replaces the empty chat's lands in it and not on the page (COD-284).
  useLayoutEffect(() => {
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
  const demoWorker = demoWorkerToConnect(workers, team);
  const selectedReply = useReplyTarget();
  const reply = selectedReply?.taskId === detail.task.id ? selectedReply : undefined;
  const busy = ['running', 'queued', 'pausing'].includes(detail.task.status);
  const blocked = missing.length > 0 || Boolean(readOnly);
  const planUsage = usePlanUsageBar({ workers, harnesses, running: busy, runs: detail.runs, action, openSettings: () => openSettings('harness') });
  // An MCP approval card is answered with its buttons; typing sends a new message instead (COD-241).
  const pendingDecision = detail.task.decisionRequests?.findLast(request => request.inputRevision === (detail.task.inputRevision ?? 0) && !request.answer && !request.interruptedAt && !request.approval);
  /**
   * Empties the bar for the message about to go and hands back a way to put it back if it fails (COD-284). The box
   * stays enabled while the message is on its way, so nothing typed right after sending is lost; `submitting` only
   * holds back a second send.
   */
  const takeUnsent = () => {
    const unsent = text;
    setText('');
    return () => setText(current => restoreUnsent(unsent, current));
  };
  const send = () => {
    const extra = text.trim();
    if (!extra || blocked || detail.task.pendingStart || submitting) return;
    setSubmitting(true);
    const putBack = takeUnsent();
    // A question is answered in words; a message that brings files is a new message instead.
    if (detail.task.status === 'waiting_input' && pendingDecision && added.sources.length === 0) {
      action(async () => {
        try {
          await orglet.call('answerDecision', { taskId: detail.task.id, requestId: pendingDecision.id, answer: extra });
          clearReplyTarget();
        } catch (error) {
          putBack();
          throw error;
        } finally {
          setSubmitting(false);
        }
      });
      return;
    }
    // The person's reaction on the previous answer reaches the orglet from the core (`previousAnswerReaction`), not
    // as words added to what they typed.
    const brief = extra;
    const sent = added.sources;
    action(async () => {
      try {
        await orglet.call('reviseTask', { taskId: detail.task.id, brief, replyTo: reply?.messageId, sourceIds: nextSourceIds(), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros, ...planFirstInput(draftKey) });
        clearSentFiles(sent);
        clearReplyTarget();
      } catch (error) {
        putBack();
        throw error;
      } finally {
        setSubmitting(false);
      }
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
  const sideThreads = canStartSideThread(detail.task) && !readOnly;
  const sendInNewThread = () => {
    const brief = text.trim();
    if (!brief || blocked || submitting) return;
    setSubmitting(true);
    const putBack = takeUnsent();
    // Chosen from the send options, focus went back to their button, which the emptied bar is about to disable.
    textarea.current?.focus();
    const orgletName = workers[0]?.name ?? 'Orglet';
    const sent = added.sources;
    action(async () => {
      try {
        const sideTaskId = await orglet.call('startSideThread', { taskId: detail.task.id, brief, sourceIds: nextSourceIds(), excludedSources: input.excludedSources, consent: true, providerScopes: providers, budgetMicros: detail.task.budgetMicros, ...planFirstInput(draftKey) });
        clearSentFiles(sent);
        // A side thread started in Plan first stays in it, so its own bar reads the same way until Follow the plan.
        if (planFirstChosen(draftKey)) setPlanFirst(taskDraftKey(sideTaskId), true);
        toast(t('Đã mở chat phụ'), 'success', orgletName, { action: { label: t('Mở'), onSelect: () => openChat(sideTaskId) } });
      } catch (error) {
        putBack();
        throw error;
      } finally {
        setSubmitting(false);
      }
    });
  };
  const sendOptions = sideThreads ? <RowMenu className="composer-send-options" label={t('Tùy chọn gửi')} icon={ChevronUp} disabled={!text.trim() || blocked || submitting}
    items={[{ label: t('Gửi trong chat phụ mới'), icon: MessageSquarePlus, shortcut: 'Ctrl+Shift+Enter', onSelect: sendInNewThread }]} /> : undefined;
  return <div className="thread-composer">
    <IslandDock />
    <Composer textareaRef={textarea} value={text} onChange={setText} onSubmit={send} onAlternateSubmit={sideThreads ? sendInNewThread : undefined} trailing={sendOptions} usage={planUsage.ring} label={t('Tin nhắn')} placeholder={readOnly ? t('Chỉ đọc') : detail.task.pendingStart ? t('Đang chuyển sang yêu cầu mới…') : busy ? t('Nhắn để đổi hướng đang làm…') : pendingDecision ? t('Trả lời câu hỏi…') : t('Nhắn tiếp…')} sendLabel={t('Gửi tin nhắn')} disabled={Boolean(readOnly)} sendDisabled={blocked || Boolean(detail.task.pendingStart) || submitting || Boolean(readOnly)}
      onStop={busy || detail.task.pendingStart ? () => action(() => orglet.call('cancel', { id: detail.task.id })) : undefined}
      mentions={workers.length > 1 || team ? { people: workers, ...(team ? { allNames: [team.name] } : {}) } : undefined}
      context={reply && !pendingDecision ? <div className="composer-reply">
        <Reply size={14} aria-hidden="true" />
        <p><strong>{reply.author}</strong><span>{reply.text}</span></p>
        <Button type="button" size="icon" aria-label={t('Bỏ trả lời')} title={t('Bỏ trả lời')} onClick={clearReplyTarget}><X size={14} /></Button>
      </div> : undefined}
      attachments={added.sources} onRemoveAttachment={removeFile}
      leading={<SourcePicker disabled={Boolean(readOnly)} onFiles={() => action(async () => addFiles({ sources: await orglet.pickSources(), skipped: [] }))} onFolder={() => action(async () => addFiles(await orglet.pickFolder()))} />} mode={modePicker} />
    <SkippedFiles items={added.skipped} />
    <ComposerFoot>
    {readOnly && <p className="composer-note" role="status">{readOnly.note}{readOnly.action && <button type="button" onClick={readOnly.action.onSelect}>{readOnly.action.label}</button>}</p>}
    {!busy && !readOnly && blocked && <p className="composer-note">{t('Cần kết nối {0} trước khi gửi.', [missing.map(providerLabel).join(t(' và '))])}<button type="button" onClick={() => openSettings(settingsTabFor(missing))}>{t('Mở Cài đặt')}</button></p>}
    {!readOnly && !blocked && demoWorker && onConnectModel && <DemoNote someOnDemo={providers.length > 0 ? demoWorker.name : undefined} preflight={providers.length === 0 && Boolean(team?.preflight)} onConnect={() => onConnectModel(demoWorker)} />}
    {/* One line under the bar at most: a note above says what to do first. */}
    {!readOnly && !blocked && !demoWorker && (planUsage.out || !permissionHint) && planUsage.note}
    {permissionHint && !planUsage.out && <ComposerPermissionHint text={text} controls={{ ...permissionHint, enabled: permissionHint.enabled && !readOnly && !blocked && !demoWorker }}
      fallback={!readOnly && !blocked && !demoWorker ? planUsage.note : undefined} />}
    </ComposerFoot>
  </div>;
}
