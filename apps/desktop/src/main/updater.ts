import { appendFile, readFile, writeFile } from 'node:fs/promises';
import type { UpdateState, UpdateEnvironment } from '../shared/updates';
import { updateErrorReason, updateSupport } from '../shared/updates';

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
  /**
   * One line for each thing the updater did, so "did it check this morning?" has an answer on the person's machine
   * (COD-304). Main writes these to `updater.log` in the data folder; Squirrel keeps its own `SquirrelSetup.log`.
   */
  log?: (line: string) => void;
  clock?: () => Date;
};

/** How much of an engine error the log keeps: Squirrel's stack traces run to several thousand characters. */
const ENGINE_ERROR_LOG_LIMIT = 4000;

/** Why a check started, as the log names it. */
type CheckReason = 'startup' | 'interval' | 'manual';

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
  private readonly log: (line: string) => void;
  private readonly clock: () => Date;
  private startupTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;

  constructor(options: UpdaterOptions) {
    this.engine = options.engine;
    this.firstRun = options.firstRun;
    this.automatic = options.automatic;
    this.onChange = options.onChange;
    this.log = options.log ?? (() => undefined);
    this.clock = options.clock ?? (() => new Date());
    const support = updateSupport(options.environment);
    this.supported = support.supported;
    this.state = support.supported ? { status: 'idle' } : { status: 'unsupported', reason: support.reason };
    if (!support.supported) {
      this.log(`not checking: ${support.reason} build`);
      return;
    }
    this.log(`feed ${options.feedUrl}${options.firstRun ? ' (first run after Setup)' : ''}`);
    this.engine.setFeedURL({ url: options.feedUrl });
    this.engine.on('checking-for-update', () => this.set({ status: 'checking' }));
    this.engine.on('update-available', () => this.set({ status: 'downloading' }));
    this.engine.on('update-not-available', () => this.set({ status: 'up-to-date', checkedAt: this.now() }));
    this.engine.on('update-downloaded', (_event: unknown, _notes: string, releaseName: string) => {
      this.set({ status: 'ready', version: typeof releaseName === 'string' && releaseName ? releaseName : null });
    });
    this.engine.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // The whole text, stack trace and all, goes to the log; the state carries the one sentence a person can read.
      this.log(`engine error: ${oneLine(message).slice(0, ENGINE_ERROR_LOG_LIMIT)}`);
      this.set({ status: 'error', message: updateErrorReason(message), checkedAt: this.now() });
    });
  }

  /** Starts the schedule the saved setting asks for. Safe to call once; `stop` undoes it. */
  start(): void {
    if (!this.supported) return;
    if (!this.automatic) {
      this.log('automatic updates are off: checking only when asked');
      return;
    }
    this.schedule();
  }

  /** Turning the setting on starts checking again; turning it off leaves only manual checks. */
  setAutomatic(automatic: boolean): void {
    if (automatic === this.automatic) return;
    this.automatic = automatic;
    this.clearTimers();
    // A build that cannot update has no feed: a scheduled check would turn "unsupported" into Electron's
    // "Update URL is not set" error.
    if (automatic && this.supported) this.schedule();
  }

  /** A check the person asked for. Returns the state to show right away; the engine's events follow. */
  check(): UpdateState {
    if (!this.supported) return this.state;
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    this.runCheck('manual');
    return this.state;
  }

  /** Restarts into the downloaded version. Refuses when nothing is downloaded, so the button cannot quit the app for nothing. */
  install(): void {
    if (this.state.status !== 'ready') throw new Error('Chưa có bản cập nhật nào tải xong.');
    this.log(`restarting into ${this.state.version ?? 'the downloaded version'}`);
    this.engine.quitAndInstall();
  }

  stop(): void {
    this.clearTimers();
  }

  private schedule(): void {
    // The installer's first launch skips the early check; the interval still covers the rest of the session.
    if (!this.firstRun) {
      this.startupTimer = setTimeout(() => this.scheduledCheck('startup'), STARTUP_CHECK_DELAY_MS);
      this.startupTimer.unref?.();
    }
    this.intervalTimer = setInterval(() => this.scheduledCheck('interval'), CHECK_INTERVAL_MS);
    this.intervalTimer.unref?.();
    const startup = this.firstRun ? 'no startup check on the first run after Setup' : `first check in ${STARTUP_CHECK_DELAY_MS / 1000} s`;
    this.log(`automatic updates on: ${startup}, then every ${CHECK_INTERVAL_MS / 3_600_000} h`);
  }

  private scheduledCheck(reason: CheckReason): void {
    // A downloaded update waits for a restart; checking again would only download it once more.
    if (this.state.status === 'ready' || this.state.status === 'checking' || this.state.status === 'downloading') return;
    this.runCheck(reason);
  }

  private runCheck(reason: CheckReason): void {
    this.log(`check (${reason})`);
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
    // The engine announces a check the updater already announced; one line and one push are enough.
    const repeatsChecking = state.status === 'checking' && this.state.status === 'checking';
    this.state = state;
    if (repeatsChecking) return;
    this.log(describeState(state));
    this.onChange(state);
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

/** The log line for a state: what the updater knows now, in the engine's own words for a failure. */
export function describeState(state: UpdateState): string {
  if (state.status === 'unsupported') return `not checking: ${state.reason} build`;
  if (state.status === 'idle') return 'idle';
  if (state.status === 'checking') return 'checking';
  if (state.status === 'up-to-date') return 'up to date';
  if (state.status === 'downloading') return 'update found, downloading';
  if (state.status === 'ready') return `downloaded ${state.version ?? '(version not reported)'}, waiting for a restart`;
  return `failed: ${oneLine(state.message)}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The log stays small: past this size the older half is dropped on the next write. */
export const UPDATER_LOG_LIMIT_BYTES = 64 * 1024;

/**
 * Writes the updater's lines to `file`, one timestamped line each, in order. A write that fails costs the line and
 * never the update.
 */
export function updaterLogWriter(file: string, clock: () => Date = () => new Date()): UpdaterLogWriter {
  let queue: Promise<void> = Promise.resolve();
  const write = (line: string) => {
    const entry = `${clock().toISOString()} ${line}\n`;
    queue = queue.then(() => appendKeepingLimit(file, entry)).catch(() => undefined);
  };
  return Object.assign(write, { written: () => queue });
}

/** Writes one line; `written` resolves once every line written so far is on disk (or failed). */
export type UpdaterLogWriter = ((line: string) => void) & { written: () => Promise<void> };

async function appendKeepingLimit(file: string, entry: string): Promise<void> {
  const existing = await readFile(file, 'utf8').catch(() => '');
  if (Buffer.byteLength(existing) + Buffer.byteLength(entry) <= UPDATER_LOG_LIMIT_BYTES) {
    await appendFile(file, entry, 'utf8');
    return;
  }
  const kept = existing.slice(Math.floor(existing.length / 2));
  const fromLineStart = kept.slice(kept.indexOf('\n') + 1);
  await writeFile(file, fromLineStart + entry, 'utf8');
}
