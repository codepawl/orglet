import { z } from 'zod';
import { ListingId, MarketVersion, MarketListingV2 } from './market';
import { credentialLocations } from './secrets';

export const MARKET_MODERATION_REQUEST_LIMIT = 8 * 1024;
export const MarketModerationCode = z.enum([
  'idempotency_conflict', 'report_unavailable', 'already_reported', 'report_limit', 'stale_review', 'stale_report',
  'listing_hidden', 'review_forbidden', 'moderation_unavailable', 'storage_failed', 'not_found', 'invalid_request',
  'invalid_pagination', 'invalid_idempotency_key', 'request_size', 'content_type', 'invalid_token',
  'account_unavailable', 'account_changed', 'pending_limit',
]);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Text = z.string().trim().min(1).max(2048).refine(value => new TextEncoder().encode(value).length <= 2048 &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) && credentialLocations(value, 1).length === 0);
const ExactVersion = z.object({ listingId: ListingId, version: MarketVersion, sha256: Digest, reviewDigest: Digest }).strict();
export const MarketReportInput = ExactVersion.extend({
  reason: z.enum(['security', 'privacy', 'license', 'other']), explanation: Text,
  reference: z.object({ path: z.string().min(1).max(512).refine(value => !/[\x00-\x1f\x7f]/.test(value) && credentialLocations(value, 1).length === 0), line: z.number().int().min(1).max(100000) }).strict().optional(),
}).strict();
export type MarketReportInput = z.infer<typeof MarketReportInput>;
export const MarketReviewExpected = ExactVersion.extend({
  publicationEpoch: z.number().int().nonnegative(), reviewRevision: z.number().int().nonnegative(),
  moderationRevision: z.number().int().nonnegative(), publishedVersion: MarketVersion.nullable(),
}).strict();
export type MarketReviewExpected = z.infer<typeof MarketReviewExpected>;
export const MarketDecisionInput = z.object({ expected: MarketReviewExpected, decision: z.enum(['approve', 'reject', 'hide']), reason: Text }).strict();
export type MarketDecisionInput = z.infer<typeof MarketDecisionInput>;
export const MarketResolveInput = z.object({ reportId: z.string().uuid(), revision: z.number().int().nonnegative(), resolution: z.enum(['dismissed', 'resolved']), reason: Text }).strict();
export type MarketResolveInput = z.infer<typeof MarketResolveInput>;
export const MarketModerationReceipt = z.object({
  id: z.string().uuid(), operation: z.enum(['report', 'approve', 'reject', 'hide', 'resolve']),
  listingId: ListingId, version: MarketVersion,
  state: z.enum(['accepted', 'approved', 'rejected', 'hidden', 'dismissed', 'resolved']), reportId: z.string().uuid().optional(),
}).strict().refine(value => value.operation === 'report' ? value.state === 'accepted' && value.reportId !== undefined :
  value.operation === 'resolve' ? ['dismissed', 'resolved'].includes(value.state) && value.reportId !== undefined :
  value.reportId === undefined && value.state === ({ approve: 'approved', reject: 'rejected', hide: 'hidden' } as const)[value.operation]);
export type MarketModerationReceipt = z.infer<typeof MarketModerationReceipt>;
export const MarketReportView = z.object({
  id: z.string().uuid(), listingId: ListingId, version: MarketVersion,
  reason: MarketReportInput.shape.reason, explanation: Text, reference: MarketReportInput.shape.reference,
  state: z.enum(['open', 'dismissed', 'resolved']), revision: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(),
}).strict();
export const MarketReviewDetail = z.object({
  listing: MarketListingV2, expected: MarketReviewExpected,
  state: z.enum(['pending', 'approved', 'rejected']), reason: z.union([z.literal(''), Text]),
  hidden: z.boolean(), hiddenReason: z.union([z.literal(''), Text]), selfReview: z.boolean(),
  reportCount: z.number().int().nonnegative(),
}).strict().refine(value => value.listing.listingId === value.expected.listingId && value.listing.version === value.expected.version &&
  value.listing.sha256 === value.expected.sha256 && value.listing.reviewDigest === value.expected.reviewDigest);
