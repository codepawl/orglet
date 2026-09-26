import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import {
  BrowserEngine, chromeWindows, LAUNCH_ARGS, PLAYWRIGHT_DISABLED_FEATURES, type BrowserWindowState, type BrowserWindows,
} from '../../apps/desktop/src/browser/engine';
import { detectBrowser } from '../../apps/desktop/src/browser/detect';
import { snapshotElement } from '../../apps/desktop/src/browser/snapshot-lines';
import { CLEAN_BROWSER_PROFILE } from '../../apps/desktop/src/shared/browser';

/**
 * Orglet's browser window stays out of the person's way (COD-261): a run's window is minimized after every new tab,
 * popup, page load and step, unless the person asked to see it. The window commands are replaced by a stand-in that
 * behaves like Chrome (measured on Windows 11 with Chrome 153: every new tab, a popup's included, brings a minimized
 * window back up), so these run on hidden windows. Skipped on a machine with neither Chrome nor Edge.
 */
const found = detectBrowser();
const REAL_BROWSER_TIMEOUT_MS = 120_000;

/** Every `--disable-features` value on the command line Chrome actually got, in order. */
async function disabledFeatureSwitches(args: string[]): Promise<string[][]> {
  const browser = await chromium.launch({ executablePath: found!.executable, headless: true, args });
  try {
    const page = await browser.newPage();
    await page.goto('chrome://version');
    const commandLine = await page.locator('#command_line').textContent() ?? '';
    return [...commandLine.matchAll(/--disable-features=(\S+)/g)].map(match => match[1].split(','));
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

  it.runIf(found !== null)('leave Chrome with every feature Playwright turns off still off', async () => {
    // Chrome keeps only the last --disable-features, and Playwright puts its own before Orglet's.
    const [playwrightDefault] = await disabledFeatureSwitches([]);
    expect(PLAYWRIGHT_DISABLED_FEATURES).toEqual(expect.arrayContaining(playwrightDefault));
    const withOrglet = await disabledFeatureSwitches(LAUNCH_ARGS);
    expect(withOrglet.at(-1)).toEqual(expect.arrayContaining([...playwrightDefault, 'msImplicitSignin']));
  }, REAL_BROWSER_TIMEOUT_MS);
});

/**
 * One window per browser context, as Chrome has it here: a Clean run's context and a named profile each have one. Like
 * Chrome, it comes back up (normal) whenever a tab opens in it.
 */
function windowsLikeChrome() {
  const states = new Map<BrowserContext, BrowserWindowState>();
  const minimizes: string[] = [];
  const windowOf = (page: Page) => {
    const context = page.context();
    if (!states.has(context)) {
      states.set(context, 'normal');
      context.on('page', () => states.set(context, 'normal'));
    }
    return context;
  };
  const control: BrowserWindows = {
    async state(page) {
      return states.get(windowOf(page));
    },
    async set(page, state) {
      const context = windowOf(page);
      if (state === 'minimized') minimizes.push(page.url());
      states.set(context, state);
    },
  };
  /** The state of the window a run's tabs are in, found through the tab the engine last touched in it. */
  const stateOf = (context: BrowserContext | undefined) => (context ? states.get(context) : undefined);
  return { control, minimizes, stateOf, contexts: () => [...states.keys()] };
}

