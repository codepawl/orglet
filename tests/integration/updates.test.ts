import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABOUT_LINKS, AboutLink, aboutDetailsText, becameReady, CHANGELOG_URL, installKind, parseReleases, updateErrorReason, updateFeedUrl, updateIndicator, updateSupport, type UpdateEnvironment, type UpdateState } from '../../apps/desktop/src/shared/updates';
import { CHECK_INTERVAL_MS, describeState, STARTUP_CHECK_DELAY_MS, Updater, UPDATER_LOG_LIMIT_BYTES, updaterLogWriter, type UpdaterEngine } from '../../apps/desktop/src/main/updater';
import { CHANGELOG_MAX_AGE_MS, ChangelogFeed } from '../../apps/desktop/src/main/changelog';
import { version } from '../../package.json';

/** Stands in for Electron's autoUpdater: records calls and lets a test raise its events. */
class FakeEngine extends EventEmitter implements UpdaterEngine {
  feedUrl: string | undefined;
  checks = 0;
  installs = 0;
  setFeedURL(options: { url: string }) { this.feedUrl = options.url; }
  checkForUpdates() { this.checks += 1; }
  quitAndInstall() { this.installs += 1; }
}

const squirrel: UpdateEnvironment = { packaged: true, platform: 'win32', squirrelUpdater: true, macosSigned: false };

function updater(overrides: Partial<{ environment: UpdateEnvironment; firstRun: boolean; automatic: boolean }> = {}) {
  const engine = new FakeEngine();
  const states: UpdateState[] = [];
  const logged: string[] = [];
  const instance = new Updater({
    engine, environment: overrides.environment ?? squirrel, feedUrl: updateFeedUrl('win32', 'x64', version),
    firstRun: overrides.firstRun ?? false, automatic: overrides.automatic ?? true,
    onChange: state => states.push(state), clock: () => new Date('2026-09-23T10:00:00.000Z'),
    log: line => logged.push(line),
  });
  return { engine, states, instance, logged };
}

describe('update feed and support', () => {
  it('points at update.electronjs.org for this repository, platform, architecture and version', () => {
    expect(updateFeedUrl('win32', 'x64', '0.2.3')).toBe('https://update.electronjs.org/codepawl/orglet/win32-x64/0.2.3');
    expect(updateFeedUrl('darwin', 'arm64', '0.3.0')).toBe('https://update.electronjs.org/codepawl/orglet/darwin-arm64/0.3.0');
  });

  it('supports only a Squirrel install on Windows and a signed macOS app, naming the reason otherwise', () => {
    expect(updateSupport(squirrel)).toEqual({ supported: true });
    expect(updateSupport({ ...squirrel, packaged: false })).toEqual({ supported: false, reason: 'dev' });
    expect(updateSupport({ ...squirrel, squirrelUpdater: false })).toEqual({ supported: false, reason: 'portable' });
    expect(updateSupport({ packaged: true, platform: 'linux', squirrelUpdater: false, macosSigned: false })).toEqual({ supported: false, reason: 'linux' });
    expect(updateSupport({ packaged: true, platform: 'darwin', squirrelUpdater: false, macosSigned: false })).toEqual({ supported: false, reason: 'macos-unsigned' });
    expect(updateSupport({ packaged: true, platform: 'darwin', squirrelUpdater: false, macosSigned: true })).toEqual({ supported: true });
  });

  it('names how the build got here', () => {
    expect(installKind({ ...squirrel, packaged: false })).toBe('dev');
    expect(installKind(squirrel)).toBe('squirrel');
    expect(installKind({ ...squirrel, squirrelUpdater: false })).toBe('portable');
    expect(installKind({ packaged: true, platform: 'darwin', squirrelUpdater: false, macosSigned: false })).toBe('macos-app');
    expect(installKind({ packaged: true, platform: 'linux', squirrelUpdater: false, macosSigned: false })).toBe('linux');
  });

  it('copies the details as one fact per line', () => {
    const text = aboutDetailsText({ version: '0.2.3', electron: '44.3.0', chromium: '140.0.0.0', node: '24.19.0', platform: 'win32', osRelease: '10.0.26200', arch: 'x64', install: 'squirrel' }, '3.50.0', 'Installed with Setup (Squirrel)');
    expect(text.split('\n')).toEqual(['Orglet 0.2.3', 'Electron 44.3.0', 'Chromium 140.0.0.0', 'Node 24.19.0', 'SQLite 3.50.0', 'Windows 10.0.26200 x64', 'Installed with Setup (Squirrel)']);
  });
});

