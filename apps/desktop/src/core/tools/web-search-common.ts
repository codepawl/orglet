import type { IncomingHttpHeaders } from 'node:http';
import type { WebSearchResult } from '../../shared/web-tools';
import { MAX_WEB_BYTES, publicWebUrl, resolveAddress, type WebNetwork } from './web-network';

/** The most results any provider hands to a worker, and the longest excerpt (COD-266). */
export const MAX_RESULTS = 10;
export const SNIPPET_CHARACTERS = 300;

/** A failure to reach the provider at all, told apart from an answer the provider gave. */
export class SearchConnectionError extends Error {}

/** Seconds from a Retry-After header, when it gives a plain number. */
export function retryAfterSeconds(value: string | null | undefined): number | undefined {
  const seconds = Number(value);
  if (!value || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/** A short, single-line reason from whatever failed, without a stack and without the key if it was ever in the text. */
export function reasonOf(error: unknown, secret?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (secret) message = message.split(secret).join('…');
  return message.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Lỗi không rõ.';
}

/** Text a search result's excerpt may show: one line, capped. */
export function excerpt(value: unknown): string | undefined {
  const text = Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' ') : typeof value === 'string' ? value : '';
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  const characters = Array.from(line);
  return characters.length > SNIPPET_CHARACTERS ? `${characters.slice(0, SNIPPET_CHARACTERS).join('')}…` : line;
}

/** A result a provider described, kept only when its address is a public web page; the excerpt is the provider's, never Orglet's. */
export function addResult(results: WebSearchResult[], title: string | undefined, url: string | undefined, snippet: string | undefined) {
  if (!url || results.length >= MAX_RESULTS) return;
  let address: string;
  try {
    address = publicWebUrl(url).href;
  } catch {
    return;
  }
  if (results.some(result => result.url === address)) return;
  const name = title?.replace(/\s+/g, ' ').trim().slice(0, 500) || address;
  results.push(snippet ? { title: name, url: address, snippet } : { title: name, url: address });
}

export type SearchJsonRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  /** Sent as JSON. Only a POST has one. */
  body?: unknown;
  /** The key in the headers; scrubbed from any connection error text. */
  secret?: string;
};

export type SearchJsonAnswer = { status: number; retryAfter: number | undefined; json: unknown };

function headerText(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One request to a provider's JSON API through the web tools' own boundary: a public HTTPS address, resolved, checked and
 * pinned, the 1 MiB limit, no cookies, no redirects followed, the caller's signal. An answer that is not JSON comes back
 * with `json` undefined, so the caller can tell "not understood" from a status it knows.
 */
export async function requestSearchJson(network: WebNetwork, signal: AbortSignal, request: SearchJsonRequest): Promise<SearchJsonAnswer> {
  const url = publicWebUrl(request.url);
  if (url.protocol !== 'https:') throw new Error('Tìm kiếm chỉ đi qua HTTPS.');
  signal.throwIfAborted();
  const headers = { Accept: 'application/json', ...request.headers, ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  const body = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body));
  let response;
  try {
    const address = await resolveAddress(url, signal, network);
    response = await network.connect({ url, address, signal, request: { method: request.method, headers, body } });
  } catch (error) {
    signal.throwIfAborted();
    throw new SearchConnectionError(reasonOf(error, request.secret));
  }
  signal.throwIfAborted();
  if (response.cut || response.body.length >= MAX_WEB_BYTES) throw new Error('Kết quả tìm kiếm vượt giới hạn 1 MiB.');
  const encoding = headerText(response.headers, 'content-encoding');
  if (encoding && encoding !== 'identity') throw new Error('Dịch vụ tìm kiếm dùng kiểu nén chưa được hỗ trợ.');
  let json: unknown;
  try {
    json = JSON.parse(response.body.toString('utf8'));
  } catch {
    json = undefined;
  }
  return { status: response.status, retryAfter: retryAfterSeconds(headerText(response.headers, 'retry-after')), json };
}
