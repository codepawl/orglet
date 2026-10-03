import { z } from 'zod';
import type { D1Database } from '../worker-configuration';
import {
  MarketReportInput, MarketDecisionInput, MarketResolveInput, MarketModerationReceipt,
  MarketReviewDetail, MarketQueuePage, MarketReportsPage, MarketAuditPage,
} from '../../../apps/desktop/src/shared/market-moderation';
import { MarketIdempotencyKey, ListingId, MarketVersion } from '../../../apps/desktop/src/shared/market';
import { canonicalMarketContent } from '../../../apps/desktop/src/shared/market-publishing';
import { MarketOperationError } from './listings';
import { sha256 } from './content';
import type { MarketIdentity } from './auth';
import { joinBody } from './content';

/** Probe the migration contract, including empty databases; a binding alone is not readiness. */
export async function moderationReady(database: D1Database | undefined): Promise<boolean> {
  if (!database) return false;
  try {
    const session = database.withSession('first-primary');
    await session.prepare(`SELECT listings.moderation_hidden,listings.moderation_revision,listings.moderation_reason,
      reviews.review_revision,reviews.reason,reviews.report_count FROM listings
      LEFT JOIN version_reviews AS reviews USING(listing_id) LIMIT 1`).all();
    await session.prepare(`SELECT reports.revision,events.self_review,requests.expected_moderation_revision
      FROM reports LEFT JOIN moderation_events AS events ON events.report_id=reports.report_id
      LEFT JOIN moderation_requests AS requests ON requests.request_id=events.request_id LIMIT 1`).all();
    return true;
  } catch { return false; }
}
export async function publicPublishingReady(environment: {
  MARKET_DB?: D1Database; MARKET_PUBLIC_PUBLISHING_ENABLED?: string; MARKET_REVIEWER_SUBJECTS?: string;
}): Promise<boolean> {
  return environment.MARKET_PUBLIC_PUBLISHING_ENABLED === 'true' && reviewerSubjects(environment.MARKET_REVIEWER_SUBJECTS) !== undefined &&
    await moderationReady(environment.MARKET_DB);
}

const ReviewerSubjects = z.array(z.string().min(1).max(200).refine(value => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value))).min(1).max(32)
  .refine(values => new Set(values).size === values.length);
export function reviewerSubjects(raw: string | undefined): ReadonlySet<string> | undefined {
  if (!raw || raw.length > 8192) return undefined;
  try {
    const result = ReviewerSubjects.safeParse(JSON.parse(raw));
    return result.success ? new Set(result.data) : undefined;
  } catch { return undefined; }
}
export function canReview(identity: MarketIdentity, configuration: string | undefined): boolean {
  return reviewerSubjects(configuration)?.has(identity.subject) === true;
}
function requireReviewer(identity: MarketIdentity, configuration: string | undefined) {
  if (!canReview(identity, configuration)) throw new MarketOperationError(403, 'review_forbidden');
}

type Row = {
  listing_id: string; version: number; metadata_json: string; author_name: string; owner_id: string;
  body_sha256: string; review_digest: string; current_epoch: number; published_version: number | null;
  review_revision: number; moderation_revision: number; moderation_hidden: number; moderation_reason: string;
  state: 'pending' | 'approved' | 'rejected'; reason: string; report_count: number;
};
const detailColumns = `SELECT versions.*, listings.owner_id, listings.publication_epoch AS current_epoch,
  listings.published_version, listings.moderation_revision, listings.moderation_hidden, listings.moderation_reason,
  reviews.state, reviews.review_revision, reviews.reason, reviews.report_count
  FROM listing_versions AS versions JOIN listings USING(listing_id) JOIN version_reviews AS reviews USING(listing_id,version)`;
