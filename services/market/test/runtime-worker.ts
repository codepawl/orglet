import type { Env } from '../worker-configuration';
import worker from '../src/index';
import { submitListing, unpublishListing, listingBody, approvedListings, ownerListings, ownerSummaries, MarketOperationError } from '../src/listings';
import { validateMarketSubmission } from '../../../apps/desktop/src/shared/market-publishing';
import { joinBody } from '../src/content';
import { reviewDetail, reviewQueue, reviewReports, reviewAudit, reportVersion, decideVersion, resolveReport } from '../src/moderation';

/** Repository-only test bundle. No bearer tokens, signature bypass or production route installs. */
export default {
  async fetch(request: Request, environment: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/repository-fixture')) return worker.fetch(request, environment);
    const input = await request.json() as {
      operation: string; owner: string; target: string | null; key: string; text: string;
      now?: number; version: number; cap?: number;
      after?: string; limit?: number; publishingEnabled?: boolean;
      input?: unknown; configuration?: string; cursor?: string;
      chunks?: { ordinal: number; body: number[] }[];
      expected?: { body_bytes: number; chunk_count: number; body_sha256: string };
    };
    const identity = { subject: input.owner, grantId: 'fixture-family', displayName: 'Fixture publisher', publishedListings: input.cap ?? 10 };
    try {
      const configuration = input.configuration ?? '["fixture-reviewer"]';
      if (input.operation === 'review-detail') return Response.json(await reviewDetail(environment.MARKET_DB, identity, configuration, input.target!, input.version));
      if (input.operation === 'review-queue') return Response.json(await reviewQueue(environment.MARKET_DB, identity, configuration, input.cursor));
      if (input.operation === 'review-reports') return Response.json(await reviewReports(environment.MARKET_DB, identity, configuration, input.target!, input.version, input.cursor));
      if (input.operation === 'review-audit') return Response.json(await reviewAudit(environment.MARKET_DB, identity, configuration, input.target!, input.version, input.cursor));
      if (input.operation === 'report') return Response.json(await reportVersion(environment.MARKET_DB, identity, input.input, input.key, input.now));
      if (input.operation === 'decision') return Response.json(await decideVersion(environment.MARKET_DB, identity, configuration, input.input, input.key, input.now));
      if (input.operation === 'resolve-report') return Response.json(await resolveReport(environment.MARKET_DB, identity, configuration, input.input, input.key, input.now));
      if (input.operation === 'integrity') return new Response(await joinBody(input.chunks!, input.expected!));
      if (input.operation === 'validate') return Response.json(await validateMarketSubmission(input.text));
      if (input.operation === 'submit') {
        const content = await validateMarketSubmission(input.text);
        if (!content.ok) return Response.json(content, { status: 400 });
        return Response.json(await submitListing(environment.MARKET_DB, identity, input.target, input.key, content, input.now));
      }
      if (input.operation === 'unpublish') return Response.json(await unpublishListing(environment.MARKET_DB, identity, input.target!, input.key));
      if (input.operation === 'public') return Response.json(await approvedListings(environment.MARKET_DB, '', 100));
      if (input.operation === 'owner') return Response.json(await ownerListings(environment.MARKET_DB, identity, input.after ?? '', input.limit ?? 100));
      if (input.operation === 'summary') return Response.json(await ownerSummaries(environment.MARKET_DB, identity, input.publishingEnabled));
      const body = await listingBody(environment.MARKET_DB, input.target!, input.version, input.operation === 'preview' ? input.owner : undefined);
      return body ? new Response(body.bytes, { headers: { ETag: body.hash } }) : new Response(null, { status: 404 });
    } catch (error) {
      return Response.json({ code: error instanceof MarketOperationError ? error.code : 'fixture_failed' }, {
        status: error instanceof MarketOperationError ? error.status : 500,
      });
    }
  },
};
