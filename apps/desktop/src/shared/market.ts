import { z } from 'zod';
import { MAX_CREW_TEMPLATE_WORKERS } from './crew-limits';

export const MARKET_URL = 'https://market.orglet.codepawl.com';
export const MARKET_BODY_LIMIT = 2 * 1024 * 1024;
export const ListingId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
export const MarketVersion = z.number().int().positive();
export const MarketListing = z.object({
  listingId: ListingId,
  version: MarketVersion,
  kind: z.enum(['orglet', 'crew']),
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
/** Origin links are local metadata and may travel in a workspace backup, never in a marketplace listing. */
export const MarketOrigin = z.object({
  entityId: z.string().uuid(), listingId: ListingId, version: MarketVersion, kind: z.enum(['orglet', 'crew']),
  workerIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= MAX_CREW_TEMPLATE_WORKERS),
  skillIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= MAX_CREW_TEMPLATE_WORKERS),
  baseline: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MarketOrigin = z.infer<typeof MarketOrigin>;
export const MarketOrigins = z.array(MarketOrigin).max(10_000).refine(origins => new Set(origins.map(origin => origin.entityId)).size === origins.length);
export const MarketTarget = z.object({ listingId: ListingId, version: MarketVersion }).strict();
export const MarketUpdateTarget = z.object({ entityId: z.string().uuid() }).strict();
export const MarketApplyUpdate = MarketUpdateTarget.extend({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type MarketCatalogView = MarketCatalog & { source: 'online' | 'cache' | 'bundled'; fetchedAt: string | null; error?: string };
export type MarketAdded = { entityId: string; kind: 'orglet' | 'crew'; workerIds: string[]; fallbackNames: string[] };
export type MarketChange = { name: string; before: string; after: string };
export type MarketUpdate = {
  entityId: string; listing: MarketListing; installedVersion: number; customized: boolean;
  token: string; changes: MarketChange[];
};
export type MarketInstallation = { entityId: string; kind: 'orglet' | 'crew'; listingId: string; version: number; name: string; updateAvailable: boolean };
