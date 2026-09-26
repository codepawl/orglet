import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type FileChooser, type Page, type Route } from 'playwright-core';
import {
  BrowserHostRequest, type BrowserActResult, type BrowserActStep, type BrowserExpectedTarget, type BrowserHostEvent, type BrowserInspectResult, type BrowserPageFacts,
  type BrowserPolicy, type BrowserTabView,
} from '../shared/browser-host';
import { BROWSER_OPEN_TIMEOUT_MS, CLEAN_BROWSER_PROFILE, MAX_BROWSER_TABS, type BrowserInfo } from '../shared/browser';
import {
  BROWSER_CURSOR_LEAD_MS, BROWSER_WATCH_LEASE_MS, BrowserCursorTrack, askingPointFor, cursorPointFor, type BrowserCursorAction, type BrowserInputEvent, type BrowserWatchState,
} from '../shared/browser-live';
import { requestRefusal, type ResolveAddresses } from '../core/tools/browser-policy';
import type { DetectedBrowser } from './detect';
import { PASSKEY_BINDING, PASSKEY_WATCH_SCRIPT, readFocusedField, suggestionFor, SuggestionLog, type DetectorSignal } from './detector';
import { headedUserAgent, launchArgs, LAUNCH_ARGS } from './launch';
import { FrameStream } from './live-stream';
import { PolicyProxy } from './proxy';
import { focusedElement, newSnapshotLines, snapshotElement, type SnapshotElement } from './snapshot-lines';
import { CAPTCHA_FRAME, PAYMENT_FRAME, PAYMENT_PATH, readElementFacts, readFrameFacts } from './page-facts';

export { LAUNCH_ARGS, PLAYWRIGHT_DISABLED_FEATURES } from './launch';

/**
 * The hands of Orglet's browser (COD-261): a real Chrome or Edge driven through playwright-core over a pipe, never
 * a debugging port. The core has decided each step before it arrives; this engine keeps each run to its own tabs,
 * checks every navigation and request against the run's site rules while pages load, and closes a run's tabs when
 * the run ends. It runs in its own process, started by main.
 *
 * Runs have no window: the browser runs in Chrome's headless mode (`launch.ts`). The person watches a run in Orglet,
 * where the tab the run last used streams as frames while a view is open, with the cursor Orglet draws where the
 * orglet just pointed, and takes it over there. They can also move a run's tabs into a real Chrome window (Open in
 * Chrome) and hand them back; a window opens for nothing else except signing in to a profile.
 *
 * Clean runs share one headless browser process, each in a private context of its own that is thrown away with the
 * run. A named profile is a folder under `profilesRoot` opened as one persistent context; runs and the person share
 * it, each run seeing only the tabs it opened.
 *
 * Two gates check the site rules. Every connection goes through a `PolicyProxy` (one per Clean run, one per named
 * profile), which sees each hop of a redirect and every frame, worker and socket, and refuses private addresses the
 * chat did not list. A request hook refuses a page or frame on a site the chat blocked, or, on a signed-in profile,
 * one it did not list; before a page is read or pictured, every frame on it is checked again.
 */

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

type RunSession = {
  runId: string;
  profileId: string;
  context: BrowserContext;
  /** A Clean run's private context, closed with the run. */
  ownsContext: boolean;
  tabs: Map<string, Page>;
  nextTab: number;
  policy: BrowserPolicy;
  /** A Clean run's own network gate and its address, closed with it. */
  proxy?: PolicyProxy;
  proxyServer?: string;
  /** The person has taken this run's browser over: its steps wait, its popups stay open as tabs. */
  held: boolean;
  /** The run's tabs are in a Chrome window the person has, after Open in Chrome. */
  inChrome: boolean;
  /** A Clean run's own browser with a window, while its tabs are in Chrome. */
  chromeBrowser?: Browser;
  /** A Clean run's cookies and site storage as last read from the Chrome window, kept for when the window closes. */
  savedState?: StorageState;
  /** Where each tab last was, so its tabs can be opened again after they move between the headless browser and Chrome. */
  addresses: Map<string, string>;
  /** Set while the engine moves the run's tabs, so the context it closes on the way is not taken for the person's. */
  switching: boolean;
  /** The tab the run used last: the one a view shows. */
  activeTab: string | null;
  /** A view watching this run, until the lease runs out, and how wide it draws the page. */
  watch?: { until: number; width: number };
  /** The frames of the active tab while a view watches; its own field, so a watch ending never loses a running stream. */
  stream?: FrameStream;
  /** Moving the stream from tab to tab, one move at a time. */
  streaming: Promise<void>;
  /** The person's input from the view, one event at a time, in the order it came. */
  inputs: Promise<void>;
  focusCheck?: NodeJS.Timeout;
  /**
   * What the run's pages tried that Orglet stopped, counted so a step can say what happened during it. Dialogs are
   * numbered, since only the last few are kept.
   */
  dialogs: { number: number; type: string; message: string }[];
  dialogCount: number;
  downloads: number;
  fileChoosers: number;
  popupsClosed: number;
};

export type BrowserEngineOptions = {
  profilesRoot: string;
  browser: () => DetectedBrowser | null;
  /**
   * No window at all, for tests: the windows meant for the person (signing in, Open in Chrome) open headless too.
   * Runs are headless either way.
   */
  headless?: boolean;
  resolve?: ResolveAddresses;
  /** How long the browser stays open after the last run and sign-in window are done. */
  idleMs?: number;
  /** Frames, the cursor, suggestions and a closed Chrome window, for main to pass on. */
  emit?: (event: BrowserHostEvent) => void;
};

const VIEWPORT = { width: 1280, height: 800 };
/** What a connection nobody claims gets: public sites only. */
const PUBLIC_ONLY: BrowserPolicy = { sites: [], restricted: false };
const DNS_CACHE_MS = 60_000;
const STEP_TIMEOUT_MS = 15_000;
/** How long the cursor may take to find its element before a step; a step it cannot place still runs. */
const CURSOR_LOOKUP_MS = 2_000;
/** How long after a click or a key in the view Orglet looks at where the page's focus went. */
const FOCUS_CHECK_DELAY_MS = 150;
/** How often expired watches are stopped. */
const LEASE_CHECK_MS = 5_000;
/** A Chrome window closes its tabs one by one within this long. */
const WINDOW_CLOSING_MS = 500;

export const NO_BROWSER = 'Không tìm thấy Chrome hay Edge trên máy này. Cài một trong hai rồi thử lại.';
export const NO_TAB = 'Lần chạy này không có tab đó. Xem các tab bằng browser_tabs.';
export const TOO_MANY_TABS = 'Lần chạy này đã mở đủ tab. Đóng một tab rồi mở tiếp.';
export const PROFILE_IN_USE = 'Một Tí đang dùng hồ sơ này. Đợi lượt chạy xong rồi thử lại.';
export const PROFILE_RUNNING = 'Một Tí đang dùng hồ sơ này. Mở trang của nó trong Chrome từ chat, hoặc đợi lượt chạy xong rồi mở hồ sơ để đăng nhập.';
export const PROFILE_SHARED = 'Một lượt chạy khác cũng đang dùng hồ sơ này nên chưa mở được trong Chrome. Đợi lượt đó xong rồi thử lại.';
export const OTHER_PROFILE = 'Lần chạy này đang dùng một hồ sơ khác. Nhắn tin mới để dùng hồ sơ vừa chọn.';
export const WINDOW_CLOSED = 'Cửa sổ trình duyệt đã đóng. Mở lại trang để tiếp tục.';
export const FRAME_REFUSED = 'Trang này có một khung hiện trang mà luật trang của chat không cho phép, nên không đọc trang này.';
export const PAGE_MOVED = 'Trang đã chuyển sang địa chỉ khác trước bước này nên không làm gì. Đọc lại trang bằng browser_snapshot.';
export const ELEMENT_CHANGED = 'Phần tử này đã đổi hoặc không còn trên trang nên không làm gì. Đọc lại trang bằng browser_snapshot rồi dùng mã mới.';
export const NOT_HELD = 'Bạn cần tiếp quản trình duyệt trước khi bấm hay gõ trên trang.';
export const HTTP_SIGN_IN = 'Trang này cần đăng nhập bằng hộp thoại của trình duyệt. Nhờ người dùng mở trang trong Chrome và tự đăng nhập.';
export const IN_CHROME = 'Trang đang mở trong cửa sổ Chrome. Dùng cửa sổ đó, hoặc quay lại xem trong Orglet.';

