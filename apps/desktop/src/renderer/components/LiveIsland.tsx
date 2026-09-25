import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Gauge, Lightbulb, X } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { RosterAvatars } from './Avatar';
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
export type IslandView = { state: IslandState; label: string; named?: NamedSentence; receipt?: string; workers: readonly Worker[] };

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
export function LiveIsland({ state, label, named, receipt, workers, leaving }: { state: IslandState; label: string; named?: NamedSentence; receipt?: string; workers: readonly Worker[]; leaving?: boolean }) {
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
      </span>
    </div>
  </div>;
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
  const label = count === 1 ? t('1 gợi ý knowledge') : t('{0} gợi ý knowledge', [count]);
  return <div role="status" className={leaving ? 'live-island live-island-knowledge leaving' : 'live-island live-island-knowledge'}>
    <div className="live-island-body" style={{ width }}>
      <span className="live-island-content" ref={content}>
        <Lightbulb size={16} aria-hidden="true" />
        <span className="live-island-label" key={label}>{label}</span>
        <Button type="button" className="live-island-action" aria-label={t('Xem gợi ý knowledge')} onClick={review}>{t('Xem')}</Button>
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
export function AccountIsland({ harnessName, target, resetsAt, switchAccount, dismiss, leaving }: {
  harnessName: string;
  /** The account to switch to and how much of its tightest allowance is used; absent when none has room. */
  target?: { label: string; usedPercent: number };
  resetsAt?: string;
  switchAccount: () => void;
  dismiss: () => void;
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
            aria-label={t('Chuyển sang {0} rồi chạy lại', [target.label])}>{t('Dùng {0} · còn {1}%', [target.label, 100 - Math.round(target.usedPercent)])}</Button>
          : resetsAt && <span className="live-island-meta">{usageResetLabel(resetsAt)}</span>}
        <Button type="button" size="icon" className="live-island-dismiss" aria-label={t('Bỏ qua')} title={t('Bỏ qua')} onClick={dismiss}><X size={14} /></Button>
      </span>
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
 */
function useNaturalWidth(target: RefObject<HTMLElement | null>, text: string | undefined) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) {
      setWidth(undefined);
      return;
    }
    setWidth(Math.ceil(element.scrollWidth));
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
