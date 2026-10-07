import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { ChevronDown, Eye, Gauge, Lightbulb, Undo2, X } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { RosterAvatars } from './Avatar';
import { Input } from '@codepawlhq/orglet-ui';
import { Button } from './ui';
import { usageResetLabel } from './PlanUsage';
import { t } from '../i18n';

/**
 * What the worker is doing right now. The faces move with it (COD-171: a head that turns is thinking, eyes on a
 * line are reading, a breath is waiting), so a change of state is seen before it is read.
 */
export type IslandState = 'thinking' | 'reading' | 'searching' | 'listing' | 'tool' | 'writing' | 'waiting' | 'pausing';

/**
 * What the island shows: the state and label for now, the last finished step where the run reports steps, and the
 * workers whose runs are really running, whose faces the island carries (COD-169). `named` is the label cut around
 * the one worker's name, when it names one (COD-250); the label stays the whole sentence.
 */
export type IslandView = { state: IslandState; label: string; named?: NamedSentence; receipt?: string; workers: readonly Worker[]; actions?: readonly IslandAction[];
  /** When the run started (ms), so a long wait shows how long it has been (user, 2026-10-07). */ since?: number };

/**
 * A control the island may carry while a run uses Orglet's browser (COD-261): watch it in the live view, or hand it
 * back once taken over. `kind` picks the icon and tells views apart; the parent owns what it does.
 */
export type IslandAction = { kind: 'watch' | 'handBack'; label: string; onSelect: () => void };

/** A sentence around a worker's name: "" + "Researcher" + " is reading invoice.xlsx…". */
export type NamedSentence = { before: string; name: string; after: string };

/** How long the receipt waits after the label has changed, so the new state is read first. */
const RECEIPT_DELAY_MS = 350;

/** The room between the faces and the label; the receipt line is inset by the faces plus this, to sit over the label. */
const FACES_GAP_PX = 8;

/** How far a long name shrinks before the action starts to give way: a few letters and the ellipsis. */
const NAME_FLOOR_EM = 6;

/**
 * A working run as one island (COD-164, from the owner's dynamic-island reference), docked on the prompt bar
 * (COD-167): a tab in the bar's own colour and outline that grows out of the bar's top edge, with the faces of the
 * workers at work and one label for what they are doing now, and above the label one grey line for the last thing
 * done. The faces carry the state through `data-state` (COD-171, the rules under `.live-island` in styles.css):
 * there is no separate light, because a mark nobody can name says nothing the sentence does not.
 *
 * The tab's width follows its label through a transition, so a new label reads as the same shape changing rather
 * than a cut. The receipt changes a beat after the label. `prefers-reduced-motion` turns every change into a cut
 * (the global rule in styles.css drops every transition and animation), and nothing here waits for an animation to
 * finish: the resting style is the visible one, and `leaving` only plays the way out.
 *
 * `receipt` is left out where the run reports no steps, and passed as an empty string while the first step is still
 * running; the line takes room only once it has something to say.
 */
export function LiveIsland({ state, label, named, receipt, workers, actions = [], since, leaving }: { state: IslandState; label: string; named?: NamedSentence; receipt?: string; workers: readonly Worker[]; since?: number; actions?: readonly IslandAction[]; leaving?: boolean }) {
  const content = useRef<HTMLSpanElement>(null);
  const faces = useRef<HTMLSpanElement>(null);
  const width = useMeasuredWidth(content);
  const facesWidth = useMeasuredWidth(faces) ?? 0;
  const settledReceipt = useDelayed(receipt, RECEIPT_DELAY_MS);

  const bodyStyle = { width, '--island-faces': `${facesWidth}px`, '--island-faces-gap': `${FACES_GAP_PX}px` } as CSSProperties;
  return <div role="status" className={leaving ? 'live-island leaving' : 'live-island'} data-state={state}>
    <div className="live-island-body" style={bodyStyle}>
      <div className="live-island-receipt-row" data-empty={settledReceipt ? undefined : ''}>
        <span className="live-island-receipt" key={settledReceipt}>{settledReceipt}</span>
      </div>
      <span className="live-island-content" ref={content}>
        <span className="live-island-faces" ref={faces} title={workers.map(worker => worker.name).join(', ')}>
          <RosterAvatars workers={workers} size="sm" max={workers.length} />
        </span>
        <IslandSentence key={label} label={label} named={named} />
        {since !== undefined && <IslandElapsed since={since} />}
        {actions.map(action => <Button key={action.kind} type="button" className="live-island-browser" onClick={action.onSelect}>
          {action.kind === 'watch' ? <Eye size={14} aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />}{action.label}
        </Button>)}
      </span>
    </div>
  </div>;
}

