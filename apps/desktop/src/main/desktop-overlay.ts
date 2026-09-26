import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { DesktopOverlayState, overlayLayout, pointInFrame, type OverlayRect, type OverlayView, type VisibleOverlayState } from '../shared/desktop-overlay';

/**
 * Draws the glow the core asks for while an orglet controls a desktop app (COD-261): one transparent window over the
 * window being used, or over its whole display while the real mouse is borrowed, with the orglet peeking over the top
 * edge and a pill with Stop. The page is the renderer's `#overlay` view (`DesktopOverlay.tsx`).
 *
 * It never takes the focus or a click meant for the app: the window cannot be focused, is shown without activating,
 * and lets the mouse through everywhere but the pill, which takes the pointer only while the pointer is over it. It is
 * not in the window pictures the helper keeps, since `PrintWindow` draws only the window it is given.
 */

/** How often the orglet's cursor follows the real one while the mouse is borrowed. */
const REAL_CURSOR_MS = 16;
/** How long a new overlay page may take to mount before a state gives up on it. */
const PAGE_READY_WAIT_MS = 5_000;

export class DesktopOverlayWindow {
  private window?: BrowserWindow;
  /** Settles once the page has mounted and listens: a view sent before that would be lost. */
  private pageReady?: Promise<void>;
  private markPageReady?: () => void;
  private state: DesktopOverlayState = { visible: false };
  private bounds?: OverlayRect;
  private cursorTimer?: NodeJS.Timeout;
  private overPill = false;

  /** `cancel` stops the run the pill names, as the composer's Stop does. */
  constructor(private url: string, private preload: string, private cancel: (taskId: string) => Promise<unknown>) {
    ipcMain.on('orglet-overlay:ready', event => {
      if (this.fromOverlay(event)) this.markPageReady?.();
    });
    ipcMain.on('orglet-overlay:pointer', (event, inside: unknown) => {
      if (this.fromOverlay(event)) this.setOverPill(inside === true);
    });
    ipcMain.handle('orglet-overlay:stop', async event => {
      if (!this.fromOverlay(event) || !this.state.visible) return false;
      await this.cancel(this.state.taskId);
      return true;
    });
  }

  /** Only the overlay's own page may point or stop, and it can only stop the run it shows. */
  private fromOverlay(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const overlay = this.window;
    return overlay !== undefined && !overlay.isDestroyed() && event.sender === overlay.webContents && event.senderFrame === overlay.webContents.mainFrame;
  }

  /**
   * A state from the core; anything that does not parse leaves the glow as it is. Answers once the glow is on screen
   * (or gone, for a hidden state), which a borrow waits for before its first input.
   */
  async update(raw: unknown): Promise<boolean> {
    const parsed = DesktopOverlayState.safeParse(raw);
    if (!parsed.success) return false;
    this.state = parsed.data;
    if (!parsed.data.visible) {
      this.hide();
      return true;
    }
    return this.show(parsed.data);
  }

  /** Called when the app's main window closes, so a hidden overlay never keeps the app running. */
  destroy() {
    this.stopFollowingCursor();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }

  private create(): BrowserWindow {
    const overlay = new BrowserWindow({
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, title: 'Orglet',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', event => event.preventDefault());
    overlay.on('closed', () => {
      this.window = undefined;
      this.pageReady = undefined;
    });
    this.pageReady = new Promise<void>(resolve => { this.markPageReady = resolve; });
    void overlay.loadURL(`${this.url}#overlay`).catch(() => undefined);
    return overlay;
  }

  private async show(state: VisibleOverlayState): Promise<boolean> {
    const overlay = this.window ?? (this.window = this.create());
    // The page says when it listens; one that never does (a broken load) leaves the glow off, and a borrow then falls
    // back to the helper's own notice.
    const ready = await Promise.race([this.pageReady?.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), PAGE_READY_WAIT_MS))]);
    if (!ready) return false;
    // A newer state arrived while the page loaded.
    if (this.state !== state || overlay.isDestroyed()) return false;
    const frame = screen.screenToDipRect(null, state.frame);
    const display = screen.getDisplayMatching(frame);
    const layout = overlayLayout(state.mode, frame, display);
    this.bounds = layout.bounds;
    overlay.setBounds(layout.bounds);
    const view: OverlayView = {
      visible: true, mode: state.mode, worker: state.worker, app: state.app, theme: state.theme, language: state.language, peekTop: layout.peekTop, followsRealCursor: state.mode === 'borrow',
      ...(state.accent ? { accent: state.accent } : {}),
      ...(state.cursor ? { cursor: { ...state.cursor, ...pointInFrame(screen.screenToDipPoint(state.cursor), layout.bounds) } } : {}),
    };
    overlay.webContents.send('orglet-overlay:view', view);
    if (!overlay.isVisible()) overlay.showInactive();
    if (state.mode === 'borrow') this.followRealCursor();
    else this.stopFollowingCursor();
    return overlay.isVisible();
  }

  /** While the mouse is borrowed the orglet's cursor rides on the real one, so the person sees who moves it. */
  private followRealCursor() {
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => {
      const overlay = this.window;
      if (!overlay || overlay.isDestroyed() || !this.bounds) return;
      overlay.webContents.send('orglet-overlay:real-cursor', pointInFrame(screen.getCursorScreenPoint(), this.bounds));
    }, REAL_CURSOR_MS);
  }

  private stopFollowingCursor() {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    this.cursorTimer = undefined;
  }

  private setOverPill(inside: boolean) {
    if (inside === this.overPill || !this.window || this.window.isDestroyed()) return;
    this.overPill = inside;
    // Over the pill the overlay takes the pointer so Stop can be clicked; it still cannot take the focus.
    this.window.setIgnoreMouseEvents(!inside, { forward: true });
  }

  private hide() {
    this.stopFollowingCursor();
    this.setOverPill(false);
    const overlay = this.window;
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.send('orglet-overlay:view', { visible: false } satisfies OverlayView);
    overlay.hide();
  }
}
