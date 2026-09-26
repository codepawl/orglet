import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type FileChooser, type Page, type Route } from 'playwright-core';
import {
  BrowserHostRequest, type BrowserActResult, type BrowserActStep, type BrowserExpectedTarget, type BrowserInspectResult, type BrowserPageFacts,
  type BrowserPolicy, type BrowserTabView,
} from '../shared/browser-host';
import { BROWSER_OPEN_TIMEOUT_MS, CLEAN_BROWSER_PROFILE, MAX_BROWSER_TABS, type BrowserInfo } from '../shared/browser';
import { requestRefusal, type ResolveAddresses } from '../core/tools/browser-policy';
import type { DetectedBrowser } from './detect';
import { PolicyProxy } from './proxy';
import { focusedElement, newSnapshotLines, snapshotElement, type SnapshotElement } from './snapshot-lines';
import { CAPTCHA_FRAME, PAYMENT_FRAME, PAYMENT_PATH, readElementFacts, readFrameFacts } from './page-facts';

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
  /** The person has taken this run's browser over: its popups stay open and a file picker is theirs to use. */
  held: boolean;
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
export const PAGE_MOVED = 'Trang đã chuyển sang địa chỉ khác trước bước này nên không làm gì. Đọc lại trang bằng browser_snapshot.';
export const ELEMENT_CHANGED = 'Phần tử này đã đổi hoặc không còn trên trang nên không làm gì. Đọc lại trang bằng browser_snapshot rồi dùng mã mới.';

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
  private profileProxies = new Map<string, PolicyProxy>();
  private signIn = new Set<string>();
  private runs = new Map<string, RunSession>();
  private pageOwners = new WeakMap<Page, RunSession>();
  private fileChooserListeners = new WeakMap<RunSession, (chooser: FileChooser) => void>();
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
        const png = await this.picture(page, request.highlight);
        return { ...await this.tabView(request.tabId, page), png: png.toString('base64') };
      }
      case 'inspect': return this.inspect(request.runId, request.tabId, request.policy, request.ref, signal);
      case 'act': return this.act(request.runId, request.tabId, request.policy, request.step, request.url, request.expect, signal);
      case 'hold': return this.hold(request.runId, request.held);
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
        for (const session of [...this.runs.values()]) {
          if (!session.ownsContext) continue;
          session.proxy?.close();
          this.runs.delete(session.runId);
        }
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
   * page of that context loads. A popup a run's page opens is closed, unless the person has taken the browser over:
   * a sign-in window is theirs to use then. Its requests still follow the run's site rules.
   */
  private async watchContext(context: BrowserContext) {
    await context.route('**/*', route => this.onRoute(context, route));
    context.on('page', page => {
      void this.ownerOfOpener(page).then(owner => {
        if (!owner || owner.held) return;
        owner.popupsClosed += 1;
        void page.close().catch(() => {});
      });
    });
  }

  /**
   * What a run's tab does with the things a page can try on its own. A JavaScript dialog is dismissed and noted,
   * since nothing may answer one; a download is cancelled (the context accepts none) and noted; a file picker is
   * caught before it opens and never filled, unless the person has the browser.
   */
  private watchTab(session: RunSession, page: Page) {
    page.on('dialog', dialog => {
      session.dialogCount += 1;
      session.dialogs.push({ number: session.dialogCount, type: dialog.type().slice(0, 20), message: dialog.message().slice(0, 300) });
      session.dialogs = session.dialogs.slice(-5);
      void dialog.dismiss().catch(() => {});
    });
    page.on('download', download => {
      session.downloads += 1;
      void download.cancel().catch(() => {});
    });
    if (!session.held) page.on('filechooser', this.catchFileChooser(session));
  }

  /** One listener per run, so handing the browser over can take it off every tab and put it back. */
  private catchFileChooser(session: RunSession) {
    let listener = this.fileChooserListeners.get(session);
    if (!listener) {
      listener = () => { session.fileChoosers += 1; };
      this.fileChooserListeners.set(session, listener);
    }
    return listener;
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
      const session: RunSession = { runId, profileId, context, ownsContext: true, tabs: new Map(), nextTab: 1, policy, proxy, ...quietSession() };
      this.runs.set(runId, session);
      return session;
    }
    const context = await this.profileContext(profileId);
    const session: RunSession = { runId, profileId, context, ownsContext: false, tabs: new Map(), nextTab: 1, policy, ...quietSession() };
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
      this.watchTab(session, page);
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

  /**
   * A PNG of what the tab shows. Password fields are painted over, so a picture never shows what someone typed into
   * one. `highlight` scrolls one element into view, outlines it and keeps only the part of the page around it, so
   * the card's small picture still shows the element and its words.
   */
  private async picture(page: Page, highlight?: string): Promise<Buffer> {
    const options = { type: 'png' as const, timeout: STEP_TIMEOUT_MS, animations: 'disabled' as const, caret: 'hide' as const, mask: [page.locator('input[type="password"]')] };
    if (!highlight) return page.screenshot(options);
    const element = page.locator(`aria-ref=${highlight}`);
    await element.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
    const marked = await element.evaluate(node => node.setAttribute('data-orglet-asking', ''), undefined, { timeout: 3_000 }).then(() => true, () => false);
    const box = await element.boundingBox({ timeout: 3_000 }).catch(() => null);
    const viewport = page.viewportSize() ?? VIEWPORT;
    const clip = box ? regionAround(box, viewport) : undefined;
    try {
      return await page.screenshot({ ...options, style: ASKING_OUTLINE, ...(clip ? { clip } : {}) });
    } finally {
      if (marked) await element.evaluate(node => node.removeAttribute('data-orglet-asking'), undefined, { timeout: 3_000 }).catch(() => {});
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
      const reading = frame.evaluate(readFrameFacts).catch(() => undefined);
      const found = await Promise.race([reading, delay(FRAME_FACTS_TIMEOUT_MS).then(() => undefined)]);
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

  /** The person takes a run's browser over, or hands it back. */
  private async hold(runId: string, held: boolean) {
    const session = this.runs.get(runId);
    if (!session) return { shown: false };
    session.held = held;
    const listener = this.catchFileChooser(session);
    for (const page of session.tabs.values()) {
      page.off('filechooser', listener);
      if (!held) page.on('filechooser', listener);
    }
    if (!held) return { shown: false };
    return this.show(runId);
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

/** A new run starts with nothing held and nothing stopped yet. */
function quietSession(): Pick<RunSession, 'held' | 'dialogs' | 'dialogCount' | 'downloads' | 'fileChoosers' | 'popupsClosed'> {
  return { held: false, dialogs: [], dialogCount: 0, downloads: 0, fileChoosers: 0, popupsClosed: 0 };
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
  if (/Timeout/i.test(message)) return 'Trang mở quá lâu nên đã dừng.';
  if (/closed/i.test(message)) return WINDOW_CLOSED;
  if (code) return `Không mở được trang (${code}).`;
  return 'Không mở được trang.';
}
