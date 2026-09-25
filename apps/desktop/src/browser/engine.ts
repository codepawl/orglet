import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright-core';
import { BrowserHostRequest, type BrowserPolicy, type BrowserTabView } from '../shared/browser-host';
import { BROWSER_OPEN_TIMEOUT_MS, CLEAN_BROWSER_PROFILE, MAX_BROWSER_TABS, type BrowserInfo } from '../shared/browser';
import { requestRefusal, type ResolveAddresses } from '../core/tools/browser-policy';
import type { DetectedBrowser } from './detect';
import { PolicyProxy } from './proxy';

/**
 * The hands of Orglet's browser (COD-261): a real Chrome or Edge driven through playwright-core over a pipe, never
 * a debugging port. The core has decided each step before it arrives; this engine keeps each run to its own tabs,
 * checks every navigation and request against the run's site rules while pages load, and closes a run's tabs when
 * the run ends. It runs in its own process, started by main.
 *
 * Clean runs share one browser process, each in a private context of its own that is thrown away with the run. A
 * named profile is a folder under `profilesRoot` opened as one persistent context; runs and the person share it,
 * each run seeing only the tabs it opened.
 *
 * Two gates check the site rules. Every connection goes through a `PolicyProxy` (one per Clean run, one per named
 * profile), which sees each hop of a redirect and every frame, worker and socket, and refuses private addresses the
 * chat did not list. A request hook refuses a page or frame on a site the chat blocked, or, on a signed-in profile,
 * one it did not list; before a page is read or pictured, every frame on it is checked again.
 */

type RunSession = {
  runId: string;
  profileId: string;
  context: BrowserContext;
  /** A Clean run's private context, closed with the run. */
  ownsContext: boolean;
  tabs: Map<string, Page>;
  nextTab: number;
  policy: BrowserPolicy;
  /** A Clean run's own network gate, closed with it. */
  proxy?: PolicyProxy;
};

export type BrowserEngineOptions = {
  profilesRoot: string;
  browser: () => DetectedBrowser | null;
  /** Hidden windows, for tests only. The app always opens a real window the person can look at. */
  headless?: boolean;
  resolve?: ResolveAddresses;
  /** How long the browser stays open after the last run and sign-in window are done. */
  idleMs?: number;
};

const VIEWPORT = { width: 1280, height: 800 };
/** What a connection nobody claims gets: public sites only. */
const PUBLIC_ONLY: BrowserPolicy = { sites: [], restricted: false };
const DNS_CACHE_MS = 60_000;
const STEP_TIMEOUT_MS = 15_000;
/**
 * Every window starts from these. Edge would otherwise sign a new profile in to the Windows account on its own
 * (measured for COD-261); Playwright's own defaults already turn off extensions, the first-run page and background
 * networking, and keep the "controlled by automated software" bar that tells the person the window is driven.
 */