/** How long a run goes before the island says how long it has been: a short answer never needs a clock. */
export const ELAPSED_AFTER_SECONDS = 15;

/** "42s", then "1:05" past a minute; the same in every language, like the clock it stands for. */
export function islandElapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The time a run has been going, after the sentence, once the wait is long enough to wonder about (user, 2026-10-07:
 * a Cursor run sat 1–3 minutes on one sentence). It ticks each second and is quiet text, not a spinner.
 */
function IslandElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < ELAPSED_AFTER_SECONDS) return null;
  return <span className="live-island-elapsed" aria-hidden="true">{islandElapsedLabel(seconds)}</span>;
}

/**
 * The island's sentence. With a name in it, the name and the action are separate pieces (COD-250): the name gives way
 * first, with an ellipsis and the full name in its tooltip, down to a few letters, and only then does the action
 * shorten. The floor is the shorter of those few letters and the whole name, so a short name never holds room it
 * does not use.
 */
function IslandSentence({ label, named }: { label: string; named?: NamedSentence }) {
  const name = useRef<HTMLSpanElement>(null);
  const nameWidth = useNaturalWidth(name, named?.name);
  if (!named) {
    return <span className="live-island-label live-island-sentence">
      <span className="live-island-action">{label}</span>
    </span>;
  }
  const floor = nameWidth === undefined ? `${NAME_FLOOR_EM}em` : `min(${NAME_FLOOR_EM}em, ${nameWidth}px)`;
  const style = { '--island-name-floor': floor } as CSSProperties;
  return <span className="live-island-label live-island-sentence" style={style}>
    {named.before && <span className="live-island-lead">{named.before}</span>}
    <span className="live-island-name" ref={name} title={named.name}>{named.name}</span>
    <span className="live-island-action">{named.after}</span>
  </span>;
}

/**
 * The chat's knowledge suggestions, offered from the island once the run is over (COD-208): the same tab on the bar,
 * with a lightbulb where the faces sit, the count, one Review action and a dismiss. Review opens the one note or
 * Thư viện → Knowledge; dismiss only hides the offer, the suggestions stay in the library. The parent decides when
 * it shows (`showsKnowledgeIsland`) and what the actions do.
 */
export function KnowledgeIsland({ count, review, dismiss, leaving }: { count: number; review: () => void; dismiss: () => void; leaving?: boolean }) {
  const content = useRef<HTMLSpanElement>(null);
  const width = useMeasuredWidth(content);
  const label = count === 1 ? t('1 gợi ý kiến thức') : t('{0} gợi ý kiến thức', [count]);
  return <div role="status" className={leaving ? 'live-island live-island-knowledge leaving' : 'live-island live-island-knowledge'}>
    <div className="live-island-body" style={{ width }}>
      <span className="live-island-content" ref={content}>
        <Lightbulb size={16} aria-hidden="true" />
        <span className="live-island-label" key={label}>{label}</span>
        <Button type="button" className="live-island-action" aria-label={t('Xem gợi ý kiến thức')} onClick={review}>{t('Xem')}</Button>
        <Button type="button" size="icon" className="live-island-dismiss" aria-label={t('Bỏ qua')} title={t('Bỏ qua')} onClick={dismiss}><X size={14} /></Button>
      </span>
    </div>
  </div>;
}

