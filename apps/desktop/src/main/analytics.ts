import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountState } from '../shared/account';
import {
  ANALYTICS_APP,
  ANALYTICS_PATH,
  AnalyticsQueue,
  AnalyticsSettings,
  MAX_QUEUED_ERRORS,
  MAX_QUEUED_EVENTS,
  appendBounded,
  parseError,
  parseEvent,
  scrubbedError,
  sendable,
  splitIntoBatches,
  WireAppVersion,
  WireError,
  WireEvent,
  type AnalyticsBatch,
  type AnalyticsError,
  type AnalyticsEvent,
  type AnalyticsFeature,
  type AnalyticsState,
  type ErrorKind,
  type ScrubContext,
} from '../shared/analytics';

/**
 * Usage analytics for a signed-in account (COD-344). Main owns it because only main has the access token. Events and
 * errors wait in memory and in a small file queue beside the account file, and go to the account service every five
 * minutes and on quit. Nothing is recorded without an account, with the switch off, or in tests, smokes and
 * development runs (`analyticsAllowedHere`). Nothing here imports Electron, so the tests drive it with a fake fetch.
 */

const SETTINGS_FILE = 'analytics.json';
const QUEUE_FILE = 'analytics-queue.json';
const PERSIST_DELAY_MS = 2_000;
const SHUTDOWN_FLUSH_MS = 3_000;
const FIRST_RETRY_MS = 30_000;
const LONGEST_RETRY_MS = 60 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = 60_000;

export type AnalyticsDependencies = {
  /** Orglet's data folder; the settings and the queue live here, never in the database, so no backup carries them. */
  directory: string;
  /** The account service's base address, from `accountsBaseUrl`. */
  baseUrl: string;
  appVersion: string;
  platform: string;
  /** `analyticsAllowedHere` for this run: false in tests, smokes, `ORGLET_ANALYTICS=off` and development runs. */
  allowed: boolean;
  /** The account's access token, refreshed by the account module when it is about to end. */
  getAccessToken: () => Promise<string>;
  scrub: ScrubContext;
  fetch?: typeof fetch;
  now?: () => number;
  /** Omit to flush only when asked, as the tests do. */
  flushIntervalMs?: number;
};

type Queue = { events: AnalyticsEvent[]; errors: AnalyticsError[] };

export class AnalyticsClient {
  private settings: AnalyticsSettings | undefined;
  private queue: Queue = { events: [], errors: [] };
  private signedIn = false;
  /** Set by a 401; nothing is sent again until the next sign-in. */
  private refused = false;
  private retryAt = 0;
  private failures = 0;
  private flushing: Promise<void> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private featuresSeen = new Set<AnalyticsFeature>();
  private fetch: typeof fetch;
  private now: () => number;

