import type { Env } from '../worker-configuration';
import { ListingId, MarketIdempotencyKey, MARKET_REQUEST_LIMIT } from '../../../apps/desktop/src/shared/market';
import { validateMarketSubmission } from '../../../apps/desktop/src/shared/market-publishing';
import { verifyMarketIdentity } from './auth';
import { listingBody, ownerListings, ownerSummaries, submitListing, unpublishListing, MarketOperationError } from './listings';
import { moderationReady } from './moderation';

export type MarketEnvironment = Partial<Omit<Env, 'MARKET_WRITES_ENABLED' | 'MARKET_PUBLIC_PUBLISHING_ENABLED' | 'MARKET_REVIEWER_SUBJECTS'>> & {
  MARKET_WRITES_ENABLED?: string;
  MARKET_PUBLIC_PUBLISHING_ENABLED?: string;
  MARKET_REVIEWER_SUBJECTS?: string;
};

export function privateReply(request: Request, value: unknown, status = 200): Response {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Count actual streamed bytes as well as declared length. Never parse an unbounded envelope. */
export async function readSubmissionBody(request: Request, limit = MARKET_REQUEST_LIMIT): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > limit)) {
    throw new MarketOperationError(413, 'request_size');
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
    throw new MarketOperationError(415, 'content_type');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MarketOperationError(400, 'invalid_submission');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new MarketOperationError(413, 'request_size');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new MarketOperationError(400, 'invalid_submission');
  }
}

function ownerPagination(search: URLSearchParams): { after: string; limit: number } | undefined {
  if ([...search.keys()].some(key => key !== 'limit' && key !== 'cursor')) return undefined;
  if (search.getAll('limit').length > 1 || search.getAll('cursor').length > 1) return undefined;
  const requestedLimit = search.get('limit') ?? '50';
  if (!/^[1-9][0-9]{0,2}$/.test(requestedLimit) || Number(requestedLimit) > 100) return undefined;
  const cursor = search.get('cursor');
  if (cursor === null) return { after: '', limit: Number(requestedLimit) };
  if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  try {
    const after = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const tuple: unknown = JSON.parse(after);
    if (!Array.isArray(tuple) || tuple.length !== 2 || !ListingId.safeParse(tuple[0]).success ||
      !Number.isSafeInteger(tuple[1]) || tuple[1] < 1) return undefined;
    const encoded = btoa(JSON.stringify(tuple)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (encoded !== cursor) return undefined;
    return { after, limit: Number(requestedLimit) };
  } catch {
    return undefined;
  }
}

/** Returns undefined for routes outside the account-owned surface. No test identity injection. */
export async function ownerRoute(request: Request, environment: MarketEnvironment): Promise<Response | undefined> {
  const url = new URL(request.url);
  const create = url.pathname === '/v2/listings';
  const version = /^\/v2\/listings\/([a-z0-9][a-z0-9-]{0,79})\/versions$/.exec(url.pathname);
  const unpublish = /^\/v2\/listings\/([a-z0-9][a-z0-9-]{0,79})\/unpublish$/.exec(url.pathname);
  const ownerList = url.pathname === '/v2/me/listings';
  const ownerSummary = url.pathname === '/v2/me/summary';
  const preview = /^\/v2\/me\/listings\/([a-z0-9][a-z0-9-]{0,79})\/versions\/([1-9][0-9]*)$/.exec(url.pathname);
  if (!create && !version && !unpublish && !ownerList && !ownerSummary && !preview) return undefined;
  const read = ownerList || ownerSummary || Boolean(preview);
  if (read ? request.method !== 'GET' && request.method !== 'HEAD' : request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: read ? 'GET, HEAD' : 'POST', 'Cache-Control': 'no-store' } });
  }
  const authentication = await verifyMarketIdentity(request);
  if (!authentication.ok) {
    return new Response(request.method === 'HEAD' ? null : authentication.response.body, authentication.response);
  }
  const database = environment.MARKET_DB;
  const ready = await moderationReady(database);
  if (!database || !ready || (!read && environment.MARKET_WRITES_ENABLED !== 'true')) {
    return privateReply(request, { code: 'publishing_unavailable' }, 503);
  }
  try {
    if (ownerList) {
      const pagination = ownerPagination(url.searchParams);
      if (!pagination) return privateReply(request, { code: 'invalid_pagination' }, 400);
      return privateReply(request, await ownerListings(database, authentication.identity, pagination.after, pagination.limit));
    }
    if (url.search) return privateReply(request, { code: 'invalid_request' }, 400);
    if (ownerSummary) return privateReply(request, await ownerSummaries(database, authentication.identity, environment.MARKET_WRITES_ENABLED === 'true'));
    if (preview) {
      const versionNumber = Number(preview[2]);
      if (!Number.isSafeInteger(versionNumber)) return privateReply(request, { code: 'not_found' }, 404);
      const body = await listingBody(database, preview[1], versionNumber, authentication.identity.subject);
      if (!body) return privateReply(request, { code: 'not_found' }, 404);
      return new Response(request.method === 'HEAD' ? null : body.bytes, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const key = request.headers.get('idempotency-key');
    if (!MarketIdempotencyKey.safeParse(key).success) return privateReply(request, { code: 'invalid_idempotency_key' }, 400);
    const text = await readSubmissionBody(request);
    if (unpublish) {
      if (text.trim() !== '{}') return privateReply(request, { code: 'invalid_request' }, 400);
      return privateReply(request, await unpublishListing(database, authentication.identity, unpublish[1], key!));
    }
    const content = await validateMarketSubmission(text);
    if (!content.ok) return privateReply(request, { code: 'invalid_submission', diagnostics: content.diagnostics }, 400);
    return privateReply(request, await submitListing(database, authentication.identity, version?.[1] ?? null, key!, content));
  } catch (error) {
    const status = error instanceof MarketOperationError ? error.status : 500;
    const code = error instanceof MarketOperationError ? error.code : 'storage_failed';
    return privateReply(request, { code }, status);
  }
}
