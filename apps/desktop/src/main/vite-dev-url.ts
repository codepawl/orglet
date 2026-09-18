/** Vite binds 127.0.0.1; Forge still injects localhost. Same port, same loopback. */

const LOOPBACK = new Set(['localhost', '127.0.0.1']);

function port(url: URL) {
  return url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
}

export function preferLoopbackIpv4(href: string) {
  const url = new URL(href);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.href;
}

export function isViteDevRequest(target: URL, dev: URL) {
  if (!['http:', 'ws:'].includes(target.protocol)) return false;
  if (port(target) !== port(dev)) return false;
  if (LOOPBACK.has(dev.hostname) && LOOPBACK.has(target.hostname)) return true;
  return target.hostname === dev.hostname;
}