function detail(row: Row, identity: MarketIdentity) {
  const listing = { ...JSON.parse(row.metadata_json), listingId: row.listing_id, version: row.version,
    author: { displayName: row.author_name }, sha256: row.body_sha256, reviewDigest: row.review_digest };
  return MarketReviewDetail.parse({ listing, expected: {
    listingId: row.listing_id, version: row.version, sha256: row.body_sha256, reviewDigest: row.review_digest,
    publicationEpoch: row.current_epoch, reviewRevision: row.review_revision,
    moderationRevision: row.moderation_revision, publishedVersion: row.published_version,
  }, state: row.state, reason: row.reason, hidden: row.moderation_hidden === 1, hiddenReason: row.moderation_reason,
  selfReview: row.owner_id === identity.subject, reportCount: row.report_count });
}
export async function reviewDetail(database: D1Database, identity: MarketIdentity, configuration: string | undefined, listingId: string, version: number) {
  requireReviewer(identity, configuration);
  ListingId.parse(listingId); MarketVersion.parse(version);
  const row = await database.withSession('first-primary').prepare(`${detailColumns} WHERE versions.listing_id=? AND versions.version=?`)
    .bind(listingId, version).first<Row>();
  if (!row) throw new MarketOperationError(404, 'not_found');
  return detail(row, identity);
}
/** Reviewer-only reconstruction. No caller-controlled owner override or public visibility shortcut. */
export async function reviewBody(database: D1Database, identity: MarketIdentity, configuration: string | undefined, listingId: string, version: number) {
  requireReviewer(identity, configuration);
  ListingId.parse(listingId); MarketVersion.parse(version);
  const session = database.withSession('first-primary');
  const row = await session.prepare('SELECT body_bytes,chunk_count,body_sha256 FROM listing_versions WHERE listing_id=? AND version=?')
    .bind(listingId, version).first<{ body_bytes: number; chunk_count: number; body_sha256: string }>();
  if (!row) throw new MarketOperationError(404, 'not_found');
  const chunks = await session.prepare('SELECT ordinal,body FROM version_body_chunks WHERE listing_id=? AND version=? ORDER BY ordinal')
    .bind(listingId, version).all<{ ordinal: number; body: number[] }>();
  return { bytes: await joinBody(chunks.results, row), hash: row.body_sha256 };
}
const QueueCursor = z.tuple([ListingId, MarketVersion]);
const ReportCursor = z.tuple([z.number().int().nonnegative(), z.string().uuid()]);
function encodeCursor(value: unknown) { return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = schema.parse(JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))));
    if (encodeCursor(value) !== cursor) throw new Error();
    return value;
  } catch { throw new MarketOperationError(400, 'invalid_pagination'); }
}
export async function reviewQueue(database: D1Database, identity: MarketIdentity, configuration: string | undefined, cursor?: string) {
  requireReviewer(identity, configuration);
  const [after, version] = cursor ? decodeCursor(cursor, QueueCursor) : ['', 0];
  const rows = await database.withSession('first-primary').prepare(`${detailColumns}
    WHERE (reviews.state='pending' OR EXISTS (SELECT 1 FROM reports WHERE reports.listing_id=versions.listing_id AND reports.version=versions.version AND reports.status='open')) AND (versions.listing_id > ? OR (versions.listing_id=? AND versions.version > ?))
    ORDER BY versions.listing_id,versions.version LIMIT 21`).bind(after, after, version).all<Row>();
  const page = rows.results.slice(0, 20);
  return MarketQueuePage.parse({ items: page.map(row => detail(row, identity)), nextCursor: rows.results.length > 20 ? encodeCursor([page.at(-1)!.listing_id, page.at(-1)!.version]) : null });
}
export async function reviewReports(database: D1Database, identity: MarketIdentity, configuration: string | undefined, listingId: string, version: number, cursor?: string) {
  requireReviewer(identity, configuration);
  ListingId.parse(listingId); MarketVersion.parse(version);
  const [before, id] = cursor ? decodeCursor(cursor, ReportCursor) : [Number.MAX_SAFE_INTEGER, ''];
  const rows = await database.withSession('first-primary').prepare(`SELECT report_id,listing_id,version,reason,explanation,reference_path,reference_line,status,revision,created_at
    FROM reports WHERE listing_id=? AND version=? AND (created_at < ? OR (created_at=? AND report_id < ?))
    ORDER BY created_at DESC,report_id DESC LIMIT 21`).bind(listingId, version, before, before, id).all<{
      report_id: string; listing_id: string; version: number; reason: string; explanation: string; reference_path: string | null;
      reference_line: number | null; status: string; revision: number; created_at: number;
    }>();
  const page = rows.results.slice(0, 20);
  return MarketReportsPage.parse({ items: page.map(row => ({ id: row.report_id, listingId: row.listing_id, version: row.version,
    reason: row.reason, explanation: row.explanation, ...(row.reference_path !== null ? { reference: { path: row.reference_path, line: row.reference_line } } : {}),
    state: row.status, revision: row.revision, createdAt: row.created_at })),
    nextCursor: rows.results.length > 20 ? encodeCursor([page.at(-1)!.created_at, page.at(-1)!.report_id]) : null });
}

