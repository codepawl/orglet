import type { CDPSession, Page } from 'playwright-core';
import { BROWSER_FRAME_INTERVAL_MS, BROWSER_FRAME_QUALITY } from '../shared/browser-live';

/** The widest picture a view may ask for; a wider view gets this and scales it. */
export const MAX_FRAME_WIDTH = 1920;
const MIN_FRAME_WIDTH = 320;
/**
 * Chrome can drop a screencast frame that comes while earlier ones wait for an acknowledgement, so the last change of
 * a quick burst can go unsent until the page changes again (seen in the packaged app for COD-261). This long after the
 * last frame, one picture of the tab as it is now is sent, so the view always ends on the page's real state.
 */
const SETTLE_MS = 400;

type FrameSize = { width: number; height: number };

/**
 * One tab's picture while a view watches it (COD-261): Chrome's screencast of the tab as JPEG frames. Chrome sends
 * the next frame only once the last one is acknowledged, so acknowledging each after `BROWSER_FRAME_INTERVAL_MS`
 * keeps the stream at ten frames a second at most, and a page that does not change sends none; one settling picture
 * follows each burst. While Orglet takes a screenshot of its own (which covers password fields and outlines an
 * element for a moment), frames are held back. Frames go straight to `onFrame` and are never kept.
 */
export class FrameStream {
  private session?: CDPSession;
  private stopped = false;
  private paused = 0;
  private settleTimer?: NodeJS.Timeout;
  /** The page's size in CSS pixels, as the last frame reported it. */
  private size?: FrameSize;

  constructor(private page: Page, private width: number, private onFrame: (data: string, size: FrameSize) => void) {}

  async start() {
    const session = await this.page.context().newCDPSession(this.page);
    this.session = session;
    session.on('Page.screencastFrame', frame => {
      setTimeout(() => void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {}), BROWSER_FRAME_INTERVAL_MS);
      if (this.stopped || this.paused > 0) return;
      this.size = { width: Math.round(frame.metadata.deviceWidth), height: Math.round(frame.metadata.deviceHeight) };
      this.onFrame(frame.data, this.size);
      this.settleSoon();
    });
    const viewport = await this.viewport();
    const maxWidth = Math.min(Math.max(Math.round(this.width), MIN_FRAME_WIDTH), MAX_FRAME_WIDTH);
    const maxHeight = Math.round(maxWidth * viewport.height / Math.max(viewport.width, 1));
    if (this.stopped) return this.detach();
    await session.send('Page.startScreencast', { format: 'jpeg', quality: BROWSER_FRAME_QUALITY, maxWidth, maxHeight, everyNthFrame: 1 });
  }

  /** Holds frames back while Orglet changes the page for a screenshot of its own. */
  pause() {
    this.paused += 1;
    clearTimeout(this.settleTimer);
  }

  /** Lets frames through again, and sends the page as it is once it settles. */
  resume() {
    this.paused = Math.max(this.paused - 1, 0);
    if (this.paused === 0) this.settleSoon();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.settleTimer);
    await this.session?.send('Page.stopScreencast').catch(() => {});
    await this.detach();
  }

  private settleSoon() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => void this.settle(), SETTLE_MS);
    this.settleTimer.unref?.();
  }

  /** One picture of the tab as it is now, after a burst of frames. */
  private async settle() {
    const session = this.session;
    if (!session || this.stopped || this.paused > 0) return;
    // The page's size comes from the frames, as the view scales by it; the picture is the visible part of the page.
    const size = this.size ?? await this.viewport();
    const shot = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: BROWSER_FRAME_QUALITY, captureBeyondViewport: false }).catch(() => undefined);
    if (!shot || this.stopped || this.paused > 0) return;
    this.onFrame(shot.data, size);
  }

  private async viewport(): Promise<FrameSize> {
    return this.page.viewportSize() ?? await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => ({ width: 1280, height: 800 }));
  }

  private async detach() {
    await this.session?.detach().catch(() => {});
    this.session = undefined;
  }
}
