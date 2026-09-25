import { z } from 'zod';
import type { ToolCapability } from './tool-policy';

/**
 * Browser use, phase 1: reading pages (COD-261). An orglet opens and reads pages in a real Chrome or Edge window that
 * Orglet starts with a profile of its own, never the person's everyday one. The core decides which site and which step
 * and journals every call; the browser host process only carries it out. docs/browser.md is the user-facing page.
 */

/** The profile that keeps nothing: each run gets a private window context that is thrown away when the run ends. */
export const CLEAN_BROWSER_PROFILE = 'clean';
export const BrowserProfileId = z.union([z.literal(CLEAN_BROWSER_PROFILE), z.uuid()]);
export type BrowserProfileId = z.infer<typeof BrowserProfileId>;
export const BrowserProfileName = z.string().trim().min(1).max(40);

/** Sites one chat may list. */
export const MAX_BROWSER_SITES = 100;
/** Tabs one run may hold open at once. */
export const MAX_BROWSER_TABS = 4;
/** Screenshots one run may keep; each is a PNG of the visible part of the page. */
export const MAX_BROWSER_SCREENSHOTS = 10;
/** Characters of a page snapshot one call returns; the worker asks for the next part with `offset`. */
export const BROWSER_SNAPSHOT_CHARACTERS = 20_000;
/** How long opening a page may take before the call gives up. */
export const BROWSER_OPEN_TIMEOUT_MS = 30_000;

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * A site as the person typed it, reduced to the form the list keeps: the host in lowercase (punycode for a non-ASCII
 * name), plus the port when it is not the scheme's default. "https://Example.com/pricing" becomes "example.com" and
 * "localhost:3000" stays "localhost:3000". Returns undefined for anything that is not a web address.
 */
export function normalizeBrowserSite(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.username || url.password || !url.hostname) return undefined;
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname.startsWith('.')) return undefined;
  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? url.port : '';
  return port ? `${hostname}:${port}` : hostname;
}

const BrowserSiteText = z.string().min(1).max(260).refine(text => normalizeBrowserSite(text) === text, 'Địa chỉ trang không hợp lệ.');
export const BrowserSiteDecision = z.enum(['allowed', 'blocked']);
export type BrowserSiteDecision = z.infer<typeof BrowserSiteDecision>;
/** One site on a chat's list: allowed (needed for this computer, the local network, or a signed-in profile) or blocked. */
export const BrowserSite = z.object({ site: BrowserSiteText, decision: BrowserSiteDecision, addedAt: z.iso.datetime() }).strict();
export type BrowserSite = z.infer<typeof BrowserSite>;
export const BrowserSites = z.array(BrowserSite).max(MAX_BROWSER_SITES)
  .refine(sites => new Set(sites.map(entry => entry.site)).size === sites.length, 'Trang bị trùng trong danh sách.');

/**
 * What one chat's browser uses: which profile, and its site list. Absent on a chat means the Clean profile and an
 * empty list. The level itself is the `browser.read` capability, so it follows the chat's other permissions.
 */
export const BrowserChoice = z.object({ profileId: BrowserProfileId, sites: BrowserSites }).strict();
export type BrowserChoice = z.infer<typeof BrowserChoice>;
export const defaultBrowserChoice = (): BrowserChoice => ({ profileId: CLEAN_BROWSER_PROFILE, sites: [] });

/**
 * What a side thread may use (COD-247): never wider than its main chat. It always uses the main chat's profile, a site
 * is allowed only when both lists allow it, and a site either list blocks is blocked. Read again before every step, so
 * a narrowing in the main chat reaches the side thread at once.
 */
export function narrowBrowserChoice(side: BrowserChoice, main: BrowserChoice): BrowserChoice {
  const mainAllowed = new Set(main.sites.filter(entry => entry.decision === 'allowed').map(entry => entry.site));
  const allowed = side.sites.filter(entry => entry.decision === 'allowed' && mainAllowed.has(entry.site));
  const blocked = [...side.sites, ...main.sites].filter(entry => entry.decision === 'blocked');
  const uniqueBlocked = blocked.filter((entry, index) => blocked.findIndex(other => other.site === entry.site) === index);
  const blockedSites = new Set(uniqueBlocked.map(entry => entry.site));
  const sites = [...uniqueBlocked, ...allowed.filter(entry => !blockedSites.has(entry.site))].slice(0, MAX_BROWSER_SITES);
  return { profileId: main.profileId, sites };
}

