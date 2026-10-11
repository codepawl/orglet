import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { adoptCrews, emptyChannels } from '../../apps/desktop/src/core/storage/channels';
import { MARKET_SEED_BODIES, seedCatalog } from '../../apps/desktop/src/shared/market-seed';
import type { MarketAdded, MarketUpdate } from '../../apps/desktop/src/shared/market';
import type { Team } from '../../apps/desktop/src/shared/contracts';

/*
 * A crew listing is shown and added as a space (docs/marketplace-design.md): a space named after the listing, with its
 * orglets and the crew's channel inside it. A copy added the old way, with the channel outside every space, still updates.
 */

describe('adding a crew listing', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let servedVersion = 1;
  let servedBody = MARKET_SEED_BODIES['research-review:1'];

  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-market-crew-space-'));
    store = new Store(join(directory, 'state.sqlite'));
    // These cases update by hand; the automatic path, on by default, would take the update first.
    store.setSetting('marketAutoUpdate', false);
    core = new CoreService(store, () => {}, async () => { throw new Error('Adding a listing never calls a model.'); });
    servedVersion = 1;
    servedBody = MARKET_SEED_BODIES['research-review:1'];
    const seed = (await seedCatalog()).listings.find(item => item.listingId === 'research-review')!;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/catalog') return new Response(JSON.stringify({ listings: [{ ...seed, version: servedVersion, sha256: sha256(servedBody), changelog: 'Renamed.' }] }));
      if (path.startsWith('/v1/listings/research-review/versions/')) return new Response(servedBody);
      return new Response(null, { status: 404 });
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const crewChannelsOf = (teamId: string) => emptyChannels(store).filter(channel => channel.crewId === teamId);

  it('makes one space named after the listing, with its orglets and its lead channel, and nothing in Channels', async () => {
    const added = await core.command('marketAdd', { listingId: 'research-review', version: 1 }) as MarketAdded;
    adoptCrews(store, () => new Date().toISOString());
    const workspace = store.workspace();
    const space = workspace.spaces.find(item => item.id === added.spaceId)!;
    expect(workspace.spaces).toHaveLength(1);
    expect(space.name).toBe('Research and review');
    expect(space.orgletIds).toEqual(added.workerIds);
    const channels = crewChannelsOf(added.entityId);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ spaceId: space.id, access: 'listed', crewId: added.entityId });
    expect(core.channels.loose()).toEqual([]);
    expect(core.channels.inSpace(space.id)).toEqual([channels[0].id]);
  });

  it('updates a copy added as a space and a copy added the old way, outside every space', async () => {
    const asSpace = await core.command('marketAdd', { listingId: 'research-review', version: 1 }) as MarketAdded;
    const oldWay = await new Marketplace(store, () => {}, { defaultModel: async () => ({ provider: 'demo' }), followCrew: team => core.channels.followCrew(team) }).add('research-review', 1);
    adoptCrews(store, () => new Date().toISOString());
    expect(core.channels.loose().map(channel => channel.crewId)).toEqual([oldWay.entityId]);

    const template = JSON.parse(servedBody);
    template.team.name = 'Updated review crew';
    servedBody = JSON.stringify(template);
    servedVersion = 2;
    await core.command('marketCatalog', { refresh: true });

    for (const copy of [asSpace, oldWay]) {
      const preview = await core.command('marketPreviewUpdate', { entityId: copy.entityId }) as MarketUpdate;
      await core.command('marketApplyUpdate', { entityId: copy.entityId, token: preview.token });
      expect(store.get<Team>('teams', copy.entityId).name).toBe('Updated review crew');
      expect(crewChannelsOf(copy.entityId).map(channel => channel.name)).toEqual(['Updated review crew']);
    }
    expect(crewChannelsOf(asSpace.entityId)[0].spaceId).toBe(asSpace.spaceId);
    expect(crewChannelsOf(oldWay.entityId)[0].spaceId).toBeUndefined();
    expect(core.market.installations().map(item => item.version)).toEqual([2, 2]);
  });
});
