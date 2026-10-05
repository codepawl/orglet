import { z } from 'zod';
import { ListingId, MARKET_REQUEST_LIMIT, MarketKind, MarketMutationReceipt, MarketReviewState, MarketListingV2 } from './market';
import { BuiltInProviderId } from './contracts';
import { MarketSubmission } from './market-publishing';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicModelSuggestion = z.object({ provider: BuiltInProviderId, modelId: z.string().min(1).max(200).optional() }).strict();
export const PublishingSource = z.object({ kind: MarketKind, entityId: z.string().uuid() }).strict();
export const PublishingMetadata = z.object({
  name: z.string().trim().min(1).max(80), summary: z.string().trim().min(1).max(240),
  tags: z.array(z.string().min(1).max(32)).max(10), language: z.enum(['en', 'vi']),
  license: z.literal('CC-BY-4.0'), changelog: z.string().max(2000),
}).strict();
export const OwnerAllowance = z.object({
  listingLimit: z.number().int().min(0).max(10), listingCount: z.number().int().min(0).max(10),
  submissionsInHour: z.number().int().min(0).max(5), submissionLimit: z.literal(5),
}).strict();
export const OwnerSummary = z.object({
  listingId: ListingId, kind: MarketKind,
  latest: z.object({ listing: MarketListingV2, state: MarketReviewState, reason: z.string().max(2048).default('') }).strict(),
  published: MarketListingV2.nullable(), publicationEpoch: z.number().int().nonnegative(),
  hidden: z.boolean().default(false), hiddenReason: z.string().max(2048).default(''),
}).strict().refine(summary => summary.latest.listing.listingId === summary.listingId && summary.latest.listing.kind === summary.kind &&
  (summary.published === null || (summary.published.listingId === summary.listingId && summary.published.kind === summary.kind && summary.published.version <= summary.latest.listing.version)));
export const OwnerSummaries = z.object({ publishingEnabled: z.boolean(), listings: z.array(OwnerSummary).max(10), allowance: OwnerAllowance }).strict()
  .refine(summary => new Set(summary.listings.map(listing => listing.listingId)).size === summary.listings.length && summary.allowance.listingCount === summary.listings.length);
export type OwnerSummaries = z.infer<typeof OwnerSummaries>;
export const PublishingAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), source: PublishingSource, metadata: PublishingMetadata, target: ListingId.nullable(), suggestion: PublicModelSuggestion.optional() }).strict(),
  z.object({ action: z.literal('submit'), previewId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('retry'), operationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('inspect'), operationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('unpublish'), listingId: ListingId, confirmation: Digest }).strict(),
  z.object({ action: z.literal('listOwn') }).strict(),
]);
export type PublishingAction = z.infer<typeof PublishingAction>;
export const PublishingCapability = z.object({ status: z.enum(['local', 'upgradeRequired', 'unverified', 'available', 'unavailable']) }).strict();
export type PublishingCapability = z.infer<typeof PublishingCapability>;
/** Internal context crosses only main/core; never a renderer account identifier. */
export const PublishingContext = z.object({
  accountKey: z.string().max(64).nullable(), generation: z.number().int().nonnegative(),
  status: z.enum(['local', 'upgradeRequired', 'unverified', 'available', 'unavailable']),
  summaries: OwnerSummaries.optional(),
}).strict();
export type PublishingContext = z.infer<typeof PublishingContext>;
export const PublishingOperation = z.object({
  id: z.string().uuid(), accountKey: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  operation: z.enum(['create', 'version', 'unpublish']), target: ListingId.nullable(),
  key: z.string().uuid(), requestText: z.string().max(MARKET_REQUEST_LIMIT).optional(), digest: Digest,
  state: z.enum(['notSent', 'unknown', 'rejected', 'acceptedPending', 'unpublished']),
  receipt: MarketMutationReceipt.optional(), code: z.string().regex(/^[a-z_]{1,80}$/).optional(),
}).strict();
export type PublishingOperation = z.infer<typeof PublishingOperation>;
export const PublishingJournal = z.array(PublishingOperation).max(20);
export const PublishingRelay = z.discriminatedUnion('action', [
  z.object({ action: z.literal('context') }).strict(),
  z.object({ action: z.literal('send'), accountKey: z.string().min(1).max(64), generation: z.number().int().nonnegative(), operation: z.enum(['create', 'version', 'unpublish']), target: ListingId.nullable(), key: z.string().uuid(), requestText: z.string().max(MARKET_REQUEST_LIMIT) }).strict(),
]);
export type PublishingRelay = z.infer<typeof PublishingRelay>;
export const PublishingOutcome = z.discriminatedUnion('state', [
  z.object({ state: z.literal('notSent'), code: z.string().regex(/^[a-z_]{1,80}$/) }).strict(),
  z.object({ state: z.literal('unknown') }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string().regex(/^[a-z_]{1,80}$/) }).strict(),
  z.object({ state: z.literal('accepted'), receipt: MarketMutationReceipt }).strict(),
]);
export type PublishingOutcome = z.infer<typeof PublishingOutcome>;
const PublicRequestText = z.string().max(MARKET_REQUEST_LIMIT).refine(text => new TextEncoder().encode(text).byteLength <= MARKET_REQUEST_LIMIT);
function isPublicSubmission(text: string): boolean {
  try {
    return MarketSubmission.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}
export const PublishingPreview = z.object({
  previewId: z.string().uuid(), requestText: PublicRequestText.refine(isPublicSubmission), digest: Digest,
  source: PublishingSource, capability: PublishingCapability, target: ListingId.nullable(),
}).strict();
export type PublishingPreview = z.infer<typeof PublishingPreview>;
export const PublishingOperationView = PublishingOperation.omit({ accountKey: true, key: true, requestText: true, digest: true }).strict();
export type PublishingOperationView = z.infer<typeof PublishingOperationView>;
export const PublishingOwnView = z.object({
  capability: PublishingCapability, summaries: OwnerSummaries.optional(),
  operations: z.array(PublishingOperationView).max(20),
  confirmations: z.record(ListingId, Digest).refine(confirmations => Object.keys(confirmations).length <= 10),
}).strict();
export type PublishingOwnView = z.infer<typeof PublishingOwnView>;
export const PublishingResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preview'), preview: PublishingPreview }).strict(),
  z.object({ kind: z.literal('blocked'), diagnostics: z.array(z.object({
    path: z.string().max(1024), line: z.number().int().min(1), rule: z.string().regex(/^[a-z0-9_-]{1,80}$/),
    message: z.string().max(300).refine((message): boolean => message === 'Nội dung xuất bản không hợp lệ. Kiểm tra trường và quy tắc được chỉ ra.'),
  }).strict()).max(100) }).strict(),
  z.object({ kind: z.literal('own'), view: PublishingOwnView }).strict(),
  z.object({ kind: z.literal('saved'), operation: PublishingOperationView, requestText: PublicRequestText }).strict()
    .refine(result => result.operation.operation === 'unpublish' ? result.requestText === '{}' : isPublicSubmission(result.requestText)),
  z.object({ kind: z.literal('operation'), operation: PublishingOperationView }).strict(),
]);
export type PublishingResult = z.infer<typeof PublishingResult>;