/** Characters of the changed snapshot lines a step returns; the worker reads the rest with browser_snapshot. */
const CHANGED_LINES_CHARACTERS = 3_000;
/** Frames whose facts are read before a step; a page with more is judged on these. */
const FACT_FRAMES = 20;
const FRAME_FACTS_TIMEOUT_MS = 1_500;
/** A step that opens a page gets this long to load before its result is read. */
const SETTLE_LOAD_MS = 5_000;
/** The colour the element the person is asked about is outlined in, on the picture the card shows. */
const ASKING_OUTLINE = '[data-orglet-asking]{outline:3px solid #e5484d !important;outline-offset:2px !important}';
/** The size of the part of the page a card's picture keeps around the element. */
const ASKING_PICTURE = { width: 720, height: 405 };

export class BrowserEngine {
  private cleanBrowser?: Promise<Browser>;
  /** The gate the Clean browser process starts with; every Clean context replaces it with its run's own. */
  private cleanProxy?: PolicyProxy;
  private profiles = new Map<string, Promise<BrowserContext>>();
  /** Named profiles open in a window rather than headless: to sign in, or with a run's tabs after Open in Chrome. */
  private windowedProfiles = new Set<string>();
  private profileProxies = new Map<string, PolicyProxy>();
  private signIn = new Set<string>();
  private runs = new Map<string, RunSession>();
  /** Runs the person took over before their first page opened; the hold applies once it does. */
  private heldBeforeOpen = new Set<string>();
  private pageOwners = new WeakMap<Page, RunSession>();
  private fileChooserListeners = new WeakMap<RunSession, (chooser: FileChooser) => void>();
  private dnsCache = new Map<string, { at: number; addresses: string[] }>();
  private userAgents = new Map<string, Promise<string | undefined>>();
  private cursors = new BrowserCursorTrack();
  private suggestions = new SuggestionLog();
  /** A Clean run's own Chrome on its way out after its tabs came back headless. */
  private closingBrowsers = new Set<Promise<void>>();
  private idleTimer?: NodeJS.Timeout;
  private leaseTimer?: NodeJS.Timeout;
  private resolve: ResolveAddresses;

  constructor(private options: BrowserEngineOptions) {
    this.resolve = options.resolve ?? (hostname => this.resolveCached(hostname));
  }

  info(): BrowserInfo | null {
    const found = this.options.browser();
    if (!found) return null;
    return { kind: found.kind, name: found.name, version: found.version };
  }