/**
 * How far a chat's browser reaches. Cumulative like the working folder's levels: a later "read and act" will include
 * reading. `none` is no browser at all.
 */
export type BrowserLevel = 'none' | 'read';
export const browserLevels: readonly BrowserLevel[] = ['none', 'read'];

export function browserLevelOf(capabilities: readonly ToolCapability[]): BrowserLevel {
  return capabilities.includes('browser.read') ? 'read' : 'none';
}

/** The chat's capabilities with the browser at `level`, every other capability kept as it was. */
export function capabilitiesWithBrowserLevel(capabilities: readonly ToolCapability[], level: BrowserLevel): ToolCapability[] {
  const others = capabilities.filter(capability => capability !== 'browser.read');
  if (level === 'read') return [...others, 'browser.read'];
  return others;
}

/** A tab of one run, named by the run: t1, t2 and so on. A run never sees another run's tabs. */
export const BrowserTabId = z.string().regex(/^t\d{1,3}$/, 'Mã tab không hợp lệ.');

export const BrowserOpenArgs = z.object({ url: z.string().min(1).max(4096), tabId: BrowserTabId.nullable() }).strict();
export const BrowserSnapshotArgs = z.object({ tabId: BrowserTabId, offset: z.number().int().min(0).max(10_000_000) }).strict();
export const BrowserFindArgs = z.object({ tabId: BrowserTabId, query: z.string().trim().min(1).max(200) }).strict();
export const BrowserTabArgs = z.object({ tabId: BrowserTabId }).strict();
export const BrowserScrollDirection = z.enum(['down', 'up', 'top', 'bottom']);
export const BrowserScrollArgs = z.object({ tabId: BrowserTabId, direction: BrowserScrollDirection }).strict();
export const BrowserTabsArgs = z.object({}).strict();

/** Every step a browser tool can take. Phase 1 has only the reading ones; acting adds its own later. */
export const BrowserActionKind = z.enum(['open', 'snapshot', 'find', 'screenshot', 'scroll', 'tabs', 'close']);
export type BrowserActionKind = z.infer<typeof BrowserActionKind>;
/**
 * How much a step could change, decided by the core and never lowered by the model. Every phase 1 step is `read`;
 * `input` and `consequential` are for acting on pages, which is not built yet.
 */
export const BrowserRisk = z.enum(['read', 'input', 'consequential']);
export type BrowserRisk = z.infer<typeof BrowserRisk>;
/** `unknown` is a step the app closed in the middle of; a read step is simply run again. */
export const BrowserOutcome = z.enum(['done', 'refused', 'failed', 'unknown']);
export type BrowserOutcome = z.infer<typeof BrowserOutcome>;

/** One journaled browser step as the chat's Details lists it. */
export const BrowserAction = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  callId: z.string().min(1).max(200),
  tabId: z.string().max(8).nullable(),
  kind: BrowserActionKind,
  origin: z.string().max(300).nullable(),
  target: z.string().max(300).nullable(),
  risk: BrowserRisk,
  outcome: BrowserOutcome,
  screenshotId: z.uuid().nullable(),
  at: z.iso.datetime(),
}).strict();
export type BrowserAction = z.infer<typeof BrowserAction>;

/**
 * A stored screenshot as a message may carry it later: named by the SHA-256 of its bytes, with its type. The same
 * shape as the image slot tool results are getting (COD-260), so a model that can see images can be shown it without
 * changing the journal.
 */
export const BrowserScreenshotRef = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), mime: z.literal('image/png') }).strict();
export type BrowserScreenshotRef = z.infer<typeof BrowserScreenshotRef>;

/** The browser Orglet found on this computer. Chrome is preferred; Edge signs its profiles in to Microsoft sites. */
export type BrowserKind = 'chrome' | 'edge';
export type BrowserInfo = { kind: BrowserKind; name: string; version: string | null };
/** A profile as the window sees it: a name and dates, never its folder. */
export type BrowserProfileView = { id: string; name: string; createdAt: string; lastUsedAt: string | null; open: boolean };
export type BrowserState = { browser: BrowserInfo | null; profiles: BrowserProfileView[] };
