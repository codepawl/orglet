import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { TaskStatus } from '../shared/contracts';

/**
 * How a chat follows its newest message (COD-290). A reader at the end stays at the end whatever makes the thread
 * taller or narrower: streamed text, a card mounting, a picture loading, the window resizing, Details opening. A
 * reader who scrolled up is left where they are, except that a card that needs them is brought into view once when
 * they are still near the end.
 *
 * The old rule re-pinned only when a few counts changed, so a card or a reflow that grew the thread without changing
 * them was not followed; and when Details narrowed the thread, Chromium's scroll anchoring moved `scrollTop` to keep
 * the text in view, and that scroll event read as the reader leaving the end.
 */

/** Where the thread's viewport is, and how big it and its content are, at one look. */
export type ThreadScroll = { top: number; height: number; viewHeight: number; viewWidth: number };

/**
 * Within this many pixels of the end the reader counts as at the end when they scroll back down. Less than one wheel
 * notch (Chromium scrolls 100px per notch), so scrolling down to the last lines resumes following without having to
 * hit the exact bottom.
 */
export const END_SLACK = 80;

/** A scroll smaller than this is sub-pixel rounding at a zoom level, not a move. */
const STILL = 1;

export function gapToEnd(scroll: ThreadScroll): number {
  return Math.max(0, scroll.height - scroll.top - scroll.viewHeight);
}

function layoutChanged(before: ThreadScroll, after: ThreadScroll): boolean {
  return before.height !== after.height || before.viewHeight !== after.viewHeight || before.viewWidth !== after.viewWidth;
}

/**
 * Whether the thread follows its end after a scroll event, from the last look (`before`) and this one (`after`).
 * A scroll that came with a change of size was made by the layout (scroll anchoring on a reflow, the browser clamping
 * when content shrank), not by the reader, so it keeps what was; a reader it left exactly at the end follows. Without
 * a change of size the reader moved: up leaves the end, down to within `END_SLACK` of it comes back.
 */
export function followsAfterScroll(following: boolean, before: ThreadScroll, after: ThreadScroll): boolean {
  const gap = gapToEnd(after);
  if (layoutChanged(before, after)) return following || gap <= STILL;
  if (after.top < before.top - STILL) return false;
  if (after.top > before.top + STILL && gap <= END_SLACK) return true;
  return following;
}

/** Keys that scroll a focused thread up. */
const upwardKeys = new Set(['ArrowUp', 'PageUp', 'Home']);

/**
 * Whether a wheel turn or a key press asks to scroll up. It stops following at once, before its scroll event, so text
 * streaming in at the same moment cannot pin the reader back down while the wheel is still moving.
 */
export function asksToScrollUp(input: { deltaY?: number; key?: string }): boolean {
  if (input.deltaY !== undefined) return input.deltaY < 0;
  return input.key !== undefined && upwardKeys.has(input.key);
}

/**
 * Whether a card that needs the person is brought into view when it appears, from the look before it did: always for
 * a reader following the end, and for one whose view still overlaps the last screenful (less than one viewport height
 * from the end), who scrolled up a little. A reader further up is reading history and is not moved; the island on the
 * prompt bar already says the chat waits for them.
 */
export function revealsNeed(following: boolean, before: ThreadScroll): boolean {
  return following || gapToEnd(before) < before.viewHeight;
}

/** Statuses a chat is still working in; any other that is not an answer waits for the person to look. */
const settledStatuses: readonly TaskStatus[] = ['running', 'queued', 'pausing', 'completed'];

/**
 * What in the latest turn needs the person now, as a key that changes when a new thing does: a browser or desktop
 * step waiting on its card, a question or MCP call waiting for an answer, or a turn that ended without an answer
 * (failed, stopped, paused, waiting for budget, a hand-in a command blocked). Empty when nothing does.
 */
export function needsPersonKey({ status, turn, lastRunId, waitingIds }: { status: TaskStatus; turn: number; lastRunId?: string; waitingIds: readonly (string | undefined)[] }): string {
  const parts = waitingIds.filter((id): id is string => Boolean(id));
  if (!settledStatuses.includes(status)) parts.push(`${status}:${turn}:${lastRunId ?? ''}`);
  return parts.join('|');
}

function look(element: HTMLElement): ThreadScroll {
  return { top: element.scrollTop, height: element.scrollHeight, viewHeight: element.clientHeight, viewWidth: element.clientWidth };
}

/**
 * Keeps `viewport` at its end while the reader is there, from the first frame. `content` is the element whose height
 * grows with the chat. `needKey` (`needsPersonKey`) brings a new card that needs the person into view once;
 * `turnCount` growing (the person sent a message) always goes to the end.
 */
export function useThreadFollow(viewport: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, { needKey, turnCount }: { needKey: string; turnCount: number }) {
  const following = useRef(true);
  const lastLook = useRef<ThreadScroll | null>(null);
  const pinToEnd = (element: HTMLElement) => {
    element.scrollTop = element.scrollHeight;
    following.current = true;
    lastLook.current = look(element);
  };

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    pinToEnd(element);
    const onScroll = () => {
      const now = look(element);
      following.current = followsAfterScroll(following.current, lastLook.current ?? now, now);
      lastLook.current = now;
    };
    const onWheel = (event: WheelEvent) => {
      if (element.scrollTop > 0 && asksToScrollUp({ deltaY: event.deltaY })) following.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (element.scrollTop > 0 && asksToScrollUp({ key: event.key })) following.current = false;
    };
    // Runs after layout and before paint whenever the thread or its content changes size, so the end is kept
    // without a frame drawn away from it.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      if (following.current) pinToEnd(element);
      else lastLook.current = look(element);
    });
    observer?.observe(element);
    if (content.current) observer?.observe(content.current);
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('keydown', onKeyDown);
    return () => {
      observer?.disconnect();
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Once per new thing that needs the person, judged from where the reader was before it appeared: this runs after
  // the commit that mounted the card but before the resize observer has taken a new look.
  const revealedKey = useRef(needKey);
  useLayoutEffect(() => {
    const previousKey = revealedKey.current;
    revealedKey.current = needKey;
    const element = viewport.current;
    if (!needKey || needKey === previousKey || !element || !lastLook.current) return;
    if (revealsNeed(following.current, lastLook.current)) pinToEnd(element);
  }, [needKey]);

  // The person's own new message: the view goes to the end with it, wherever they were reading.
  const knownTurns = useRef(turnCount);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (turnCount > knownTurns.current && element) pinToEnd(element);
    knownTurns.current = turnCount;
  }, [turnCount]);
}