  async handle(raw: unknown, signal: AbortSignal): Promise<unknown> {
    const request = BrowserHostRequest.parse(raw);
    signal.throwIfAborted();
    switch (request.kind) {
      case 'detect': return this.info();
      case 'open': return this.open(request.runId, request.profileId, request.policy, request.tabId, request.url, signal);
      case 'snapshot': {
        const page = await this.allowedTab(request.runId, request.tabId, request.policy);
        const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: STEP_TIMEOUT_MS, signal });
        return { ...await this.tabView(request.tabId, page), snapshot };
      }
      case 'screenshot': {
        const page = await this.allowedTab(request.runId, request.tabId, request.policy);
        const png = await this.picture(this.runs.get(request.runId)!, request.tabId, page, request.highlight, request.pointer);
        return { ...await this.tabView(request.tabId, page), png: png.toString('base64') };
      }
      case 'inspect': return this.inspect(request.runId, request.tabId, request.policy, request.ref, signal);
      case 'act': return this.act(request.runId, request.tabId, request.policy, request.step, request.url, request.expect, signal);
      case 'hold': return this.hold(request.runId, request.held, request.inChrome);
      case 'watch': return this.watch(request.runId, request.watching, request.width);
      case 'input': return this.input(request.runId, request.event);
      case 'scroll': {
        const page = await this.allowedTab(request.runId, request.tabId, request.policy);
        const metrics = await page.evaluate(direction => {
          const step = Math.round(window.innerHeight * 0.9);
          if (direction === 'down') window.scrollBy(0, step);
          if (direction === 'up') window.scrollBy(0, -step);
          if (direction === 'top') window.scrollTo(0, 0);
          if (direction === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
          return { scrollY: Math.round(window.scrollY), scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight };
        }, request.direction);
        // Pages that load more as they are scrolled get a moment to do it before the next snapshot.
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
        return { ...await this.tabView(request.tabId, page), ...metrics };
      }
      case 'tabs': {
        const session = this.runs.get(request.runId);
        if (!session) return { tabs: [] };
        const tabs: BrowserTabView[] = [];
        for (const [tabId, page] of session.tabs) tabs.push(await this.tabView(tabId, page));
        return { tabs };
      }
      case 'close': {
        const session = this.runs.get(request.runId);
        const page = session?.tabs.get(request.tabId);
        if (!session || !page) throw new Error(NO_TAB);
        session.tabs.delete(request.tabId);
        await page.close().catch(() => {});
        this.tabGone(session, request.tabId);
        return { closed: true };
      }
      case 'endRun': {
        await this.endRun(request.runId);
        return { ended: true };
      }
      case 'openProfile': return this.openProfile(request.profileId);
      case 'closeProfile': return this.closeProfile(request.profileId);
      case 'openProfiles': return [...this.profiles.keys()];
    }
  }

  /** Closes every browser this engine opened. */
  async shutdown() {
    clearTimeout(this.idleTimer);
    clearInterval(this.leaseTimer);
    this.leaseTimer = undefined;
    for (const runId of [...this.runs.keys()]) await this.endRun(runId);
    for (const context of this.profiles.values()) await (await context.catch(() => undefined))?.close().catch(() => {});
    this.profiles.clear();
    this.signIn.clear();
    const browser = await this.cleanBrowser?.catch(() => undefined);
    this.cleanBrowser = undefined;
    await browser?.close().catch(() => {});
    this.cleanProxy?.close();
    this.cleanProxy = undefined;
    for (const proxy of this.profileProxies.values()) proxy.close();
    this.profileProxies.clear();
    await Promise.all([...this.closingBrowsers]);
  }

  /**
   * Closes a Clean run's own Chrome once its tabs are back in the headless browser, without making the run wait for
   * Chrome to exit: that takes up to a second or more on a busy Mac, and a teardown waiting on it once ran past 30
   * seconds on the macOS runner (COD-261). Shutting down still waits for it.
   */
  private closeLater(browser: Browser | undefined) {
    if (!browser) return;
    const closing = browser.close().catch(() => {});
    this.closingBrowsers.add(closing);
    void closing.then(() => this.closingBrowsers.delete(closing));
  }

  private emit(event: BrowserHostEvent) {
    this.options.emit?.(event);
  }

  private detected(): DetectedBrowser {
    const found = this.options.browser();
    if (!found) throw new Error(NO_BROWSER);
    return found;
  }

  /**
   * The user agent this browser sends with a window. The version comes from the install folder on Windows and the app's
   * Info.plist on a Mac; when neither says (on Linux), the browser is started once, headless, to ask it.
   */
  private headedUserAgent(found: DetectedBrowser): Promise<string | undefined> {
    const known = headedUserAgent(found.kind, found.version);
    if (known) return Promise.resolve(known);
    let asking = this.userAgents.get(found.executable);
    if (!asking) {
      asking = (async () => {
        const browser = await chromium.launch({ executablePath: found.executable, headless: true, args: LAUNCH_ARGS, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
        try {
          return headedUserAgent(found.kind, browser.version());
        } finally {
          await browser.close().catch(() => {});
        }
      })().catch(() => undefined);
      this.userAgents.set(found.executable, asking);
    }
    return asking;
  }

  /** How one browser starts: headless for a run, with a window when it is for the person. */
  private async launchOptions(forPerson: boolean) {
    const found = this.detected();
    const headless = this.options.headless === true || !forPerson;
    const userAgent = headless ? await this.headedUserAgent(found) : undefined;
    return { executablePath: found.executable, headless, args: launchArgs(headless, userAgent),
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
  }

  private async resolveCached(hostname: string): Promise<string[]> {
    const cached = this.dnsCache.get(hostname);
    if (cached && Date.now() - cached.at < DNS_CACHE_MS) return cached.addresses;
    const answers = await lookup(hostname, { all: true, verbatim: true });
    const addresses = answers.map(answer => answer.address);
    this.dnsCache.set(hostname, { at: Date.now(), addresses });
    return addresses;
  }

  private async clean(): Promise<Browser> {
    if (!this.cleanBrowser) {
      const launching = this.launchClean();
      this.cleanBrowser = launching;
      launching.then(browser => browser.on('disconnected', () => {
        if (this.cleanBrowser === launching) this.cleanBrowser = undefined;
        for (const session of [...this.runs.values()]) {
          // A Clean run whose tabs are in Chrome lives in a browser of its own.
          if (!session.ownsContext || session.chromeBrowser) continue;
          this.forgetRun(session);
        }
      }), () => { if (this.cleanBrowser === launching) this.cleanBrowser = undefined; });
    }
    return this.cleanBrowser;
  }

  private async launchClean(): Promise<Browser> {
    const options = await this.launchOptions(false);
    this.cleanProxy?.close();
    const proxy = new PolicyProxy(() => PUBLIC_ONLY, this.resolve);
    this.cleanProxy = proxy;
    const server = await proxy.start();
    return chromium.launch({ ...options, proxy: { server } });
  }

  /** A Clean run's private context in the headless browser, carrying `state` when its tabs come back from Chrome. */
  private async cleanContext(session: Pick<RunSession, 'proxyServer'>, state?: StorageState): Promise<BrowserContext> {
    const browser = await this.clean();
    const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: false, serviceWorkers: 'block', proxy: { server: session.proxyServer! }, ...(state ? { storageState: state } : {}) });
    await this.watchContext(context, true);
    return context;
  }

  /**
   * What a named profile's gate allows: every rule of every run using it, so one run's listed local address is open
   * to that profile while the run lasts. A block on any of their lists wins, and each run's pages are still checked
   * against its own list before they are read.
   */
  private profilePolicy(profileId: string): BrowserPolicy {
    const sites = [...this.runs.values()].filter(session => session.profileId === profileId).flatMap(session => session.policy.sites);
    return { sites, restricted: false };
  }

  /**
   * A named profile's persistent context, opened once and shared by the runs that use it and the person. It opens
   * headless for a run and with a window for the person; one that is already open is used as it is.
   */
  private async profileContext(profileId: string, forPerson: boolean): Promise<BrowserContext> {
    let opening = this.profiles.get(profileId);
    if (!opening) {
      opening = this.launchProfile(profileId, forPerson);
      this.profiles.set(profileId, opening);
      const current = opening;
      opening.catch(() => { if (this.profiles.get(profileId) === current) this.profiles.delete(profileId); });
    }
    return opening;
  }

  private async launchProfile(profileId: string, forPerson: boolean): Promise<BrowserContext> {
    const options = await this.launchOptions(forPerson);
    this.profileProxies.get(profileId)?.close();
    const proxy = new PolicyProxy(() => this.profilePolicy(profileId), this.resolve);
    this.profileProxies.set(profileId, proxy);
    const server = await proxy.start();
    const context = await chromium.launchPersistentContext(join(this.options.profilesRoot, profileId), {
      ...options, viewport: forPerson ? null : VIEWPORT, acceptDownloads: false, serviceWorkers: 'block', proxy: { server },
    });
    if (forPerson) this.windowedProfiles.add(profileId);
    else this.windowedProfiles.delete(profileId);
    await this.watchContext(context, !forPerson);
    context.on('close', () => {
      if (this.profileProxies.get(profileId) === proxy) {
        proxy.close();
        this.profileProxies.delete(profileId);
      }
      const affected = [...this.runs.values()].filter(session => session.context === context && !session.switching);
      void this.profileClosed(profileId, context, affected);
    });
    return context;
  }

  /**
   * A profile's browser closed: the person closed its window, or it went away. Runs that used it go on headless, at the
   * pages they were at; a context the engine closed on purpose to move a run is left to that move.
   */
  private async profileClosed(profileId: string, context: BrowserContext, affected: RunSession[]) {
    const current = await this.profiles.get(profileId)?.catch(() => undefined);
    if (current === context || current === undefined) {
      if (current === context) this.profiles.delete(profileId);
      this.windowedProfiles.delete(profileId);
      this.signIn.delete(profileId);
    }
    for (const session of affected) await this.windowClosed(session, context);
    this.scheduleIdle();
  }

  /**
   * Checks every request of a context against the site rules of the run that owns the page making it, before any
   * page of that context loads. A popup a run's page opens is closed, unless the person has taken the browser over:
   * then it becomes one of the run's tabs, and the view follows it, so a sign-in window can be used. Its requests
   * still follow the run's site rules. A headless context also learns when a page asks for a passkey.
   */
  private async watchContext(context: BrowserContext, headless: boolean) {
    await context.route('**/*', route => this.onRoute(context, route));
    if (headless) {
      await context.exposeBinding(PASSKEY_BINDING, source => {
        const owner = source.page ? this.pageOwners.get(source.page) : undefined;
        if (owner) this.suggest(owner, { kind: 'credentials', publicKey: true });
      });
      await context.addInitScript({ content: PASSKEY_WATCH_SCRIPT });
    }
    context.on('page', page => {
      void this.ownerOfOpener(page).then(async owner => {
        if (!owner) return;
        if (!owner.held) {
          owner.popupsClosed += 1;
          await page.close().catch(() => {});
          return;
        }
        if (owner.inChrome || owner.tabs.size >= MAX_BROWSER_TABS) return;
        const tabId = `t${owner.nextTab}`;
        owner.nextTab += 1;
        this.adoptTab(owner, tabId, page);
        await this.focusTab(owner, tabId);
      });
    });
  }

  /**
   * What a run's tab does with the things a page can try on its own. A JavaScript dialog is dismissed and noted,
   * since nothing may answer one, except in the Chrome window, where it is the person's; a download is cancelled
   * (the context accepts none) and noted; a file picker is caught before it opens and never filled, except in Chrome.
   * Each of these, a sign-in the browser asks for, and a passkey prompt are also offered to the view as a reason to
   * open the page in Chrome.
   */
  private watchTab(session: RunSession, tabId: string, page: Page) {
    page.on('dialog', dialog => {
      if (session.inChrome) return;
      session.dialogCount += 1;
      session.dialogs.push({ number: session.dialogCount, type: dialog.type().slice(0, 20), message: dialog.message().slice(0, 300) });
      session.dialogs = session.dialogs.slice(-5);
      this.suggest(session, { kind: 'dialog' });
      void dialog.dismiss().catch(() => {});
    });
    page.on('download', download => {
      session.downloads += 1;
      void download.cancel().catch(() => {});
    });
    page.on('response', response => {
      const status = response.status();
      if (status !== 401 && status !== 407) return;
      const request = response.request();
      this.suggest(session, {
        kind: 'response', status, authenticate: response.headers()['www-authenticate'] !== undefined || response.headers()['proxy-authenticate'] !== undefined,
        document: request.resourceType() === 'document', mainFrame: request.frame() === page.mainFrame(),
      });
    });
    // Headless, the browser cannot show its own sign-in dialog, so a page that asks for one fails to load instead.
    page.on('requestfailed', request => {
      if (!/ERR_INVALID_AUTH_CREDENTIALS/.test(request.failure()?.errorText ?? '')) return;
      this.suggest(session, { kind: 'response', status: 401, authenticate: true, document: request.resourceType() === 'document', mainFrame: request.frame() === page.mainFrame() });
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && session.tabs.get(tabId) === page) session.addresses.set(tabId, frame.url());
    });
    // A Clean run's sign-ins in the Chrome window are kept as the pages load, so closing the window keeps them.
    page.on('load', () => {
      if (!session.inChrome || !session.ownsContext) return;
      void session.context.storageState().then(state => { if (session.inChrome) session.savedState = state; }, () => {});
    });
    if (!session.inChrome) page.on('filechooser', this.catchFileChooser(session));
  }

  /** One listener per run, counting each file picker and offering the Chrome window for it. */
  private catchFileChooser(session: RunSession) {
    let listener = this.fileChooserListeners.get(session);
    if (!listener) {
      listener = () => {
        session.fileChoosers += 1;
        this.suggest(session, { kind: 'fileChooser' });
      };
      this.fileChooserListeners.set(session, listener);
    }
    return listener;
  }

  /** Offers the view a reason to open the page in Chrome, once in a while per reason. Not while it is in Chrome. */
  private suggest(session: RunSession, signal: DetectorSignal) {
    if (session.inChrome || this.runs.get(session.runId) !== session) return;
    const suggestion = suggestionFor(signal);
    if (suggestion && this.suggestions.offer(session.runId, suggestion)) this.emit({ kind: 'suggest', runId: session.runId, suggestion });
  }

  private async ownerOfOpener(page: Page): Promise<RunSession | undefined> {
    const opener = await page.opener().catch(() => null);
    return opener ? this.pageOwners.get(opener) : undefined;
  }

  /**
   * The rules for one request, or undefined when it belongs to the person rather than a run. A page is a run's when
   * the run opened it or a page of the run opened it; in a Clean context everything is the run's. A request with no
   * page (a worker) in a signed-in window some run is using gets the strictest rules: public sites only.
   */
  private async policyFor(context: BrowserContext, route: Route): Promise<BrowserPolicy | undefined> {
    let page: Page | undefined;
    try {
      page = route.request().frame().page();
    } catch {
      page = undefined;
    }
    if (page) {
      const owner = this.pageOwners.get(page) ?? await this.ownerOfOpener(page);
      if (owner) return owner.policy;
    }
    const cleanOwner = [...this.runs.values()].find(session => session.context === context && session.ownsContext);
    if (cleanOwner) return cleanOwner.policy;
    if (page) return undefined;
    if ([...this.runs.values()].some(session => session.context === context)) return { sites: [], restricted: false };
    return undefined;
  }

  private async onRoute(context: BrowserContext, route: Route) {
    const policy = await this.policyFor(context, route);
    // A page the person opened themselves in a signed-in window is theirs, not a run's.
    if (!policy) {
      await route.continue().catch(() => {});
      return;
    }
    const request = route.request();
    const refusal = await requestRefusal(request.url(), policy, request.resourceType() === 'document', this.resolve);
    if (refusal) {
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  }

  private async session(runId: string, profileId: string, policy: BrowserPolicy): Promise<RunSession> {
    const existing = this.runs.get(runId);
    if (existing) {
      if (existing.profileId !== profileId) throw new Error(OTHER_PROFILE);
      existing.policy = policy;
      return existing;
    }
    clearTimeout(this.idleTimer);
    if (profileId === CLEAN_BROWSER_PROFILE) {
      const proxy = new PolicyProxy(() => this.runs.get(runId)?.policy ?? PUBLIC_ONLY, this.resolve);
      const proxyServer = await proxy.start();
      const context = await this.cleanContext({ proxyServer });
      const session: RunSession = { runId, profileId, context, ownsContext: true, policy, proxy, proxyServer, ...quietSession(), held: this.heldBeforeOpen.delete(runId) };
      this.runs.set(runId, session);
      return session;
    }
    const context = await this.profileContext(profileId, false);
    const session: RunSession = { runId, profileId, context, ownsContext: false, policy, ...quietSession(), held: this.heldBeforeOpen.delete(runId) };
    this.runs.set(runId, session);
    return session;
  }

  /** Makes a page one of the run's tabs under `tabId`. */
  private adoptTab(session: RunSession, tabId: string, page: Page) {
    session.tabs.set(tabId, page);
    this.pageOwners.set(page, session);
    this.watchTab(session, tabId, page);
    page.on('close', () => {
      if (session.tabs.get(tabId) !== page || session.switching) return;
      session.tabs.delete(tabId);
      const windowed = session.inChrome || (!session.ownsContext && this.windowedProfiles.has(session.profileId));
      if (!windowed) {
        this.tabGone(session, tabId);
        return;
      }
      const context = session.context;
      // In Chrome, the last of the run's tabs closing is the person closing the window: the run goes on headless, at
      // every tab's address.
      if (session.inChrome && session.tabs.size === 0) {
        void this.windowClosed(session, context);
        return;
      }
      // Closing a window closes its tabs one by one, and the browser says the window is gone only after its process
      // exits: over a second later on a busy Mac (measured on the macOS runner for COD-261), or never, since Chrome on
      // macOS keeps running with no window. So a moment after the tab closes, a context with no page left open is a
      // closed window, and the run goes on headless with this tab too; a context that still shows pages had only this
      // tab closed, and the run forgets it.
      setTimeout(() => {
        if (session.context !== context || session.tabs.has(tabId)) return;
        if (context.pages().length === 0) void this.windowClosed(session, context);
        else this.tabGone(session, tabId);
      }, WINDOW_CLOSING_MS);
    });
  }

  private async open(runId: string, profileId: string, policy: BrowserPolicy, tabId: string | null, url: string, signal: AbortSignal) {
    const session = await this.session(runId, profileId, policy);
    if (session.inChrome) throw new Error(IN_CHROME);
    let page: Page;
    let pageTabId: string;
    if (tabId) {
      const existing = session.tabs.get(tabId);
      if (!existing || existing.isClosed()) throw new Error(NO_TAB);
      page = existing;
      pageTabId = tabId;
    } else {
      if (session.tabs.size >= MAX_BROWSER_TABS) throw new Error(TOO_MANY_TABS);
      page = await session.context.newPage();
      pageTabId = `t${session.nextTab}`;
      session.nextTab += 1;
      this.adoptTab(session, pageTabId, page);
      // A profile the person has open in a window keeps its own size; the run's tab is the size every run's is.
      if (!session.ownsContext) await page.setViewportSize(VIEWPORT).catch(() => {});
    }
    await this.focusTab(session, pageTabId);
    let status: number | null = null;
    let failure: unknown;
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_OPEN_TIMEOUT_MS, signal });
      status = response?.status() ?? null;
      await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {});
    } catch (error) {
      failure = error;
    }
    signal.throwIfAborted();
    if (page.isClosed()) throw new Error(WINDOW_CLOSED);
    // The page may have ended somewhere else than asked, through a redirect or a script; that address must pass too.
    const landed = page.url();
    const refusal = landed === 'about:blank' ? undefined : await requestRefusal(landed, session.policy, true, this.resolve);
    if (refusal) {
      await page.goto('about:blank').catch(() => {});
      return { ...await this.tabView(pageTabId, page), status: null, blocked: refusal };
    }
    if (failure) {
      const blocked = failure instanceof Error && /ERR_BLOCKED_BY_CLIENT/.test(failure.message);
      if (blocked) return { ...await this.tabView(pageTabId, page), status: null, blocked: 'Trang hoặc một bước chuyển hướng tới nó bị luật trang của chat chặn.' };
      throw new Error(openFailure(failure));
    }
    return { ...await this.tabView(pageTabId, page), status };
  }

  /** The run's tab, after checking that where it is now still passes the chat's current site rules. */
  private async allowedTab(runId: string, tabId: string, policy: BrowserPolicy): Promise<Page> {
    const session = this.runs.get(runId);
    const page = session?.tabs.get(tabId);
    if (!session || !page || page.isClosed()) throw new Error(NO_TAB);
    session.policy = policy;
    const refusal = page.url() === 'about:blank' ? undefined : await requestRefusal(page.url(), policy, true, this.resolve);
    if (refusal) throw new Error(refusal);
    // A snapshot and a screenshot include frames, so a frame that ended up somewhere the rules refuse (through a
    // redirect inside it, say) keeps the whole page unread.
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (!/^https?:/i.test(frameUrl)) continue;
      if (await requestRefusal(frameUrl, policy, true, this.resolve)) throw new Error(FRAME_REFUSED);
    }
    await this.focusTab(session, tabId);
    return page;
  }

  private async tabView(tabId: string, page: Page): Promise<BrowserTabView> {
    const title = await page.title().catch(() => '');
    return { tabId, url: page.url(), title: title.slice(0, 300) };
  }

  /**
   * A PNG of what the tab shows. Password fields are painted over, so a picture never shows what someone typed into
   * one. `highlight` scrolls one element into view, outlines it and keeps only the part of the page around it, so
   * the card's small picture still shows the element and its words; with `pointer`, the orglet's cursor goes to its
   * lower right corner (`askingPointFor`), so a view shows what the card asks about without covering it. The live view holds its frames back meanwhile, since the page
   * carries the outline and the painted-over fields for that moment.
   */
  private async picture(session: RunSession, tabId: string, page: Page, highlight?: string, pointer?: BrowserCursorAction): Promise<Buffer> {
    const stream = session.stream;
    stream?.pause();
    try {
      const options = { type: 'png' as const, timeout: STEP_TIMEOUT_MS, animations: 'disabled' as const, caret: 'hide' as const, mask: [page.locator('input[type="password"]')] };
      if (!highlight) return await page.screenshot(options);
      const element = page.locator(`aria-ref=${highlight}`);
      await element.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
      const marked = await element.evaluate(node => node.setAttribute('data-orglet-asking', ''), undefined, { timeout: 3_000 }).then(() => true, () => false);
      const box = await element.boundingBox({ timeout: 3_000 }).catch(() => null);
      const viewport = page.viewportSize() ?? VIEWPORT;
      if (box && pointer) {
        const cursor = { tabId, ...askingPointFor(box, viewport), action: pointer };
        this.cursors.move(session.runId, cursor);
        this.emit({ kind: 'cursor', runId: session.runId, cursor });
      }
      const clip = box ? regionAround(box, viewport) : undefined;
      try {
        return await page.screenshot({ ...options, style: ASKING_OUTLINE, ...(clip ? { clip } : {}) });
      } finally {
        if (marked) await element.evaluate(node => node.removeAttribute('data-orglet-asking'), undefined, { timeout: 3_000 }).catch(() => {});
      }
    } finally {
      stream?.resume();
    }
  }

  /** Signs of a password, payment or CAPTCHA page, read from the page's address and its first frames. */
  private async pageFacts(page: Page): Promise<BrowserPageFacts> {
    const facts: BrowserPageFacts = { passwordField: false, cardField: false, payment: false, captcha: false };
    try {
      facts.payment = PAYMENT_PATH.test(new URL(page.url()).pathname);
    } catch {
      facts.payment = false;
    }
    for (const frame of page.frames().slice(0, FACT_FRAMES)) {
      const frameUrl = frame.url();
      if (CAPTCHA_FRAME.test(frameUrl)) facts.captcha = true;
      if (PAYMENT_FRAME.test(frameUrl)) facts.payment = true;
      if (!/^(?:https?:|about:blank|about:srcdoc)/i.test(frameUrl)) continue;
      const found = await withinFrameTimeout(frame.evaluate(readFrameFacts));
      if (!found) continue;
      facts.passwordField ||= found.passwordField;
      facts.cardField ||= found.cardField;
      facts.captcha ||= found.captcha;
    }
    return facts;
  }

  /**
   * What the page reports about one element before a step on it, from a snapshot taken now: its role and name as the
   * snapshot shows them, and the facts the core judges the step by. `ref` null reads the focused element.
   */
  private async inspect(runId: string, tabId: string, policy: BrowserPolicy, ref: string | null, signal: AbortSignal): Promise<BrowserInspectResult> {
    const page = await this.allowedTab(runId, tabId, policy);
    const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: STEP_TIMEOUT_MS, signal });
    const view = await this.tabView(tabId, page);
    const facts = await this.pageFacts(page);
    const element = ref ? snapshotElement(snapshot, ref) : focusedElement(snapshot);
    if (!element) return { ...view, target: null, page: facts };
    const located = page.locator(`aria-ref=${element.ref}`);
    if (await located.count() === 0) return { ...view, target: null, page: facts };
    const elementFacts = await located.evaluate(readElementFacts, undefined, { timeout: STEP_TIMEOUT_MS });
    return { ...view, target: { ref: element.ref, role: element.role.slice(0, 60), name: element.name.slice(0, 300), ...elementFacts }, page: facts };
  }

  /**
   * The person takes a run's browser over, or hands it back. Held, the run's steps wait and its popups become tabs;
   * `inChrome` moves its tabs into a Chrome window for the person. Handing back, or asking for the live view again,
   * brings them back to the headless browser.
   */
  private async hold(runId: string, held: boolean, inChrome: boolean) {
    const session = this.runs.get(runId);
    if (!session) {
      if (held) this.heldBeforeOpen.add(runId);
      else this.heldBeforeOpen.delete(runId);
      return { inChrome: false };
    }
    session.held = held;
    if (held && inChrome) await this.toChrome(session);
    else if (session.inChrome) await this.toHeadless(session);
    if (!held) this.suggestions.clear(runId);
    return { inChrome: session.inChrome };
  }

  /** Where each of the run's tabs is now, or was last. */
  private currentAddresses(session: RunSession): Map<string, string> {
    const addresses = new Map<string, string>();
    for (const [tabId, page] of session.tabs) addresses.set(tabId, page.isClosed() ? session.addresses.get(tabId) ?? 'about:blank' : page.url());
    for (const [tabId, url] of session.addresses) if (!addresses.has(tabId)) addresses.set(tabId, url);
    return addresses;
  }

  /**
   * Opens the run's tabs again in the context the run now uses, under the same tab names and at the same addresses.
   * What a page held in memory, such as a half-filled form, does not come along; cookies and site storage do.
   */
  private async reopenTabs(session: RunSession, addresses: Map<string, string>) {
    const context = session.context;
    const leftBlank = context.pages().filter(page => !this.pageOwners.has(page) && page.url() === 'about:blank');
    session.tabs = new Map();
    for (const [tabId, url] of addresses) {
      const page = await context.newPage();
      this.adoptTab(session, tabId, page);
      if (!session.ownsContext && !session.inChrome) await page.setViewportSize(VIEWPORT).catch(() => {});
      if (url && url !== 'about:blank') await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_OPEN_TIMEOUT_MS }).catch(() => {});
    }
    // The blank page a profile opens with would stand between the person and the run's tabs in a window.
    if (session.inChrome && session.tabs.size > 0) for (const page of leftBlank) await page.close().catch(() => {});
    if (session.activeTab === null || !session.tabs.has(session.activeTab)) session.activeTab = [...session.tabs.keys()].at(-1) ?? null;
  }

  /** Brings the run's tab into view in the Chrome window. */
  private async bringForward(session: RunSession) {
    const page = (session.activeTab ? session.tabs.get(session.activeTab) : undefined) ?? [...session.tabs.values()].at(-1);
    await page?.bringToFront().catch(() => {});
  }

  /**
   * Moves the run's tabs into a Chrome window for the person. A named profile is locked by the browser using it, so
   * its headless browser closes and the same folder opens with a window; a Clean run's cookies and site storage are
   * carried into a private window of its own.
   */
  private async toChrome(session: RunSession) {
    if (session.inChrome) {
      await this.bringForward(session);
      return;
    }
    await this.stopStream(session);
    const addresses = this.currentAddresses(session);
    session.switching = true;
    try {
      if (!session.ownsContext) {
        if (this.windowedProfiles.has(session.profileId)) {
          // The profile is already in a window: the person opened it to sign in.
          session.inChrome = true;
        } else {
          const sharing = [...this.runs.values()].some(other => other !== session && other.context === session.context);
          if (sharing) throw new Error(PROFILE_SHARED);
          const headless = session.context;
          this.profiles.delete(session.profileId);
          await headless.close().catch(() => {});
          session.context = await this.profileContext(session.profileId, true);
          session.inChrome = true;
          await this.reopenTabs(session, addresses);
        }
      } else {
        const state = await session.context.storageState().catch(() => undefined);
        const browser = await chromium.launch({ ...await this.launchOptions(true), proxy: { server: session.proxyServer! } });
        const context = await browser.newContext({ viewport: null, acceptDownloads: false, serviceWorkers: 'block', ...(state ? { storageState: state } : {}) });
        await this.watchContext(context, this.options.headless === true);
        const headless = session.context;
        session.context = context;
        session.chromeBrowser = browser;
        session.savedState = state;
        session.inChrome = true;
        await this.reopenTabs(session, addresses);
        await headless.close().catch(() => {});
        browser.on('disconnected', () => {
          if (session.chromeBrowser === browser) void this.windowClosed(session, context);
        });
      }
    } finally {
      session.switching = false;
    }
    await this.bringForward(session);
  }

  /** Brings the run's tabs back from the Chrome window into the headless browser, where the live view shows them. */
  private async toHeadless(session: RunSession) {
    if (!session.inChrome) return;
    const addresses = this.currentAddresses(session);
    session.switching = true;
    try {
      if (!session.ownsContext) {
        if (this.signIn.has(session.profileId)) {
          // The window is the person's, open to sign in; the run keeps using it as it did before.
          session.inChrome = false;
        } else {
          const windowed = session.context;
          this.profiles.delete(session.profileId);
          await windowed.close().catch(() => {});
          session.context = await this.profileContext(session.profileId, false);
          session.inChrome = false;
          await this.reopenTabs(session, addresses);
        }
      } else {
        const state = await session.context.storageState().catch(() => session.savedState);
        const browser = session.chromeBrowser;
        session.chromeBrowser = undefined;
        session.context = await this.cleanContext(session, state);
        session.inChrome = false;
        session.savedState = undefined;
        await this.reopenTabs(session, addresses);
        this.closeLater(browser);
      }
    } finally {
      session.switching = false;
    }
    await this.restartStream(session);
  }

  /**
   * The person closed the Chrome window the run's tabs were in, or a signed-in window a run shared. The run goes on
   * headless at the addresses its tabs were at, and a browser the person held counts as handed back. Its tabs and the
   * browser both report the close, in either order; only the first report for the context the run is in moves it.
   */
  private async windowClosed(session: RunSession, closed: BrowserContext) {
    if (this.runs.get(session.runId) !== session || session.switching || session.context !== closed) return;
    const wasHeld = session.held && session.inChrome;
    const addresses = this.currentAddresses(session);
    session.switching = true;
    try {
      if (session.ownsContext) {
        const state = await session.context.storageState().catch(() => session.savedState);
        const chrome = session.chromeBrowser;
        session.chromeBrowser = undefined;
        session.inChrome = false;
        session.context = await this.cleanContext(session, state);
        this.closeLater(chrome);
      } else {
        const closing = session.context;
        const current = await this.profiles.get(session.profileId)?.catch(() => undefined);
        if (current === closing) {
          this.profiles.delete(session.profileId);
          this.windowedProfiles.delete(session.profileId);
          this.signIn.delete(session.profileId);
        }
        await closing.close().catch(() => {});
        session.inChrome = false;
        session.context = await this.profileContext(session.profileId, false);
      }
      session.savedState = undefined;
      await this.reopenTabs(session, addresses);
    } catch {
      this.forgetRun(session);
      return;
    } finally {
      session.switching = false;
    }
    await this.restartStream(session);
    if (wasHeld) this.emit({ kind: 'released', runId: session.runId });
  }

  /**
   * A view starts, renews or stops watching a run. Watching streams the tab the run last used until the lease runs
   * out; the answer says which tab that is, where the cursor is and what Orglet suggests, so the view can draw them
   * before the first frame.
   */
  private async watch(runId: string, watching: boolean, width: number): Promise<BrowserWatchState> {
    const session = this.runs.get(runId);
    if (!session) return { watching: false, tabId: null, cursor: null, suggestion: null, inChrome: false };
    if (!watching) {
      // Cleared before any wait, so a watch that starts meanwhile (a view that resized) is not undone by this one.
      session.watch = undefined;
      await this.stopStream(session);
    } else {
      const current = session.watch;
      session.watch = { until: Date.now() + BROWSER_WATCH_LEASE_MS, width };
      if (!current || current.width !== width || !session.stream) await this.restartStream(session);
      this.checkLeases();
    }
    const tabId = session.activeTab;
    return {
      watching: session.watch !== undefined, tabId, cursor: tabId ? this.cursors.at(runId, tabId) : null,
      suggestion: this.suggestions.current(runId), inChrome: session.inChrome,
    };
  }

  /** Stops the streams of views that stopped renewing their watch, such as a window that reloaded. */
  private checkLeases() {
    if (this.leaseTimer) return;
    this.leaseTimer = setInterval(() => {
      const now = Date.now();
      let watched = false;
      for (const session of this.runs.values()) {
        if (!session.watch) continue;
        if (session.watch.until > now) {
          watched = true;
          continue;
        }
        session.watch = undefined;
        void this.stopStream(session);
      }
      if (!watched) {
        clearInterval(this.leaseTimer);
        this.leaseTimer = undefined;
      }
    }, LEASE_CHECK_MS);
    this.leaseTimer.unref?.();
  }

  /**
   * Streams the run's active tab to its view, if one watches, after stopping whatever it streamed before. Starts and
   * stops go one at a time, in the order they were asked for.
   */
  private restartStream(session: RunSession): Promise<void> {
    session.streaming = session.streaming.then(async () => {
      const previous = session.stream;
      session.stream = undefined;
      await previous?.stop();
      const watch = session.watch;
      const tabId = session.activeTab;
      const page = tabId ? session.tabs.get(tabId) : undefined;
      if (!watch || !tabId || !page || page.isClosed() || session.inChrome || this.runs.get(session.runId) !== session) return;
      const stream = new FrameStream(page, watch.width, (data, size) => {
        if (session.stream !== stream) return;
        this.emit({ kind: 'frame', runId: session.runId, tabId, data, ...size });
      });
      session.stream = stream;
      await stream.start().catch(() => { if (session.stream === stream) session.stream = undefined; });
    }).catch(() => {});
    return session.streaming;
  }

  private stopStream(session: RunSession): Promise<void> {
    session.streaming = session.streaming.then(async () => {
      const stream = session.stream;
      session.stream = undefined;
      await stream?.stop();
    }).catch(() => {});
    return session.streaming;
  }

  /** The run moved to another tab: a view follows it. */
  private async focusTab(session: RunSession, tabId: string) {
    if (session.activeTab === tabId) return;
    session.activeTab = tabId;
    if (session.watch) await this.restartStream(session);
  }

  /** A tab closed: the view moves to the run's newest remaining tab. */
  private tabGone(session: RunSession, tabId: string) {
    this.cursors.forgetTab(session.runId, tabId);
    session.addresses.delete(tabId);
    if (session.activeTab !== tabId) return;
    session.activeTab = [...session.tabs.keys()].at(-1) ?? null;
    if (session.watch) void this.restartStream(session);
  }

  /**
   * Where the orglet points for a step: the element is scrolled into view and the cursor put on it, in the page's CSS
   * pixels, before the step acts. While a view watches, the step waits a moment so the drawn cursor arrives first.
   */
  private async pointAt(session: RunSession, tabId: string, page: Page, action: BrowserCursorAction, ref: string, signal: AbortSignal) {
    const element = page.locator(`aria-ref=${ref}`);
    await element.scrollIntoViewIfNeeded({ timeout: CURSOR_LOOKUP_MS }).catch(() => {});
    const box = await element.boundingBox({ timeout: CURSOR_LOOKUP_MS }).catch(() => null);
    if (!box) return;
    const cursor = { tabId, ...cursorPointFor(action, box, page.viewportSize() ?? VIEWPORT), action };
    this.cursors.move(session.runId, cursor);
    this.emit({ kind: 'cursor', runId: session.runId, cursor });
    if (session.watch) await delay(BROWSER_CURSOR_LEAD_MS, undefined, { signal });
  }

  /**
   * One click, wheel turn or key from the person's view, while they hold the browser and it is not in Chrome. Events
   * reach the tab one at a time, in the order they came. After a click or a key, Orglet looks at where the page's focus
   * went, to offer Chrome for a password or card field.
   */
  private async input(runId: string, event: BrowserInputEvent) {
    const session = this.runs.get(runId);
    if (!session?.held) throw new Error(NOT_HELD);
    if (session.inChrome) throw new Error(IN_CHROME);
    const page = session.activeTab ? session.tabs.get(session.activeTab) : undefined;
    if (!page || page.isClosed()) throw new Error(NO_TAB);
    const done = session.inputs.then(() => dispatchInput(page, event));
    session.inputs = done.catch(() => {});
    await done;
    if ((event.type === 'mouse' && event.action === 'down') || (event.type === 'key' && event.action === 'down')) this.checkFocusSoon(session, page);
    return { done: true };
  }

  private checkFocusSoon(session: RunSession, page: Page) {
    clearTimeout(session.focusCheck);
    session.focusCheck = setTimeout(() => void this.checkFocus(session, page), FOCUS_CHECK_DELAY_MS);
  }

  private async checkFocus(session: RunSession, page: Page) {
    if (page.isClosed() || !session.held) return;
    for (const frame of page.frames().slice(0, FACT_FRAMES)) {
      const field = await withinFrameTimeout(frame.evaluate(readFocusedField));
      if (!field) continue;
      this.suggest(session, { kind: 'focus', field, held: session.held });
      return;
    }
  }

  /**
   * One step on a page the core has allowed. The page must still be where the core saw it, and the element must
   * still carry the role and name the core judged; otherwise nothing is done and the worker is told to read the page
   * again. After the step the page gets a moment to load, the address it lands on must pass the chat's site rules,
   * and the result says what changed and what the page tried that Orglet stopped.
   */
  private async act(runId: string, tabId: string, policy: BrowserPolicy, step: BrowserActStep, url: string, expect: BrowserExpectedTarget | null, signal: AbortSignal): Promise<BrowserActResult> {
    const page = await this.allowedTab(runId, tabId, policy);
    const session = this.runs.get(runId);
    if (!session) throw new Error(NO_TAB);
    const beforeView = await this.tabView(tabId, page);
    const before = { url: beforeView.url, title: beforeView.title };
    const quiet = { changes: '', changesCut: false, dialogs: [], downloadBlocked: false, popupClosed: false, fileChooser: false };
    // A wait changes nothing, so it only needs the tab; every other step needs the page the core judged.
    if (step.kind !== 'wait' && !sameAddress(page.url(), url)) return { ...beforeView, before, ...quiet, stale: PAGE_MOVED };
    const beforeSnapshot = await page.ariaSnapshot({ mode: 'ai', timeout: STEP_TIMEOUT_MS, signal });
    if (step.kind !== 'wait') {
      const current = step.kind === 'press' ? focusedElement(beforeSnapshot) : snapshotElement(beforeSnapshot, step.ref);
      if (!sameElement(current, expect)) return { ...beforeView, before, ...quiet, stale: ELEMENT_CHANGED };
    }
    const counted = { dialogs: session.dialogCount, downloads: session.downloads, fileChoosers: session.fileChoosers, popups: session.popupsClosed };
    if (step.kind === 'click' || step.kind === 'type' || step.kind === 'select') await this.pointAt(session, tabId, page, step.kind, step.ref, signal);
    await this.perform(page, step, signal);
    await this.settleAfterStep(page, step);
    signal.throwIfAborted();
    if (page.isClosed()) throw new Error(WINDOW_CLOSED);
    const landed = page.url();
    const refusal = landed === 'about:blank' ? undefined : await requestRefusal(landed, session.policy, true, this.resolve);
    const tried = {
      dialogs: session.dialogs.filter(dialog => dialog.number > counted.dialogs).map(dialog => ({ type: dialog.type, message: dialog.message })),
      downloadBlocked: session.downloads > counted.downloads,
      popupClosed: session.popupsClosed > counted.popups,
      fileChooser: session.fileChoosers > counted.fileChoosers,
    };
    if (refusal) {
      await page.goto('about:blank').catch(() => {});
      return { ...await this.tabView(tabId, page), before, changes: '', changesCut: false, ...tried, blocked: refusal };
    }
    const afterSnapshot = await page.ariaSnapshot({ mode: 'ai', timeout: STEP_TIMEOUT_MS, signal }).catch(() => '');
    const changed = newSnapshotLines(beforeSnapshot, afterSnapshot, CHANGED_LINES_CHARACTERS);
    return { ...await this.tabView(tabId, page), before, changes: changed.text, changesCut: changed.cut, ...tried };
  }

  private async perform(page: Page, step: BrowserActStep, signal: AbortSignal) {
    const options = { timeout: STEP_TIMEOUT_MS, signal };
    if (step.kind === 'wait') {
      await delay(step.ms, undefined, { signal });
      return;
    }
    if (step.kind === 'press') {
      await page.keyboard.press(step.key);
      return;
    }
    const element = page.locator(`aria-ref=${step.ref}`);
    if (step.kind === 'click') await element.click(options);
    if (step.kind === 'select') await element.selectOption(step.values, options);
    if (step.kind === 'type') {
      await element.fill(step.text, options);
      if (step.submit) await element.press('Enter', options);
    }
  }

  /** A step that starts loading a page gets up to a few seconds for it; one that only changes the page, a moment. */
  private async settleAfterStep(page: Page, step: BrowserActStep) {
    if (step.kind === 'wait') return;
    await delay(250);
    await page.waitForLoadState('domcontentloaded', { timeout: SETTLE_LOAD_MS }).catch(() => {});
    await page.waitForLoadState('load', { timeout: SETTLE_LOAD_MS }).catch(() => {});
  }

  /** Takes a run off the engine without closing anything; its browser is already gone. */
  private forgetRun(session: RunSession) {
    if (this.runs.get(session.runId) !== session) return;
    this.runs.delete(session.runId);
    void session.stream?.stop();
    session.stream = undefined;
    session.watch = undefined;
    clearTimeout(session.focusCheck);
    session.proxy?.close();
    this.cursors.forgetRun(session.runId);
    this.suggestions.clear(session.runId);
  }

  private async endRun(runId: string) {
    this.heldBeforeOpen.delete(runId);
    const session = this.runs.get(runId);
    if (!session) return;
    this.forgetRun(session);
    session.switching = true;
    if (session.ownsContext) await session.context.close().catch(() => {});
    else for (const page of session.tabs.values()) await page.close().catch(() => {});
    await session.chromeBrowser?.close().catch(() => {});
    this.scheduleIdle();
  }

  /**
   * Opens a named profile in a window so the person can sign in. A profile a run is using headless is locked by that
   * browser, so it cannot open until the run ends, or the person moves the run's tabs into Chrome from its chat.
   */
  private async openProfile(profileId: string) {
    clearTimeout(this.idleTimer);
    const opening = this.profiles.get(profileId);
    if (opening && !this.windowedProfiles.has(profileId)) {
      if ([...this.runs.values()].some(session => session.profileId === profileId)) throw new Error(PROFILE_RUNNING);
      this.profiles.delete(profileId);
      await (await opening.catch(() => undefined))?.close().catch(() => {});
    }
    this.signIn.add(profileId);
    const context = await this.profileContext(profileId, true);
    const page = context.pages()[0] ?? await context.newPage();
    await page.bringToFront().catch(() => {});
    return { opened: true };
  }

  private async closeProfile(profileId: string) {
    if ([...this.runs.values()].some(session => session.profileId === profileId)) throw new Error(PROFILE_IN_USE);
    this.signIn.delete(profileId);
    const opening = this.profiles.get(profileId);
    this.profiles.delete(profileId);
    const context = await opening?.catch(() => undefined);
    await context?.close().catch(() => {});
    return { closed: true };
  }

  /** Once nothing uses the browser, it closes after a quiet minute, so a finished chat leaves nothing running. */
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.runs.size || this.signIn.size) return;
    this.idleTimer = setTimeout(() => void this.closeIdle(), this.options.idleMs ?? 60_000);
    this.idleTimer.unref?.();
  }

  private async closeIdle() {
    if (this.runs.size || this.signIn.size) return;
    // Everything to close is taken off the engine before the first wait, so a run that starts while it closes gets a
    // fresh browser instead of one that is on its way out.
    const profiles = [...this.profiles.values()];
    this.profiles.clear();
    const cleanBrowser = this.cleanBrowser;
    const cleanProxy = this.cleanProxy;
    this.cleanBrowser = undefined;
    this.cleanProxy = undefined;
    for (const opening of profiles) {
      await (await opening.catch(() => undefined))?.close().catch(() => {});
    }
    const browser = await cleanBrowser?.catch(() => undefined);
    await browser?.close().catch(() => {});
    cleanProxy?.close();
  }
}

