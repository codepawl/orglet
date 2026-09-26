import type { BrowserKind } from '../shared/browser';

/**
 * How Orglet starts Chrome or Edge (COD-261). A run's browser has no window: it is Chrome's own headless mode, with
 * the user agent the same browser sends when it has a window. Nothing else about automation is hidden:
 * `navigator.webdriver` stays true and the AutomationControlled feature is left alone. A window opens only for the
 * person, to sign in to a profile or when they choose Open in Chrome.
 *
 * Measured on Windows 11 with Chrome 153 against 23 sites (2026-09-26): headless with the plain headless user agent
 * was refused by X and Ticketmaster and challenged more often; with the headed user agent it did as well as a real
 * window, and unlike a minimized window it never took the foreground and never stalled a click.
 */

/**
 * The features playwright-core 1.63 turns off with its own `--disable-features`. Chrome keeps only the last
 * `--disable-features` on its command line, so Orglet's list has to repeat these: with Orglet's alone, HTTPS upgrades,
 * Translate and paint holding came back on (measured for COD-261: `http://example.com` opened as https). A test checks
 * this list against the switches Playwright really passes.
 */
export const PLAYWRIGHT_DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider', 'GlobalMediaControls',
  'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding', 'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect', 'Translate', 'AutoDeElevate', 'OptimizationHints', 'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
];
/** Edge would otherwise sign a new profile in to the Windows account on its own (measured for COD-261). */
const ORGLET_DISABLED_FEATURES = ['msImplicitSignin'];
/**
 * Every browser starts from these. Playwright's own defaults already turn off extensions, the first-run page and
 * background networking, and keep the "controlled by automated software" bar on a window the person sees.
 */
export const LAUNCH_ARGS = [`--disable-features=${[...PLAYWRIGHT_DISABLED_FEATURES, ...ORGLET_DISABLED_FEATURES].join(',')}`,
  '--disable-sync', '--no-default-browser-check',
  // WebRTC may only use the proxy, so a page cannot reach the local network over UDP either.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

const PLATFORM_TOKENS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
};

/**
 * The user agent the browser sends with a window, for a browser of this kind and version on this system: Chrome
 * reduces it to the major version and a fixed platform token, and Edge adds its own token. Undefined when the version
 * is not known yet.
 */
export function headedUserAgent(kind: BrowserKind, version: string | null, platform: NodeJS.Platform = process.platform): string | undefined {
  const major = version ? /^(\d+)\./.exec(version)?.[1] : undefined;
  if (!major) return undefined;
  const platformToken = PLATFORM_TOKENS[platform] ?? PLATFORM_TOKENS.linux!;
  const chrome = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  return kind === 'edge' ? `${chrome} Edg/${major}.0.0.0` : chrome;
}

/**
 * The switches for one launch: headless for a run, a window for the person. The user agent is passed as a switch,
 * not as a context's `userAgent` option, which would leave the client hints (`Sec-CH-UA`, `navigator.userAgentData`)
 * saying one thing and the header another.
 */
export function launchArgs(headless: boolean, userAgent: string | undefined): string[] {
  if (!headless || !userAgent) return LAUNCH_ARGS;
  return [...LAUNCH_ARGS, `--user-agent=${userAgent}`];
}
