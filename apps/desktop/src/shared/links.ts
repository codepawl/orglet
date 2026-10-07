/**
 * Addresses a chat may open in the person's browser (2026-10-07): web pages and mail only. Anything else a reply could
 * write (`file:`, `javascript:`, an app's own scheme) stays text, so a link can never reach the computer itself.
 */
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ADDRESS_LIMIT = 2048;

/** The address as the browser should get it, or undefined when it is not one a chat may open. */
export function openableUrl(text: string): string | undefined {
  if (text.length > ADDRESS_LIMIT) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!OPENABLE_PROTOCOLS.has(url.protocol)) return undefined;
  if (url.protocol !== 'mailto:' && !url.hostname) return undefined;
  if (url.username || url.password) return undefined;
  return url.toString();
}

/** The site a link goes to, as a short name beside a link whose text says something else. */
export function linkHost(address: string): string {
  const url = new URL(address);
  if (url.protocol === 'mailto:') return url.pathname;
  return url.hostname.replace(/^www\./, '');
}
