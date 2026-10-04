import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { Channel } from '../../apps/desktop/src/shared/channels';
import { categoryOrgletIds, membersInSpace, membersOutsideScope, scopeOrgletIds, Space } from '../../apps/desktop/src/shared/spaces';
import { parseArguments } from '../../apps/desktop/src/cli/arguments';
import { formatSpaces } from '../../apps/desktop/src/cli/output';

/*
 * Spaces (docs/spaces-design.md): a space holds categories and channels, and who is in a channel narrows from the
 * space down. Nothing widens on the way down, and an orglet taken out of a space leaves every channel in it.
 */

const ids = {
  space: '10000000-0000-4000-8000-000000000001',
  category: '20000000-0000-4000-8000-000000000001',
  narrow: '20000000-0000-4000-8000-000000000002',
  a: '30000000-0000-4000-8000-00000000000a',
  b: '30000000-0000-4000-8000-00000000000b',
  c: '30000000-0000-4000-8000-00000000000c',
};
const orglet = (id: string) => ({ kind: 'orglet' as const, id });

describe('who a place in a space has', () => {
  const space = Space.parse({
    id: ids.space,
    name: 'Launch',
    orgletIds: [ids.a, ids.b, ids.c],
    categories: [{ id: ids.category, name: 'Plan' }, { id: ids.narrow, name: 'Copy', orgletIds: [ids.c, ids.a] }],
  });

  it('gives a category every orglet of its space, or the ones it lists, in the space\'s order', () => {
    expect(categoryOrgletIds(space, ids.category)).toEqual([ids.a, ids.b, ids.c]);
    expect(categoryOrgletIds(space, ids.narrow)).toEqual([ids.a, ids.c]);
    expect(categoryOrgletIds(space, ids.space)).toEqual([]);
    expect(scopeOrgletIds(space, undefined)).toEqual([ids.a, ids.b, ids.c]);
  });

  it('resolves a channel that inherits to its whole scope, and a listed one to what its scope still has', () => {
    expect(membersInSpace({ members: [orglet(ids.b)], categoryId: ids.narrow }, space)).toEqual([orglet(ids.a), orglet(ids.c)]);
    expect(membersInSpace({ members: [orglet(ids.c), orglet(ids.b)], categoryId: ids.narrow, access: 'listed' }, space)).toEqual([orglet(ids.c)]);
    expect(membersInSpace({ members: [orglet(ids.b)], access: 'listed' }, space)).toEqual([orglet(ids.b)]);
  });

  it('names the listed members a scope does not have', () => {
    expect(membersOutsideScope([orglet(ids.a), orglet(ids.b)], [ids.a])).toEqual([orglet(ids.b)]);
    expect(membersOutsideScope([{ kind: 'crew', id: ids.a }], [ids.a])).toEqual([{ kind: 'crew', id: ids.a }]);
  });

  it('refuses a space with no orglet, a repeated orglet or a repeated category', () => {
    const base = { id: ids.space, name: 'Launch', orgletIds: [ids.a], categories: [] };
    expect(Space.safeParse({ ...base, orgletIds: [] }).success).toBe(false);
    expect(Space.safeParse({ ...base, orgletIds: [ids.a, ids.a] }).success).toBe(false);
    expect(Space.safeParse({ ...base, categories: [{ id: ids.category, name: 'x' }, { id: ids.category, name: 'y' }] }).success).toBe(false);
  });
});