/**
 * A harness account ran out of plan usage (COD-225), offered from the island where the chat's next message is typed:
 * the harness that stopped, then either one action that switches to the account with the most room and runs the turn
 * again, or, when no other account has any, when the one in use resets. The parent picks the account and does the
 * switching; this only shows it.
 */
export function AccountIsland({ harnessName, target, resetsAt, switchAccount, dismiss, retries = true, leaving }: {
  harnessName: string;
  /** The account to switch to and how much of its tightest allowance is used; absent when none has room. */
  target?: { label: string; usedPercent: number };
  resetsAt?: string;
  switchAccount: () => void;
  dismiss: () => void;
  /** Switching also runs the stopped turn again; the plan running out before anything was sent only switches. */
  retries?: boolean;
  leaving?: boolean;
}) {
  const content = useRef<HTMLSpanElement>(null);
  const width = useMeasuredWidth(content);
  const label = t('{0} hết hạn mức', [harnessName]);
  return <div role="status" className={leaving ? 'live-island live-island-knowledge live-island-account leaving' : 'live-island live-island-knowledge live-island-account'}>
    <div className="live-island-body" style={{ width }}>
      <span className="live-island-content" ref={content}>
        <Gauge size={16} aria-hidden="true" />
        <span className="live-island-label">{label}</span>
        {target
          ? <Button type="button" className="live-island-action" onClick={switchAccount}
            aria-label={retries ? t('Chuyển sang {0} rồi chạy lại', [target.label]) : t('Chuyển sang {0}', [target.label])}>{t('Dùng {0} · còn {1}%', [target.label, 100 - Math.round(target.usedPercent)])}</Button>
          : resetsAt && <span className="live-island-meta">{usageResetLabel(resetsAt)}</span>}
        <Button type="button" size="icon" className="live-island-dismiss" aria-label={t('Bỏ qua')} title={t('Bỏ qua')} onClick={dismiss}><X size={14} /></Button>
      </span>
    </div>
  </div>;
}

/** What a decision island sends: a choice with the person's note under it, their own words, or that they skipped. */
export type DecisionPick = { kind: 'option'; option: string; note: string } | { kind: 'other'; text: string } | { kind: 'skip' };

/** The answer text the orglet reads for a pick; undefined while there is nothing to send yet. */
export function decisionAnswer(pick: DecisionPick): string | undefined {
  if (pick.kind === 'skip') return t('Bỏ qua câu hỏi này. Tự chọn cách hợp lý nhất và nói rõ đã chọn gì.');
  if (pick.kind === 'other') return pick.text.trim() || undefined;
  const note = pick.note.trim();
  return note ? `${pick.option}\n\n${t('Ghi chú: {0}', [note])}` : pick.option;
}

/**
 * A question an orglet stopped to ask, answered from the island on the prompt bar (user, 2026-10-07, after Claude's
 * question box): the asker's face and the question, then one row per choice with its number key, and a last row for
 * the person's own words. A picked choice can carry a note. Skip lets the orglet decide; Send (or Ctrl+Enter) answers.
 * The chevron folds the choices away to read the chat behind. The chat keeps the question as the orglet's message, and
 * the prompt bar under the island still sends a typed answer. `busy` holds everything while an answer is on its way.
 */
