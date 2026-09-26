import { z } from 'zod';
import { BrowserTabId } from './browser';

/**
 * Watching an orglet's browser inside Orglet, and taking it over there (COD-261). A run's browser has no window: the
 * host streams the tab the run last used as JPEG frames while a view is open, and tells the window where the orglet
 * just pointed so Orglet can draw its cursor over the picture. While the person holds the browser, their clicks, wheel
 * and keys in the view go back to the tab. Nothing here is page content beyond the picture: no cookies, no text, no
 * addresses the journal does not already hold. Frames are never stored.
 */

/** At most this many frames a second reach the window; the host acknowledges a frame only after this long. */
export const BROWSER_FRAME_INTERVAL_MS = 100;
/** The JPEG quality of a frame; enough to read a page, small enough to stream. */
export const BROWSER_FRAME_QUALITY = 60;
/** A view renews its watch this often; the host stops streaming when a watch is not renewed within the lease. */
export const BROWSER_WATCH_RENEW_MS = 10_000;
export const BROWSER_WATCH_LEASE_MS = 30_000;
/** How long a step waits for the drawn cursor to reach its element before it acts, and only while someone watches. */
export const BROWSER_CURSOR_LEAD_MS = 300;

/** What a step did at the point the cursor moved to. A key press keeps the cursor where it was. */
export const BrowserCursorAction = z.enum(['click', 'type', 'select']);
export type BrowserCursorAction = z.infer<typeof BrowserCursorAction>;

/** Where the orglet last pointed in one tab, in the page's CSS pixels from the viewport's top left corner. */
export const BrowserCursor = z.object({ tabId: BrowserTabId, x: z.number(), y: z.number(), action: BrowserCursorAction }).strict();
export type BrowserCursor = z.infer<typeof BrowserCursor>;

/**
 * Why Orglet suggests opening the page in the real Chrome window: the live view cannot show or answer it. A passkey
 * prompt, a file picker, a question the page asked in a dialog (Orglet closes those), a password or card field the
 * person is in while they hold the browser, or a sign-in the browser itself asks for (HTTP authentication).
 */
export const BrowserSuggestion = z.enum(['passkey', 'fileChooser', 'dialog', 'sensitiveField', 'httpAuth']);
export type BrowserSuggestion = z.infer<typeof BrowserSuggestion>;

/** A key the person pressed in the view, by its DOM `key` name: one character or a named key such as ArrowLeft. */
const KeyName = z.string().min(1).max(24).regex(/^(?:.|[A-Z][A-Za-z0-9]{0,23})$/u, 'Phím không hợp lệ.');
const Coordinate = z.number().min(-10_000).max(10_000);

/**
 * One thing the person did in the view while holding the browser, already in the page's CSS pixels. Modifier keys
 * arrive as their own key events, as they do from a keyboard, so a click with Control held is Control down, the
 * click, Control up.
 */
export const BrowserInputEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mouse'), action: z.enum(['move', 'down', 'up']), x: Coordinate, y: Coordinate, button: z.enum(['left', 'middle', 'right']), clickCount: z.number().int().min(1).max(3) }).strict(),
  z.object({ type: z.literal('wheel'), x: Coordinate, y: Coordinate, deltaX: z.number().min(-5_000).max(5_000), deltaY: z.number().min(-5_000).max(5_000) }).strict(),
  z.object({ type: z.literal('key'), action: z.enum(['down', 'up']), key: KeyName }).strict(),
  /** Text the person typed or an input method composed, entered as it is. */
  z.object({ type: z.literal('text'), text: z.string().min(1).max(500) }).strict(),
]);
export type BrowserInputEvent = z.infer<typeof BrowserInputEvent>;

/** What a view gets when it starts watching: the tab it will see, where the cursor is and what Orglet suggests. */
export type BrowserWatchState = { watching: boolean; tabId: string | null; cursor: BrowserCursor | null; suggestion: BrowserSuggestion | null; inChrome: boolean };

/** A frame as the window receives it; `width` and `height` are the page's size in CSS pixels, not the picture's. */
export type BrowserLiveFrame = { kind: 'frame'; runId: string; tabId: string; bytes: Uint8Array; width: number; height: number };
/** What the host pushes to the window about one run, relayed by main. */
export type BrowserLiveEvent =
  | BrowserLiveFrame
  | { kind: 'cursor'; runId: string; cursor: BrowserCursor }
  | { kind: 'suggest'; runId: string; suggestion: BrowserSuggestion };

type Size = { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

/**
 * A point in the view, in the view's own CSS pixels, as a point on the page in the page's CSS pixels. The picture can
 * be larger or smaller than the page (a frame is the page's device pixels, scaled to fit what the view asked for, and
 * the view is drawn at the window's own device pixel ratio), so the scale comes from the page's size the frame
 * reports and the size the view is drawn at, never from the picture's pixels. The result stays inside the page.
 */
export function viewToPage(point: { x: number; y: number }, view: Size, page: Size): { x: number; y: number } {
  if (view.width <= 0 || view.height <= 0) return { x: 0, y: 0 };
  const x = point.x * (page.width / view.width);
  const y = point.y * (page.height / view.height);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { x: round(Math.min(Math.max(x, 0), page.width - 1)), y: round(Math.min(Math.max(y, 0), page.height - 1)) };
}

/** The same, the other way: where a point on the page is drawn in the view. */
export function pageToView(point: { x: number; y: number }, view: Size, page: Size): { x: number; y: number } {
  if (page.width <= 0 || page.height <= 0) return { x: 0, y: 0 };
  return { x: point.x * (view.width / page.width), y: point.y * (view.height / page.height) };
}

/** How far into a field the cursor stands when the orglet types: where a caret would be, not the field's middle. */
const TYPING_INSET_PX = 14;

/**
 * Where the cursor goes for a step on an element whose box the page reports: the centre for a click or a choice, and
 * a little way into the field, level with its middle, for typing. Kept inside the viewport.
 */
export function cursorPointFor(action: BrowserCursorAction, box: Box, viewport: Size): { x: number; y: number } {
  const centreY = box.y + box.height / 2;
  const x = action === 'type' ? box.x + Math.min(TYPING_INSET_PX, box.width / 2) : box.x + box.width / 2;
  const clamp = (value: number, limit: number) => Math.round(Math.min(Math.max(value, 0), limit - 1));
  return { x: clamp(x, viewport.width), y: clamp(centreY, viewport.height) };
}

/**
 * Where the orglet last pointed, per run and tab. The host keeps it so a view opened between steps shows the cursor
 * where it was, and forgets a tab when it closes and a run when it ends.
 */
export class BrowserCursorTrack {
  private runs = new Map<string, Map<string, BrowserCursor>>();

  move(runId: string, cursor: BrowserCursor) {
    let tabs = this.runs.get(runId);
    if (!tabs) {
      tabs = new Map();
      this.runs.set(runId, tabs);
    }
    tabs.set(cursor.tabId, cursor);
  }

  at(runId: string, tabId: string): BrowserCursor | null {
    return this.runs.get(runId)?.get(tabId) ?? null;
  }

  /** A tab that closed takes its cursor with it; a page that loads keeps it, as a real pointer stays where it was. */
  forgetTab(runId: string, tabId: string) {
    this.runs.get(runId)?.delete(tabId);
  }

  forgetRun(runId: string) {
    this.runs.delete(runId);
  }
}