describe('the About tab links', () => {
  it('are exactly the allowlisted addresses, and nothing else parses as a link', () => {
    expect(ABOUT_LINKS).toEqual({
      website: 'https://orglet.codepawl.com',
      github: 'https://github.com/codepawl/orglet',
      discord: 'https://discord.gg/XTShcr4j75',
      x: 'https://x.com/codepawl',
      threads: 'https://www.threads.com/@codepawl',
      releases: 'https://github.com/codepawl/orglet/releases',
      exaKeys: 'https://dashboard.exa.ai/api-keys',
    });
    expect(AboutLink.options).toEqual(Object.keys(ABOUT_LINKS));
    expect(AboutLink.safeParse('https://example.com').success).toBe(false);
    expect(AboutLink.safeParse('pricing').success).toBe(false);
  });
});

describe('the updater state machine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stays unsupported and never touches the engine where updates cannot work', () => {
    const { engine, instance, states } = updater({ environment: { ...squirrel, squirrelUpdater: false } });
    instance.start();
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2);
    expect(instance.check()).toEqual({ status: 'unsupported', reason: 'portable' });
    expect(engine.feedUrl).toBeUndefined();
    expect(engine.checks).toBe(0);
    expect(states).toEqual([]);
    expect(() => instance.install()).toThrow('Chưa có bản cập nhật');
  });

  it('stays unsupported when automatic updates are switched on in a build that cannot update', () => {
    const { engine, instance, states } = updater({ environment: { ...squirrel, squirrelUpdater: false }, automatic: false });
    instance.start();
    instance.setAutomatic(true);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2);
    expect(engine.checks).toBe(0);
    expect(states).toEqual([]);
    expect(instance.state).toEqual({ status: 'unsupported', reason: 'portable' });
  });

  it('checks shortly after start and then on the interval while automatic updates are on', () => {
    const { engine, instance } = updater();
    instance.start();
    expect(engine.feedUrl).toBe(`https://update.electronjs.org/codepawl/orglet/win32-x64/${version}`);
    expect(engine.checks).toBe(0);
    vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS);
    expect(engine.checks).toBe(1);
    engine.emit('update-not-available');
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    expect(engine.checks).toBe(2);
    instance.stop();
  });

  it('skips the startup check on the installer first run but keeps the interval', () => {
    const { engine, instance } = updater({ firstRun: true });
    instance.start();
    vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS * 2);
    expect(engine.checks).toBe(0);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    expect(engine.checks).toBe(1);
    instance.stop();
  });

  it('schedules nothing with automatic updates off, and starts when they are turned on', () => {
    const { engine, instance } = updater({ automatic: false });
    instance.start();
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 3);
    expect(engine.checks).toBe(0);
    instance.setAutomatic(true);
    vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS);
    expect(engine.checks).toBe(1);
    engine.emit('update-not-available');
    instance.setAutomatic(false);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 3);
    expect(engine.checks).toBe(1);
  });

  it('follows the engine from checking to downloading to ready, and restarts only then', () => {
    const { engine, instance, states } = updater({ automatic: false });
    expect(instance.check()).toEqual({ status: 'checking' });
    expect(engine.checks).toBe(1);
    expect(instance.check()).toEqual({ status: 'checking' });
    expect(engine.checks).toBe(1);
    engine.emit('update-available');
    expect(instance.state).toEqual({ status: 'downloading' });
    expect(() => instance.install()).toThrow('Chưa có bản cập nhật');
    engine.emit('update-downloaded', {}, 'notes', '0.2.4', new Date(), 'https://example.invalid');
    expect(instance.state).toEqual({ status: 'ready', version: '0.2.4' });
    expect(instance.check()).toEqual({ status: 'ready', version: '0.2.4' });
    expect(engine.checks).toBe(1);
    instance.install();
    expect(engine.installs).toBe(1);
    expect(states.map(state => state.status)).toEqual(['checking', 'downloading', 'ready']);
  });

  it('keeps the engine\'s reason when a check fails, and reports up to date with the time', () => {
    const { engine, instance } = updater({ automatic: false });
    instance.check();
    engine.emit('error', new Error('Update check failed: 503'));
    expect(instance.state).toEqual({ status: 'error', message: 'Update check failed: 503', checkedAt: '2026-09-23T10:00:00.000Z' });
    instance.check();
    engine.emit('update-not-available');
    expect(instance.state).toEqual({ status: 'up-to-date', checkedAt: '2026-09-23T10:00:00.000Z' });
  });

  it('does not check again on the schedule while an update waits for a restart', () => {
    const { engine, instance } = updater();
    instance.start();
    vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS);
    engine.emit('update-available');
    engine.emit('update-downloaded', {}, '', '0.2.4', new Date(), '');
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2);
    expect(engine.checks).toBe(1);
    instance.stop();
  });
});