  constructor(private dependencies: AnalyticsDependencies) {
    this.fetch = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  /** Reads the install's settings (making a new install id the first time) and whatever the last run left queued. */
  async load(): Promise<void> {
    this.settings = await this.readSettings();
    this.queue = await this.readQueue();
    if (this.dependencies.flushIntervalMs) {
      this.flushTimer = setInterval(() => void this.flush(), this.dependencies.flushIntervalMs);
      this.flushTimer.unref?.();
    }
  }

  /** What the window shows next to the switch. */
  state(): AnalyticsState {
    return { enabled: this.settings?.enabled ?? true };
  }

  /** Whether anything may be recorded right now. */
  active(): boolean {
    return this.dependencies.allowed && this.signedIn && (this.settings?.enabled ?? false);
  }

  /** Follows the account: a new sign-in lifts a 401 stop, signing out empties the queue. */
  async accountChanged(account: AccountState): Promise<void> {
    const wasSignedIn = this.signedIn;
    this.signedIn = account.status === 'signed_in';
    if (this.signedIn && !wasSignedIn) {
      this.refused = false;
      this.failures = 0;
      this.retryAt = 0;
    }
    if (account.status === 'local') await this.clear();
  }

  /** The switch in Settings → Account. Turning it off empties the queue at once. */
  async setEnabled(enabled: boolean): Promise<AnalyticsState> {
    const settings = this.settings ?? await this.readSettings();
    this.settings = { ...settings, enabled };
    await this.saveSettings();
    if (!enabled) await this.clear();
    if (enabled) this.record({ name: 'setting_changed', at: this.timestamp(), props: { setting: 'analytics', value: true } });
    return this.state();
  }

  /**
   * Records the start of this run, and an update when the version differs from the one that ran last. The version is
   * remembered whether or not anything is recorded, so an update is never counted twice.
   */
  async appStarted(props: { version: string; platform: string; arch: string; locale: string; installKind: string }): Promise<void> {
    const settings = this.settings ?? await this.readSettings();
    const previous = settings.lastVersion;
    this.record({ name: 'app_started', at: this.timestamp(), props });
    if (previous && previous !== props.version) this.record({ name: 'update_installed', at: this.timestamp(), props: { from: previous, to: props.version } });
    if (previous !== props.version) {
      this.settings = { ...settings, lastVersion: props.version };
      await this.saveSettings().catch(() => undefined);
    }
  }

  /** Queues one event after checking it against the whitelist; an unknown event or prop is dropped. */
  record(raw: unknown): void {
    if (!this.active()) return;
    const event = parseEvent(raw);
    if (!event) return;
    this.queue.events = appendBounded(this.queue.events, [event], MAX_QUEUED_EVENTS);
    this.persistSoon();
  }

  /** A feature counts once per app session, when it is first used. */
  recordFeature(feature: AnalyticsFeature): void {
    if (!this.active() || this.featuresSeen.has(feature)) return;
    this.featuresSeen.add(feature);
    this.record({ name: 'feature_used', at: this.timestamp(), props: { feature } });
  }

  /** Queues an error, scrubbed of paths, names, emails, query strings and anything shaped like a key. */
  recordError(kind: ErrorKind, message: string, stack?: string): void {
    if (!this.active()) return;
    const error = parseError(scrubbedError(kind, message, stack, this.dependencies.scrub, new Date(this.now())));
    if (!error) return;
    this.queue.errors = appendBounded(this.queue.errors, [error], MAX_QUEUED_ERRORS);
    this.persistSoon();
  }

  /** Sends what is queued. Concurrent calls share one flush. */
  flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  /** On quit: one last flush, bounded so quitting never waits long, then the queue is written down. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    const timeout = new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_FLUSH_MS).unref?.());
    await Promise.race([this.flush().catch(() => undefined), timeout]);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    await this.persist().catch(() => undefined);
  }

  /** What is waiting to be sent; for tests. */
  queued(): Readonly<Queue> {
    return this.queue;
  }

  private async flushOnce(): Promise<void> {
    if (!this.active() || this.refused || this.now() < this.retryAt) return;
    if (!this.queue.events.length && !this.queue.errors.length) return;
    // A version the service would not read fails every request, so nothing is sent from such a build.
    if (!WireAppVersion.safeParse(this.dependencies.appVersion).success) return;
    let token: string;
    try {
      token = await this.dependencies.getAccessToken();
    } catch {
      return;
    }
    const now = this.now();
    const events = sendable(this.queue.events, WireEvent, now);
    const errors = sendable(this.queue.errors, WireError, now);
    const batches = splitIntoBatches(this.batchHeader(), events, errors);
    // What the service would refuse (too old, malformed, too large for any request) would never go; it leaves now,
    // one item at a time, so it can never make the service refuse the rest.
    this.forget(this.itemsOutside(batches));
    for (const batch of batches) {
      const keepGoing = await this.send(batch, token);
      if (!keepGoing) break;
    }
    await this.persist().catch(() => undefined);
  }

  /** Sends one request and returns whether the next one may follow. */
  private async send(batch: AnalyticsBatch, token: string): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetch(this.endpoint(), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch {
      this.backOff();
      return false;
    }
    if (response.ok) {
      this.failures = 0;
      this.forget(batch);
      return true;
    }
    if (response.status === 400 || response.status === 413) {
      this.forget(batch);
      return true;
    }
    if (response.status === 401) {
      this.refused = true;
      return false;
    }
    if (response.status === 429) {
      this.retryAt = this.now() + retryAfterMs(response.headers.get('retry-after'));
      return false;
    }
    this.backOff();
    return false;
  }

  private backOff() {
    this.failures += 1;
    const delay = Math.min(FIRST_RETRY_MS * 2 ** (this.failures - 1), LONGEST_RETRY_MS);
    this.retryAt = this.now() + delay;
  }

  private forget(sent: { events: readonly AnalyticsEvent[]; errors: readonly AnalyticsError[] }) {
    const events = new Set(sent.events);
    const errors = new Set(sent.errors);
    this.queue = {
      events: this.queue.events.filter(event => !events.has(event)),
      errors: this.queue.errors.filter(error => !errors.has(error)),
    };
  }

  private itemsOutside(batches: AnalyticsBatch[]) {
    const events = new Set(batches.flatMap(batch => batch.events));
    const errors = new Set(batches.flatMap(batch => batch.errors));
    return {
      events: this.queue.events.filter(event => !events.has(event)),
      errors: this.queue.errors.filter(error => !errors.has(error)),
    };
  }

  private batchHeader() {
    return { app: ANALYTICS_APP, appVersion: this.dependencies.appVersion, platform: this.dependencies.platform, installId: this.settings?.installId ?? '' } as const;
  }

  private endpoint(): string {
    return `${this.dependencies.baseUrl.replace(/\/+$/, '')}${ANALYTICS_PATH}`;
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private async clear() {
    this.queue = { events: [], errors: [] };
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await unlink(join(this.dependencies.directory, QUEUE_FILE)).catch(() => undefined);
  }

  private persistSoon() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist().catch(() => undefined);
    }, PERSIST_DELAY_MS);
    this.persistTimer.unref?.();
  }

  private async persist() {
    const path = join(this.dependencies.directory, QUEUE_FILE);
    if (!this.queue.events.length && !this.queue.errors.length) {
      await unlink(path).catch(() => undefined);
      return;
    }
    await writeFile(path, JSON.stringify(this.queue), { mode: 0o600 });
  }

  private async readSettings(): Promise<AnalyticsSettings> {
    try {
      const text = await readFile(join(this.dependencies.directory, SETTINGS_FILE), 'utf8');
      return AnalyticsSettings.parse(JSON.parse(text));
    } catch {
      const fresh: AnalyticsSettings = { installId: randomUUID(), enabled: true };
      this.settings = fresh;
      await this.saveSettings().catch(() => undefined);
      return fresh;
    }
  }

  private async saveSettings() {
    if (!this.settings) return;
    await writeFile(join(this.dependencies.directory, SETTINGS_FILE), JSON.stringify(AnalyticsSettings.parse(this.settings)));
  }

  private async readQueue(): Promise<Queue> {
    try {
      const raw = AnalyticsQueue.parse(JSON.parse(await readFile(join(this.dependencies.directory, QUEUE_FILE), 'utf8')));
      const events = raw.events.map(parseEvent).filter((event): event is AnalyticsEvent => event !== undefined);
      const errors = raw.errors.map(parseError).filter((error): error is AnalyticsError => error !== undefined);
      return { events: events.slice(-MAX_QUEUED_EVENTS), errors: errors.slice(-MAX_QUEUED_ERRORS) };
    } catch {
      return { events: [], errors: [] };
    }
  }
}

/** `Retry-After` in seconds, or an HTTP date; anything unreadable waits a minute. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, LONGEST_RETRY_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), LONGEST_RETRY_MS);
  return DEFAULT_RETRY_AFTER_MS;
}
