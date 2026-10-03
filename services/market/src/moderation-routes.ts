import { z } from 'zod';
import { MarketIdempotencyKey } from '../../../apps/desktop/src/shared/market';
import { MarketReportInput, MarketDecisionInput, MarketResolveInput, MARKET_MODERATION_REQUEST_LIMIT } from '../../../apps/desktop/src/shared/market-moderation';
import { verifyMarketIdentity } from './auth';
import { MarketOperationError } from './listings';
import { privateReply, readSubmissionBody, type MarketEnvironment } from './owner-routes';
import { canReview, reviewerSubjects, moderationReady, publicPublishingReady, reviewQueue, reviewDetail, reviewBody, reviewReports, reviewAudit, reportVersion, decideVersion, resolveReport } from './moderation';

function pagination(search: URLSearchParams): string | undefined {
  if ([...search.keys()].some(key => key !== 'cursor') || search.getAll('cursor').length > 1) throw new MarketOperationError(400, 'invalid_pagination');
  const cursor = search.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 256)) throw new MarketOperationError(400, 'invalid_pagination');
  return cursor ?? undefined;
}

export async function moderationRoute(request: Request, environment: MarketEnvironment): Promise<Response | undefined> {
  const url = new URL(request.url);
  const capability = url.pathname === '/v2/me/moderation';
  const queue = url.pathname === '/v2/review/queue';
  const detail = /^\/v2\/review\/listings\/([a-z0-9][a-z0-9-]{0,79})\/versions\/([1-9][0-9]*)(?:\/(body|reports|audit|decision))?$/.exec(url.pathname);
  const report = /^\/v2\/listings\/([a-z0-9][a-z0-9-]{0,79})\/versions\/([1-9][0-9]*)\/report$/.exec(url.pathname);
  const resolve = /^\/v2\/review\/reports\/([a-f0-9-]{36})\/resolve$/.exec(url.pathname);
  if (!capability && !queue && !detail && !report && !resolve) return undefined;
  const write = Boolean(report || resolve || detail?.[3] === 'decision');
  if (write ? request.method !== 'POST' : request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: write ? 'POST' : 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  const authentication = await verifyMarketIdentity(request);
  if (!authentication.ok) return new Response(request.method === 'HEAD' ? null : authentication.response.body, authentication.response);
  const identity = authentication.identity;
  const configuration = environment.MARKET_REVIEWER_SUBJECTS;
  const reviewer = canReview(identity, configuration);
  // Every reviewer read and retry checks current configuration before accessing storage.
  if (!capability && !report && !reviewer) return privateReply(request, { code: 'review_forbidden' }, 403);
  const ready = await moderationReady(environment.MARKET_DB);
  const canWrite = ready && environment.MARKET_WRITES_ENABLED === 'true' && reviewerSubjects(configuration) !== undefined;
  if (capability) {
    if (url.search) return privateReply(request, { code: 'invalid_request' }, 400);
    return privateReply(request, { canReview: ready && reviewer, canWrite, canReport: canWrite && await publicPublishingReady(environment) });
  }
  const database = environment.MARKET_DB;
  if (!database || !ready || (write && (!canWrite || (report && !await publicPublishingReady(environment))))) return privateReply(request, { code: 'moderation_unavailable' }, 503);
  try {
    if (queue) return privateReply(request, await reviewQueue(database, identity, configuration, pagination(url.searchParams)));
    if (detail) {
      const version = Number(detail[2]);
      if (!Number.isSafeInteger(version)) throw new MarketOperationError(404, 'not_found');
      if (detail[3] === 'reports') return privateReply(request, await reviewReports(database, identity, configuration, detail[1], version, pagination(url.searchParams)));
      if (detail[3] === 'audit') return privateReply(request, await reviewAudit(database, identity, configuration, detail[1], version, pagination(url.searchParams)));
      if (url.search) throw new MarketOperationError(400, 'invalid_request');
      if (!detail[3]) return privateReply(request, await reviewDetail(database, identity, configuration, detail[1], version));
      if (detail[3] === 'body') {
        const body = await reviewBody(database, identity, configuration, detail[1], version);
        return new Response(request.method === 'HEAD' ? null : body.bytes, { headers: {
          'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        } });
      }
    }
    if (url.search) throw new MarketOperationError(400, 'invalid_request');
    const key = request.headers.get('idempotency-key');
    if (!MarketIdempotencyKey.safeParse(key).success) throw new MarketOperationError(400, 'invalid_idempotency_key');
    let input: unknown;
    try { input = JSON.parse(await readSubmissionBody(request, MARKET_MODERATION_REQUEST_LIMIT)); }
    catch (error) { if (error instanceof MarketOperationError) throw error; throw new MarketOperationError(400, 'invalid_request'); }
    if (report) {
      const parsed = MarketReportInput.parse(input);
      if (parsed.listingId !== report[1] || parsed.version !== Number(report[2])) throw new MarketOperationError(400, 'invalid_request');
      return privateReply(request, await reportVersion(database, identity, parsed, key!));
    }
    if (resolve) {
      const parsed = MarketResolveInput.parse(input);
      if (parsed.reportId !== resolve[1]) throw new MarketOperationError(400, 'invalid_request');
      return privateReply(request, await resolveReport(database, identity, configuration, parsed, key!));
    }
    const parsed = MarketDecisionInput.parse(input);
    if (parsed.expected.listingId !== detail![1] || parsed.expected.version !== Number(detail![2])) throw new MarketOperationError(400, 'invalid_request');
    return privateReply(request, await decideVersion(database, identity, configuration, parsed, key!));
  } catch (error) {
    return privateReply(request, { code: error instanceof MarketOperationError ? error.code : error instanceof z.ZodError ? 'invalid_request' : 'storage_failed' },
      error instanceof MarketOperationError ? error.status : error instanceof z.ZodError ? 400 : 500);
  }
}
