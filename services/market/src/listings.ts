import type { D1Database } from '../worker-configuration';
import {
  ListingId, MarketIdempotencyKey, MarketMutationReceipt, MarketListingV2,
  MarketOwnerPage, type MarketListingV2 as PublicListing,
} from '../../../apps/desktop/src/shared/market';
import { canonicalMarketContent, type MarketSubmissionResult } from '../../../apps/desktop/src/shared/market-publishing';
import type { MarketKind } from '../../../apps/desktop/src/shared/market';
import type { MarketIdentity } from './auth';
import { bodyChunks, joinBody, sha256 } from './content';
import { OwnerSummaries } from '../../../apps/desktop/src/shared/market-desktop';

type ValidSubmission = Extract<MarketSubmissionResult, { ok: true }>;
type ReceiptRow = {
  operation: 'create' | 'version' | 'unpublish';
  listing_id: string;
  request_digest: string;
  result_version: number | null;
  result_epoch: number | null;
};
type VersionRow = {
  listing_id: string;
  version: number;
  metadata_json: string;
  author_name: string;
  body_sha256: string;
  review_digest: string;
  body_bytes: number;
  chunk_count: number;
  submitted_at: number;
  state: 'pending' | 'approved' | 'rejected';
  published_version: number | null;
};

export class MarketOperationError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

function receiptPayload(row: ReceiptRow): MarketMutationReceipt {
  return MarketMutationReceipt.parse(row.operation === 'unpublish'
    ? { operation: row.operation, listingId: row.listing_id, publicationEpoch: row.result_epoch }
    : { operation: row.operation, listingId: row.listing_id, version: row.result_version, state: 'pending' });
}

async function existingReceipt(database: D1Database, owner: string, key: string, digest: string): Promise<MarketMutationReceipt | undefined> {
  const row = await database.withSession('first-primary').prepare(
    'SELECT operation, listing_id, request_digest, result_version, result_epoch FROM mutation_requests WHERE owner_id = ? AND idempotency_key = ?',
  ).bind(owner, key).first<ReceiptRow>();
  if (!row) return undefined;
  if (row.request_digest !== digest) throw new MarketOperationError(409, 'idempotency_conflict');
  return receiptPayload(row);
}

function operationFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const errors: [string, number, string][] = [
    ['market_owner', 404, 'not_found'], ['market_reserved', 409, 'reserved_listing'],
    ['market_capacity', 429, 'listing_limit'], ['market_rate', 429, 'submission_limit'],
    ['market_kind', 409, 'listing_kind'],
    ['market_idempotency', 409, 'idempotency_conflict'],
  ];
  for (const [marker, status, code] of errors) {
    if (message.includes(marker)) throw new MarketOperationError(status, code);
  }
  throw new MarketOperationError(500, 'storage_failed');
}

async function requestDigest(operation: string, target: string | null, reviewDigest?: string): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalMarketContent({ operation, target, reviewDigest: reviewDigest ?? null })));
}