export async function reviewAudit(database: D1Database, identity: MarketIdentity, configuration: string | undefined, listingId: string, version: number, cursor?: string) {
  requireReviewer(identity, configuration);
  ListingId.parse(listingId); MarketVersion.parse(version);
  const [before, id] = cursor ? decodeCursor(cursor, ReportCursor) : [Number.MAX_SAFE_INTEGER, ''];
  const rows = await database.withSession('first-primary').prepare(`SELECT events.request_id,actor_name,decision,reason,events.created_at,self_review,report_id,expected_sha,expected_digest
    FROM moderation_events AS events JOIN moderation_requests AS requests USING(request_id)
    WHERE events.listing_id=? AND events.version=? AND (events.created_at < ? OR (events.created_at=? AND events.request_id < ?))
    ORDER BY events.created_at DESC,events.request_id DESC LIMIT 21`).bind(listingId, version, before, before, id).all<{
      request_id: string; actor_name: string; decision: string; reason: string; created_at: number; self_review: number;
      report_id: string | null; expected_sha: string; expected_digest: string;
    }>();
  const page = rows.results.slice(0, 20);
  return MarketAuditPage.parse({ items: page.map(row => ({ id: row.request_id, actorName: row.actor_name, decision: row.decision,
    reason: row.reason, createdAt: row.created_at, selfReview: row.self_review === 1, reportId: row.report_id, sha256: row.expected_sha, reviewDigest: row.expected_digest })),
    nextCursor: rows.results.length > 20 ? encodeCursor([page.at(-1)!.created_at, page.at(-1)!.request_id]) : null });
}

