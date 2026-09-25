import { isIP } from 'node:net';
import { publicWebAddress } from './web-network';
import type { BrowserSite } from '../../shared/browser';
import type { BrowserPolicy } from '../../shared/browser-host';

/**
 * The site rules of Orglet's browser (COD-261), one set for the core, which decides before a step, and for the host,
 * which checks every navigation and request while a page loads. Private addresses follow the same registry as
 * `web_read_url` (web-network.ts); the difference is that a person may allow one exact address, such as
 * localhost:3000, for their own chat.
 */

export const REFUSED_SCHEME = 'Trình duyệt của Orglet chỉ mở trang http và https. Trang cài đặt, tiện ích, tệp trên máy và các loại địa chỉ khác không bao giờ mở được.';
export const REFUSED_CREDENTIALS = 'Không mở địa chỉ có kèm tên đăng nhập hoặc mật khẩu.';
export const REFUSED_BLOCKED = 'Trang này bị chặn trong danh sách trang của chat.';
export const REFUSED_PRIVATE = 'Trang trên máy này hoặc trong mạng nội bộ chỉ mở được khi bạn thêm đúng địa chỉ đó (ví dụ localhost:3000) vào danh sách trang được phép của chat.';
export const REFUSED_RESTRICTED = 'Hồ sơ đã đăng nhập chỉ mở các trang có trong danh sách trang được phép của chat.';
export const REFUSED_INVALID = 'Địa chỉ trang không hợp lệ.';

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };
const PRIVATE_SUFFIXES = /\.(?:localhost|local|internal|home|lan|intranet|corp|home\.arpa)$/;

/** Where a host is: `private` for this computer and local networks, `public` for a public address, `name` for a name DNS has to settle. */
export type HostPlace = 'public' | 'private' | 'name';

export function hostPlace(hostname: string): HostPlace {
  const bare = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(bare)) return publicWebAddress(bare) ? 'public' : 'private';
  if (bare === 'localhost' || PRIVATE_SUFFIXES.test(bare) || !bare.includes('.')) return 'private';
  return 'name';
}

function effectivePort(url: URL): number {
  return url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol] ?? 0;
}

/** The host and port a list entry names; an entry without a port matches the default web ports. */
function entryParts(site: string): { host: string; port: number | null } | undefined {
  try {
    const parsed = new URL(`http://${site}`);
    return { host: parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port: parsed.port ? Number(parsed.port) : null };
  } catch {
    return undefined;
  }
}

/**
 * Whether a list entry covers this address. A public name covers its subdomains too, so blocking "facebook.com" also
 * blocks www.facebook.com. An address on this computer or a local network is matched exactly, host and port, so
 * allowing localhost:3000 never opens localhost:8080.
 */
export function siteCovers(site: string, url: URL): boolean {
  const entry = entryParts(site);
  if (!entry) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const port = effectivePort(url);
  if (entry.port === null ? port !== 80 && port !== 443 : entry.port !== port) return false;
  if (host === entry.host) return true;
  const exactOnly = hostPlace(entry.host) !== 'name';
  return !exactOnly && host.endsWith(`.${entry.host}`);
}

/** What the chat's list says about an address: a matching block wins over a matching allow. */
export function listDecision(url: URL, sites: readonly BrowserSite[]): 'allowed' | 'blocked' | undefined {
  if (sites.some(entry => entry.decision === 'blocked' && siteCovers(entry.site, url))) return 'blocked';
  if (sites.some(entry => entry.decision === 'allowed' && siteCovers(entry.site, url))) return 'allowed';
  return undefined;
}

export type BrowserUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * The core's check before it opens an address. Names are not looked up here; the host looks every one up before the
 * browser connects, and refuses a public-looking name that points into a private network.
 */
export function checkBrowserUrl(raw: string, policy: BrowserPolicy): BrowserUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: REFUSED_INVALID };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: REFUSED_SCHEME };
  if (url.username || url.password) return { ok: false, reason: REFUSED_CREDENTIALS };
  if (!url.hostname) return { ok: false, reason: REFUSED_INVALID };
  const decision = listDecision(url, policy.sites);
  if (decision === 'blocked') return { ok: false, reason: REFUSED_BLOCKED };
  if (hostPlace(url.hostname) === 'private' && decision !== 'allowed') return { ok: false, reason: REFUSED_PRIVATE };
  if (policy.restricted && decision !== 'allowed') return { ok: false, reason: REFUSED_RESTRICTED };
  return { ok: true, url };
}

/** Looks a name up; the host caches the answers. */
export type ResolveAddresses = (hostname: string) => Promise<string[]>;

/**
 * The host's check for one request while a page loads: a navigation, a frame, or anything the page fetches. Returns
 * the reason it is refused, or undefined to let it through. `document` is a page or a frame, which on a signed-in
 * profile must be a listed site too, so a listed page cannot frame a signed-in site the person never named.
 */
export async function requestRefusal(raw: string, policy: BrowserPolicy, document: boolean, resolve: ResolveAddresses): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return REFUSED_INVALID;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return document ? REFUSED_SCHEME : undefined;
  if (url.protocol === 'about:') return url.href === 'about:blank' ? undefined : REFUSED_SCHEME;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return REFUSED_SCHEME;
  if (url.username || url.password) return REFUSED_CREDENTIALS;
  const decision = listDecision(url, policy.sites);
  if (decision === 'blocked') return REFUSED_BLOCKED;
  let place = hostPlace(url.hostname);
  // A site the person listed as allowed is theirs to name; any other name is looked up before the browser connects.
  if (place === 'name' && decision !== 'allowed') {
    let addresses: string[];
    try {
      addresses = await resolve(url.hostname.replace(/\.$/, ''));
    } catch {
      // A name that does not resolve fails in the browser too; nothing private can be reached through it.
      addresses = [];
    }
    if (addresses.some(address => !publicWebAddress(address))) place = 'private';
  }
  if (place === 'private' && decision !== 'allowed') return REFUSED_PRIVATE;
  if (document && policy.restricted && decision !== 'allowed') return REFUSED_RESTRICTED;
  return undefined;
}
