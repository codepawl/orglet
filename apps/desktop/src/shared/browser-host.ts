import { z } from 'zod';
import { BrowserKey, BrowserProfileId, BrowserRef, BrowserScrollDirection, BrowserSites, BrowserTabId, CLEAN_BROWSER_PROFILE, MAX_BROWSER_TYPED_CHARACTERS, MAX_BROWSER_WAIT_MS, type BrowserChoice } from './browser';
import { BrowserCursor, BrowserCursorAction, BrowserInputEvent, BrowserSuggestion } from './browser-live';

/**
 * What the core asks of the browser host process, and what main asks of it for Settings (COD-261). The core has
 * already decided the step is allowed; the host checks every navigation and request against the same site rules
 * while the page loads, because a page can redirect or load things the core never saw.
 */

/**
 * The rules the host applies to one run's pages. `restricted` is a profile the person signed in to: its pages open
 * only on sites the list allows, so a page cannot steer the orglet into a signed-in site the person did not name.
 */
export const BrowserPolicy = z.object({ sites: BrowserSites, restricted: z.boolean() }).strict();
export type BrowserPolicy = z.infer<typeof BrowserPolicy>;

export function browserPolicyOf(choice: BrowserChoice): BrowserPolicy {
  return { sites: choice.sites, restricted: choice.profileId !== CLEAN_BROWSER_PROFILE };
}

const RunId = z.uuid();

/** One step on a page, as the core decided it may run. */
export const BrowserActStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), ref: BrowserRef }).strict(),
  z.object({ kind: z.literal('type'), ref: BrowserRef, text: z.string().max(MAX_BROWSER_TYPED_CHARACTERS), submit: z.boolean() }).strict(),
  z.object({ kind: z.literal('select'), ref: BrowserRef, values: z.array(z.string().min(1).max(200)).min(1).max(20) }).strict(),
  z.object({ kind: z.literal('press'), key: BrowserKey }).strict(),
  z.object({ kind: z.literal('wait'), ms: z.number().int().min(100).max(MAX_BROWSER_WAIT_MS) }).strict(),
]);
export type BrowserActStep = z.infer<typeof BrowserActStep>;

/**
 * The element the core classified, which must still be there, with the same role and name, when the step runs: a page
 * that swapped "Next" for "Place order" while the person was being asked gets a new snapshot, not a click.
 */
export const BrowserExpectedTarget = z.object({ ref: BrowserRef, role: z.string().max(60), name: z.string().max(300) }).strict();
export type BrowserExpectedTarget = z.infer<typeof BrowserExpectedTarget>;