export function DecisionIsland({ question, options, workers, busy, answer, leaving }: {
  question: string;
  options: readonly string[];
  workers: readonly Worker[];
  busy: boolean;
  answer: (text: string) => void;
  leaving?: boolean;
}) {
  const [picked, setPicked] = useState<number>();
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [folded, setFolded] = useState(false);
  const otherIndex = options.length;
  const pick: DecisionPick | undefined = picked === undefined ? undefined
    : picked === otherIndex ? { kind: 'other', text: other } : { kind: 'option', option: options[picked], note };
  const ready = pick ? decisionAnswer(pick) : undefined;
  const send = (text: string | undefined) => {
    if (!busy && text) answer(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send(ready);
      return;
    }
    // Number keys pick a row, except while typing in one of the island's fields.
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index <= otherIndex) {
      event.preventDefault();
      setPicked(index);
    }
  };
  return <div role="group" aria-label={t('Quyết định đang chờ')} className={leaving ? 'live-island live-island-decision leaving' : 'live-island live-island-decision'} data-state="waiting" data-folded={folded ? '' : undefined} onKeyDown={onKeyDown}>
    <div className="live-island-body">
      <div className="live-island-question">
        <span className="live-island-faces" aria-hidden="true">
          <RosterAvatars workers={workers} size="sm" max={workers.length} />
        </span>
        <p>{question}</p>
        <Button type="button" size="icon" className="live-island-fold" aria-expanded={!folded} aria-label={folded ? t('Mở các lựa chọn') : t('Thu gọn các lựa chọn')} onClick={() => setFolded(value => !value)}>
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </div>
      {!folded && <>
        <div className="live-island-choices" role="radiogroup" aria-label={question}>
          {options.map((option, index) => <Button key={option} type="button" role="radio" aria-checked={picked === index} className="live-island-choice" disabled={busy} onClick={() => setPicked(index)}>
            <span className="live-island-choice-text">{option}</span><kbd>{index + 1}</kbd>
          </Button>)}
          <div className="live-island-choice live-island-other" data-checked={picked === otherIndex ? '' : undefined}>
            <Input value={other} disabled={busy} maxLength={2000} placeholder={t('Khác: tự trả lời theo ý bạn')} aria-label={t('Câu trả lời của bạn')}
              onFocus={() => setPicked(otherIndex)} onChange={event => { setOther(event.target.value); setPicked(otherIndex); }} />
            <kbd>{otherIndex + 1}</kbd>
          </div>
        </div>
        {pick?.kind === 'option' && <Input className="live-island-note" value={note} disabled={busy} maxLength={1000} placeholder={t('Thêm ghi chú cho lựa chọn này (không bắt buộc)')} aria-label={t('Ghi chú')} onChange={event => setNote(event.target.value)} />}
        <div className="live-island-decision-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={() => send(decisionAnswer({ kind: 'skip' }))}>{t('Bỏ qua')}</Button>
          <Button type="button" variant="primary" disabled={busy || !ready} onClick={() => send(ready)}>{t('Gửi')}<kbd>Ctrl ↵</kbd></Button>
        </div>
      </>}
    </div>
  </div>;
}

/** The element's width in whole pixels, kept up to date as it changes; a fractional width clips the last letter. */
function useMeasuredWidth(target: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    const measure = () => setWidth(Math.ceil(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return width;
}

/**
 * The width the element's text needs in whole pixels, even while it is cut short. Measured again when `text`
 * changes; the fonts are loaded before any run starts, so the text is the only thing that moves it.
 * The text itself is measured, not the element: the element starts at the name's floor (6em), and its scrollWidth
 * then reported that floor for a short name, so "Dev" kept 6em with a gap before the action (COD-257).
 */
function useNaturalWidth(target: RefObject<HTMLElement | null>, text: string | undefined) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) {
      setWidth(undefined);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    setWidth(Math.ceil(range.getBoundingClientRect().width));
  }, [target, text]);
  return width;
}

/** The value as it was `delayMs` ago, so a second line can follow the first instead of changing with it. */
function useDelayed<T>(value: T, delayMs: number) {
  const [delayed, setDelayed] = useState(value);
  useEffect(() => {
    if (value === delayed) return;
    const timer = setTimeout(() => setDelayed(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayed, delayMs]);
  return delayed;
}