const gitHubRelease = (tag: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, name: `Orglet ${tag.slice(1)}`, body: `## ${tag}\n\n- Something changed`, published_at: publishedAt,
  html_url: `https://github.com/codepawl/orglet/releases/tag/${tag}`, draft: false, prerelease: false, assets: [{ name: 'RELEASES' }], author: { login: 'someone' }, ...extra,
});

describe('changelog parsing', () => {
  it('keeps the fields the tab shows, drops drafts, orders newest first and caps at ten', () => {
    const listed = Array.from({ length: 12 }, (_, index) => gitHubRelease(`v0.1.${index}`, `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`));
    listed.push(gitHubRelease('v9.9.9', '2026-12-01T00:00:00Z', { draft: true }));
    const releases = parseReleases(listed);
    expect(releases).toHaveLength(10);
    expect(releases[0]).toEqual({ version: '0.1.11', name: 'Orglet 0.1.11', notes: '## v0.1.11\n\n- Something changed', publishedAt: '2026-01-12T00:00:00Z', url: 'https://github.com/codepawl/orglet/releases/tag/v0.1.11' });
    expect(releases.map(release => release.version)).not.toContain('9.9.9');
    expect(releases.at(-1)?.version).toBe('0.1.2');
  });

  it('accepts a release without a name or notes, and rejects a body that is not a release list', () => {
    const [release] = parseReleases([gitHubRelease('v0.2.0', '2026-02-01T00:00:00Z', { name: null, body: null })]);
    expect(release).toMatchObject({ version: '0.2.0', name: 'v0.2.0', notes: '' });
    expect(() => parseReleases({ message: 'API rate limit exceeded' })).toThrow();
    expect(() => parseReleases([{ tag_name: 'v1', html_url: 'not a url' }])).toThrow();
  });
});

