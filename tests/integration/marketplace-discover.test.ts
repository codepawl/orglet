import { describe, expect, it } from 'vitest';
import { discoverSections, listingMatches, shownKind, type DiscoverListing } from '../../apps/desktop/src/renderer/marketplaceDiscover';

function listing(overrides: Partial<DiscoverListing>): DiscoverListing {
  return { kind: 'orglet', name: 'Research friend', summary: 'Finds sources and checks them.', tags: ['research'], author: 'CodePawl', ...overrides };
}

describe('searching the Discover list', () => {
  it('matches the name, the summary, a tag or the author, ignoring case', () => {
    const item = listing({ name: 'Launch Desk', summary: 'Plans a newsletter', tags: ['writing'], author: { displayName: 'Mai Tran' } });
    for (const query of ['launch', 'NEWSLETTER', 'writ', 'mai tran']) expect(listingMatches(item, query)).toBe(true);
    expect(listingMatches(item, 'budget')).toBe(false);
  });

  it('ignores Vietnamese accents in the listing and in the query', () => {
    const item = listing({ name: 'Trợ lý nghiên cứu', summary: 'Đọc nguồn giúp bạn' });
    expect(listingMatches(item, 'nghien cuu')).toBe(true);
    expect(listingMatches(item, 'ĐỌC')).toBe(true);
    expect(listingMatches(listing({ name: 'Nghien cuu' }), 'nghiên cứu')).toBe(true);
  });

  it('needs every word, in any order, and lets an empty query through', () => {
    const item = listing({ name: 'Research and review', summary: 'Two friends compare sources' });
    expect(listingMatches(item, 'review research')).toBe(true);
    expect(listingMatches(item, 'review budget')).toBe(false);
    expect(listingMatches(item, '   ')).toBe(true);
  });
});

describe('the two sections of Discover', () => {
  const listings = [
    listing({ kind: 'space', name: 'Launch space' }),
    listing({ kind: 'orglet', name: 'First friend' }),
    listing({ kind: 'crew', name: 'Research and review' }),
    listing({ kind: 'orglet', name: 'Second friend' }),
  ];

  it('shows a crew as a space, because a template with several orglets is a space', () => {
    expect(shownKind('crew')).toBe('space');
    expect(shownKind('space')).toBe('space');
    expect(shownKind('orglet')).toBe('orglet');
  });

  it('puts orglets first, then spaces, each in the catalog order', () => {
    const sections = discoverSections(listings);
    expect(sections.map(section => section.kind)).toEqual(['orglet', 'space']);
    expect(sections[0].listings.map(item => item.name)).toEqual(['First friend', 'Second friend']);
    expect(sections[1].listings.map(item => item.name)).toEqual(['Launch space', 'Research and review']);
  });

  it('leaves out a section with no listing', () => {
    expect(discoverSections(listings.filter(item => item.kind === 'orglet')).map(section => section.kind)).toEqual(['orglet']);
    expect(discoverSections(listings.filter(item => item.kind === 'crew')).map(section => section.kind)).toEqual(['space']);
    expect(discoverSections([])).toEqual([]);
  });
});