export const BrowserHostRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), runId: RunId, profileId: BrowserProfileId, policy: BrowserPolicy, tabId: BrowserTabId.nullable(), url: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('snapshot'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId }).strict(),
  /**
   * `highlight` outlines one element in the picture, for the card that asks the person about it; `pointer` also puts
   * the orglet's cursor on it, as the step it asks about would.
   */
  z.object({ kind: z.literal('screenshot'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId, highlight: BrowserRef.optional(), pointer: BrowserCursorAction.optional() }).strict(),
  /** What the page reports about an element before a step on it (`ref` null: the focused one, for a key press). */
  z.object({ kind: z.literal('inspect'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId, ref: BrowserRef.nullable() }).strict(),
  /** Acts on a page; `url` and `expect` are what the core saw when it decided, and the host checks both again first. */
  z.object({ kind: z.literal('act'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId, step: BrowserActStep, url: z.string().max(4096), expect: BrowserExpectedTarget.nullable() }).strict(),
  /**
   * The person takes the run's browser over (its popups stay open and its steps wait) or hands it back. `inChrome`
   * moves the run's tabs into a Chrome window for them; without it they use the live view in Orglet, and a run that
   * was in Chrome goes back to the headless browser.
   */
  z.object({ kind: z.literal('hold'), runId: RunId, held: z.boolean(), inChrome: z.boolean() }).strict(),
  /**
   * A view in the window starts or stops watching a run's browser, or renews its watch. `width` is how many pixels
   * wide the view draws the page, so frames are no larger than it needs.
   */
  z.object({ kind: z.literal('watch'), runId: RunId, watching: z.boolean(), width: z.number().int().min(160).max(4096) }).strict(),
  /** A click, a wheel turn or a key the person gave the live view; only accepted while they hold the browser. */
  z.object({ kind: z.literal('input'), runId: RunId, event: BrowserInputEvent }).strict(),
  z.object({ kind: z.literal('scroll'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId, direction: BrowserScrollDirection }).strict(),
  z.object({ kind: z.literal('tabs'), runId: RunId }).strict(),
  z.object({ kind: z.literal('close'), runId: RunId, tabId: BrowserTabId }).strict(),
  /** The run ended: its tabs close, and a Clean context is thrown away with everything the pages stored. */
  z.object({ kind: z.literal('endRun'), runId: RunId }).strict(),
  z.object({ kind: z.literal('detect') }).strict(),
  /** Opens a named profile in a normal window so the person can sign in to sites themselves. */
  z.object({ kind: z.literal('openProfile'), profileId: z.uuid() }).strict(),
  /** Closes a named profile's window, so its folder can be cleared or deleted. Refused while a run uses it. */
  z.object({ kind: z.literal('closeProfile'), profileId: z.uuid() }).strict(),
  z.object({ kind: z.literal('openProfiles') }).strict(),
]);
export type BrowserHostRequest = z.infer<typeof BrowserHostRequest>;

/** A tab as a run sees it. */
export const BrowserTabView = z.object({ tabId: BrowserTabId, url: z.string(), title: z.string() }).strict();
export type BrowserTabView = z.infer<typeof BrowserTabView>;

/** `blocked` is set when the page, or a redirect on the way to it, went somewhere the site rules refuse. */
export const BrowserOpenResult = BrowserTabView.extend({ status: z.number().int().nullable(), blocked: z.string().max(500).optional() }).strict();
export const BrowserSnapshotResult = BrowserTabView.extend({ snapshot: z.string() }).strict();
export const BrowserScreenshotResult = BrowserTabView.extend({ png: z.string() }).strict();
export const BrowserScrollResult = BrowserTabView.extend({ scrollY: z.number(), scrollHeight: z.number(), viewportHeight: z.number() }).strict();
export const BrowserTabsResult = z.object({ tabs: z.array(BrowserTabView) }).strict();

/**
 * What the page says about one element, read by the host and judged by the core (`classifyBrowserStep`). Role and
 * name come from the snapshot the host takes just before, so they are what the worker was shown.
 */
export const BrowserTargetFacts = z.object({
  ref: BrowserRef,
  role: z.string().max(60),
  name: z.string().max(300),
  tag: z.string().max(40),
  /** An input's type ("password", "file", "search"), lowercased; null for any other element. */
  inputType: z.string().max(40).nullable(),
  autocomplete: z.string().max(200).nullable(),
  /** The element's name and id attributes, for card fields that say what they are only there. */
  fieldName: z.string().max(300).nullable(),
  editable: z.boolean(),
  /** Clicking it, or pressing Enter in it, sends its form. */
  submits: z.boolean(),
  form: z.object({ method: z.enum(['get', 'post', 'dialog']), hasPassword: z.boolean(), submitName: z.string().max(300).nullable() }).strict().nullable(),
  link: z.object({ href: z.string().max(2000), download: z.boolean() }).strict().nullable(),
  /** The element sits inside a CAPTCHA widget. */
  inCaptcha: z.boolean(),
}).strict();
export type BrowserTargetFacts = z.infer<typeof BrowserTargetFacts>;

/**
 * What the whole page shows, across its frames: a visible password field, a visible card field, signs of a payment
 * page (a payment provider's frame, or an address like /checkout), and a CAPTCHA.
 */
export const BrowserPageFacts = z.object({ passwordField: z.boolean(), cardField: z.boolean(), payment: z.boolean(), captcha: z.boolean() }).strict();
export type BrowserPageFacts = z.infer<typeof BrowserPageFacts>;

/** `target` null: the ref is not on the page any more, or, for a key press, nothing is focused. */
export const BrowserInspectResult = BrowserTabView.extend({ target: BrowserTargetFacts.nullable(), page: BrowserPageFacts }).strict();
export type BrowserInspectResult = z.infer<typeof BrowserInspectResult>;

/**
 * What one step did: where the page is now and was before, the snapshot lines that are new since (cut at a limit),
 * and anything the page tried that Orglet stopped: a dialog it dismissed, a download, a popup it closed, a file
 * picker it never filled. `stale` means the page changed before the step and nothing was done.
 */
export const BrowserActResult = BrowserTabView.extend({
  before: z.object({ url: z.string(), title: z.string() }).strict(),
  changes: z.string(),
  changesCut: z.boolean(),
  dialogs: z.array(z.object({ type: z.string().max(20), message: z.string().max(300) }).strict()).max(5),
  downloadBlocked: z.boolean(),
  popupClosed: z.boolean(),
  fileChooser: z.boolean(),
  blocked: z.string().max(500).optional(),
  stale: z.string().max(500).optional(),
}).strict();
export type BrowserActResult = z.infer<typeof BrowserActResult>;

/**
 * What the host tells main without being asked, for the window or the core: a frame of the tab a view watches (JPEG,
 * base64, never kept), where the orglet just pointed, a suggestion to open the page in Chrome, and `released` when the
 * person closed the Chrome window they had been handed, which hands the browser back.
 */
export const BrowserHostEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frame'), runId: RunId, tabId: BrowserTabId, data: z.string().max(12_000_000), width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ kind: z.literal('cursor'), runId: RunId, cursor: BrowserCursor }).strict(),
  z.object({ kind: z.literal('suggest'), runId: RunId, suggestion: BrowserSuggestion }).strict(),
  z.object({ kind: z.literal('released'), runId: RunId }).strict(),
]);
export type BrowserHostEvent = z.infer<typeof BrowserHostEvent>;

export const BrowserHoldResult = z.object({ inChrome: z.boolean() }).strict();

/** How the core reaches the host: one request, cancelled through the signal. The real one relays through main. */
export type BrowserHost = { request(request: BrowserHostRequest, signal: AbortSignal): Promise<unknown> };
