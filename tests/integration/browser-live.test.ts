import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserEngine, HTTP_SIGN_IN, IN_CHROME, NOT_HELD } from '../../apps/desktop/src/browser/engine';
import { detectBrowser } from '../../apps/desktop/src/browser/detect';
import { headedUserAgent, LAUNCH_ARGS, launchArgs } from '../../apps/desktop/src/browser/launch';
import { suggestionFor, SuggestionLog, SUGGESTION_QUIET_MS } from '../../apps/desktop/src/browser/detector';
import { snapshotElement } from '../../apps/desktop/src/browser/snapshot-lines';
import { BrowserCursorTrack, BrowserInputEvent, askingPointFor, cursorPointFor, pageToView, viewToPage, type BrowserWatchState } from '../../apps/desktop/src/shared/browser-live';
import { CLEAN_BROWSER_PROFILE } from '../../apps/desktop/src/shared/browser';
import type { BrowserHostEvent } from '../../apps/desktop/src/shared/browser-host';

/**
 * Watching and taking over Orglet's browser inside Orglet (COD-261): the headless launch with the headed user agent,
 * the live view's frames, the orglet's cursor, the person's input, the suggestion to open Chrome, and moving a run's
 * tabs into a Chrome window and back. The browser parts are skipped on a machine with neither Chrome nor Edge.
 */

