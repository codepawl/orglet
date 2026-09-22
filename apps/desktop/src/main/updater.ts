import type { UpdateState, UpdateEnvironment } from '../shared/updates';
import { updateSupport } from '../shared/updates';

/**
 * The part of Electron's `autoUpdater` the app uses. Kept as an interface so the state machine below can be
 * driven by a fake in tests, where Electron is not running.
 */
export interface UpdaterEngine {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  // The listener is typed the way Node's EventEmitter types it, so the real autoUpdater and a fake both fit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** A first check waits until the window is up and the installer has let go of the files. */
export const STARTUP_CHECK_DELAY_MS = 30_000;
/** Then every few hours while the app stays open. A release is rare; a person notices the next one the same day. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type UpdaterOptions = {
  engine: UpdaterEngine;
  environment: UpdateEnvironment;
  feedUrl: string;
  /** Squirrel launches the app with `--squirrel-firstrun` right after installing; checking then races the installer. */
  firstRun: boolean;
  /** The saved setting: check on a schedule and download in the background, or only when asked. */
  automatic: boolean;
  onChange: (state: UpdateState) => void;
  clock?: () => Date;
};

/**
 * Owns the updater's state and its schedule (COD-176). The engine reports what happened; this turns it into one
 * state the About tab and the notice read, and decides when a check runs on its own. It never invents a state:
 * an unsupported build stays unsupported, and a failed check keeps the engine's reason.
 */
export class Updater {
  state: UpdateState;
  private readonly engine: UpdaterEngine;
  private readonly supported: boolean;
  private readonly firstRun: boolean;
  private automatic: boolean;
  private readonly onChange: (state: UpdateState) => void;
  private readonly clock: () => Date;
  private startupTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;

  constructor(options: UpdaterOptions) {
    this.engine = options.engine;
    this.firstRun = options.firstRun;
    this.automatic = options.automatic;
    this.onChange = options.onChange;
    this.clock = options.clock ?? (() => new Date());
    const support = updateSupport(options.environment);
    this.supported = support.supported;
    this.state = support.supported ? { status: 'idle' } : { status: 'unsupported', reason: support.reason };
    if (!support.supported) return;
    this.engine.setFeedURL({ url: options.feedUrl });
    this.engine.on('checking-for-update', () => this.set({ status: 'checking' }));
    this.engine.on('update-available', () => this.set({ status: 'downloading' }));
    this.engine.on('update-not-available', () => this.set({ status: 'up-to-date', checkedAt: this.now() }));
    this.engine.on('update-downloaded', (_event: unknown, _notes: string, releaseName: string) => {
      this.set({ status: 'ready', version: typeof releaseName === 'string' && releaseName ? releaseName : null });
    });
    this.engine.on('error', (error: unknown) => {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error), checkedAt: this.now() });
    });
  }

  /** Starts the schedule the saved setting asks for. Safe to call once; `stop` undoes it. */
  start(): void {
    if (!this.supported || !this.automatic) return;
    this.schedule();
  }

  /** Turning the setting on starts checking again; turning it off leaves only manual checks. */
  setAutomatic(automatic: boolean): void {
    if (automatic === this.automatic) return;
    this.automatic = automatic;
    this.clearTimers();
    if (automatic) this.schedule();
  }

  /** A check the person asked for. Returns the state to show right away; the engine's events follow. */
  check(): UpdateState {
    if (!this.supported) return this.state;
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    this.set({ status: 'checking' });
    this.engine.checkForUpdates();
    return this.state;
  }

  /** Restarts into the downloaded version. Refuses when nothing is downloaded, so the button cannot quit the app for nothing. */
  install(): void {
    if (this.state.status !== 'ready') throw new Error('Chưa có bản cập nhật nào tải xong.');
    this.engine.quitAndInstall();
  }

  stop(): void {
    this.clearTimers();
  }

  private schedule(): void {
    // The installer's first launch skips the early check; the interval still covers the rest of the session.
    if (!this.firstRun) {
      this.startupTimer = setTimeout(() => this.scheduledCheck(), STARTUP_CHECK_DELAY_MS);
      this.startupTimer.unref?.();
    }
    this.intervalTimer = setInterval(() => this.scheduledCheck(), CHECK_INTERVAL_MS);
    this.intervalTimer.unref?.();
  }

  private scheduledCheck(): void {
    // A downloaded update waits for a restart; checking again would only download it once more.
    if (this.state.status === 'ready' || this.state.status === 'checking' || this.state.status === 'downloading') return;
    this.set({ status: 'checking' });
    this.engine.checkForUpdates();
  }

  private clearTimers(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = undefined;
    this.intervalTimer = undefined;
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.onChange(state);
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
