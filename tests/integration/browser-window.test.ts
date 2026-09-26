import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext } from 'playwright-core';
import { BrowserEngine, LAUNCH_ARGS, PLAYWRIGHT_DISABLED_FEATURES, PROFILE_RUNNING } from '../../apps/desktop/src/browser/engine';
import { detectBrowser } from '../../apps/desktop/src/browser/detect';
import { headedUserAgent, launchArgs } from '../../apps/desktop/src/browser/launch';
import { CLEAN_BROWSER_PROFILE } from '../../apps/desktop/src/shared/browser';

/**
 * Orglet's browser never takes a window from the person (COD-261): runs are headless, and a window opens only when the
 * person asks for one, to sign in to a profile or with Open in Chrome. Skipped on a machine with neither Chrome nor
 * Edge; the engine's tests run with every window hidden.
 */
const found = detectBrowser();
const REAL_BROWSER_TIMEOUT_MS = 120_000;

/** Every `--disable-features` value and whether `--headless` is on the command line Chrome actually got. */
async function commandLine(args: string[]): Promise<{ features: string[][]; headless: boolean; userAgent: string | undefined }> {
  const browser = await chromium.launch({ executablePath: found!.executable, headless: true, args });
  try {
    const page = await browser.newPage();
    await page.goto('chrome://version');
    const line = await page.locator('#command_line').textContent() ?? '';
    return {
      features: [...line.matchAll(/--disable-features=(\S+)/g)].map(match => match[1].split(',')),
      headless: /--headless\b/.test(line),
      userAgent: await page.evaluate(() => navigator.userAgent),
    };
  } finally {
    await browser.close();
  }
}

describe('the browser launch arguments', () => {
  it('carry Playwright\'s disabled features in the one --disable-features Orglet passes', () => {
    const switches = LAUNCH_ARGS.filter(argument => argument.startsWith('--disable-features='));
    expect(switches).toHaveLength(1);
    const features = switches[0].slice('--disable-features='.length).split(',');
    expect(features).toEqual(expect.arrayContaining([...PLAYWRIGHT_DISABLED_FEATURES, 'msImplicitSignin']));
  });

  it.runIf(found !== null)('leave Chrome headless, with every feature Playwright turns off still off and the headed user agent', async () => {
    // Chrome keeps only the last --disable-features, and Playwright puts its own before Orglet's.
    const [playwrightDefault] = (await commandLine([])).features;
    expect(PLAYWRIGHT_DISABLED_FEATURES).toEqual(expect.arrayContaining(playwrightDefault));
    const userAgent = headedUserAgent(found!.kind, found!.version) ?? headedUserAgent(found!.kind, '150.0.0.0')!;
    const withOrglet = await commandLine(launchArgs(true, userAgent));
    expect(withOrglet.features.at(-1)).toEqual(expect.arrayContaining([...playwrightDefault, 'msImplicitSignin']));
    expect(withOrglet.headless).toBe(true);
    expect(withOrglet.userAgent).toBe(userAgent);
  }, REAL_BROWSER_TIMEOUT_MS);

  it.runIf(found !== null && process.platform !== 'linux')('know the installed version from the install, as the headed user agent needs it', async () => {
    const browser = await chromium.launch({ executablePath: found!.executable, headless: true });
    try {
      // The user agent carries only the major version.
      expect(found!.version?.split('.')[0]).toBe(browser.version().split('.')[0]);
    } finally {
      await browser.close();
    }
  }, REAL_BROWSER_TIMEOUT_MS);
});

