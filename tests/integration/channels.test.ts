import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { migrateGroupChats } from '../../apps/desktop/src/core/storage/channels';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { Channel, channelNameFrom, channelOrgletIds, isChannelChat, isLegacyGroupChat } from '../../apps/desktop/src/shared/channels';
import { liveWorkerTask, newChatKey, newChatKeyNames } from '../../apps/desktop/src/shared/live-task';
import { channelFromRecipient, channelMembersFromSelection, channelRecipient, channelTaskInput, emptyChannelKey, memberNames, openChannelChats, openEmptyChannel, sidebarChannels } from '../../apps/desktop/src/renderer/channelChat';
import { noSelection } from '../../apps/desktop/src/renderer/sidebarSelection';

/*
 * COD-361: group chats become channels, named chats whose members are orglets and crews. A channel is the group
 * chat's row with a `channel` record; `assignees` keeps the orglets its members expand to, so the runner reads it as
 * before. An empty channel has no row until its first message.
 */

const roster = {
  workers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  teams: [{ id: 'crew', memberIds: ['b', 'c'], synthesizerId: 'a' }],
};

describe('channel members', () => {
  it('expand to orglets: orglets first in order, a crew as its members then its lead, each once', () => {
    expect(channelOrgletIds([{ kind: 'orglet', id: 'c' }, { kind: 'crew', id: 'crew' }], roster)).toEqual(['c', 'b', 'a']);
  });

  it('leave out orglets and crews that are no longer listed', () => {
    expect(channelOrgletIds([{ kind: 'orglet', id: 'gone' }, { kind: 'crew', id: 'old-crew' }, { kind: 'orglet', id: 'b' }], roster)).toEqual(['b']);
  });

  it('keep a name without its leading #, and refuse an empty name or a repeated member', () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', members: [{ kind: 'orglet', id: '22222222-2222-4222-8222-222222222222' }] };
    expect(Channel.parse({ ...base, name: '  #launch ' }).name).toBe('launch');
    expect(Channel.safeParse({ ...base, name: '#' }).success).toBe(false);
    expect(Channel.safeParse({ ...base, name: 'x', members: [...base.members, ...base.members] }).success).toBe(false);
    expect(Channel.safeParse({ ...base, name: 'x', members: [{ kind: 'person', id: base.id }] }).success).toBe(false);
  });

  it('make a name from member names, cut to the limit', () => {
    expect(channelNameFrom(['Scout', 'Writer'])).toBe('Scout, Writer');
    expect(channelNameFrom(['x'.repeat(100)])).toHaveLength(80);
    expect(channelNameFrom([])).toBe('channel');
  });

  it('tell a group chat from before channels from a channel and from other chats', () => {
    expect(isLegacyGroupChat({ assignees: ['a', 'b'] })).toBe(true);
    expect(isLegacyGroupChat({ assignees: 'all' })).toBe(true);
    expect(isLegacyGroupChat({ assignees: ['a'] })).toBe(false);
    expect(isLegacyGroupChat({ assignees: ['a', 'b'], teamId: 't' })).toBe(false);
    expect(isLegacyGroupChat({ assignees: ['a', 'b'], routineId: 'r' })).toBe(false);
    expect(isLegacyGroupChat({ assignees: ['a', 'b'], sideOf: {} })).toBe(false);
    expect(isChannelChat({ assignees: ['a'], channel: {} })).toBe(true);
    expect(isLegacyGroupChat({ assignees: ['a', 'b'], channel: {} })).toBe(false);
  });
});

