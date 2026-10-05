import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { parseMarketTemplate } from '../../apps/desktop/src/core/market/templates';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';
import { MarketOrigins, type MarketAdded, type MarketInstallation } from '../../apps/desktop/src/shared/market';

/*
 * A space as a marketplace listing (docs/marketplace-design.md): adding it makes its orglets, the space with its
 * categories, and its channels, each with every orglet of its place or the ones the listing names.
 */

describe('a space listing', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-market-space-'));
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => { throw new Error('Adding a listing never calls a model.'); });
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('is in the bundled catalog with a body that matches its digest', async () => {
    const listing = (await seedCatalog()).listings.find(item => item.listingId === 'launch-space');
    expect(listing).toMatchObject({ kind: 'space', version: 1, name: 'Launch space' });
    const template = parseMarketTemplate(MARKET_SEED_BODIES['launch-space:1'], 'space');
    expect(template.space?.channels.map(channel => channel.name)).toEqual(['general', 'sources', 'drafts']);
    expect(template.workers.map(worker => worker.key)).toEqual(['researcher', 'reviewer', 'writer']);
  });

  it('refuses a body whose channel names an orglet or a category the listing does not have', () => {
    const body = JSON.parse(MARKET_SEED_BODIES['launch-space:1']);
    const withStranger = { ...body, space: { ...body.space, channels: [{ name: 'general', memberKeys: ['nobody'] }] } };
    const withLostCategory = { ...body, space: { ...body.space, channels: [{ name: 'general', categoryKey: 'missing' }] } };
    const twice = { ...body, space: { ...body.space, channels: [{ name: 'general' }, { name: 'General' }] } };
    for (const bad of [withStranger, withLostCategory, twice]) expect(() => parseMarketTemplate(JSON.stringify(bad), 'space')).toThrow('key trùng, thiếu');
    expect(() => parseMarketTemplate(JSON.stringify({ ...body, space: { ...body.space, defaults: { capabilities: ['network.web'] } } }), 'space')).toThrow();
  });

  it('adds its orglets, the space with its categories, and its channels with the orglets each one names', async () => {
    const before = store.workspace().workers.length;
    const added = await core.command('marketAdd', { listingId: 'launch-space', version: 1 }) as MarketAdded;
    const workspace = store.workspace();
    expect(added.kind).toBe('space');
    expect(workspace.workers).toHaveLength(before + 3);
    const space = workspace.spaces.find(item => item.id === added.entityId)!;
    expect(space).toMatchObject({ name: 'Launch', categories: [{ name: 'Research' }, { name: 'Writing' }] });
    expect(space.orgletIds).toEqual(added.workerIds);
    expect(space.defaults).toBeUndefined();
    const nameOf = (orgletId: string) => workspace.workers.find(worker => worker.id === orgletId)!.name;
    const channels = Object.fromEntries(workspace.emptyChannels.filter(channel => channel.spaceId === space.id).map(channel => [channel.name, channel]));
    expect(Object.keys(channels).sort()).toEqual(['drafts', 'general', 'sources']);
    expect(channels.general).toMatchObject({ access: 'inherit', topic: 'Plan the launch and decide what happens next' });
    expect(channels.general.categoryId).toBeUndefined();
    expect(channels.general.members.map(member => nameOf(member.id))).toEqual(['Research friend', 'Review friend', 'Writing friend']);
    expect(channels.sources).toMatchObject({ access: 'listed', categoryId: space.categories[0].id });
    expect(channels.sources.members.map(member => nameOf(member.id))).toEqual(['Research friend', 'Review friend']);
    expect(channels.drafts).toMatchObject({ access: 'listed', categoryId: space.categories[1].id });
    expect(channels.drafts.members.map(member => nameOf(member.id))).toEqual(['Writing friend', 'Review friend']);
    // The listing sets no permission and no folder for the person who adds it.
    expect(workspace.newChatCapabilities).toEqual({});
  });

  it('records where the space came from, lists it as installed, and stops listing it once the space is deleted', async () => {
    const added = await core.command('marketAdd', { listingId: 'launch-space', version: 1 }) as MarketAdded;
    const origin = MarketOrigins.parse(store.setting('marketOrigins', [])).find(item => item.entityId === added.entityId)!;
    expect(origin).toMatchObject({ listingId: 'launch-space', version: 1, kind: 'space', baselineKind: 'authoring-v1' });
    expect(Object.keys(origin.workerIds).sort()).toEqual(['researcher', 'reviewer', 'writer']);
    const installed = await core.command('marketInstallations', {}) as MarketInstallation[];
    expect(installed).toEqual([{ entityId: added.entityId, kind: 'space', listingId: 'launch-space', version: 1, name: 'Launch', updateAvailable: false }]);
    await core.command('deleteSpace', { id: added.entityId });
    expect(await core.command('marketInstallations', {})).toEqual([]);
    // The orglets and channels stay: they are the person's now.
    expect(store.workspace().workers.map(worker => worker.name)).toEqual(expect.arrayContaining(['Research friend', 'Review friend', 'Writing friend']));
    expect(store.workspace().emptyChannels.filter(channel => ['general', 'sources', 'drafts'].includes(channel.name))).toHaveLength(3);
  });

  it('can be added twice, as two spaces with their own orglets', async () => {
    const first = await core.command('marketAdd', { listingId: 'launch-space', version: 1 }) as MarketAdded;
    const second = await core.command('marketAdd', { listingId: 'launch-space', version: 1 }) as MarketAdded;
    expect(second.entityId).not.toBe(first.entityId);
    expect(store.workspace().spaces).toHaveLength(2);
    expect(new Set([...first.workerIds, ...second.workerIds]).size).toBe(6);
  });
});

describe('a catalog from before spaces', () => {
  it('is asked again without the kinds it refused, and still fills the list', async () => {
    const { Marketplace } = await import('../../apps/desktop/src/core/market/service');
    const store = new Store(':memory:');
    const asked: string[] = [];
    const catalog = await seedCatalog();
    const page = { listings: catalog.listings.filter(listing => listing.kind !== 'space').map(listing => ({ ...listing, author: { displayName: 'CodePawl' }, reviewDigest: 'a'.repeat(64) })), nextCursor: null };
    const market = new Marketplace(store, () => {}, {
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        asked.push(`${url.pathname}${url.search}`);
        if (url.searchParams.has('kinds')) return new Response('refused', { status: 400 });
        return new Response(JSON.stringify(page));
      }) as unknown as typeof fetch,
    });
    const view = await market.catalog(true);
    expect(asked).toEqual(['/v2/catalog?limit=20&kinds=orglet,crew,space', '/v2/catalog?limit=20']);
    expect(view.source).toBe('online');
    expect(view.listings.map(listing => listing.kind)).toEqual(['orglet', 'crew']);
    store.db.close();
  });
});
