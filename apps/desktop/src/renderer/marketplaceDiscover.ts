import { foldForSearch } from '../shared/chat-search';
import type { MarketKind } from '../shared/market';

/** What search and grouping read of a listing. */
export type DiscoverListing = {
  kind: MarketKind;
  name: string;
  summary: string;
  tags: readonly string[];
  author: string | { displayName: string };
};

/**
 * The two kinds a person sees. A listing that brings several orglets (a crew) is a space in the person's eyes, so
 * the catalog's `crew` kind is shown as a space. The catalog format keeps its three kinds.
 */
export type ShownKind = 'orglet' | 'space';

export function shownKind(kind: MarketKind): ShownKind {
  return kind === 'orglet' ? 'orglet' : 'space';
}

function authorName(listing: Pick<DiscoverListing, 'author'>): string {
  return typeof listing.author === 'string' ? listing.author : listing.author.displayName;
}

/** Every word typed must appear in the name, the summary, a tag or the author, ignoring case and accents. */
export function listingMatches(listing: DiscoverListing, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const text = foldForSearch([listing.name, listing.summary, ...listing.tags, authorName(listing)].join(' '));
  return words.every(word => text.includes(word));
}

export type DiscoverSection<Listing> = { kind: ShownKind; listings: Listing[] };

/** Orglets first, then spaces, each keeping the catalog's order. A section with no listing is left out. */
export function discoverSections<Listing extends Pick<DiscoverListing, 'kind'>>(listings: readonly Listing[]): DiscoverSection<Listing>[] {
  const kinds: ShownKind[] = ['orglet', 'space'];
  return kinds
    .map(kind => ({ kind, listings: listings.filter(listing => shownKind(listing.kind) === kind) }))
    .filter(section => section.listings.length > 0);
}