export type MarketReviewDetail = z.infer<typeof MarketReviewDetail>;
export const MarketQueuePage = z.object({ items: z.array(MarketReviewDetail).max(20), nextCursor: z.string().max(256).nullable() }).strict();
export const MarketReportsPage = z.object({ items: z.array(MarketReportView).max(20), nextCursor: z.string().max(256).nullable() }).strict();
export const MarketAuditPage = z.object({ items: z.array(z.object({
  id: z.string().uuid(), actorName: z.string().min(1).max(80), decision: z.enum(['approve', 'reject', 'hide', 'resolve']),
  reason: Text, createdAt: z.number().int().nonnegative(), selfReview: z.boolean(),
  sha256: Digest, reviewDigest: Digest, reportId: z.string().uuid().nullable(),
}).strict()).max(20), nextCursor: z.string().max(256).nullable() }).strict();
export const MarketModerationCapability = z.object({ canReview: z.boolean(), canReport: z.boolean(), canWrite: z.boolean() }).strict();
export const MarketModerationWrite = z.discriminatedUnion('action', [
  z.object({ action: z.literal('report'), input: MarketReportInput, key: z.string().uuid() }).strict(),
  z.object({ action: z.literal('decision'), input: MarketDecisionInput, key: z.string().uuid() }).strict(),
  z.object({ action: z.literal('resolve'), input: MarketResolveInput, key: z.string().uuid() }).strict(),
]);
export type MarketModerationWrite = z.infer<typeof MarketModerationWrite>;
export const MarketModerationPending = z.array(MarketModerationWrite).max(10);
const AccountKey = z.string().min(1).max(64);
export const MarketModerationJournalRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), accountKey: AccountKey }).strict(),
  z.object({ action: z.literal('begin'), accountKey: AccountKey, request: MarketModerationWrite }).strict(),
  z.object({ action: z.literal('finish'), accountKey: AccountKey, key: z.string().uuid(), result: z.enum(['unknown', 'error', 'receipt']) }).strict(),
]);
export type MarketModerationJournalRequest = z.infer<typeof MarketModerationJournalRequest>;
export const MarketModerationJournalBegin = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), wasUnknown: z.boolean() }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(['idempotency_conflict', 'pending_limit']) }).strict(),
]);
export const MarketModerationAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('journal') }).strict(),
  z.object({ action: z.literal('retry'), operationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('capability') }).strict(),
  z.object({ action: z.literal('report'), input: MarketReportInput, key: z.string().uuid() }).strict(),
  z.object({ action: z.literal('queue'), cursor: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal('detail'), listingId: ListingId, version: MarketVersion }).strict(),
  z.object({ action: z.literal('reports'), listingId: ListingId, version: MarketVersion, cursor: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal('audit'), listingId: ListingId, version: MarketVersion, cursor: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal('decision'), input: MarketDecisionInput, key: z.string().uuid() }).strict(),
  z.object({ action: z.literal('resolve'), input: MarketResolveInput, key: z.string().uuid() }).strict(),
]);
export type MarketModerationAction = z.infer<typeof MarketModerationAction>;
export const MarketModerationResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('journal'), operations: MarketModerationPending }).strict(),
  z.object({ kind: z.literal('capability'), capability: MarketModerationCapability, status: z.enum(['accountRequired', 'unavailable', 'available']) }).strict(),
  z.object({ kind: z.literal('queue'), page: MarketQueuePage }).strict(),
  z.object({ kind: z.literal('reports'), page: MarketReportsPage }).strict(),
  z.object({ kind: z.literal('audit'), page: MarketAuditPage }).strict(),
  z.object({ kind: z.literal('detail'), detail: MarketReviewDetail, requestText: z.string().max(2 * 1024 * 1024 + 16 * 1024 + 12), previousText: z.string().max(2 * 1024 * 1024 + 16 * 1024 + 12).optional() }).strict(),
  z.object({ kind: z.literal('receipt'), receipt: MarketModerationReceipt }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
  z.object({ kind: z.literal('error'), code: MarketModerationCode }).strict(),
]);
export type MarketModerationResult = z.infer<typeof MarketModerationResult>;