describe('changelog cache', () => {
  let directory: string;
  let now: Date;
  let responses: unknown[];
  let requests: string[];
  const feed = () => new ChangelogFeed({
    cacheFile: join(directory, 'changelog-cache.json'),
    clock: () => now,
    fetchJson: async url => {
      requests.push(url);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-changelog-'));
    now = new Date('2026-09-23T10:00:00.000Z');
    responses = [];
    requests = [];
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('fetches once, serves the cache while it is fresh, and refreshes on request', async () => {
    responses.push([gitHubRelease('v0.2.3', '2026-09-20T00:00:00Z')], [gitHubRelease('v0.2.4', '2026-09-23T00:00:00Z')]);
    const first = feed();
    expect(await first.read()).toEqual({ fetchedAt: now.toISOString(), stale: false, releases: [expect.objectContaining({ version: '0.2.3' })] });
    expect(requests).toEqual([CHANGELOG_URL]);
    expect(JSON.parse(await readFile(join(directory, 'changelog-cache.json'), 'utf8')).releases[0].version).toBe('0.2.3');
    // A second feed, as after a restart, reads the file instead of the network.
    expect((await feed().read()).releases[0].version).toBe('0.2.3');
    expect(requests).toHaveLength(1);
    expect((await feed().read(true)).releases[0].version).toBe('0.2.4');
    expect(requests).toHaveLength(2);
  });

  it('fetches again once the cache is old', async () => {
    responses.push([gitHubRelease('v0.2.3', '2026-09-20T00:00:00Z')], [gitHubRelease('v0.2.4', '2026-09-23T00:00:00Z')]);
    const changelog = feed();
    await changelog.read();
    now = new Date(now.getTime() + CHANGELOG_MAX_AGE_MS + 1);
    expect((await changelog.read()).releases[0].version).toBe('0.2.4');
  });

  it('shows the last list, marked as old, when offline, and says so plainly with no list at all', async () => {
    responses.push(new Error('fetch failed'));
    expect(await feed().read()).toEqual({ fetchedAt: null, releases: [], stale: true, error: 'fetch failed' });
    responses.push([gitHubRelease('v0.2.3', '2026-09-20T00:00:00Z')], new Error('fetch failed'));
    const changelog = feed();
    const fresh = await changelog.read();
    const offline = await changelog.read(true);
    expect(offline).toEqual({ ...fresh, stale: true, error: 'fetch failed' });
  });

  it('ignores a cache file this build cannot read', async () => {
    await writeFile(join(directory, 'changelog-cache.json'), '{"releases": "nope"}');
    responses.push([gitHubRelease('v0.2.3', '2026-09-20T00:00:00Z')]);
    expect((await feed().read()).releases[0].version).toBe('0.2.3');
  });
});

describe('what the main screen shows about an update (COD-304)', () => {
  it('shows a mark only while a new version downloads or waits for a restart', () => {
    expect(updateIndicator(undefined)).toBeNull();
    expect(updateIndicator({ status: 'idle' })).toBeNull();
    expect(updateIndicator({ status: 'checking' })).toBeNull();
    expect(updateIndicator({ status: 'up-to-date', checkedAt: '2026-09-27T10:00:00.000Z' })).toBeNull();
    expect(updateIndicator({ status: 'error', message: 'offline', checkedAt: '2026-09-27T10:00:00.000Z' })).toBeNull();
    expect(updateIndicator({ status: 'unsupported', reason: 'portable' })).toBeNull();
    expect(updateIndicator({ status: 'downloading' })).toEqual({ kind: 'downloading' });
    expect(updateIndicator({ status: 'ready', version: '0.6.2' })).toEqual({ kind: 'ready', version: '0.6.2' });
    expect(updateIndicator({ status: 'ready', version: null })).toEqual({ kind: 'ready', version: null });
  });

  it('announces a ready update once: on the step into ready, never on a repeat', () => {
    expect(becameReady({ status: 'downloading' }, { status: 'ready', version: '0.6.2' })).toBe(true);
    expect(becameReady(undefined, { status: 'ready', version: '0.6.2' })).toBe(true);
    expect(becameReady({ status: 'ready', version: '0.6.2' }, { status: 'ready', version: '0.6.2' })).toBe(false);
    expect(becameReady({ status: 'checking' }, { status: 'downloading' })).toBe(false);
  });
});

describe('the updater log (COD-304)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('says when it will check, why each check ran and what came of it', () => {
    const { engine, instance, logged } = updater();
    instance.start();
    vi.advanceTimersByTime(STARTUP_CHECK_DELAY_MS);
    engine.emit('checking-for-update');
    engine.emit('update-available');
    engine.emit('update-downloaded', {}, '', '0.6.2', new Date(), '');
    instance.install();
    expect(logged).toEqual([
      `feed https://update.electronjs.org/codepawl/orglet/win32-x64/${version}`,
      'automatic updates on: first check in 30 s, then every 4 h',
      'check (startup)',
      'checking',
      'update found, downloading',
      'downloaded 0.6.2, waiting for a restart',
      'restarting into 0.6.2',
    ]);
    instance.stop();
  });

  it('pushes one checking state when the engine repeats the one the updater already announced', () => {
    const { engine, instance, states } = updater({ automatic: false });
    instance.check();
    engine.emit('checking-for-update');
    engine.emit('update-not-available');
    expect(states.map(state => state.status)).toEqual(['checking', 'up-to-date']);
  });

  it('names the reason it never checks, the first run after Setup, and a switched-off schedule', () => {
    expect(updater({ environment: { ...squirrel, squirrelUpdater: false } }).logged).toEqual(['not checking: portable build']);
    const firstRun = updater({ firstRun: true });
    firstRun.instance.start();
    expect(firstRun.logged.at(-1)).toBe('automatic updates on: no startup check on the first run after Setup, then every 4 h');
    firstRun.instance.stop();
    const manual = updater({ automatic: false });
    manual.instance.start();
    expect(manual.logged.at(-1)).toBe('automatic updates are off: checking only when asked');
  });

  it('keeps a failure on one line, in the engine\'s words', () => {
    const failure: UpdateState = { status: 'error', message: 'Command failed: 4294967295\n  at Update.exe', checkedAt: '2026-09-27T10:00:00.000Z' };
    expect(describeState(failure)).toBe('failed: Command failed: 4294967295 at Update.exe');
  });
});

