import type { D1Database } from '../worker-configuration';
import { ListingId, MarketCatalogPageV2, type MarketListingV2 } from '../../../apps/desktop/src/shared/market';
import { MARKET_SEED_BODIES, seedCatalog } from '../../../apps/desktop/src/shared/market-seed';
import { validateMarketSubmission, canonicalMarketContent } from '../../../apps/desktop/src/shared/market-publishing';
import { approvedListings } from './listings';

async function catalogSnapshot(): Promise<{ listings: MarketListingV2[]; snapshot: string }> {
  const seed = await seedCatalog();
  const listings = await Promise.all(seed.listings.map(async listing => {
    const { listingId, version, sha256, author: _author, ...metadata } = listing;
    const result = await validateMarketSubmission(JSON.stringify({
      ...metadata, template: JSON.parse(MARKET_SEED_BODIES[`${listingId}:${version}`]),
    }));
    if (!result.ok) throw new Error('Invalid curated content');
    return { ...listing, author: { displayName: 'CodePawl' }, reviewDigest: result.reviewDigest, sha256 };
  }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalMarketContent(listings)));
  const snapshot = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { listings, snapshot };
}

/** The immutable seed reserves its listing IDs; future account listings must never claim them. */
export async function catalogPageV2(search: URLSearchParams, database?: D1Database): Promise<string | undefined> {
  if ([...search.keys()].some(key => key !== 'limit' && key !== 'cursor')) return undefined;
  if (search.getAll('limit').length > 1 || search.getAll('cursor').length > 1) return undefined;
  const requestedLimit = search.get('limit') ?? '50';
  if (!/^[1-9][0-9]{0,2}$/.test(requestedLimit)) return undefined;
  const limit = Number(requestedLimit);
  if (limit > 100) return undefined;
  const { listings, snapshot } = await catalogSnapshot();
  if (database) {
    let after = '';
    const cursor = search.get('cursor');
    if (cursor !== null) {
      if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
      try {
        const decoded = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
        if (!decoded.startsWith('listing:')) return undefined;
        after = decoded.slice('listing:'.length);
        if (!ListingId.safeParse(after).success || encodeListingCursor(after) !== cursor) return undefined;
      } catch {
        return undefined;
      }
    }
    const candidates = [
      ...listings.filter(listing => listing.listingId > after),
      ...await approvedListings(database, after, limit + 1),
    ].sort((left, right) => left.listingId < right.listingId ? -1 : left.listingId > right.listingId ? 1 : 0);
    const page = candidates.slice(0, limit);
    return JSON.stringify(MarketCatalogPageV2.parse({
      listings: page,
      nextCursor: candidates.length > limit ? encodeListingCursor(page[page.length - 1].listingId) : null,
    }));
  }
  let offset = 0;
  const cursor = search.get('cursor');
  if (cursor !== null) {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
    try {
      const decoded = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
      const expectedPrefix = `${snapshot}:`;
      if (!decoded.startsWith(expectedPrefix)) return undefined;
      const position = decoded.slice(expectedPrefix.length);
      if (!/^[1-9][0-9]{0,5}$/.test(position)) return undefined;
      offset = Number(position);
      if (offset >= listings.length || encodeCursor(snapshot, offset) !== cursor) return undefined;
    } catch {
      return undefined;
    }
  }
  const nextOffset = offset + limit;
  return JSON.stringify(MarketCatalogPageV2.parse({
    listings: listings.slice(offset, nextOffset),
    nextCursor: nextOffset < listings.length ? encodeCursor(snapshot, nextOffset) : null,
  }));
}

function encodeListingCursor(listingId: string): string {
  return btoa(`listing:${listingId}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeCursor(snapshot: string, offset: number): string {
  return btoa(`${snapshot}:${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