describe('orglet spaces', () => {
  it('parses the command and prints each space with its channels', () => {
    expect(parseArguments(['spaces', '--json'])).toEqual({ kind: 'spaces', json: true });
    expect(formatSpaces({ spaces: [] })).toBe('No spaces yet.');
    const text = formatSpaces({ spaces: [{ name: 'Launch', orglets: ['Scout', 'Writer'], categories: ['Copy'], channels: [
      { name: 'general', access: 'inherit', orglets: ['Scout', 'Writer'] },
      { name: 'drafts', category: 'Copy', access: 'listed', orglets: ['Writer'] },
    ] }] });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Launch: Scout, Writer');
    expect(lines[1]).toContain('#general');
    expect(lines[1]).toContain('every orglet of its place');
    expect(lines[2]).toMatch(/#drafts\s+Copy\s+Writer/);
  });
});

describe('spaces in the core', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let scout: Worker;
  let writer: Worker;
  let editor: Worker;
  const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-spaces-'));
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => { throw new Error('Demo orglets never call a model.'); });
    scout = store.workspace().workers[0];
    writer = await core.command('saveWorker', { ...scout, id: undefined, name: 'Writer' }) as Worker;
    editor = await core.command('saveWorker', { ...scout, id: undefined, name: 'Editor' }) as Worker;
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function settled(taskId: string) {
    for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  }
  const space = (spaceId: string) => store.workspace().spaces.find(item => item.id === spaceId)!;
  const emptyChannel = (channelId: string): Channel => store.workspace().emptyChannels.find(channel => channel.id === channelId)!;
  const memberIds = (channel: Channel) => channel.members.map(member => member.id);
  const newSpace = (orgletIds: string[], categories: { name: string; orgletIds?: string[] }[] = []) =>
    core.command('createSpace', { name: 'Launch', orgletIds, categories }) as Promise<string>;

  it('saves a space with its orglets and categories, and refuses what its rules do not allow', async () => {
    const spaceId = await newSpace([scout.id, writer.id], [{ name: 'Plan' }, { name: 'Copy', orgletIds: [writer.id] }]);
    expect(space(spaceId)).toMatchObject({ name: 'Launch', orgletIds: [scout.id, writer.id], categories: [{ name: 'Plan' }, { name: 'Copy', orgletIds: [writer.id] }] });
    await expect(newSpace([])).rejects.toThrow();
    await expect(newSpace(['99999999-9999-4999-8999-999999999999'])).rejects.toThrow('lưu trữ hoặc xóa');
    await expect(newSpace([scout.id], [{ name: 'Copy', orgletIds: [writer.id] }])).rejects.toThrow('không gian của nó có');
    await expect(core.command('updateSpace', { id: '99999999-9999-4999-8999-999999999999', name: 'x', orgletIds: [scout.id], categories: [] })).rejects.toThrow('Không tìm thấy không gian');
    expect(store.workspace().spaces).toHaveLength(1);
  });

  it('gives a channel in a space the orglets of its place, and refuses a list wider than that place', async () => {
    const spaceId = await newSpace([scout.id, writer.id, editor.id], [{ name: 'Copy', orgletIds: [writer.id, editor.id] }]);
    const copy = space(spaceId).categories[0];
    const everyone = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    expect(emptyChannel(everyone)).toMatchObject({ spaceId, access: 'inherit' });
    expect(memberIds(emptyChannel(everyone))).toEqual([scout.id, writer.id, editor.id]);

    const inCopy = await core.command('createChannel', { name: 'drafts', topic: '', members: [orglet(scout.id)], spaceId, categoryId: copy.id }) as string;
    expect(memberIds(emptyChannel(inCopy))).toEqual([writer.id, editor.id]);

    const some = await core.command('createChannel', { name: 'review', topic: '', members: [orglet(editor.id)], spaceId, categoryId: copy.id, access: 'listed' }) as string;
    expect(emptyChannel(some)).toMatchObject({ access: 'listed', categoryId: copy.id });
    expect(memberIds(emptyChannel(some))).toEqual([editor.id]);

    await expect(core.command('createChannel', { name: 'wide', topic: '', members: [orglet(scout.id)], spaceId, categoryId: copy.id, access: 'listed' })).rejects.toThrow('mục hoặc không gian');
    await expect(core.command('updateChannel', { id: some, name: 'review', topic: '', members: [orglet(editor.id), orglet(scout.id)] })).rejects.toThrow('mục hoặc không gian');
    await expect(core.command('createChannel', { name: 'lost', topic: '', members: [orglet(scout.id)], spaceId, categoryId: spaceId })).rejects.toThrow('Không tìm thấy mục');
    await expect(core.command('createChannel', { name: 'lost', topic: '', members: [orglet(scout.id)], spaceId: copy.id })).rejects.toThrow('Không tìm thấy không gian');
  });

  it('takes an orglet out of every channel of a space when the space loses it, on rows and on empty channels', async () => {
    const spaceId = await newSpace([scout.id, writer.id, editor.id]);
    const written = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    const taskId = await core.command('createTask', { workerId: scout.id, channelId: written, brief: 'Plan the launch', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([scout.id, writer.id, editor.id]);
    const listed = await core.command('createChannel', { name: 'pair', topic: '', members: [orglet(writer.id), orglet(editor.id)], spaceId, access: 'listed' }) as string;

    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, editor.id], categories: [] });
    const row = store.get<Task>('tasks', taskId);
    expect(row.assignees).toEqual([scout.id, editor.id]);
    expect(memberIds(row.channel!)).toEqual([scout.id, editor.id]);
    expect(memberIds(emptyChannel(listed))).toEqual([editor.id]);
    // An orglet added to the space joins the channels that inherit, and not the ones with their own list.
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, editor.id, writer.id], categories: [] });
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([scout.id, editor.id, writer.id]);
    expect(memberIds(emptyChannel(listed))).toEqual([editor.id]);
  });

  it('refuses a save that would leave a channel with nobody, and keeps the space as it was', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const only = await core.command('createChannel', { name: 'solo', topic: '', members: [orglet(writer.id)], spaceId, access: 'listed' }) as string;
    await expect(core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id], categories: [] })).rejects.toThrow('chưa có Tí nào');
    expect(space(spaceId).orgletIds).toEqual([scout.id, writer.id]);
    expect(memberIds(emptyChannel(only))).toEqual([writer.id]);
  });

  it('keeps a lead channel\'s crew record in step, and refuses a save that would take its lead away', async () => {
    const spaceId = await newSpace([scout.id, writer.id, editor.id]);
    const channelId = await core.command('createChannel', { name: 'crew', topic: '', members: [orglet(scout.id)], spaceId, mode: 'lead', lead: { synthesizerId: editor.id } }) as string;
    const crewId = emptyChannel(channelId).crewId!;
    expect(store.get<Team>('teams', crewId).synthesizerId).toBe(editor.id);
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, editor.id], categories: [] });
    expect(store.get<Team>('teams', crewId)).toMatchObject({ synthesizerId: editor.id, memberIds: [scout.id, editor.id] });
    expect(memberIds(emptyChannel(channelId))).toEqual([scout.id, editor.id]);
    await expect(core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id], categories: [] })).rejects.toThrow('mất Tí trưởng');
    expect(space(spaceId).orgletIds).toEqual([scout.id, editor.id]);
    expect(store.get<Team>('teams', crewId).synthesizerId).toBe(editor.id);
  });

  it('narrows a category, drops one, and puts its channels directly in the space', async () => {
    const spaceId = await newSpace([scout.id, writer.id, editor.id], [{ name: 'Copy' }]);
    const copy = space(spaceId).categories[0];
    const channelId = await core.command('createChannel', { name: 'drafts', topic: '', members: [orglet(scout.id)], spaceId, categoryId: copy.id }) as string;
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, writer.id, editor.id], categories: [{ id: copy.id, name: 'Copy', orgletIds: [writer.id] }] });
    expect(space(spaceId).categories[0].id).toBe(copy.id);
    expect(memberIds(emptyChannel(channelId))).toEqual([writer.id]);
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, writer.id, editor.id], categories: [] });
    expect(emptyChannel(channelId).categoryId).toBeUndefined();
    expect(memberIds(emptyChannel(channelId))).toEqual([scout.id, writer.id, editor.id]);
  });

  it('moves a channel into a space with the orglets the space has, and out again with the ones it had', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const channelId = await core.command('createChannel', { name: 'ideas', topic: '', category: 'Loose', members: [orglet(writer.id), orglet(editor.id)] }) as string;
    await core.command('updateChannel', { id: channelId, name: 'ideas', topic: '', members: emptyChannel(channelId).members, spaceId });
    expect(emptyChannel(channelId)).toMatchObject({ spaceId, access: 'listed' });
    expect(emptyChannel(channelId).category).toBeUndefined();
    expect(memberIds(emptyChannel(channelId))).toEqual([writer.id]);
    await core.command('updateChannel', { id: channelId, name: 'ideas', topic: '', members: emptyChannel(channelId).members, spaceId: null });
    expect(emptyChannel(channelId).spaceId).toBeUndefined();
    expect(emptyChannel(channelId).access).toBeUndefined();
    expect(memberIds(emptyChannel(channelId))).toEqual([writer.id]);
  });

  it('deletes a space and leaves its channels outside every space with the orglets they had', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const channelId = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    await core.command('deleteSpace', { id: spaceId });
    expect(store.workspace().spaces).toEqual([]);
    expect(emptyChannel(channelId).spaceId).toBeUndefined();
    expect(memberIds(emptyChannel(channelId))).toEqual([scout.id, writer.id]);
    await expect(core.command('deleteSpace', { id: spaceId })).rejects.toThrow('Không tìm thấy không gian');
  });

  it('makes a space from a category of loose channels, each keeping its own orglets', async () => {
    const first = await core.command('createChannel', { name: 'plan', topic: '', category: 'Launch', members: [orglet(scout.id)] }) as string;
    const second = await core.command('createChannel', { name: 'copy', topic: '', category: 'launch', members: [orglet(writer.id), orglet(editor.id)] }) as string;
    const other = await core.command('createChannel', { name: 'misc', topic: '', category: 'Other', members: [orglet(scout.id)] }) as string;
    const spaceId = await core.command('spaceFromCategory', { category: 'Launch' }) as string;
    expect(space(spaceId)).toMatchObject({ name: 'Launch', orgletIds: [scout.id, writer.id, editor.id], categories: [] });
    expect(emptyChannel(first)).toMatchObject({ spaceId, access: 'listed' });
    expect(memberIds(emptyChannel(first))).toEqual([scout.id]);
    expect(memberIds(emptyChannel(second))).toEqual([writer.id, editor.id]);
    expect(emptyChannel(other).spaceId).toBeUndefined();
    await expect(core.command('spaceFromCategory', { category: 'Nothing here' })).rejects.toThrow('Không có kênh nào');
  });

  it('starts a new channel with the permissions its space sets, unless the person chose some for that channel', async () => {
    const spaceId = await core.command('createSpace', { name: 'Launch', orgletIds: [scout.id, writer.id], categories: [], defaults: { capabilities: ['network.web'] } }) as string;
    expect(space(spaceId).defaults).toEqual({ capabilities: ['network.web'] });
    const first = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    const firstTask = await core.command('createTask', { workerId: scout.id, channelId: first, brief: 'Plan', ...message }) as string;
    await settled(firstTask);
    expect(store.get<Task>('tasks', firstTask).toolCapabilities).toEqual(['skill.read', 'app.propose', 'network.web']);
    // A save that leaves the defaults out keeps them, and `null` goes back to the app's own.
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, writer.id], categories: [] });
    expect(space(spaceId).defaults).toEqual({ capabilities: ['network.web'] });
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id, writer.id], categories: [], defaults: null });
    expect(space(spaceId).defaults).toBeUndefined();
    const second = await core.command('createChannel', { name: 'plain', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    const secondTask = await core.command('createTask', { workerId: scout.id, channelId: second, brief: 'Plan', ...message }) as string;
    await settled(secondTask);
    expect(store.get<Task>('tasks', secondTask).toolCapabilities ?? []).not.toContain('network.web');
    await expect(core.command('createSpace', { name: 'Wide', orgletIds: [scout.id], categories: [], defaults: { capabilities: ['browser.act'] } })).rejects.toThrow();
  });

  it('refuses to save a space while one of its channels is working', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const channelId = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    const taskId = await core.command('createTask', { workerId: scout.id, channelId, brief: 'Plan the launch', ...message }) as string;
    await settled(taskId);
    store.patchTask(taskId, { status: 'running' });
    await expect(core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [scout.id], categories: [] })).rejects.toThrow('đang chạy');
    await expect(core.command('deleteSpace', { id: spaceId })).rejects.toThrow('đang chạy');
    expect(space(spaceId).orgletIds).toEqual([scout.id, writer.id]);
  });

  it('reads a channel whose space is gone as a channel outside every space', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const channelId = await core.command('createChannel', { name: 'general', topic: '', members: [orglet(scout.id)], spaceId }) as string;
    // A restored backup carries the channel's record and not the settings row that held its space.
    store.setSetting('spaces', []);
    await core.command('updateChannel', { id: channelId, name: 'general', topic: '', members: [orglet(writer.id)] });
    expect(emptyChannel(channelId).spaceId).toBeUndefined();
    expect(memberIds(emptyChannel(channelId))).toEqual([writer.id]);
  });
});