describe('the updater log file (COD-304)', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-updater-log-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('writes timestamped lines in order', async () => {
    const file = join(directory, 'updater.log');
    const write = updaterLogWriter(file, () => new Date('2026-09-27T10:00:00.000Z'));
    write('check (manual)');
    write('up to date');
    await write.written();
    expect(await readFile(file, 'utf8')).toBe('2026-09-27T10:00:00.000Z check (manual)\n2026-09-27T10:00:00.000Z up to date\n');
  });

  it('drops the older half once the file passes its limit, cutting at a line', async () => {
    const file = join(directory, 'updater.log');
    const oldLine = `${'x'.repeat(99)}\n`;
    await writeFile(file, oldLine.repeat(Math.ceil(UPDATER_LOG_LIMIT_BYTES / oldLine.length)));
    const write = updaterLogWriter(file, () => new Date('2026-09-27T10:00:00.000Z'));
    write('check (interval)');
    await write.written();
    const text = await readFile(file, 'utf8');
    expect(Buffer.byteLength(text)).toBeLessThan(UPDATER_LOG_LIMIT_BYTES);
    expect(text.endsWith('2026-09-27T10:00:00.000Z check (interval)\n')).toBe(true);
    expect(text.split('\n').slice(0, -2).every(line => line === 'x'.repeat(99))).toBe(true);
  });
});

describe('a failed check in words a person can read (COD-304)', () => {
  // What Electron's updater reported on this machine when the feed answered 404 (measured with the update test build).
  const squirrelFailure = 'Command failed: 4294967295\nSystem.AggregateException: One or more errors occurred. ---> System.Net.WebException: The remote server returned an error: (404) Not Found.\n   at System.Net.HttpWebRequest.EndGetResponse(IAsyncResult asyncResult)\n   at Squirrel.Update.Program.main(String[] args)\n   --- End of inner exception stack trace ---';

  it('keeps the message of the exception that says what went wrong, not the stack trace', () => {
    expect(updateErrorReason(squirrelFailure)).toBe('The remote server returned an error: (404) Not Found.');
    expect(updateErrorReason('System.Net.WebException: The remote name could not be resolved: \'update.electronjs.org\'\n   at System.Net.WebClient.DownloadString')).toBe('The remote name could not be resolved: \'update.electronjs.org\'');
  });

  it('keeps the first line of anything else, cut to a readable length', () => {
    expect(updateErrorReason('Update URL is not set')).toBe('Update URL is not set');
    expect(updateErrorReason('Command failed: 4294967295\n')).toBe('Command failed: 4294967295');
    expect(updateErrorReason('x'.repeat(500))).toHaveLength(300);
  });

  it('shows the reason in the state and keeps the whole text in the log', () => {
    const { engine, instance, logged } = updater({ automatic: false });
    instance.check();
    engine.emit('error', new Error(squirrelFailure));
    expect(instance.state).toMatchObject({ status: 'error', message: 'The remote server returned an error: (404) Not Found.' });
    expect(logged.at(-2)).toMatch(/^engine error: Command failed: 4294967295 System\.AggregateException: .* at Squirrel\.Update\.Program\.main/);
    expect(logged.at(-1)).toBe('failed: The remote server returned an error: (404) Not Found.');
  });
});