describe('an empty channel in the window', () => {
  const empty = { id: 'ch', name: 'launch', topic: 'Ship it', members: [{ kind: 'crew' as const, id: 'crew' }], createdAt: '2026-10-01T10:00:00.000Z' };

  it('is the empty chat of the orglets its members expand to', () => {
    const open = openEmptyChannel('ch', [empty], roster)!;
    expect(open).toMatchObject({ channelId: 'ch', name: 'launch', topic: 'Ship it', workerIds: ['b', 'c', 'a'] });
    expect(emptyChannelKey(open)).toBe(newChatKey({ workerIds: ['a', 'b', 'c'] }));
    expect(channelTaskInput(open, { brief: 'Hi' })).toEqual({ brief: 'Hi', channelId: 'ch', workerId: 'b', assignees: ['b', 'c', 'a'] });
  });

  it('is gone once it is not listed or nobody in it can answer', () => {
    expect(openEmptyChannel('other', [empty], roster)).toBeUndefined();
    expect(openEmptyChannel('ch', [empty], { workers: [], teams: [] })).toBeUndefined();
    expect(openEmptyChannel(undefined, [empty], roster)).toBeUndefined();
  });

  it('round-trips through the navigation recipient', () => {
    expect(channelFromRecipient(channelRecipient('ch'))).toBe('ch');
    expect(channelFromRecipient('team:t')).toBeUndefined();
    expect(channelFromRecipient('channel:')).toBeUndefined();
  });

  it('can be started from two or more orglets, or any crews, picked in the sidebar', () => {
    expect(channelMembersFromSelection({ section: 'workers', ids: ['b', 'a'], anchor: 'a' })).toEqual([{ kind: 'orglet', id: 'b' }, { kind: 'orglet', id: 'a' }]);
    expect(channelMembersFromSelection({ section: 'workers', ids: ['a'], anchor: 'a' })).toBeUndefined();
    expect(channelMembersFromSelection({ section: 'teams', ids: ['t'], anchor: 't' })).toEqual([{ kind: 'crew', id: 't' }]);
    expect(channelMembersFromSelection(noSelection)).toBeUndefined();
  });

  it('names a few members at a glance and leaves more to a count', () => {
    expect(memberNames(['A', 'B', 'C'])).toBe('A, B, C');
    expect(memberNames(['A', 'B', 'C', 'D'])).toBeUndefined();
  });

  it('keeps permissions keyed by its orglets, which a deleted orglet takes with it', () => {
    expect(newChatKeyNames(newChatKey({ workerIds: ['a'] }), 'a')).toBe(true);
  });
});

describe('the sidebar Channels section', () => {
  const chat = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({ id, createdAt, workerId: 'a', assignees: ['a', 'b'], ...extra });
  const empty = { id: 'empty', name: 'ideas', members: [{ kind: 'orglet' as const, id: 'a' }], createdAt: '2026-09-26T10:00:00.000Z' };

  it('lists channels with messages and empty ones together, newest first', () => {
    const tasks = [chat('older', '2026-09-24T10:00:00.000Z', { channel: { id: 'x', name: 'older' } }), chat('newer', '2026-09-25T10:00:00.000Z', { assignees: ['a'], channel: { id: 'y', name: 'newer' } })];
    expect(sidebarChannels(tasks, [empty]).map(entry => entry.kind === 'chat' ? entry.task.id : entry.channel.id)).toEqual(['empty', 'newer', 'older']);
    expect(openChannelChats(tasks).map(task => task.id)).toEqual(['newer', 'older']);
  });

  it('leaves out DMs, crews, side threads, schedule runs, archived and deleted chats', () => {
    const tasks = [
      { id: 'solo', createdAt: '2026-09-25T10:00:00.000Z', workerId: 'a' },
      chat('crew', '2026-09-25T10:00:00.000Z', { teamId: 'crew' }),
      chat('side', '2026-09-25T10:00:00.000Z', { sideOf: { taskId: 'x', throughRevision: 0 } }),
      chat('scheduled', '2026-09-25T10:00:00.000Z', { routineId: 'routine' }),
      chat('archived', '2026-09-25T10:00:00.000Z', { archivedAt: '2026-09-25T11:00:00.000Z' }),
      chat('deleted', '2026-09-25T10:00:00.000Z', { deletedAt: '2026-09-25T11:00:00.000Z' }),
      chat('kept', '2026-09-25T10:00:00.000Z'),
    ];
    expect(openChannelChats(tasks).map(task => task.id)).toEqual(['kept']);
  });
});

