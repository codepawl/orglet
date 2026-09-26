import {
  OVERLAY_FOLLOW_MS, OVERLAY_LINGER_MS, appName, type DesktopOverlayState, type OverlayCursor, type OverlayRect, type OverlayWorker,
} from '../../shared/desktop-overlay';
import type { Language } from '../../shared/i18n';

/**
 * When the glow shows on the desktop and where (COD-261). The core knows when an orglet acts on a window and when it
 * borrows the real mouse; main only draws what this sends.
 *
 * A step that acts on a window shows the glow around it at once, with the orglet's cursor going to the element. The
 * glow stays `OVERLAY_LINGER_MS` after the step, so a run that acts again soon keeps it on instead of flickering, and
 * follows the window every `OVERLAY_FOLLOW_MS` while it shows. A borrow frames the whole display of that window until
 * it ends. A run that stops or finishes takes the glow away at once, and so does a window that closes or is minimized.
 * Reading a window shows nothing: the glow means the orglet is controlling something.
 */

export type OverlayTarget = {
  runId: string;
  taskId: string;
  worker: OverlayWorker;
  /** The window, by its handle, and the programs the run may reach now: the helper checks both before it answers. */
  handle: number;
  program: string;
  allow: () => string[];
};

/** Where the window's visible frame is now, in physical pixels; undefined when it closed or is minimized. */
export type FrameReader = (handle: number, allow: string[]) => Promise<OverlayRect | undefined>;

/** The accent, theme and language the glow and the pill take, as the person set them in Settings. */
export type OverlayLook = () => { accent?: string; theme: 'system' | 'light' | 'dark'; language: Language };

export type OverlayTimers = {
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  setInterval: (callback: () => void, milliseconds: number) => unknown;
  clearInterval: (timer: unknown) => void;
};

const realTimers: OverlayTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: timer => clearTimeout(timer as NodeJS.Timeout),
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: timer => clearInterval(timer as NodeJS.Timeout),
};

const sameFrame = (first: OverlayRect, second: OverlayRect) =>
  first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;

export class DesktopOverlayDirector {
  private state: DesktopOverlayState = { visible: false };
  private target?: OverlayTarget;
  private mode: 'window' | 'borrow' = 'window';
  private frame?: OverlayRect;
  private cursor?: OverlayCursor;
  /** Steps of the current run acting now; the glow lingers only once the last of them ended. */
  private acting = 0;
  private sequence = 0;
  private lingerTimer?: unknown;
  private followTimer?: unknown;

  /** `send` may answer whether the glow is on screen now; nothing, or false, means it is not known to be. */
  constructor(private send: (state: DesktopOverlayState) => Promise<boolean> | void, private readFrame: FrameReader, private look: OverlayLook, private timers: OverlayTimers = realTimers) {}

  /** What was sent last; the tests read it. */
  get current(): DesktopOverlayState {
    return this.state;
  }

  /**
   * A step starts acting on a window (`window`), or a borrow starts (`borrow`). `point` is the middle of the element in
   * physical pixels, where the orglet's cursor goes; a borrow has none, since the real cursor moves then. Answers
   * whether whatever draws the glow said it is on screen.
   */
  async begin(target: OverlayTarget, mode: 'window' | 'borrow', point?: { x: number; y: number; action: 'move' | 'press' | 'type' }): Promise<boolean> {
    this.cancelLinger();
    if (this.target && this.target.runId !== target.runId) this.reset();
    this.target = target;
    this.mode = mode;
    this.acting += 1;
    if (point) {
      this.sequence += 1;
      this.cursor = { ...point, sequence: this.sequence };
    }
    if (mode === 'borrow') this.cursor = undefined;
    const frame = await this.readFrame(target.handle, target.allow()).catch(() => undefined);
    // The run may have ended or moved on while the frame was read.
    if (this.target !== target) return false;
    if (!frame) {
      this.hide();
      return false;
    }
    this.frame = frame;
    this.startFollowing();
    return this.publish();
  }

  /** The step or the borrow ended: the glow goes back to the window and stays a moment for the next step. */
  end(runId: string) {
    if (!this.target || this.target.runId !== runId) return;
    this.acting = Math.max(0, this.acting - 1);
    if (this.mode === 'borrow') {
      this.mode = 'window';
      if (this.frame) void this.publish();
    }
    if (this.acting === 0) this.lingerTimer = this.timers.setTimeout(() => this.hide(), OVERLAY_LINGER_MS);
  }

  /** The run stopped, failed or finished: the glow goes at once. */
  stop(runId: string) {
    if (this.target?.runId === runId) this.hide();
  }

  private async publish(): Promise<boolean> {
    const target = this.target;
    const frame = this.frame;
    if (!target || !frame) return false;
    const look = this.look();
    this.state = {
      visible: true, mode: this.mode, taskId: target.taskId, runId: target.runId, worker: target.worker, app: appName(target.program), frame,
      ...(this.cursor ? { cursor: this.cursor } : {}), ...(look.accent ? { accent: look.accent } : {}), theme: look.theme, language: look.language,
    };
    return (await this.send(this.state)) === true;
  }

  private startFollowing() {
    if (this.followTimer !== undefined) return;
    this.followTimer = this.timers.setInterval(() => { void this.follow(); }, OVERLAY_FOLLOW_MS);
  }

  /** Moves the glow with a window being dragged or resized; a window that closed or was minimized takes it away. */
  private async follow() {
    const target = this.target;
    if (!target) return;
    const frame = await this.readFrame(target.handle, target.allow()).catch(() => undefined);
    if (this.target !== target) return;
    if (!frame) {
      this.hide();
      return;
    }
    if (this.frame && sameFrame(this.frame, frame)) return;
    this.frame = frame;
    void this.publish();
  }

  private cancelLinger() {
    if (this.lingerTimer === undefined) return;
    this.timers.clearTimeout(this.lingerTimer);
    this.lingerTimer = undefined;
  }

  private reset() {
    this.cancelLinger();
    if (this.followTimer !== undefined) this.timers.clearInterval(this.followTimer);
    this.followTimer = undefined;
    this.target = undefined;
    this.frame = undefined;
    this.cursor = undefined;
    this.acting = 0;
    this.mode = 'window';
  }

  private hide() {
    this.reset();
    if (!this.state.visible) return;
    this.state = { visible: false };
    void this.send(this.state);
  }
}
