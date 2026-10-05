import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import type { RunningItem } from '../../apps/desktop/src/shared/running';
import { categoryNames, groupChannels, workingOrgletIds } from '../../apps/desktop/src/renderer/areas';
import { folderKey, spaceFolderNames } from '../../apps/desktop/src/renderer/areas';
import { DITHER_CELLS, ditherCellOn, spaceHues, spaceInitials } from '../../apps/desktop/src/renderer/components/SpaceMark';
import { SAVED_LIMIT, SAVED_TEXT_LIMIT, savedExcerpt, withSaved, withoutSaved, type SavedMessage } from '../../apps/desktop/src/renderer/saved';
import { activityCounts } from '../../apps/desktop/src/renderer/components/ActivityPage';

/*
 * COD-366: the area rail. The pure parts are tested here: which friends a tab and a search show, how channels group under
 * categories, what Saved keeps, what Activity counts, and a channel's category through the core.
 */

function orglet(name: string, description = ''): Worker {
  return { id: name.toLowerCase(), name, description, instructions: 'x', provider: 'demo', skillId: 's', revision: 1 } as Worker;
}

const running = (worker: Worker, state: RunningItem['state']): RunningItem => ({ key: `${worker.id}:${state}`, taskId: 't', state, worker, provider: 'demo' });

describe('Friends', () => {
  const friends = [orglet('Kế toán', 'Làm sổ sách'), orglet('Researcher', 'Reads sources'), orglet('Writer', 'Drafts')];

  it('counts only the orglets with a run going as working', () => {
    const working = workingOrgletIds([running(friends[1], 'running'), running(friends[2], 'queued'), running(friends[0], 'paused')]);
    expect([...working]).toEqual(['researcher']);
  });

});

describe('channels under categories', () => {
  const channels = [
    { name: 'launch', category: 'Projects' },
    { name: 'random' },
    { name: 'ideas', category: 'projects' },
    { name: 'ops', category: 'Ops' },
    { name: 'blank', category: '  ' },
  ];

  it('lists the channels with no category first, then the categories in alphabetical order, each keeping its channels order', () => {
    const groups = groupChannels(channels, channel => channel.category);
    expect(groups.map(group => group.name)).toEqual([undefined, 'Ops', 'Projects']);
    expect(groups[0].entries.map(channel => channel.name)).toEqual(['random', 'blank']);
    expect(groups[2].entries.map(channel => channel.name)).toEqual(['launch', 'ideas']);
  });

  it('makes no group for no channels and offers each category once, spelt as first used', () => {
    expect(groupChannels([], () => undefined)).toEqual([]);
    expect(categoryNames(channels.map(channel => channel.category))).toEqual(['Ops', 'Projects']);
  });
});

describe('Saved', () => {
  const saved = (id: string): SavedMessage => ({ taskId: 'task', messageId: id, author: 'Researcher', text: id, savedAt: '2026-10-01T10:00:00.000Z' });

  it('keeps the first words of a message, squeezed, and says when it cut', () => {
    expect(savedExcerpt('  one\n\n two   three ')).toBe('one two three');
    const long = savedExcerpt(`${'word '.repeat(100)}`);
    expect(long.length).toBeLessThanOrEqual(SAVED_TEXT_LIMIT);
    expect(long.endsWith('…')).toBe(true);
  });

  it('moves a message saved again to the top, takes one off, and stays bounded', () => {
    const list = withSaved(withSaved([], saved('a')), saved('b'));
    expect(withSaved(list, saved('a')).map(item => item.messageId)).toEqual(['a', 'b']);
    expect(withoutSaved(list, 'task', 'a').map(item => item.messageId)).toEqual(['b']);
    let many: SavedMessage[] = [];
    for (let index = 0; index < SAVED_LIMIT + 5; index++) many = withSaved(many, saved(String(index)));
    expect(many).toHaveLength(SAVED_LIMIT);
    expect(many[0].messageId).toBe(String(SAVED_LIMIT + 4));
  });
});

