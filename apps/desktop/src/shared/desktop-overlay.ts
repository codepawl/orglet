import { z } from 'zod';
import { Language } from './i18n';

/**
 * The glow Orglet draws on the desktop while an orglet controls something (COD-261): the person's accent colour at the
 * inner edges of the window an orglet acts on, fading to nothing towards the middle, and a pill at the top with the
 * orglet's face saying who is using what, with Stop. While it borrows the real mouse and keyboard the same glow frames the
 * whole display, stronger, and the pill says so. The core decides when it shows and where; main draws it in one
 * click-through window that never takes the focus; the page is `renderer/components/DesktopOverlay.tsx`.
 */

/** How long the glow stays after a run's last step, so a run stepping quickly does not flicker it on and off. */
export const OVERLAY_LINGER_MS = 1_000;
/** How often the core asks where the window is while the glow shows, so the glow follows a window being moved. */
export const OVERLAY_FOLLOW_MS = 300;

/** A rectangle on the desktop. From the core it is in physical pixels, as Windows reports them. */
export const OverlayRect = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
export type OverlayRect = z.infer<typeof OverlayRect>;

/** Who is acting, as the peek draws it: the same fields `Avatar` takes for a worker. */
export const OverlayWorker = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  avatar: z.object({ mascot: z.string().max(60).optional(), color: z.string().max(40).optional() }).strict().optional(),
}).strict();
export type OverlayWorker = z.infer<typeof OverlayWorker>;

/**
 * Where the orglet's own cursor goes on the overlay during a background step: the middle of the element it acts on.
 * `press` squashes it and leaves a ripple, `type` rests it with the eyes on the field; `sequence` makes a second press
 * on the same point play again.
 */
export const OverlayCursor = z.object({ x: z.number().int(), y: z.number().int(), action: z.enum(['move', 'press', 'type']), sequence: z.number().int().nonnegative() }).strict();
export type OverlayCursor = z.infer<typeof OverlayCursor>;

/**
 * What the core asks main to draw. `window` frames the window the orglet acts on in the background; `borrow` frames
 * the display that window is on while the real mouse and keyboard are borrowed.
 */
export const DesktopOverlayState = z.discriminatedUnion('visible', [
  z.object({ visible: z.literal(false) }).strict(),
  z.object({
    visible: z.literal(true),
    mode: z.enum(['window', 'borrow']),
    taskId: z.string().min(1).max(200),
    runId: z.string().min(1).max(200),
    worker: OverlayWorker,
    app: z.string().min(1).max(120),
    frame: OverlayRect,
    cursor: OverlayCursor.optional(),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    theme: z.enum(['system', 'light', 'dark']),
    language: Language,
  }).strict(),
]);
export type DesktopOverlayState = z.infer<typeof DesktopOverlayState>;
export type VisibleOverlayState = Extract<DesktopOverlayState, { visible: true }>;

/**
 * What the overlay page gets from main: the state, with the cursor in the page's own pixels, and how far down the peek
 * sits so it stays on screen when the window reaches above the top of the display.
 */
export type OverlayView =
  | { visible: false }
  | {
    visible: true; mode: 'window' | 'borrow'; worker: OverlayWorker; app: string; accent?: string; theme: 'system' | 'light' | 'dark'; language: Language;
    cursor?: OverlayCursor; peekTop: number; followsRealCursor: boolean;
  };

/** What the overlay page may do, exposed by the preload as `window.orgletOverlay`. */
export type OverlayBridge = {
  onView: (callback: (view: OverlayView) => void) => () => void;
  onRealCursor: (callback: (point: { x: number; y: number }) => void) => () => void;
  /** The page listens now; main sends views only after this. */
  ready: () => void;
  /** Whether the pointer is over the pill, so main lets the pill take the click. */
  pointer: (inside: boolean) => void;
  /** Stops the run the overlay shows. */
  stop: () => Promise<unknown>;
};

/**
 * How far below the overlay's top edge the peek sits: none when the frame's top is on screen, and as much as the frame
 * reaches above the work area otherwise, so the face and the pill stay visible.
 */
export function peekInset(frame: OverlayRect, workArea: OverlayRect): number {
  return Math.max(0, Math.min(frame.height - 1, workArea.y - frame.y));
}

/** A program's name as the pill says it: "notepad.exe" reads "Notepad". */
export function appName(program: string): string {
  const base = program.replace(/\.exe$/i, '').trim();
  if (!base) return program;
  return `${base.charAt(0).toLocaleUpperCase()}${base.slice(1)}`;
}

/** A point, moved into a frame's own pixels. */
export function pointInFrame(point: { x: number; y: number }, frame: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x - frame.x), y: Math.round(point.y - frame.y) };
}

type Box = { x: number; y: number; width: number; height: number };
const whole = (box: Box): OverlayRect => {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  return { x, y, width: Math.max(1, Math.round(box.x + box.width) - x), height: Math.max(1, Math.round(box.y + box.height) - y) };
};

/**
 * Where the overlay window goes, in the display's own units (DIPs): over the window's frame for a background step, over
 * the whole display the window is on while borrowing. The peek sits inside the top edge, lowered to stay on screen when
 * the window reaches above the display's work area.
 */
export function overlayLayout(mode: 'window' | 'borrow', frame: Box, display: { bounds: Box; workArea: Box }): { bounds: OverlayRect; peekTop: number } {
  const bounds = whole(mode === 'borrow' ? display.bounds : frame);
  return { bounds, peekTop: peekInset(bounds, whole(display.workArea)) };
}
