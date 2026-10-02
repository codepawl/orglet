import { z } from 'zod';

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
/** Origin links are local metadata and may travel in a workspace backup, never in a marketplace listing. */
export const MarketOrigin = z.object({
  entityId: z.string().uuid(), listingId: ListingId, version: MarketVersion, kind: z.enum(['orglet', 'crew']),
  workerIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= 8),
  skillIds: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.string().uuid()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= 5),
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
