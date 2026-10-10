import { z } from 'zod';
import { MAX_CREW_TEMPLATE_WORKERS } from './crew-limits';

export const MARKET_URL = 'https://market.orglet.codepawl.com';
export const MARKET_BODY_LIMIT = 2 * 1024 * 1024;
export const MARKET_METADATA_LIMIT = 16 * 1024;
// Metadata has at most 2,640 authored UTF-16 units (15,840 escaped bytes) plus <544 fixed JSON bytes.
// Joining its object to the template adds ,"template": (12 bytes); the closing brace replaces the removed one.
export const MARKET_REQUEST_LIMIT = MARKET_BODY_LIMIT + MARKET_METADATA_LIMIT + 12;
export const ListingId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
export const MarketVersion = z.number().int().positive();
/** What a listing adds: one orglet, a crew with its channel, or a space with its orglets, categories and channels. */
export const MarketKind = z.enum(['orglet', 'crew', 'space']);
export type MarketKind = z.infer<typeof MarketKind>;
/**
 * The kinds every Orglet has understood. An app from before spaces reads a catalog strictly, so a listing of any
 * other kind is served only to a reader that names the kinds it understands (`kinds` on `/v2/catalog`), and never on
 * `/v1/catalog`.
 */
export const LEGACY_MARKET_KINDS: readonly MarketKind[] = ['orglet', 'crew'];
/** What this app asks the catalog for. */
export const MARKET_KINDS_QUERY = MarketKind.options.join(',');
export const MarketListing = z.object({
  listingId: ListingId,
  version: MarketVersion,
  kind: MarketKind,
  name: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  tags: z.array(z.string().min(1).max(32)).max(10),
  language: z.enum(['en', 'vi']),
  author: z.literal('CodePawl'),
  license: z.literal('CC-BY-4.0'),
  changelog: z.string().max(2000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MarketListing = z.infer<typeof MarketListing>;
export const MarketCatalog = z.object({ listings: z.array(MarketListing).max(200) }).strict().refine(
  catalog => new Set(catalog.listings.map(listing => listing.listingId)).size === catalog.listings.length,
  'Mục trong danh mục bị trùng.',
);
export type MarketCatalog = z.infer<typeof MarketCatalog>;
/** V2 display metadata has no account identity, email, claims or credentials. V1 stays literal CodePawl. */
export const MarketPublicAuthor = z.object({ displayName: z.string().trim().min(1).max(80) }).strict();
export const MarketListingV2 = MarketListing.omit({ author: true }).extend({
  author: MarketPublicAuthor,
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MarketListingV2 = z.infer<typeof MarketListingV2>;
export const MarketCatalogPageV2 = z.object({
  listings: z.array(MarketListingV2).max(100),
  nextCursor: z.string().max(256).nullable(),
}).strict().refine(page => new Set(page.listings.map(listing => listing.listingId)).size === page.listings.length);
export type MarketCatalogPageV2 = z.infer<typeof MarketCatalogPageV2>;

export const MarketIdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const MarketReviewState = z.enum(['pending', 'approved', 'rejected']);
export const MarketMutationReceipt = z.discriminatedUnion('operation', [
  z.object({ operation: z.enum(['create', 'version']), listingId: ListingId, version: MarketVersion, state: z.literal('pending') }).strict(),
  z.object({ operation: z.literal('unpublish'), listingId: ListingId, publicationEpoch: z.number().int().nonnegative() }).strict(),
]);
export type MarketMutationReceipt = z.infer<typeof MarketMutationReceipt>;
export const MarketOwnerVersion = z.object({
  listing: MarketListingV2,
  state: MarketReviewState,
  submittedAt: z.number().int().nonnegative(),
  published: z.boolean(),
}).strict();
export const MarketOwnerPage = z.object({
  versions: z.array(MarketOwnerVersion).max(100),
  nextCursor: z.string().max(256).nullable(),
  allowance: z.object({
    listingLimit: z.number().int().min(0).max(10),
    listingCount: z.number().int().min(0).max(10),
    submissionsInHour: z.number().int().min(0).max(5),
    submissionLimit: z.literal(5),
  }).strict(),
}).strict();
/** Origin links are local metadata and may travel in a workspace backup, never in a marketplace listing. */
export const MarketOrigin = z.object({
  entityId: z.string().uuid(), listingId: ListingId, version: MarketVersion, kind: MarketKind,
  workerIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= MAX_CREW_TEMPLATE_WORKERS),
  skillIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= MAX_CREW_TEMPLATE_WORKERS),
  baseline: z.string().regex(/^[a-f0-9]{64}$/),
  /**
   * What `baseline` is a digest of. `authoring-v1` covers only the content an update replaces (names, instructions,
   * skills, crew settings, members by their template keys), so every computer of an account computes the same value
   * (GH-479). An origin without the tag is from before: its baseline hashed whole rows of the computer that added
   * it, local revision numbers included, and proves nothing on another computer.
   */
  baselineKind: z.literal('authoring-v1').optional(),
}).strict();
export type MarketOrigin = z.infer<typeof MarketOrigin>;
/** Whether an installed copy still matches what was installed; `unknown` when an old baseline cannot say. */
export type MarketCustomization = 'unchanged' | 'customized' | 'unknown';
export const MarketOrigins = z.array(MarketOrigin).max(10_000).refine(origins => new Set(origins.map(origin => origin.entityId)).size === origins.length);
export const MarketTarget = z.object({ listingId: ListingId, version: MarketVersion }).strict();
export const MarketUpdateTarget = z.object({ entityId: z.string().uuid() }).strict();
export const MarketApplyUpdate = MarketUpdateTarget.extend({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type MarketDisplayListing = MarketListing | MarketListingV2;
export type MarketCatalogView = { listings: MarketDisplayListing[]; nextCursor?: string | null; pageCursor?: string; cachedPages?: { cursor: string; name: string }[]; source: 'online' | 'cache' | 'bundled'; fetchedAt: string | null; error?: string };
export type MarketAdded = { entityId: string; kind: MarketKind; workerIds: string[]; fallbackNames: string[] };
export type MarketChange = { name: string; before: string; after: string };
export type MarketUpdate = {
  entityId: string; listing: MarketDisplayListing; installedVersion: number; customization: MarketCustomization;
  token: string; changes: MarketChange[];
  /** What this update would let an orglet or channel do or spend beyond what it may now; empty when it widens nothing. */
  widening: MarketWidening[];
};
export type MarketInstallation = { entityId: string; kind: MarketKind; listingId: string; version: number; name: string; updateAvailable: boolean; latestVersion?: number };

export const MarketWidening = z.object({
  kind: z.enum(['new-orglet', 'task-budget', 'monthly-budget', 'concurrency', 'skill-files', 'channel-rules']),
  name: z.string().max(200),
}).strict();
export type MarketWidening = z.infer<typeof MarketWidening>;
/** Why an update is left to the person: they changed the copy, the app cannot tell, or the update widens what it may do. */
export const MarketUpdateBlock = z.enum(['customized', 'unknown', 'widening']);
export type MarketUpdateBlock = z.infer<typeof MarketUpdateBlock>;

/**
 * Why an update waits for the person even when marketplace updates are automatic, or undefined when it may be applied
 * alone. An edit of the person's own would be replaced, and a wider budget, a new orglet or new skill files change what
 * the thing may do: both need a look at the comparison first.
 */
export function automaticUpdateBlock(update: Pick<MarketUpdate, 'customization' | 'widening'>): MarketUpdateBlock | undefined {
  if (update.widening.length > 0) return 'widening';
  if (update.customization === 'customized') return 'customized';
  if (update.customization === 'unknown') return 'unknown';
  return undefined;
}

/**
 * What the update place remembers about one installed item's automatic update: applied (with what changed), failed
 * (with its reason, not retried by itself) or left for the person (with why). One record per item, the newest.
 */
export const MarketUpdateRecord = z.object({
  entityId: z.string().uuid(),
  kind: MarketKind,
  listingId: ListingId,
  name: z.string().min(1).max(200),
  fromVersion: MarketVersion,
  toVersion: MarketVersion,
  status: z.enum(['applied', 'failed', 'needs-review']),
  at: z.iso.datetime(),
  /** The error of a failed update, in the words the app's own errors use. */
  reason: z.string().max(600).optional(),
  /** Set when the update was left to the person, with what it would widen. */
  block: MarketUpdateBlock.optional(),
  widening: z.array(MarketWidening).max(20).optional(),
  changelog: z.string().max(2000).optional(),
  changed: z.array(z.string().max(200)).max(20),
}).strict();
export type MarketUpdateRecord = z.infer<typeof MarketUpdateRecord>;
export const MARKET_UPDATE_RECORD_LIMIT = 50;
export const MarketUpdateRecords = z.array(MarketUpdateRecord).max(MARKET_UPDATE_RECORD_LIMIT);