async function receipt(database: D1Database, actor: string, key: string, digest: string) {
  const row = await database.withSession('first-primary').prepare('SELECT request_digest,receipt_json FROM moderation_requests WHERE actor_id=? AND idempotency_key=?')
    .bind(actor, key).first<{ request_digest: string; receipt_json: string }>();
  if (!row) return undefined;
  if (row.request_digest !== digest) throw new MarketOperationError(409, 'idempotency_conflict');
  return MarketModerationReceipt.parse(JSON.parse(row.receipt_json));
}
function failed(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const failures: [string, number, string][] = [
    ['market_idempotency',409,'idempotency_conflict'], ['market_report_target',409,'report_unavailable'],
    ['market_report_duplicate',409,'already_reported'], ['market_report_rate',429,'report_limit'],
    ['market_stale_review',409,'stale_review'], ['market_stale_report',409,'stale_report'], ['market_hidden',409,'listing_hidden'],
  ];
  for (const [marker, status, code] of failures) if (message.includes(marker)) throw new MarketOperationError(status, code);
  throw new MarketOperationError(500, 'storage_failed');
}
function requestStatement(database: Pick<D1Database, 'prepare'>, identity: MarketIdentity, key: string, digest: string, result: MarketModerationReceipt, exact: {
  sha256: string; reviewDigest: string; publicationEpoch?: number; reviewRevision?: number; moderationRevision?: number; publishedVersion?: number | null;
}, now: number, reportRevision?: number) {
  return database.prepare(`INSERT INTO moderation_requests(request_id,actor_id,idempotency_key,operation,listing_id,version,request_digest,
    expected_sha,expected_digest,expected_epoch,expected_review_revision,expected_moderation_revision,expected_published_version,expected_report_revision,created_at,receipt_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(result.id, identity.subject, key, result.operation, result.listingId, result.version, digest,
    exact.sha256, exact.reviewDigest, exact.publicationEpoch ?? null, exact.reviewRevision ?? null, exact.moderationRevision ?? null, exact.publishedVersion ?? null,
    reportRevision ?? null, now, JSON.stringify(result));
}
export async function reportVersion(database: D1Database, identity: MarketIdentity, raw: unknown, key: string, now = Math.floor(Date.now() / 1000)) {
  const input = MarketReportInput.parse(raw); MarketIdempotencyKey.parse(key);
  const digest = await sha256(new TextEncoder().encode(canonicalMarketContent({ operation: 'report', input })));
  const existing = await receipt(database, identity.subject, key, digest); if (existing) return existing;
  const visible = await database.withSession('first-primary').prepare(`SELECT 1 AS visible FROM listing_versions AS versions JOIN listings USING(listing_id)
    JOIN version_reviews AS reviews USING(listing_id,version) WHERE versions.listing_id=? AND versions.version=?
      AND versions.body_sha256=? AND versions.review_digest=? AND listings.published_version IS NOT NULL
      AND listings.moderation_hidden=0 AND reviews.state='approved'`).bind(input.listingId, input.version, input.sha256, input.reviewDigest).first();
  if (!visible) throw new MarketOperationError(409, 'report_unavailable');
  const result = MarketModerationReceipt.parse({ id: crypto.randomUUID(), operation: 'report', listingId: input.listingId, version: input.version, state: 'accepted', reportId: crypto.randomUUID() });
  const session = database.withSession('first-primary');
  try {
    await session.batch([
      requestStatement(session, identity, key, digest, result, input, now),
      session.prepare(`INSERT INTO reports(report_id,reporter_id,listing_id,version,created_request,created_at,reason,explanation,reference_path,reference_line)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(result.reportId, identity.subject, input.listingId, input.version, result.id, now, input.reason, input.explanation, input.reference?.path ?? null, input.reference?.line ?? null),
    ]);
  } catch (error) { const committed = await receipt(database, identity.subject, key, digest); if (committed) return committed; failed(error); }
  return result;
}
export async function decideVersion(database: D1Database, identity: MarketIdentity, configuration: string | undefined, raw: unknown, key: string, now = Math.floor(Date.now() / 1000)) {
  requireReviewer(identity, configuration);
  const input = MarketDecisionInput.parse(raw); MarketIdempotencyKey.parse(key);
  const digest = await sha256(new TextEncoder().encode(canonicalMarketContent({ operation: input.decision, input })));
  const existing = await receipt(database, identity.subject, key, digest); if (existing) return existing;
  const { expected } = input;
  if (!await database.withSession('first-primary').prepare('SELECT 1 AS present FROM listing_versions WHERE listing_id=? AND version=?').bind(expected.listingId, expected.version).first()) throw new MarketOperationError(404, 'not_found');
  const result = MarketModerationReceipt.parse({ id: crypto.randomUUID(), operation: input.decision, listingId: expected.listingId, version: expected.version,
    state: input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'hidden' });
  const session = database.withSession('first-primary');
  const statements = [requestStatement(session, identity, key, digest, result, expected, now),
    session.prepare(`INSERT INTO moderation_events(request_id,actor_id,actor_name,listing_id,version,decision,reason,created_at,self_review)
      SELECT ?,?,?,listing_id,?,?,?,?,?=owner_id FROM listings WHERE listing_id=?`)
      .bind(result.id, identity.subject, identity.displayName, expected.version, input.decision, input.reason, now, identity.subject, expected.listingId),
  ];
  if (input.decision === 'hide') statements.push(session.prepare(`UPDATE listings SET moderation_hidden=1,moderation_reason=?,moderation_revision=moderation_revision+1,
    published_version=NULL,publication_epoch=publication_epoch+1 WHERE listing_id=?`).bind(input.reason, expected.listingId));
  else {
    statements.push(session.prepare(`UPDATE version_reviews SET state=?,reason=?,review_revision=review_revision+1 WHERE listing_id=? AND version=?`)
      .bind(result.state, input.reason, expected.listingId, expected.version));
    if (input.decision === 'approve') statements.push(session.prepare('UPDATE listings SET published_version=? WHERE listing_id=?').bind(expected.version, expected.listingId));
  }
  try { await session.batch(statements); }
  catch (error) { const committed = await receipt(database, identity.subject, key, digest); if (committed) return committed; failed(error); }
  return result;
}
export async function resolveReport(database: D1Database, identity: MarketIdentity, configuration: string | undefined, raw: unknown, key: string, now = Math.floor(Date.now() / 1000)) {
  requireReviewer(identity, configuration);
  const input = MarketResolveInput.parse(raw); MarketIdempotencyKey.parse(key);
  const digest = await sha256(new TextEncoder().encode(canonicalMarketContent({ operation: 'resolve', input })));
  const existing = await receipt(database, identity.subject, key, digest); if (existing) return existing;
  const row = await database.withSession('first-primary').prepare(`SELECT reports.listing_id,reports.version,versions.body_sha256,versions.review_digest
    FROM reports JOIN listing_versions AS versions USING(listing_id,version) WHERE report_id=?`).bind(input.reportId)
    .first<{ listing_id: string; version: number; body_sha256: string; review_digest: string }>();
  if (!row) throw new MarketOperationError(404, 'not_found');
  const result = MarketModerationReceipt.parse({ id: crypto.randomUUID(), operation: 'resolve', listingId: row.listing_id, version: row.version, state: input.resolution, reportId: input.reportId });
  const session = database.withSession('first-primary');
  try {
    await session.batch([
      requestStatement(session, identity, key, digest, result, { sha256: row.body_sha256, reviewDigest: row.review_digest }, now, input.revision),
      session.prepare(`INSERT INTO moderation_events(request_id,actor_id,actor_name,listing_id,version,decision,reason,created_at,self_review,report_id)
        SELECT ?,?,?,listing_id,?,'resolve',?,?,?=owner_id,? FROM listings WHERE listing_id=?`)
        .bind(result.id, identity.subject, identity.displayName, row.version, input.reason, now, identity.subject, input.reportId, row.listing_id),
      session.prepare('UPDATE reports SET status=?,revision=revision+1 WHERE report_id=?').bind(input.resolution, input.reportId),
    ]);
  } catch (error) { const committed = await receipt(database, identity.subject, key, digest); if (committed) return committed; failed(error); }
  return result;
}
