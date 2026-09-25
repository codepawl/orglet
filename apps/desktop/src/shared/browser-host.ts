import { z } from 'zod';
import { BrowserProfileId, BrowserScrollDirection, BrowserSites, BrowserTabId, CLEAN_BROWSER_PROFILE, type BrowserChoice } from './browser';

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

export const BrowserHostRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), runId: RunId, profileId: BrowserProfileId, policy: BrowserPolicy, tabId: BrowserTabId.nullable(), url: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('snapshot'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId }).strict(),
  z.object({ kind: z.literal('screenshot'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId }).strict(),
  z.object({ kind: z.literal('scroll'), runId: RunId, policy: BrowserPolicy, tabId: BrowserTabId, direction: BrowserScrollDirection }).strict(),
  z.object({ kind: z.literal('tabs'), runId: RunId }).strict(),
  z.object({ kind: z.literal('close'), runId: RunId, tabId: BrowserTabId }).strict(),
  /** The run ended: its tabs close, and a Clean context is thrown away with everything the pages stored. */
  z.object({ kind: z.literal('endRun'), runId: RunId }).strict(),
  /** Brings the window of a run's tab to the front, or the newest browser window when no run is named. */
  z.object({ kind: z.literal('show'), runId: RunId.nullable() }).strict(),
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

/** How the core reaches the host: one request, cancelled through the signal. The real one relays through main. */
export type BrowserHost = { request(request: BrowserHostRequest, signal: AbortSignal): Promise<unknown> };