describe.runIf(found !== null)('windows for the person', { timeout: REAL_BROWSER_TIMEOUT_MS }, () => {
  let directory: string;
  let server: Server;
  let base: string;
  let engine: BrowserEngine;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-browser-window-'));
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Window test</title><button>Count</button>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    engine = new BrowserEngine({ profilesRoot: join(directory, 'profiles'), browser: () => found, headless: true, idleMs: 50 });
  }, REAL_BROWSER_TIMEOUT_MS);

  afterEach(async () => {
    // This test's own engine, server and folder, taken before the first wait, so a slow teardown never closes the next
    // test's.
    const ending = { engine, server, directory };
    await ending.engine.shutdown();
    ending.server.close();
    await rm(ending.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, REAL_BROWSER_TIMEOUT_MS);

  const policy = () => ({ sites: [{ site: new URL(base).host, decision: 'allowed' as const, addedAt: new Date().toISOString() }], restricted: true });
  const open = (runId: string, profileId = CLEAN_BROWSER_PROFILE) =>
    engine.handle({ kind: 'open', runId, profileId, policy: policy(), tabId: null, url: `${base}/` }, signal) as Promise<{ tabId: string }>;

  it('keeps a named profile a run is using headless until the run ends, then opens it to sign in', async () => {
    const profileId = randomUUID();
    const runId = randomUUID();
    await open(runId, profileId);
    await expect(engine.handle({ kind: 'openProfile', profileId }, signal)).rejects.toThrow(PROFILE_RUNNING);
    await engine.handle({ kind: 'endRun', runId }, signal);
    expect(await engine.handle({ kind: 'openProfile', profileId }, signal)).toEqual({ opened: true });
    expect(await engine.handle({ kind: 'openProfiles' }, signal)).toEqual([profileId]);
  });

  it('lets a run share a profile the person has open to sign in, and carries it on headless when they close it', async () => {
    const profileId = randomUUID();
    await engine.handle({ kind: 'openProfile', profileId }, signal);
    const runId = randomUUID();
    await open(runId, profileId);
    expect(await engine.handle({ kind: 'closeProfile', profileId }, signal).catch(error => String(error))).toMatch(/đang dùng hồ sơ này/);
    // The person closes the sign-in window themselves.
    const sessions = (engine as unknown as { runs: Map<string, { context: { close(): Promise<void> } }> }).runs;
    await sessions.get(runId)!.context.close();
    const started = Date.now();
    let tabs: { url: string }[] = [];
    while (Date.now() - started < 20_000) {
      tabs = (await engine.handle({ kind: 'tabs', runId }, signal) as { tabs: { url: string }[] }).tabs;
      if (tabs.length === 1 && tabs[0].url.startsWith(base)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(tabs.map(tab => tab.url)).toEqual([`${base}/`]);
    const read = await engine.handle({ kind: 'snapshot', runId, policy: policy(), tabId: 't1' }, signal) as { title: string };
    expect(read.title).toBe('Window test');
  });

  type SessionView = { context: BrowserContext; addresses: Map<string, string> };
  const sessionOf = (runId: string) => (engine as unknown as { runs: Map<string, SessionView> }).runs.get(runId)!;
  const until = async (check: () => boolean, timeoutMs = 20_000) => {
    const started = Date.now();
    while (!check() && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 50));
    expect(check()).toBe(true);
  };
  const tabsOf = async (runId: string) => (await engine.handle({ kind: 'tabs', runId }, signal) as { tabs: { url: string }[] }).tabs.map(tab => tab.url);
  /** The run's tab addresses once they are `expected`, or what they are after 20 seconds. */
  const settledTabs = async (runId: string, expected: string[]) => {
    const started = Date.now();
    let tabs = await tabsOf(runId);
    while (tabs.join() !== expected.join() && Date.now() - started < 20_000) {
      await new Promise(resolve => setTimeout(resolve, 100));
      tabs = await tabsOf(runId);
    }
    return tabs;
  };

  it('carries a run on headless when the sign-in window it shares closes and Chrome keeps running, as it does on a Mac', async () => {
    const profileId = randomUUID();
    await engine.handle({ kind: 'openProfile', profileId }, signal);
    const runId = randomUUID();
    await open(runId, profileId);
    // Closing the window closes every page in it; Chrome on macOS goes on running with no window, so the browser never
    // says the profile closed.
    const windowed = sessionOf(runId).context;
    await Promise.all(windowed.pages().map(page => page.close()));
    expect(await settledTabs(runId, [`${base}/`])).toEqual([`${base}/`]);
    expect(sessionOf(runId).context).not.toBe(windowed);
    const read = await engine.handle({ kind: 'snapshot', runId, policy: policy(), tabId: 't1' }, signal) as { title: string };
    expect(read.title).toBe('Window test');
    // The profile is headless for the run now, not a window for the person.
    await expect(engine.handle({ kind: 'openProfile', profileId }, signal)).rejects.toThrow(PROFILE_RUNNING);
  });

  it('forgets only the tab the person closes in a sign-in window a run shares, and leaves the window open', async () => {
    const profileId = randomUUID();
    await engine.handle({ kind: 'openProfile', profileId }, signal);
    const runId = randomUUID();
    await open(runId, profileId);
    const windowed = sessionOf(runId).context;
    const runTab = windowed.pages().find(page => page.url().startsWith(base))!;
    await runTab.close();
    await until(() => !sessionOf(runId).addresses.has('t1'));
    expect(sessionOf(runId).context).toBe(windowed);
    expect(await tabsOf(runId)).toEqual([]);
    expect(windowed.pages()).toHaveLength(1);
  });
});