/** One event from the view, on the tab; Playwright's mouse and keyboard send them as Chrome's input events. */
async function dispatchInput(page: Page, event: BrowserInputEvent) {
  if (event.type === 'mouse') {
    await page.mouse.move(event.x, event.y);
    if (event.action === 'down') await page.mouse.down({ button: event.button, clickCount: event.clickCount });
    if (event.action === 'up') await page.mouse.up({ button: event.button, clickCount: event.clickCount });
    return;
  }
  if (event.type === 'wheel') {
    await page.mouse.move(event.x, event.y);
    await page.mouse.wheel(event.deltaX, event.deltaY);
    return;
  }
  if (event.type === 'text') {
    await page.keyboard.insertText(event.text);
    return;
  }
  // A key Chrome has no name for (a media key, say) is dropped rather than failing the ones after it.
  try {
    if (event.action === 'down') await page.keyboard.down(event.key);
    else await page.keyboard.up(event.key);
  } catch {
    // Nothing to send.
  }
}

/** A frame's answer, or undefined when it does not come within a moment. */
async function withinFrameTimeout<Result>(reading: Promise<Result>): Promise<Result | undefined> {
  const answer = reading.catch(() => undefined);
  return Promise.race([answer, delay(FRAME_FACTS_TIMEOUT_MS).then(() => undefined)]);
}

