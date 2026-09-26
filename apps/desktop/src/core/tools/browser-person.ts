import type { BrowserApprovalView } from '../../shared/browser';

/**
 * What the person is doing with Orglet's browser while a run uses it (COD-261, phase 2): answering the card that asks
 * about one consequential step, or holding the browser after taking it over. Both are kept in memory, because the
 * run waiting on them is a run of this process: the tabs it acts in close when the app does, so a restart has
 * nothing to resume.
 *
 * A wait ends when the person answers or hands back, when the run is stopped (its signal), or after `waitMs`, so a
 * run nobody attends to does not hold a browser window open forever. Desktop apps (`desktop-tools.ts`) ask through
 * the same class with their own card; they have no take-over, since the person's desktop is already theirs.
 */
export type BrowserAnswer = 'allow' | 'decline';
export type BrowserAskOutcome = BrowserAnswer | 'no_answer';

/** How long a step waits for an answer or for the browser to be handed back. */
export const BROWSER_PERSON_WAIT_MS = 15 * 60_000;

type PendingAsk<View> = { taskId: string; view: View; settle: (answer: BrowserAnswer) => void };
/** `inChrome`: the person moved the tabs into a Chrome window, rather than using the live view in Orglet. */
type Holding = { since: string; released: Set<() => void>; inChrome: boolean };

export const NOT_ASKING = 'Bước này không còn chờ bạn trả lời.';
/**
 * A card waiting while the person holds the browser is answered after they hand it back (dogfood, 2026-09-26): an
 * allowed step would otherwise act on the page they are using, and the page they hand back may no longer be the one
 * the card pictured. The window greys the buttons out with the same reason.
 */
export const HOLDING_BROWSER = 'Bạn đang giữ trình duyệt. Trả lại trình duyệt rồi trả lời.';

export class BrowserPerson<View extends { id: string } = BrowserApprovalView> {
  private asks = new Map<string, PendingAsk<View>>();
  private holdings = new Map<string, Holding>();
  private waitingTasks = new Map<string, number>();

  constructor(private notify: () => void, private waitMs = BROWSER_PERSON_WAIT_MS) {}

  /** Shows the card on the chat and waits for the person's answer. */
  async ask(taskId: string, view: View, signal: AbortSignal): Promise<BrowserAskOutcome> {
    signal.throwIfAborted();
    const answered = new Promise<BrowserAnswer>(resolve => {
      this.asks.set(view.id, { taskId, view, settle: resolve });
    });
    this.notify();
    try {
      return await this.untilSettled(answered, signal, 'no_answer');
    } finally {
      this.asks.delete(view.id);
      this.notify();
    }
  }

  /** The person's answer to a card on this chat; the command the window sends when a button is pressed. */
  answer(taskId: string, requestId: string, answer: BrowserAnswer) {
    const pending = this.asks.get(requestId);
    if (!pending || pending.taskId !== taskId) throw new Error(NOT_ASKING);
    if (this.holds(taskId)) throw new Error(HOLDING_BROWSER);
    this.asks.delete(requestId);
    pending.settle(answer);
  }

  /** The card waiting on this chat, if any. */
  approval(taskId: string): View | undefined {
    for (const pending of this.asks.values()) if (pending.taskId === taskId) return pending.view;
    return undefined;
  }

  /** The person takes the browser over, or switches between the live view and the Chrome window while they hold it. */
  takeOver(taskId: string, inChrome = false) {
    const holding = this.holdings.get(taskId);
    if (holding) holding.inChrome = inChrome;
    else this.holdings.set(taskId, { since: new Date().toISOString(), released: new Set(), inChrome });
    this.notify();
  }

  /** Hands the browser back: every step waiting for it goes on. */
  handBack(taskId: string) {
    const holding = this.holdings.get(taskId);
    this.holdings.delete(taskId);
    for (const release of holding?.released ?? []) release();
    this.notify();
  }

  holds(taskId: string): boolean {
    return this.holdings.has(taskId);
  }

  inChrome(taskId: string): boolean {
    return this.holdings.get(taskId)?.inChrome ?? false;
  }

  /** Whether a step of this chat is waiting for the browser to be handed back. */
  waiting(taskId: string): boolean {
    return (this.waitingTasks.get(taskId) ?? 0) > 0;
  }

  /**
   * Waits while the person holds this chat's browser. `free` when nobody held it, `handed` once it was handed back,
   * `still_held` when the wait ran out first.
   */
  async untilHandedBack(taskId: string, signal: AbortSignal): Promise<'free' | 'handed' | 'still_held'> {
    const holding = this.holdings.get(taskId);
    if (!holding) return 'free';
    signal.throwIfAborted();
    let release = () => {};
    const handed = new Promise<'handed'>(resolve => {
      release = () => resolve('handed');
      holding.released.add(release);
    });
    this.waitingTasks.set(taskId, (this.waitingTasks.get(taskId) ?? 0) + 1);
    this.notify();
    try {
      return await this.untilSettled(handed, signal, 'still_held');
    } finally {
      holding.released.delete(release);
      const count = (this.waitingTasks.get(taskId) ?? 1) - 1;
      if (count > 0) this.waitingTasks.set(taskId, count);
      else this.waitingTasks.delete(taskId);
      this.notify();
    }
  }

  /** The answer, or `timedOut` after the wait runs out; a stopped run rejects with its reason. */
  private untilSettled<Answer, TimedOut>(answer: Promise<Answer>, signal: AbortSignal, timedOut: TimedOut): Promise<Answer | TimedOut> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let onAbort = () => {};
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        settle();
      };
      onAbort = () => finish(() => reject(signal.reason instanceof Error ? signal.reason : new Error('Đã dừng bước trình duyệt.')));
      timer = setTimeout(() => finish(() => resolve(timedOut)), this.waitMs);
      signal.addEventListener('abort', onAbort, { once: true });
      void answer.then(value => finish(() => resolve(value)));
    });
  }
}