describe('Activity counts', () => {
  it('counts what waits for the person apart from what runs, and adds the schedules and notes that need a look', () => {
    const writer = orglet('Writer');
    const items = [running(writer, 'running'), running(writer, 'queued'), { ...running(writer, 'paused'), wait: { kind: 'answer' } as const }];
    const counts = activityCounts(items, [], 2);
    expect(counts).toMatchObject({ needs: 3, running: 2, saved: 0 });
  });
});

describe('a channel category through the core', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-categories-'));
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ request: async () => { throw new Error('no model in this test'); } }));
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('is saved with the channel, kept by a change that leaves it out, and taken off by an empty one', async () => {
    const [scout] = store.all<Worker>('workers');
    const members = [{ kind: 'orglet' as const, id: scout.id }];
    const channelId = await core.command('createChannel', { name: 'launch', topic: '', category: ' Projects ', members }) as string;
    expect(store.workspace().emptyChannels.find(channel => channel.id === channelId)?.category).toBe('Projects');
    await core.command('updateChannel', { id: channelId, name: 'launch', topic: 'Friday', members });
    expect(store.workspace().emptyChannels.find(channel => channel.id === channelId)).toMatchObject({ category: 'Projects', topic: 'Friday' });
    await core.command('updateChannel', { id: channelId, name: 'launch', topic: 'Friday', category: 'Ops', members });
    expect(store.workspace().emptyChannels.find(channel => channel.id === channelId)?.category).toBe('Ops');
    await core.command('updateChannel', { id: channelId, name: 'launch', topic: 'Friday', category: '', members });
    expect(store.workspace().emptyChannels.find(channel => channel.id === channelId)?.category).toBeUndefined();
  });

  it('refuses a category longer than the limit', async () => {
    const [scout] = store.all<Worker>('workers');
    await expect(core.command('createChannel', { name: 'x', topic: '', category: 'c'.repeat(41), members: [{ kind: 'orglet', id: scout.id }] })).rejects.toThrow();
  });
});

describe('folders of spaces on the rail', () => {
  it('lists each folder once, as its first space spelled it, in the spaces\' order', () => {
    expect(spaceFolderNames([{ folder: 'Work' }, {}, { folder: ' clients' }, { folder: 'WORK' }, { folder: 'Clients' }])).toEqual(['Work', 'clients']);
    expect(spaceFolderNames([{}, { folder: '   ' }])).toEqual([]);
    expect(folderKey(' Work ')).toBe(folderKey('work'));
  });
});

describe('a space\'s mark on the rail', () => {
  it('takes two initials from the name', () => {
    expect(spaceInitials('Launch')).toBe('LA');
    expect(spaceInitials('  ra mắt sản phẩm ')).toBe('RM');
    expect(spaceInitials('Q')).toBe('Q');
    expect(spaceInitials('   ')).toBe('?');
  });

  it('picks the same gradient for a space every time, and never a yellow one', () => {
    const seeds = Array.from({ length: 200 }, (_, index) => `space-${index}`);
    for (const seed of seeds) expect(spaceHues(seed)).toEqual(spaceHues(seed));
    expect(new Set(seeds.map(seed => spaceHues(seed).join())).size).toBeGreaterThan(5);
    for (const seed of seeds) for (const hue of spaceHues(seed)) expect(hue >= 35 && hue <= 80).toBe(false);
  });

  it('dithers from the first colour at the top left to the second at the bottom right', () => {
    const on = (rows: readonly number[]) => rows.reduce((total, row) => total + Array.from({ length: DITHER_CELLS }, (_, column) => ditherCellOn(column, row)).filter(Boolean).length, 0);
    expect(ditherCellOn(0, 0)).toBe(false);
    expect(ditherCellOn(DITHER_CELLS - 1, DITHER_CELLS - 1)).toBe(true);
    // The second colour thickens row by row, and about half the tile ends up in each colour.
    expect(on([0, 1, 2, 3])).toBeLessThan(on([5, 6, 7, 8]));
    expect(on([5, 6, 7, 8])).toBeLessThan(on([10, 11, 12, 13]));
    const all = on(Array.from({ length: DITHER_CELLS }, (_, row) => row));
    expect(all).toBeGreaterThan(DITHER_CELLS * DITHER_CELLS * 0.4);
    expect(all).toBeLessThan(DITHER_CELLS * DITHER_CELLS * 0.6);
  });
});