/** The part of the page a card's picture shows: 720 by 405 pixels around the element, kept inside the viewport. */
function regionAround(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) {
  const width = Math.min(ASKING_PICTURE.width, viewport.width);
  const height = Math.min(ASKING_PICTURE.height, viewport.height);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const x = Math.round(Math.min(Math.max(centreX - width / 2, 0), viewport.width - width));
  const y = Math.round(Math.min(Math.max(centreY - height / 2, 0), viewport.height - height));
  return { x, y, width, height };
}

/** A new run starts with no tabs, nothing held and nothing stopped yet. */
function quietSession(): Pick<RunSession, 'tabs' | 'nextTab' | 'held' | 'inChrome' | 'addresses' | 'switching' | 'activeTab' | 'streaming' | 'inputs' | 'dialogs' | 'dialogCount' | 'downloads' | 'fileChoosers' | 'popupsClosed'> {
  return {
    tabs: new Map(), nextTab: 1, held: false, inChrome: false, addresses: new Map(), switching: false, activeTab: null,
    streaming: Promise.resolve(), inputs: Promise.resolve(), dialogs: [], dialogCount: 0, downloads: 0, fileChoosers: 0, popupsClosed: 0,
  };
}

/** The same page address, whatever its fragment says: a script moving the #part is not a new page. */
function sameAddress(current: string, expected: string): boolean {
  const withoutFragment = (address: string) => address.split('#')[0];
  return withoutFragment(current) === withoutFragment(expected);
}