describe.runIf(found !== null)('the run\'s browser window', { timeout: REAL_BROWSER_TIMEOUT_MS }, () => {
  let directory: string;
  let server: Server;
  let base: string;
  let engine: BrowserEngine;
  let windows: ReturnType<typeof windowsLikeChrome>;
  const signal = new AbortController().signal;
  const PAGE = '<!doctype html><title>Window test</title><button onclick="window.clicks=(window.clicks||0)+1">Count</button><a href="/other" target="_blank">Open elsewhere</a>';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-browser-window-'));
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(request.url === '/other' ? '<!doctype html><title>Other</title>' : PAGE);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    windows = windowsLikeChrome();
    engine = new BrowserEngine({ profilesRoot: join(directory, 'profiles'), browser: () => found, headless: true, idleMs: 50, windows: windows.control });
  }, REAL_BROWSER_TIMEOUT_MS);

  afterEach(async () => {
    await engine.shutdown();
    server.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, REAL_BROWSER_TIMEOUT_MS);

  const policy = () => ({ sites: [{ site: new URL(base).host, decision: 'allowed' as const, addedAt: new Date().toISOString() }], restricted: true });
  const open = (runId: string, profileId = CLEAN_BROWSER_PROFILE) =>
    engine.handle({ kind: 'open', runId, profileId, policy: policy(), tabId: null, url: `${base}/` }, signal) as Promise<{ tabId: string }>;
  const click = async (runId: string, tabId: string, name: RegExp) => {
    const { snapshot, url } = await engine.handle({ kind: 'snapshot', runId, policy: policy(), tabId }, signal) as { snapshot: string; url: string };
    const line = snapshot.split('\n').find(candidate => name.test(candidate))!;
    const ref = /\[ref=([a-z0-9]+)\]/.exec(line)![1];
    return engine.handle({ kind: 'act', runId, policy: policy(), tabId, step: { kind: 'click', ref }, url, expect: snapshotElement(snapshot, ref)! }, signal) as Promise<{ popupClosed: boolean }>;
  };
  /** The window the newest context the engine opened is in. */
  const newestWindow = () => windows.stateOf(windows.contexts().at(-1));

  it('keeps a Clean run\'s window minimized through new tabs, popups and steps', async () => {
    const runId = randomUUID();
    await open(runId);
    expect(newestWindow()).toBe('minimized');
    // A second tab brings the window back up in Chrome; the run puts it away again.
    await open(runId);
    expect(newestWindow()).toBe('minimized');
    const minimizedBeforePopup = windows.minimizes.length;
    const clicked = await click(runId, 't1', /link "Open elsewhere"/);
    expect(clicked.popupClosed).toBe(true);
    expect(newestWindow()).toBe('minimized');
    expect(windows.minimizes.length).toBeGreaterThan(minimizedBeforePopup);
  });

  it('leaves the window up once the person asks to see it, and keeps other runs out of sight', async () => {
    const shownRun = randomUUID();
    await open(shownRun);
    const shownWindow = windows.contexts().at(-1);
    expect(await engine.handle({ kind: 'show', runId: shownRun }, signal)).toEqual({ shown: true });
    expect(windows.stateOf(shownWindow)).toBe('normal');
    await open(shownRun);
    await click(shownRun, 't1', /button "Count"/);
    expect(windows.stateOf(shownWindow)).toBe('normal');
    // Another chat's run is still kept out of the way.
    await open(randomUUID());
    expect(newestWindow()).toBe('minimized');
    expect(windows.stateOf(shownWindow)).toBe('normal');
  });

  it('leaves the window where the person put it after they take the browser over and hand it back', async () => {
    const runId = randomUUID();
    await open(runId);
    await engine.handle({ kind: 'hold', runId, held: true }, signal);
    expect(newestWindow()).toBe('normal');
    await engine.handle({ kind: 'hold', runId, held: false }, signal);
    await open(runId);
    await click(runId, 't1', /button "Count"/);
    expect(newestWindow()).toBe('normal');
  });

  it('minimizes a named profile a run opens, though the profile starts with a blank page of its own', async () => {
    const profileId = randomUUID();
    const runId = randomUUID();
    await open(runId, profileId);
    const profileWindow = windows.contexts().at(-1);
    expect(profileWindow?.pages().length).toBe(2);
    expect(windows.stateOf(profileWindow)).toBe('minimized');
    await open(runId, profileId);
    expect(windows.stateOf(profileWindow)).toBe('minimized');
  });

  it('keeps a named profile up while the person has it open to sign in', async () => {
    const profileId = randomUUID();
    expect(await engine.handle({ kind: 'openProfile', profileId }, signal)).toEqual({ opened: true });
    const profileWindow = windows.contexts().at(-1);
    expect(windows.stateOf(profileWindow)).toBe('normal');
    await open(randomUUID(), profileId);
    expect(windows.stateOf(profileWindow)).toBe('normal');
    expect(windows.minimizes).toEqual([]);
  });
});

/**
 * The same on a real, visible window. It opens windows on the screen of the machine running it, so it runs only
 * when ORGLET_HEADED_BROWSER_TEST=1 is set, never in CI.
 */
describe.runIf(found !== null && process.env.ORGLET_HEADED_BROWSER_TEST === '1')('a visible browser window', { timeout: REAL_BROWSER_TIMEOUT_MS }, () => {
  it('is minimized after every new tab, popup and step until the person asks to see it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-browser-window-headed-'));
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(request.url === '/other' ? '<!doctype html><title>Other</title>' : '<!doctype html><title>Window test</title><button>Count</button><a href="/other" target="_blank">Open elsewhere</a>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let lastTab: Page | undefined;
    const recording: BrowserWindows = {
      state: page => { lastTab = page; return chromeWindows.state(page); },
      set: (page, state) => { lastTab = page; return chromeWindows.set(page, state); },
    };
    const engine = new BrowserEngine({ profilesRoot: join(directory, 'profiles'), browser: () => found, idleMs: 60_000, windows: recording });
    const signal = new AbortController().signal;
    const policy = { sites: [{ site: new URL(base).host, decision: 'allowed' as const, addedAt: new Date().toISOString() }], restricted: true };
    const runId = randomUUID();
    const windowNow = () => chromeWindows.state(lastTab!);
    try {
      await engine.handle({ kind: 'open', runId, profileId: CLEAN_BROWSER_PROFILE, policy, tabId: null, url: `${base}/` }, signal);
      expect(await windowNow()).toBe('minimized');
      await engine.handle({ kind: 'open', runId, profileId: CLEAN_BROWSER_PROFILE, policy, tabId: null, url: `${base}/` }, signal);
      expect(await windowNow()).toBe('minimized');
      const { snapshot, url } = await engine.handle({ kind: 'snapshot', runId, policy, tabId: 't1' }, signal) as { snapshot: string; url: string };
      const ref = /\[ref=([a-z0-9]+)\]/.exec(snapshot.split('\n').find(line => /link "Open elsewhere"/.test(line))!)![1];
      const clicked = await engine.handle({ kind: 'act', runId, policy, tabId: 't1', step: { kind: 'click', ref }, url, expect: snapshotElement(snapshot, ref)! }, signal) as { popupClosed: boolean };
      expect(clicked.popupClosed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(await windowNow()).toBe('minimized');
      await engine.handle({ kind: 'show', runId }, signal);
      expect(await windowNow()).toBe('normal');
    } finally {
      await engine.shutdown();
      server.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