const LAUNCH_ARGS = ['--disable-features=msImplicitSignin', '--disable-sync', '--no-default-browser-check',
  // WebRTC may only use the proxy, so a page cannot reach the local network over UDP either.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

export const NO_BROWSER = 'Không tìm thấy Chrome hay Edge trên máy này. Cài một trong hai rồi thử lại.';
export const NO_TAB = 'Lần chạy này không có tab đó. Xem các tab bằng browser_tabs.';
export const TOO_MANY_TABS = 'Lần chạy này đã mở đủ tab. Đóng một tab rồi mở tiếp.';
export const PROFILE_IN_USE = 'Một Tí đang dùng hồ sơ này. Đợi lượt chạy xong rồi thử lại.';
export const OTHER_PROFILE = 'Lần chạy này đang dùng một hồ sơ khác. Nhắn tin mới để dùng hồ sơ vừa chọn.';
export const WINDOW_CLOSED = 'Cửa sổ trình duyệt đã đóng. Mở lại trang để tiếp tục.';
export const FRAME_REFUSED = 'Trang này có một khung hiện trang mà luật trang của chat không cho phép, nên không đọc trang này.';

export class BrowserEngine {
  private cleanBrowser?: Promise<Browser>;
  /** The gate the Clean browser process starts with; every Clean context replaces it with its run's own. */
  private cleanProxy?: PolicyProxy;
  private profiles = new Map<string, Promise<BrowserContext>>();
  private profileProxies = new Map<string, PolicyProxy>();
  private signIn = new Set<string>();
  private runs = new Map<string, RunSession>();
  private pageOwners = new WeakMap<Page, RunSession>();
  private dnsCache = new Map<string, { at: number; addresses: string[] }>();
  private idleTimer?: NodeJS.Timeout;
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
        // Password fields are painted over, so a screenshot never shows what someone typed into one.
        const png = await page.screenshot({ type: 'png', timeout: STEP_TIMEOUT_MS, animations: 'disabled', caret: 'hide', mask: [page.locator('input[type="password"]')] });
        return { ...await this.tabView(request.tabId, page), png: png.toString('base64') };
      }
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
        return { closed: true };
      }
      case 'endRun': {
        await this.endRun(request.runId);
        return { ended: true };
      }
      case 'show': return this.show(request.runId);
      case 'openProfile': return this.openProfile(request.profileId);
      case 'closeProfile': return this.closeProfile(request.profileId);
      case 'openProfiles': return [...this.profiles.keys()];
    }
  }

  /** Closes every window this engine opened. */
  async shutdown() {
    clearTimeout(this.idleTimer);
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
  }

  private detected(): DetectedBrowser {
    const found = this.options.browser();
    if (!found) throw new Error(NO_BROWSER);
    return found;
  }

  private launchOptions() {
    const found = this.detected();
    return { executablePath: found.executable, headless: this.options.headless ?? false, args: LAUNCH_ARGS,
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
        for (const session of [...this.runs.values()]) if (session.ownsContext) this.runs.delete(session.runId);
      }), () => { if (this.cleanBrowser === launching) this.cleanBrowser = undefined; });
    }
    return this.cleanBrowser;
  }

  private async launchClean(): Promise<Browser> {
    const options = this.launchOptions();
    this.cleanProxy?.close();
    const proxy = new PolicyProxy(() => PUBLIC_ONLY, this.resolve);
    this.cleanProxy = proxy;
    const server = await proxy.start();
    return chromium.launch({ ...options, proxy: { server } });
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

  /** A named profile's persistent context, opened once and shared by the runs that use it and the person. */
  private async profileContext(profileId: string): Promise<BrowserContext> {
    let opening = this.profiles.get(profileId);
    if (!opening) {
      opening = this.launchProfile(profileId);
      this.profiles.set(profileId, opening);
      const current = opening;
      opening.catch(() => { if (this.profiles.get(profileId) === current) this.profiles.delete(profileId); });
    }
    return opening;
  }

  private async launchProfile(profileId: string): Promise<BrowserContext> {
    const options = this.launchOptions();
    this.profileProxies.get(profileId)?.close();
    const proxy = new PolicyProxy(() => this.profilePolicy(profileId), this.resolve);
    this.profileProxies.set(profileId, proxy);
    const server = await proxy.start();
    const context = await chromium.launchPersistentContext(join(this.options.profilesRoot, profileId), {
      ...options, viewport: null, acceptDownloads: false, serviceWorkers: 'block', proxy: { server },
    });
    await this.watchContext(context);
    context.on('close', () => {
      this.profiles.delete(profileId);
      this.signIn.delete(profileId);
      if (this.profileProxies.get(profileId) === proxy) {
        proxy.close();
        this.profileProxies.delete(profileId);
      }
      for (const session of [...this.runs.values()]) if (session.context === context) this.runs.delete(session.runId);
      this.scheduleIdle();
    });
    return context;
  }

  /**
   * Checks every request of a context against the site rules of the run that owns the page making it, before any
   * page of that context loads. A popup a run's page opens is closed: reading never follows one.
   */
  private async watchContext(context: BrowserContext) {
    await context.route('**/*', route => this.onRoute(context, route));
    context.on('page', page => {
      void this.ownerOfOpener(page).then(owner => {
        if (owner) void page.close().catch(() => {});
      });
    });
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
      const browser = await this.clean();
      const proxy = new PolicyProxy(() => this.runs.get(runId)?.policy ?? PUBLIC_ONLY, this.resolve);
      const server = await proxy.start();
      const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: false, serviceWorkers: 'block', proxy: { server } });
      await this.watchContext(context);
      const session: RunSession = { runId, profileId, context, ownsContext: true, tabs: new Map(), nextTab: 1, policy, proxy };
      this.runs.set(runId, session);
      return session;
    }
    const context = await this.profileContext(profileId);
    const session: RunSession = { runId, profileId, context, ownsContext: false, tabs: new Map(), nextTab: 1, policy };
    this.runs.set(runId, session);
    return session;
  }

  private async open(runId: string, profileId: string, policy: BrowserPolicy, tabId: string | null, url: string, signal: AbortSignal) {
    const session = await this.session(runId, profileId, policy);
    let page: Page;
    let pageTabId: string;
    if (tabId) {
      const existing = session.tabs.get(tabId);
      if (!existing || existing.isClosed()) throw new Error(NO_TAB);
      page = existing;
      pageTabId = tabId;
    } else {
      if (session.tabs.size >= MAX_BROWSER_TABS) throw new Error(TOO_MANY_TABS);
      const firstWindow = session.ownsContext && session.tabs.size === 0;
      const quietWindow = !this.signIn.has(profileId);
      page = await session.context.newPage();
      pageTabId = `t${session.nextTab}`;
      session.nextTab += 1;
      session.tabs.set(pageTabId, page);
      this.pageOwners.set(page, session);
      page.on('close', () => { if (session.tabs.get(pageTabId) === page) session.tabs.delete(pageTabId); });
      if (!session.ownsContext) await page.setViewportSize(VIEWPORT).catch(() => {});
      // The window is real and stays reachable from the taskbar and from Details, but it opens out of the way.
      if (firstWindow || (!session.ownsContext && quietWindow && session.context.pages().length === 1)) await this.setWindowState(page, 'minimized');
    }
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
    return page;
  }

  private async tabView(tabId: string, page: Page): Promise<BrowserTabView> {
    const title = await page.title().catch(() => '');
    return { tabId, url: page.url(), title: title.slice(0, 300) };
  }

  private async endRun(runId: string) {
    const session = this.runs.get(runId);
    if (!session) return;
    this.runs.delete(runId);
    if (session.ownsContext) await session.context.close().catch(() => {});
    else for (const page of session.tabs.values()) await page.close().catch(() => {});
    session.proxy?.close();
    this.scheduleIdle();
  }

  private async show(runId: string | null) {
    const session = runId ? this.runs.get(runId) : undefined;
    const page = session ? [...session.tabs.values()].at(-1) : await this.newestPage();
    if (!page) return { shown: false };
    await this.setWindowState(page, 'normal');
    await page.bringToFront().catch(() => {});
    return { shown: true };
  }

  private async newestPage(): Promise<Page | undefined> {
    for (const session of [...this.runs.values()].reverse()) {
      const page = [...session.tabs.values()].at(-1);
      if (page) return page;
    }
    for (const opening of this.profiles.values()) {
      const context = await opening.catch(() => undefined);
      const page = context?.pages().at(-1);
      if (page) return page;
    }
    return undefined;
  }

  private async openProfile(profileId: string) {
    this.signIn.add(profileId);
    clearTimeout(this.idleTimer);
    const context = await this.profileContext(profileId);
    const page = context.pages()[0] ?? await context.newPage();
    await this.setWindowState(page, 'normal');
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

  /** Once nothing uses the browser, it closes after a quiet minute, so a finished chat leaves no window behind. */
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.runs.size || this.signIn.size) return;
    this.idleTimer = setTimeout(() => void this.closeIdle(), this.options.idleMs ?? 60_000);
    this.idleTimer.unref?.();
  }

  private async closeIdle() {
    if (this.runs.size || this.signIn.size) return;
    for (const [profileId, opening] of [...this.profiles]) {
      this.profiles.delete(profileId);
      await (await opening.catch(() => undefined))?.close().catch(() => {});
    }
    const browser = await this.cleanBrowser?.catch(() => undefined);
    this.cleanBrowser = undefined;
    await browser?.close().catch(() => {});
    this.cleanProxy?.close();
    this.cleanProxy = undefined;
  }

  private async setWindowState(page: Page, state: 'minimized' | 'normal') {
    if (this.options.headless) return;
    const session = await page.context().newCDPSession(page).catch(() => undefined);
    if (!session) return;
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: state } });
    } catch {
      // A window the person already closed or moved to another state is left as it is.
    } finally {
      await session.detach().catch(() => {});
    }
  }
}

/** A page that did not open, in words the worker and the person can act on; the browser's own code stays at the end. */
function openFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = /net::(ERR_[A-Z_]+)/.exec(message)?.[1];
  if (code === 'ERR_NAME_NOT_RESOLVED') return 'Không tìm thấy trang này (tên miền không tồn tại).';
  if (code === 'ERR_CONNECTION_REFUSED') return 'Trang từ chối kết nối.';
  if (code === 'ERR_INTERNET_DISCONNECTED') return 'Máy đang không có mạng.';
  if (/Timeout/i.test(message)) return 'Trang mở quá lâu nên đã dừng.';
  if (/closed/i.test(message)) return WINDOW_CLOSED;
  if (code) return `Không mở được trang (${code}).`;
  return 'Không mở được trang.';
}