/** Whether the element found now is the one the core judged: same ref, role and name, or both nothing focused. */
function sameElement(current: SnapshotElement | undefined, expected: BrowserExpectedTarget | null): boolean {
  if (!current || !expected) return !current && !expected;
  // The core keeps names and roles at the lengths the journal holds, so they are compared at those lengths.
  return current.ref === expected.ref && current.role.slice(0, 60) === expected.role && current.name.slice(0, 300) === expected.name;
}

/** A page that did not open, in words the worker and the person can act on; the browser's own code stays at the end. */
function openFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = /net::(ERR_[A-Z_]+)/.exec(message)?.[1];
  if (code === 'ERR_NAME_NOT_RESOLVED') return 'Không tìm thấy trang này (tên miền không tồn tại).';
  if (code === 'ERR_CONNECTION_REFUSED') return 'Trang từ chối kết nối.';
  if (code === 'ERR_INTERNET_DISCONNECTED') return 'Máy đang không có mạng.';
  if (code === 'ERR_INVALID_AUTH_CREDENTIALS') return HTTP_SIGN_IN;
  if (/Timeout/i.test(message)) return 'Trang mở quá lâu nên đã dừng.';
  if (/closed/i.test(message)) return WINDOW_CLOSED;
  if (code) return `Không mở được trang (${code}).`;
  return 'Không mở được trang.';
}

