import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { request as requestHttp, type IncomingHttpHeaders } from 'node:http';
import { request as requestHttps, type RequestOptions } from 'node:https';

export const MAX_WEB_BYTES = 1024 * 1024;
const forbidden = new BlockList();
// Conservative public-web boundary based on the IANA special-purpose registries.
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) forbidden.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) forbidden.addSubnet(network, prefix, 'ipv6');
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');

export function publicWebAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !forbidden.check(address, 'ipv4');
  return family === 6 && globalIpv6.check(address, 'ipv6') && !forbidden.check(address, 'ipv6');
}

export function publicWebUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('URL web không hợp lệ.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || !hostname || hostname === 'localhost' || /\.(?:localhost|local|internal|home|lan)$/.test(hostname)
    || (!isIP(hostname) && !hostname.includes('.')) || (isIP(hostname) && !publicWebAddress(hostname))) {
    throw new Error('Chỉ đọc URL HTTP/HTTPS công khai trên cổng mặc định, không có thông tin đăng nhập.');
  }
  url.hash = '';
  return url;
}

/** A request other than a page read: the web search provider's MCP client posts JSON-RPC (COD-266). */
export type WebRequest = { method: 'POST' | 'DELETE'; headers: Record<string, string>; body?: Buffer };
export type WebConnection = { url: URL; address: LookupAddress; signal: AbortSignal; request?: WebRequest };
/** `cut` marks a body that stopped at the byte limit: the page was longer and only its start was read (COD-266). */
export type WebResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer; cut?: boolean };
export type WebNetwork = {
  resolve: (hostname: string) => Promise<LookupAddress[]>;
  connect: (connection: WebConnection) => Promise<WebResponse>;
};

export function webRequestOptions(connection: WebConnection): RequestOptions & { autoSelectFamily: boolean } {
  return {
    method: connection.request?.method ?? 'GET', agent: false, signal: connection.signal, maxHeaderSize: 16 * 1024, rejectUnauthorized: true,
    family: connection.address.family, autoSelectFamily: false,
    // Resolve once and pin the connection. TLS still verifies the original URL hostname.
    lookup: (_hostname, _options, callback) => callback(null, connection.address.address, connection.address.family),
    headers: connection.request ? requestHeaders(connection.request) : { Accept: 'text/html,text/plain,application/json;q=0.8', 'Accept-Encoding': 'identity', 'User-Agent': 'Orglet/0.2 WebTools' },
  };
}

/** The caller's headers, with the same uncompressed encoding and user agent a page read sends. */
function requestHeaders(request: WebRequest): Record<string, string> {
  const headers: Record<string, string> = { ...request.headers, 'Accept-Encoding': 'identity', 'User-Agent': 'Orglet/0.2 WebTools' };
  if (request.body) headers['Content-Length'] = String(request.body.length);
  return headers;
}

export const webNetwork: WebNetwork = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  connect: connection => new Promise((resolve, reject) => {
    connection.signal.throwIfAborted();
    const request = (connection.url.protocol === 'https:' ? requestHttps : requestHttp)(connection.url,
      webRequestOptions(connection), response => {
        const status = response.statusCode ?? 0;
        response.on('error', reject);
        if ([301, 302, 303, 307, 308].includes(status)) {
          resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        let cut = false;
        // A page over the limit keeps its first MAX_WEB_BYTES and stops reading: modern pages often ship more than
        // 1 MiB of HTML, and refusing them outright lost pages whose text sits near the top (COD-266).
        response.on('data', (chunk: Buffer) => {
          if (cut) return;
          const room = MAX_WEB_BYTES - bytes;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            bytes = MAX_WEB_BYTES;
            cut = true;
            resolve({ status, headers: response.headers, body: Buffer.concat(chunks), cut: true });
            response.destroy();
            return;
          }
          bytes += chunk.length;
          chunks.push(chunk);
        });
        response.on('end', () => { if (!cut) resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }); });
        response.on('aborted', () => { if (!cut) reject(new Error('Kết nối web bị gián đoạn.')); });
      });
    request.on('error', reject);
    request.end(connection.request?.body);
  }),
};

export async function resolveAddress(url: URL, signal: AbortSignal, network: WebNetwork): Promise<LookupAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await network.resolve(hostname);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(address => !publicWebAddress(address.address)
    || isIP(address.address) !== address.family)) throw new Error('Tên miền trỏ tới địa chỉ mạng không được phép.');
  return addresses[0];
}

/** No cookies, provider keys, proxy configuration, scripts or file writes are used here. */
export async function fetchWebText(raw: string, signal: AbortSignal, network: WebNetwork = webNetwork) {
  let url = publicWebUrl(raw);
  const requestedUrl = url.href;
  const redirects: string[] = [];
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const address = await resolveAddress(url, signal, network);
    const response = await network.connect({ url, address, signal });
    signal.throwIfAborted();
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === 3 || !response.headers.location) throw new Error('Trang web chuyển hướng quá nhiều hoặc thiếu đích đến.');
      const next = publicWebUrl(new URL(response.headers.location, url).href);
      if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('Không theo chuyển hướng từ HTTPS xuống HTTP.');
      redirects.push(next.href);
      url = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Trang web trả lỗi HTTP ${response.status}.`);
    const cut = Boolean(response.cut) || response.body.length > MAX_WEB_BYTES;
    const body = response.body.length > MAX_WEB_BYTES ? response.body.subarray(0, MAX_WEB_BYTES) : response.body;
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      throw new Error('Trang web dùng kiểu nén chưa được hỗ trợ.');
    }
    const contentType = response.headers['content-type'] ?? '';
    const mimeType = contentType.split(';')[0].trim().toLowerCase();
    if (!['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xhtml+xml'].includes(mimeType)) {
      throw new Error('Chỉ đọc trang HTML hoặc nội dung văn bản được hỗ trợ.');
    }
    const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
    let content: string;
    // A body cut at the limit may end inside a character; streaming decode leaves that partial character out.
    try { content = new TextDecoder(charset, { fatal: true }).decode(body, { stream: cut }); }
    catch { throw new Error('Không giải mã được văn bản của trang web.'); }
    return { requestedUrl, url: url.href, redirects, mimeType, content, cut };
  }
  throw new Error('Trang web chuyển hướng quá nhiều hoặc thiếu đích đến.');
}