describe('channels in the core', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let scout: Worker;
  let writer: Worker;
  let editor: Worker;
  const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-channels-'));
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

  it('creates an empty channel with no row, and its first message makes the row with the channel on it', async () => {
    const crew = await core.command('saveTeam', { name: 'Launch crew', instructions: 'Combine.', memberIds: [writer.id], synthesizerId: editor.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 }) as Team;
    const channelId = await core.command('createChannel', { name: '#launch', topic: 'Ship it', members: [{ kind: 'orglet', id: scout.id }, { kind: 'crew', id: crew.id }] }) as string;
    expect(store.workspace().emptyChannels).toMatchObject([{ id: channelId, name: 'launch', topic: 'Ship it' }]);
    expect(store.workspace().tasks).toHaveLength(0);
    const taskId = await core.command('createTask', { workerId: scout.id, channelId, brief: 'Plan the launch', ...message }) as string;
    await settled(taskId);
    const task = store.get<Task>('tasks', taskId);
    expect(task.channel).toMatchObject({ id: channelId, name: 'launch', topic: 'Ship it' });
    expect(task.assignees).toEqual([scout.id, writer.id, editor.id]);
    expect(store.workspace().emptyChannels).toEqual([]);
    expect(store.workspace().tasks.find(row => row.id === taskId)?.title).toBe('launch');
    // A channel is never an orglet's main chat, even with one orglet in it.
    expect(liveWorkerTask(store.workspace().tasks, scout.id)).toBeUndefined();
  });

  it('renames, sets the topic and changes the members of a channel, empty or written in', async () => {
    const channelId = await core.command('createChannel', { name: 'ideas', topic: '', members: [{ kind: 'orglet', id: scout.id }] }) as string;
    await core.command('updateChannel', { id: channelId, name: 'ideas-2', topic: 'Anything', members: [{ kind: 'orglet', id: writer.id }] });
    expect(store.workspace().emptyChannels[0]).toMatchObject({ name: 'ideas-2', topic: 'Anything', members: [{ kind: 'orglet', id: writer.id }] });
    const taskId = await core.command('createTask', { workerId: writer.id, channelId, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId)).toMatchObject({ workerId: writer.id, assignees: [writer.id] });
    await core.command('updateChannel', { id: channelId, name: 'ideas', topic: '', members: [{ kind: 'orglet', id: editor.id }, { kind: 'orglet', id: scout.id }] });
    const updated = store.get<Task>('tasks', taskId);
    expect(updated).toMatchObject({ workerId: editor.id, assignees: [editor.id, scout.id] });
    expect(updated.channel).toEqual({ id: channelId, name: 'ideas', members: [{ kind: 'orglet', id: editor.id }, { kind: 'orglet', id: scout.id }] });
    // Renaming the chat renames the channel; its auto title never does.
    await core.command('renameTask', { id: taskId, title: 'brainstorm' });
    expect(store.get<Task>('tasks', taskId).channel?.name).toBe('brainstorm');
    await expect(core.command('renameTask', { id: taskId, title: '' })).rejects.toThrow('Kênh cần một tên.');
    // The chat's own settings keep only the limit for a channel.
    await core.command('updateTask', { id: taskId, title: 'other', assignee: { kind: 'workers', workerIds: [scout.id] }, budgetMicros: 900_000 });
    expect(store.get<Task>('tasks', taskId)).toMatchObject({ budgetMicros: 900_000, assignees: [editor.id, scout.id], channel: { name: 'brainstorm' } });
  });

  it('refuses a channel nobody in it can answer, and members that are not listed', async () => {
    await expect(core.command('createChannel', { name: 'x', topic: '', members: [{ kind: 'orglet', id: '99999999-9999-4999-8999-999999999999' }] })).rejects.toThrow('lưu trữ hoặc xóa');
    await expect(core.command('createChannel', { name: 'x', topic: '', members: [] })).rejects.toThrow();
  });

  it('deletes an empty channel, and a written-in one only as a chat', async () => {
    const emptyId = await core.command('createChannel', { name: 'scratch', topic: '', members: [{ kind: 'orglet', id: scout.id }] }) as string;
    await core.command('deleteChannel', { id: emptyId });
    expect(store.workspace().emptyChannels).toEqual([]);
    const channelId = await core.command('createChannel', { name: 'kept', topic: '', members: [{ kind: 'orglet', id: scout.id }] }) as string;
    const taskId = await core.command('createTask', { workerId: scout.id, channelId, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    await expect(core.command('deleteChannel', { id: channelId })).rejects.toThrow('đã có tin nhắn');
    await core.command('archiveTask', { id: taskId, archived: true });
    expect(store.get<Task>('tasks', taskId).archivedAt).toBeTruthy();
    await core.command('deleteTask', { id: taskId });
    expect(store.workspace().tasks.find(row => row.id === taskId)).toBeUndefined();
  });

  it('follows a crew whose members change', async () => {
    const crew = await core.command('saveTeam', { name: 'Crew', instructions: 'Combine.', memberIds: [writer.id], synthesizerId: writer.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 }) as Team;
    const channelId = await core.command('createChannel', { name: 'crew-room', topic: '', members: [{ kind: 'crew', id: crew.id }] }) as string;
    const taskId = await core.command('createTask', { workerId: writer.id, channelId, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    await core.command('saveTeam', { ...crew, memberIds: [editor.id, scout.id], synthesizerId: writer.id, expectedRevision: crew.revision });
    expect(store.get<Task>('tasks', taskId)).toMatchObject({ workerId: editor.id, assignees: [editor.id, scout.id, writer.id] });
  });

  it('makes a channel of a chat several orglets were given some other way', async () => {
    const taskId = await core.command('createTask', { workerId: scout.id, assignees: [scout.id, writer.id], brief: 'Compare', ...message }) as string;
    await settled(taskId);
    const task = store.get<Task>('tasks', taskId);
    expect(task.channel).toMatchObject({ name: 'Researcher, Writer', members: [{ kind: 'orglet', id: scout.id }, { kind: 'orglet', id: writer.id }] });
  });

  it('migrates group chats from before channels without losing their history, once', async () => {
    const titled: Task = { id: '11111111-0000-4000-8000-000000000000', workerId: scout.id, assignees: [scout.id, writer.id], brief: 'Old group', status: 'completed', createdAt: '2026-09-20T10:00:00.000Z', budgetMicros: 500_000, sourceIds: [], consent: true, accepted: false, inputRevision: 3 };
    const untitled: Task = { ...titled, id: '22222222-0000-4000-8000-000000000000', archivedAt: '2026-09-21T10:00:00.000Z' };
    const everyone: Task = { ...titled, id: '33333333-0000-4000-8000-000000000000', assignees: 'all' };
    const solo: Task = { ...titled, id: '44444444-0000-4000-8000-000000000000', assignees: undefined };
    for (const row of [titled, untitled, everyone, solo]) store.put('tasks', row);
    store.setSetting('taskTitles', { [titled.id]: 'Launch plan', [solo.id]: 'Solo chat' });
    expect(migrateGroupChats(store)).toBe(3);
    const migrated = store.get<Task>('tasks', titled.id);
    expect(migrated).toMatchObject({ brief: 'Old group', inputRevision: 3, assignees: [scout.id, writer.id], channel: { name: 'Launch plan', members: [{ kind: 'orglet', id: scout.id }, { kind: 'orglet', id: writer.id }] } });
    expect(store.get<Task>('tasks', untitled.id)).toMatchObject({ archivedAt: untitled.archivedAt, channel: { name: 'Researcher, Writer' } });
    expect(store.get<Task>('tasks', everyone.id)).toMatchObject({ assignees: [scout.id, writer.id, editor.id], channel: { name: 'Researcher, Writer, Editor' } });
    expect(store.get<Task>('tasks', solo.id).channel).toBeUndefined();
    // The name moved onto the channel; the solo chat keeps its title.
    expect(store.setting('taskTitles', {})).toEqual({ [solo.id]: 'Solo chat' });
    expect(migrateGroupChats(store)).toBe(0);
    expect(store.get<Task>('tasks', titled.id).channel?.id).toBe(migrated.channel?.id);
  });

  it('migrates when the workspace opens', async () => {
    const path = join(directory, 'state.sqlite');
    const legacy: Task = { id: '55555555-0000-4000-8000-000000000000', workerId: scout.id, assignees: [scout.id, writer.id], brief: 'Old group', status: 'completed', createdAt: '2026-09-20T10:00:00.000Z', budgetMicros: 500_000, sourceIds: [], consent: true, accepted: false };
    store.put('tasks', legacy);
    await core.runner.shutdown();
    store.close();
    store = new Store(path);
    core = new CoreService(store, () => {}, async () => { throw new Error('Demo orglets never call a model.'); });
    expect(store.get<Task>('tasks', legacy.id).channel?.name).toBe('Researcher, Writer');
  });
});