/** Identity and content are already verified; SQL owns allocation, ownership, quota and transaction rollback. */
export async function submitListing(
  database: D1Database, identity: MarketIdentity, target: string | null, key: string, content: ValidSubmission,
  now = Math.floor(Date.now() / 1000),
): Promise<MarketMutationReceipt> {
  MarketIdempotencyKey.parse(key);
  if (target !== null) ListingId.parse(target);
  const operation = target === null ? 'create' : 'version';
  const digest = await requestDigest(operation, target, content.reviewDigest);
  const previous = await existingReceipt(database, identity.subject, key, digest);
  if (previous) return previous;
  const listingId = target ?? `listing-${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();
  const chunks = bodyChunks(content.templateText);
  const { template: _template, ...metadata } = content.submission;
  const session = database.withSession('first-primary');
  const statements = [session.prepare(`
    INSERT INTO mutation_requests(request_id, owner_id, idempotency_key, operation, listing_id,
      request_digest, listing_cap, created_at, result_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(version), 0) + 1 FROM listing_versions WHERE listing_id = ?))
  `).bind(requestId, identity.subject, key, operation, listingId, digest, identity.publishedListings, now, listingId)];
  if (target === null) {
    statements.push(session.prepare(`
      INSERT INTO listings(listing_id, owner_id, kind, created_request, created_at) VALUES (?, ?, ?, ?, ?)
    `).bind(listingId, identity.subject, content.submission.kind, requestId, now));
  }
  statements.push(session.prepare(`
    INSERT INTO listing_versions(listing_id, version, request_id, submitted_by, submitted_at,
      publication_epoch, author_name, metadata_json, body_sha256, review_digest, body_bytes, chunk_count)
    SELECT listings.listing_id, requests.result_version, requests.request_id, requests.owner_id, requests.created_at,
      listings.publication_epoch, ?, ?, ?, ?, ?, ?
    FROM mutation_requests AS requests JOIN listings ON listings.listing_id = requests.listing_id WHERE requests.request_id = ?
  `).bind(identity.displayName, JSON.stringify(metadata), content.sha256, content.reviewDigest,
    new TextEncoder().encode(content.templateText).length, chunks.length, requestId));
  for (const [ordinal, chunk] of chunks.entries()) {
    statements.push(session.prepare(`
      INSERT INTO version_body_chunks(listing_id, version, ordinal, body)
      SELECT listing_id, result_version, ?, ? FROM mutation_requests WHERE request_id = ?
    `).bind(ordinal, chunk, requestId));
  }
  statements.push(session.prepare(`
    INSERT INTO version_reviews(listing_id, version)
    SELECT listing_id, result_version FROM mutation_requests WHERE request_id = ?
  `).bind(requestId));
  try {
    await session.batch(statements);
  } catch (error) {
    const committed = await existingReceipt(database, identity.subject, key, digest);
    if (committed) return committed;
    operationFailure(error);
  }
  return (await existingReceipt(database, identity.subject, key, digest))!;
}

export async function unpublishListing(database: D1Database, identity: MarketIdentity, listingId: string, key: string): Promise<MarketMutationReceipt> {
  ListingId.parse(listingId);
  MarketIdempotencyKey.parse(key);
  const digest = await requestDigest('unpublish', listingId);
  const previous = await existingReceipt(database, identity.subject, key, digest);
  if (previous) return previous;
  const requestId = crypto.randomUUID();
  const session = database.withSession('first-primary');
  try {
    await session.batch([
      session.prepare(`
        INSERT INTO mutation_requests(request_id, owner_id, idempotency_key, operation, listing_id,
          request_digest, listing_cap, created_at, result_epoch)
        VALUES (?, ?, ?, 'unpublish', ?, ?, ?, ?, (SELECT publication_epoch + 1 FROM listings WHERE listing_id = ?))
      `).bind(requestId, identity.subject, key, listingId, digest, identity.publishedListings, Math.floor(Date.now() / 1000), listingId),
      session.prepare(`
        UPDATE listings SET published_version = NULL, publication_epoch = publication_epoch + 1 WHERE listing_id = ? AND owner_id = ?
      `).bind(listingId, identity.subject),
    ]);
  } catch (error) {
    const committed = await existingReceipt(database, identity.subject, key, digest);
    if (committed) return committed;
    operationFailure(error);
  }
  return (await existingReceipt(database, identity.subject, key, digest))!;
}

function publicListing(row: VersionRow): PublicListing {
  return MarketListingV2.parse({
    ...JSON.parse(row.metadata_json), listingId: row.listing_id, version: row.version,
    author: { displayName: row.author_name }, sha256: row.body_sha256, reviewDigest: row.review_digest,
  });
}

export async function listingBody(database: D1Database, listingId: string, version: number, owner?: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | undefined> {
  const session = database.withSession('first-primary');
  const row = await session.prepare(`
    SELECT versions.* FROM listing_versions AS versions JOIN listings USING(listing_id)
    JOIN version_reviews AS reviews USING(listing_id, version)
    WHERE versions.listing_id = ? AND versions.version = ? AND (
      (? IS NOT NULL AND listings.owner_id = ?) OR
      (? IS NULL AND listings.published_version IS NOT NULL AND listings.moderation_hidden=0 AND reviews.state = 'approved')
    )
  `).bind(listingId, version, owner ?? null, owner ?? null, owner ?? null).first<VersionRow>();
  if (!row) return undefined;
  const chunks = await session.prepare('SELECT ordinal, body FROM version_body_chunks WHERE listing_id = ? AND version = ? ORDER BY ordinal')
    .bind(listingId, version).all<{ ordinal: number; body: number[] }>();
  const bytes = await joinBody(chunks.results, row);
  if (owner === undefined) {
    // Recheck after reconstruction, before the handler can answer HEAD or a conditional 304.
    const visible = await database.withSession('first-primary').prepare(`
      SELECT 1 AS visible FROM listings JOIN version_reviews USING(listing_id)
      WHERE listing_id = ? AND version = ? AND published_version IS NOT NULL AND moderation_hidden=0 AND state = 'approved'
    `).bind(listingId, version).first();
    if (!visible) return undefined;
  }
  return { bytes, hash: row.body_sha256 };
}

/**
 * The approved listings of these kinds. An app from before spaces names no kinds and is given only the kinds it has
 * always understood, so a space an account published never reaches a reader that would fail on it.
 */
export async function approvedListings(database: D1Database, after: string, limit: number, kinds: readonly MarketKind[]): Promise<PublicListing[]> {
  // The kinds are checked against the enum by the caller; they are still bound, never written into the statement.
  const placeholders = kinds.map(() => '?').join(',');
  const rows = await database.withSession('first-primary').prepare(`
    SELECT versions.* FROM listings JOIN listing_versions AS versions ON versions.listing_id = listings.listing_id
      AND versions.version = listings.published_version JOIN version_reviews AS reviews USING(listing_id, version)
    WHERE reviews.state = 'approved' AND listings.moderation_hidden=0 AND listings.kind IN (${placeholders}) AND listings.listing_id > ? ORDER BY listings.listing_id LIMIT ?
  `).bind(...kinds, after, limit).all<VersionRow>();
  return rows.results.map(publicListing);
}

export async function ownerListings(database: D1Database, identity: MarketIdentity, after: string, limit: number) {
  const cursor = after ? JSON.parse(after) as [string, number] : ['', 0];
  const session = database.withSession('first-primary');
  const results = await session.batch([
    session.prepare(`
      SELECT versions.*, reviews.state, listings.published_version FROM listing_versions AS versions JOIN listings USING(listing_id)
        JOIN version_reviews AS reviews USING(listing_id, version)
      WHERE listings.owner_id = ? AND (versions.listing_id > ? OR (versions.listing_id = ? AND versions.version > ?))
      ORDER BY versions.listing_id, versions.version LIMIT ?
    `).bind(identity.subject, cursor[0], cursor[0], cursor[1], limit + 1),
    session.prepare('SELECT count(*) AS total FROM listings WHERE owner_id = ?').bind(identity.subject),
    session.prepare('SELECT count(*) AS total FROM listing_versions WHERE submitted_by = ? AND submitted_at > ?')
      .bind(identity.subject, Math.floor(Date.now() / 1000) - 3600),
  ]);
  const rows = results[0].results as VersionRow[];
  const listingCount = (results[1].results as { total: number }[])[0].total;
  const submissionsInHour = (results[2].results as { total: number }[])[0].total;
  const last = rows[Math.min(rows.length, limit) - 1];
  return MarketOwnerPage.parse({
    versions: rows.slice(0, limit).map(row => ({ listing: publicListing(row), state: row.state, submittedAt: row.submitted_at, published: row.version === row.published_version })),
    nextCursor: rows.length > limit ? btoa(JSON.stringify([last.listing_id, last.version])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null,
    allowance: {
      listingLimit: identity.publishedListings, listingCount,
      submissionsInHour, submissionLimit: 5,
    },
  });
}

/** One bounded row per owned identity, independent of lifetime history pagination. */
export async function ownerSummaries(database: D1Database, identity: MarketIdentity, publishingEnabled = false) {
  const session = database.withSession('first-primary');
  const results = await session.batch([
    session.prepare(`
      SELECT versions.*, reviews.state, reviews.reason, listings.moderation_hidden,listings.moderation_reason,
        listings.publication_epoch AS current_epoch, listings.published_version
      FROM listings JOIN listing_versions AS versions ON versions.listing_id = listings.listing_id
        AND versions.version = (SELECT max(version) FROM listing_versions WHERE listing_id = listings.listing_id)
      JOIN version_reviews AS reviews ON reviews.listing_id = versions.listing_id AND reviews.version = versions.version
      WHERE listings.owner_id = ? ORDER BY listings.listing_id LIMIT 10
    `).bind(identity.subject),
    session.prepare(`
      SELECT versions.* FROM listings JOIN listing_versions AS versions ON versions.listing_id = listings.listing_id
        AND versions.version = listings.published_version JOIN version_reviews AS reviews USING(listing_id, version)
      WHERE listings.owner_id = ? AND reviews.state = 'approved' AND listings.moderation_hidden=0 ORDER BY listings.listing_id LIMIT 10
    `).bind(identity.subject),
    session.prepare('SELECT count(*) AS total FROM listing_versions WHERE submitted_by = ? AND submitted_at > ?')
      .bind(identity.subject, Math.floor(Date.now() / 1000) - 3600),
  ]);
  const latest = results[0].results as (VersionRow & { current_epoch: number; reason: string; moderation_hidden: number; moderation_reason: string })[];
  const published = new Map((results[1].results as VersionRow[]).map(row => [row.listing_id, publicListing(row)]));
  return OwnerSummaries.parse({
    publishingEnabled,
    listings: latest.map(row => {
      const listing = publicListing(row);
      return { listingId: row.listing_id, kind: listing.kind, latest: { listing, state: row.state, reason: row.reason },
        published: published.get(row.listing_id) ?? null, publicationEpoch: row.current_epoch,
        hidden: row.moderation_hidden === 1, hiddenReason: row.moderation_reason };
    }),
    allowance: {
      listingLimit: identity.publishedListings, listingCount: latest.length,
      submissionsInHour: (results[2].results as { total: number }[])[0].total, submissionLimit: 5,
    },
  });
}

export async function publicListingSummary(database: D1Database, listingId: string): Promise<PublicListing | undefined> {
  const row = await database.withSession('first-primary').prepare(`
    SELECT versions.* FROM listings JOIN listing_versions AS versions ON versions.listing_id = listings.listing_id
      AND versions.version = listings.published_version JOIN version_reviews AS reviews USING(listing_id, version)
    WHERE listings.listing_id = ? AND listings.moderation_hidden=0 AND reviews.state = 'approved'
  `).bind(listingId).first<VersionRow>();
  return row ? publicListing(row) : undefined;
}