describe('the launch arguments', () => {
  it('give a headless run the user agent the same browser sends with a window', () => {
    expect(headedUserAgent('chrome', '153.0.8010.37', 'win32')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
    expect(headedUserAgent('edge', '153.0.3405.12', 'win32')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0');
    expect(headedUserAgent('chrome', '140.0.1.2', 'darwin')).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    expect(headedUserAgent('chrome', '140.0.1.2', 'linux')).toContain('(X11; Linux x86_64)');
    expect(headedUserAgent('chrome', null, 'win32')).toBeUndefined();
    expect(headedUserAgent('chrome', 'unknown', 'win32')).toBeUndefined();
  });

  it('pass the user agent as a switch on a headless launch only, and never hide automation', () => {
    const userAgent = headedUserAgent('chrome', '153.0.8010.37', 'win32')!;
    const headless = launchArgs(true, userAgent);
    expect(headless).toEqual([...LAUNCH_ARGS, `--user-agent=${userAgent}`]);
    expect(launchArgs(false, userAgent)).toEqual(LAUNCH_ARGS);
    expect(launchArgs(true, undefined)).toEqual(LAUNCH_ARGS);
    expect(headless.join(' ')).not.toMatch(/AutomationControlled|disable-blink-features/);
    expect(headless.filter(argument => argument.startsWith('--disable-features='))).toHaveLength(1);
  });
});

describe('the cursor', () => {
  const viewport = { width: 1280, height: 800 };

  it('points at the centre of what it clicks or picks, and into a field it types in', () => {
    const box = { x: 100, y: 200, width: 120, height: 40 };
    expect(cursorPointFor('click', box, viewport)).toEqual({ x: 160, y: 220 });
    expect(cursorPointFor('select', box, viewport)).toEqual({ x: 160, y: 220 });
    expect(cursorPointFor('type', box, viewport)).toEqual({ x: 114, y: 220 });
    // A narrow field is typed into at its middle, not past its end.
    expect(cursorPointFor('type', { x: 10, y: 10, width: 16, height: 20 }, viewport)).toEqual({ x: 18, y: 20 });
  });

  it('stays inside the viewport for an element partly off screen', () => {
    expect(cursorPointFor('click', { x: 1250, y: 790, width: 100, height: 40 }, viewport)).toEqual({ x: 1279, y: 799 });
    expect(cursorPointFor('click', { x: -80, y: -30, width: 40, height: 20 }, viewport)).toEqual({ x: 0, y: 0 });
  });

  it('waits on the lower right corner of what a card asks about, so it does not cover it (dogfood, 2026-09-26)', () => {
    // A 13px checkbox: at its centre the cursor hid it, and its name covered the button under it.
    const checkbox = { x: 20, y: 172, width: 13, height: 13 };
    expect(askingPointFor(checkbox, viewport)).toEqual({ x: 33, y: 185 });
    expect(askingPointFor(checkbox, viewport)).not.toEqual(cursorPointFor('click', checkbox, viewport));
    expect(askingPointFor({ x: 1250, y: 790, width: 100, height: 40 }, viewport)).toEqual({ x: 1279, y: 799 });
  });

  it('is kept per run and tab, and forgotten with the tab and the run', () => {
    const track = new BrowserCursorTrack();
    track.move('run-a', { tabId: 't1', x: 10, y: 20, action: 'click' });
    track.move('run-a', { tabId: 't1', x: 30, y: 40, action: 'type' });
    track.move('run-a', { tabId: 't2', x: 5, y: 6, action: 'select' });
    track.move('run-b', { tabId: 't1', x: 1, y: 2, action: 'click' });
    expect(track.at('run-a', 't1')).toEqual({ tabId: 't1', x: 30, y: 40, action: 'type' });
    expect(track.at('run-b', 't1')).toEqual({ tabId: 't1', x: 1, y: 2, action: 'click' });
    track.forgetTab('run-a', 't2');
    expect(track.at('run-a', 't2')).toBeNull();
    track.forgetRun('run-a');
    expect(track.at('run-a', 't1')).toBeNull();
    expect(track.at('run-b', 't1')).not.toBeNull();
  });
});

describe('input from the live view', () => {
  it('turns a point in the view into the page\'s CSS pixels, whatever the picture\'s pixels', () => {
    const page = { width: 1280, height: 800 };
    // A view drawn at half the page's size.
    expect(viewToPage({ x: 320, y: 200 }, { width: 640, height: 400 }, page)).toEqual({ x: 640, y: 400 });
    // A window at 1.25x draws a 1024 by 640 CSS pixel view with a 1280 pixel wide frame; the frame's pixels do not count.
    expect(viewToPage({ x: 512, y: 320 }, { width: 1024, height: 640 }, page)).toEqual({ x: 640, y: 400 });
    // A page with a device pixel ratio of 2 reports its CSS size, so the result is the same.
    expect(viewToPage({ x: 100, y: 50 }, { width: 640, height: 400 }, { width: 1280, height: 800 })).toEqual({ x: 200, y: 100 });
    expect(viewToPage({ x: 900, y: -5 }, { width: 640, height: 400 }, page)).toEqual({ x: 1279, y: 0 });
    expect(pageToView({ x: 640, y: 400 }, { width: 640, height: 400 }, page)).toEqual({ x: 320, y: 200 });
    expect(viewToPage({ x: 1, y: 1 }, { width: 0, height: 0 }, page)).toEqual({ x: 0, y: 0 });
  });

  it('accepts only the events the view sends', () => {
    expect(BrowserInputEvent.safeParse({ type: 'mouse', action: 'down', x: 10, y: 10, button: 'left', clickCount: 1 }).success).toBe(true);
    expect(BrowserInputEvent.safeParse({ type: 'key', action: 'down', key: 'ArrowLeft' }).success).toBe(true);
    expect(BrowserInputEvent.safeParse({ type: 'key', action: 'down', key: 'ă' }).success).toBe(true);
    expect(BrowserInputEvent.safeParse({ type: 'key', action: 'down', key: 'Control+w' }).success).toBe(false);
    expect(BrowserInputEvent.safeParse({ type: 'text', text: 'x'.repeat(501) }).success).toBe(false);
    expect(BrowserInputEvent.safeParse({ type: 'mouse', action: 'down', x: 1e9, y: 0, button: 'left', clickCount: 1 }).success).toBe(false);
  });
});

describe('the detector', () => {
  it('suggests Chrome for what the live view cannot show or answer', () => {
    expect(suggestionFor({ kind: 'credentials', publicKey: true })).toBe('passkey');
    expect(suggestionFor({ kind: 'credentials', publicKey: false })).toBeNull();
    expect(suggestionFor({ kind: 'fileChooser' })).toBe('fileChooser');
    expect(suggestionFor({ kind: 'dialog' })).toBe('dialog');
    expect(suggestionFor({ kind: 'response', status: 401, authenticate: true, document: true, mainFrame: true })).toBe('httpAuth');
    expect(suggestionFor({ kind: 'response', status: 407, authenticate: true, document: true, mainFrame: true })).toBe('httpAuth');
  });

  it('leaves alone a 401 that is not the page asking the browser to sign in', () => {
    expect(suggestionFor({ kind: 'response', status: 401, authenticate: false, document: true, mainFrame: true })).toBeNull();
    expect(suggestionFor({ kind: 'response', status: 401, authenticate: true, document: false, mainFrame: true })).toBeNull();
    expect(suggestionFor({ kind: 'response', status: 401, authenticate: true, document: true, mainFrame: false })).toBeNull();
    expect(suggestionFor({ kind: 'response', status: 403, authenticate: true, document: true, mainFrame: true })).toBeNull();
  });

  it('suggests Chrome for a password or card field only while the person holds the browser', () => {
    const password = { inputType: 'password', autocomplete: null, fieldName: 'pw' };
    const card = { inputType: 'text', autocomplete: 'cc-number', fieldName: null };
    const cardByName = { inputType: 'text', autocomplete: null, fieldName: 'card_number' };
    const search = { inputType: 'search', autocomplete: null, fieldName: 'q' };
    expect(suggestionFor({ kind: 'focus', field: password, held: true })).toBe('sensitiveField');
    expect(suggestionFor({ kind: 'focus', field: card, held: true })).toBe('sensitiveField');
    expect(suggestionFor({ kind: 'focus', field: cardByName, held: true })).toBe('sensitiveField');
    expect(suggestionFor({ kind: 'focus', field: search, held: true })).toBeNull();
    expect(suggestionFor({ kind: 'focus', field: password, held: false })).toBeNull();
    expect(suggestionFor({ kind: 'focus', field: null, held: true })).toBeNull();
  });

  it('does not repeat a suggestion within the quiet time, and forgets on hand-back', () => {
    let clock = 1_000;
    const log = new SuggestionLog(() => clock);
    expect(log.offer('run', 'dialog')).toBe(true);
    expect(log.offer('run', 'dialog')).toBe(false);
    expect(log.offer('run', 'fileChooser')).toBe(true);
    expect(log.current('run')).toBe('fileChooser');
    clock += SUGGESTION_QUIET_MS + 1;
    expect(log.offer('run', 'dialog')).toBe(true);
    log.clear('run');
    expect(log.current('run')).toBeNull();
    expect(log.offer('run', 'dialog')).toBe(true);
  });
});

const found = detectBrowser();
const REAL_BROWSER_TIMEOUT_MS = 120_000;

const PAGE = `<!doctype html><title>Live test</title>
  <style>body { margin:0 } input, button { box-sizing:border-box } #go { position:absolute; left:100px; top:200px; width:120px; height:40px }
  #name { position:absolute; left:100px; top:300px; width:200px; height:30px } #secret { position:absolute; left:100px; top:360px; width:200px; height:30px }
  #file { position:absolute; left:100px; top:420px } #ask { position:absolute; left:400px; top:200px } #key { position:absolute; left:400px; top:260px }</style>
  <button id="go" onclick="document.title='Clicked'">Go</button>
  <label>Name <input id="name" name="name"></label>
  <label>Secret <input id="secret" type="password" name="secret"></label>
  <input id="file" type="file" aria-label="Upload">
  <button id="ask" onclick="alert('Are you sure?')">Ask</button>
  <button id="key" onclick="navigator.credentials.get({ publicKey: { challenge: new Uint8Array(16), timeout: 1000 } }).catch(() => {})">Passkey</button>
  <p id="agent">${'x'}</p>
  <script>document.getElementById('agent').textContent = navigator.userAgent + ' webdriver=' + navigator.webdriver</script>`;

describe.runIf(found !== null)('the live view of a real headless browser', { timeout: REAL_BROWSER_TIMEOUT_MS }, () => {
  let directory: string;
  let server: Server;
  let base: string;
  let engine: BrowserEngine;
  let events: BrowserHostEvent[];
  const signal = new AbortController().signal;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-browser-live-'));
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (url.pathname === '/private') {
        response.statusCode = 401;
        response.setHeader('WWW-Authenticate', 'Basic realm="test"');
        response.end('<!doctype html><title>Sign in needed</title>');
        return;
      }
      if (url.pathname === '/remember') {
        response.setHeader('Set-Cookie', 'visit=kept; Path=/');
        response.end('<!doctype html><title>Remembered</title>');
        return;
      }
      if (url.pathname === '/cookie') {
        response.end(`<!doctype html><title>Cookie ${request.headers.cookie ?? 'none'}</title>`);
        return;
      }
      response.end(PAGE);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    events = [];
    engine = new BrowserEngine({ profilesRoot: join(directory, 'profiles'), browser: () => found, headless: true, idleMs: 50, emit: event => events.push(event) });
  }, REAL_BROWSER_TIMEOUT_MS);

  afterEach(async () => {
    await engine.shutdown();
    server.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, REAL_BROWSER_TIMEOUT_MS);

  const policy = () => ({ sites: [{ site: new URL(base).host, decision: 'allowed' as const, addedAt: new Date().toISOString() }], restricted: true });
  const open = (runId: string, path = '/', profileId = CLEAN_BROWSER_PROFILE, tabId: string | null = null) =>
    engine.handle({ kind: 'open', runId, profileId, policy: policy(), tabId, url: `${base}${path}` }, signal) as Promise<{ tabId: string; title: string; url: string }>;
  const snapshot = (runId: string, tabId = 't1') => engine.handle({ kind: 'snapshot', runId, policy: policy(), tabId }, signal) as Promise<{ snapshot: string; url: string; title: string }>;
  const act = async (runId: string, name: RegExp, step: 'click' | 'type' = 'click') => {
    const { snapshot: text, url } = await snapshot(runId);
    const line = text.split('\n').find(candidate => name.test(candidate))!;
    const ref = /\[ref=([a-z0-9]+)\]/.exec(line)![1];
    const planned = step === 'click' ? { kind: 'click' as const, ref } : { kind: 'type' as const, ref, text: 'Ada', submit: false };
    return engine.handle({ kind: 'act', runId, policy: policy(), tabId: 't1', step: planned, url, expect: snapshotElement(text, ref)! }, signal);
  };
  const watch = (runId: string, watching = true) => engine.handle({ kind: 'watch', runId, watching, width: 640 }, signal) as Promise<BrowserWatchState>;
  const input = (runId: string, event: BrowserInputEvent) => engine.handle({ kind: 'input', runId, event }, signal);
  const hold = (runId: string, held: boolean, inChrome = false) => engine.handle({ kind: 'hold', runId, held, inChrome }, signal) as Promise<{ inChrome: boolean }>;
  const click = async (runId: string, x: number, y: number) => {
    await input(runId, { type: 'mouse', action: 'down', x, y, button: 'left', clickCount: 1 });
    await input(runId, { type: 'mouse', action: 'up', x, y, button: 'left', clickCount: 1 });
  };
  const until = async (check: () => boolean, timeoutMs = 10_000) => {
    const started = Date.now();
    while (!check() && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 50));
    expect(check()).toBe(true);
  };
  const framesOf = (runId: string) => events.filter(event => event.kind === 'frame' && event.runId === runId);
  const suggested = (runId: string) => events.flatMap(event => event.kind === 'suggest' && event.runId === runId ? [event.suggestion] : []);

  it('runs headless with the user agent of a browser with a window, and still says it is automated', async () => {
    const runId = randomUUID();
    await open(runId);
    const { snapshot: text } = await snapshot(runId);
    const agent = text.split('\n').find(line => line.includes('webdriver='))!;
    expect(agent).not.toContain('HeadlessChrome');
    expect(agent).toMatch(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36/);
    expect(agent).toContain('webdriver=true');
  });

  it('streams the tab while watched, moves the cursor to what the orglet clicks, and stops when the view closes', async () => {
    const runId = randomUUID();
    await open(runId);
    expect((await watch(runId)).tabId).toBe('t1');
    await until(() => framesOf(runId).length > 0);
    const first = framesOf(runId)[0] as Extract<BrowserHostEvent, { kind: 'frame' }>;
    expect(first).toMatchObject({ tabId: 't1', width: 1280, height: 800 });
    expect(Buffer.from(first.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    await act(runId, /button "Go"/);
    expect(events.find(event => event.kind === 'cursor')).toEqual({ kind: 'cursor', runId, cursor: { tabId: 't1', x: 160, y: 220, action: 'click' } });
    await act(runId, /textbox "Name"/, 'type');
    expect(events.filter(event => event.kind === 'cursor').at(-1)).toMatchObject({ cursor: { x: 114, y: 315, action: 'type' } });
    // A view opened later starts from where the cursor is.
    expect((await watch(runId)).cursor).toEqual({ tabId: 't1', x: 114, y: 315, action: 'type' });
    await watch(runId, false);
    const stopped = framesOf(runId).length;
    await act(runId, /button "Go"/);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(framesOf(runId).length).toBe(stopped);
  });

  it('keeps streaming when one watch ends as another starts, as when a view is resized', async () => {
    const runId = randomUUID();
    await open(runId);
    await watch(runId);
    await Promise.all([watch(runId, false), engine.handle({ kind: 'watch', runId, watching: true, width: 960 }, signal)]);
    const before = framesOf(runId).length;
    await act(runId, /button "Go"/);
    await until(() => framesOf(runId).length > before, 5_000);
  });

  it('puts the cursor at the corner of the element a card asks about when its picture is taken', async () => {
    const runId = randomUUID();
    await open(runId);
    await watch(runId);
    const { snapshot: text } = await snapshot(runId);
    const ref = /\[ref=([a-z0-9]+)\]/.exec(text.split('\n').find(line => /button "Go"/.test(line))!)![1];
    await engine.handle({ kind: 'screenshot', runId, policy: policy(), tabId: 't1', highlight: ref, pointer: 'click' }, signal);
    // The Go button's lower right corner, beside it rather than over it; the click itself goes to its centre.
    expect(events.filter(event => event.kind === 'cursor').at(-1)).toEqual({ kind: 'cursor', runId, cursor: { tabId: 't1', x: 220, y: 240, action: 'click' } });
    // The outline the card's picture draws is gone again, and the view ends on the page as it is.
    const before = framesOf(runId).length;
    await until(() => framesOf(runId).length > before, 5_000);
  });

  it('takes the person\'s clicks and typing only while they hold the browser', async () => {
    const runId = randomUUID();
    await open(runId);
    await expect(click(runId, 200, 315)).rejects.toThrow(NOT_HELD);
    await hold(runId, true);
    await click(runId, 200, 315);
    await input(runId, { type: 'text', text: 'Grace' });
    await input(runId, { type: 'key', action: 'down', key: 'Backspace' });
    await input(runId, { type: 'key', action: 'up', key: 'Backspace' });
    await input(runId, { type: 'text', text: 'ệ' });
    await click(runId, 160, 220);
    const { snapshot: text, title } = await snapshot(runId);
    expect(title).toBe('Clicked');
    expect(text).toMatch(/textbox "Name"[^\n]*: Gracệ/);
  });

  it('suggests Chrome for a password field the person is in, a dialog, a file picker, a passkey and a browser sign-in', async () => {
    const runId = randomUUID();
    await open(runId);
    await hold(runId, true);
    await click(runId, 200, 375);
    await until(() => suggested(runId).includes('sensitiveField'));
    await click(runId, 420, 215);
    await until(() => suggested(runId).includes('dialog'));
    await click(runId, 150, 430);
    await until(() => suggested(runId).includes('fileChooser'));
    await click(runId, 430, 275);
    await until(() => suggested(runId).includes('passkey'));
    await expect(open(runId, '/private', CLEAN_BROWSER_PROFILE, 't1')).rejects.toThrow(HTTP_SIGN_IN);
    await until(() => suggested(runId).includes('httpAuth'));
    // A plain field suggests nothing.
    const before = suggested(runId).length;
    await open(runId, '/', CLEAN_BROWSER_PROFILE, 't1');
    await click(runId, 200, 315);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(suggested(runId).length).toBe(before);
  });

  it('moves a Clean run\'s tabs into Chrome and back with its cookies, and a closed window hands the browser back', async () => {
    const runId = randomUUID();
    await open(runId, '/remember');
    await open(runId, '/');
    expect(await hold(runId, true, true)).toEqual({ inChrome: true });
    await expect(open(runId, '/cookie', CLEAN_BROWSER_PROFILE, 't1')).rejects.toThrow(IN_CHROME);
    const inChrome = await engine.handle({ kind: 'tabs', runId }, signal) as { tabs: { tabId: string; url: string }[] };
    expect(inChrome.tabs.map(tab => [tab.tabId, new URL(tab.url).pathname])).toEqual([['t1', '/remember'], ['t2', '/']]);
    expect(await hold(runId, false)).toEqual({ inChrome: false });
    expect((await open(runId, '/cookie', CLEAN_BROWSER_PROFILE, 't1')).title).toBe('Cookie visit=kept');
    // The person closes the Chrome window: the run goes on headless and the browser counts as handed back.
    await hold(runId, true, true);
    const closeAll = (engine as unknown as { runs: Map<string, { tabs: Map<string, { close(): Promise<void> }> }> }).runs.get(runId)!.tabs;
    for (const page of [...closeAll.values()]) await page.close();
    await until(() => events.some(event => event.kind === 'released' && event.runId === runId));
    expect((await watch(runId)).inChrome).toBe(false);
    expect((await open(runId, '/cookie', CLEAN_BROWSER_PROFILE, 't1')).title).toBe('Cookie visit=kept');
  });

  it('moves a named profile\'s tabs into Chrome and back, keeping what the profile stored', async () => {
    const runId = randomUUID();
    const profileId = randomUUID();
    await open(runId, '/remember', profileId);
    expect(await hold(runId, true, true)).toEqual({ inChrome: true });
    const inChrome = await engine.handle({ kind: 'tabs', runId }, signal) as { tabs: { url: string }[] };
    expect(inChrome.tabs.map(tab => new URL(tab.url).pathname)).toEqual(['/remember']);
    await hold(runId, false);
    expect((await open(runId, '/cookie', profileId, 't1')).title).toBe('Cookie visit=kept');
  });
});
