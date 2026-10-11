import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Team, UnfriendResult, Worker } from '../../apps/desktop/src/shared/contracts';
import type { Channel } from '../../apps/desktop/src/shared/channels';
import { orgletPlaces } from '../../apps/desktop/src/shared/unfriend';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

/*
 * Unfriending an orglet: it leaves the person's DMs, and the person chooses per space or channel to kick it out
 * (the default) or keep it there. An orglet kept somewhere is marked unfriended instead of deleted.
 */

const orglet = (id: string) => ({ kind: 'orglet' as const, id });

describe('unfriending an orglet in the core', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let scout: Worker;
  let writer: Worker;
  let editor: Worker;
  const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-unfriend-'));
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
  const unfriend = (workerId: string, keep: { kind: 'space' | 'channel'; id: string }[] = []) =>
    core.command('unfriendWorker', { id: workerId, keep }) as Promise<UnfriendResult>;
  const placesOf = (workerId: string) => orgletPlaces(store.workspace(), workerId);
  const newSpace = (orgletIds: string[]) => core.command('createSpace', { name: 'Launch', orgletIds, categories: [] }) as Promise<string>;
  const newChannel = (name: string, memberIds: string[], extra: Record<string, unknown> = {}) =>
    core.command('createChannel', { name, topic: '', members: memberIds.map(orglet), ...extra }) as Promise<string>;
  const emptyChannel = (channelId: string): Channel => store.workspace().emptyChannels.find(channel => channel.id === channelId)!;
  const memberIds = (channel: Channel) => channel.members.map(member => member.id);
  const liveWorkerIds = () => store.workspace().workers.map(worker => worker.id);

  it('lists the spaces and channels an orglet is in, every one of them leavable', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    await newChannel('inside', [scout.id], { spaceId });
    const turns = await newChannel('turns', [scout.id, writer.id]);
    const lead = await newChannel('lead', [scout.id, writer.id], { mode: 'lead' });
    const alone = await newChannel('alone', [scout.id]);
    const soloSpace = await core.command('createSpace', { name: 'Solo', orgletIds: [scout.id], categories: [] }) as string;
    await newChannel('elsewhere', [writer.id]);

    const places = placesOf(scout.id);
    expect(places.slice(0, 2)).toEqual([
      { kind: 'space', id: spaceId, name: 'Launch' },
      { kind: 'space', id: soloSpace, name: 'Solo' },
    ]);
    expect(places.slice(2)).toHaveLength(3);
    expect(places.slice(2)).toEqual(expect.arrayContaining([
      { kind: 'channel', id: turns, name: 'turns' },
      { kind: 'channel', id: lead, name: 'lead' },
      { kind: 'channel', id: alone, name: 'alone' },
    ]));
    expect(placesOf(editor.id)).toEqual([]);
  });

  it('lets an orglet leave a space where it was the only one in a channel: that channel takes the space\'s orglets', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const solo = await newChannel('solo', [scout.id], { spaceId, access: 'listed' });
    const soloLead = await newChannel('solo lead', [scout.id], { spaceId, access: 'listed', mode: 'lead' });
    expect(placesOf(scout.id)).toEqual([{ kind: 'space', id: spaceId, name: 'Launch' }]);

    expect(await unfriend(scout.id)).toEqual({ outcome: 'deleted', kicked: 1, kept: 0 });
    expect(memberIds(emptyChannel(solo))).toEqual([writer.id]);
    expect(memberIds(emptyChannel(soloLead))).toEqual([writer.id]);
    const crew = store.get<Team>('teams', emptyChannel(soloLead).crewId!);
    expect(crew.synthesizerId).toBe(writer.id);
  });

  it('lets an orglet leave a space whose category lists only it, and the category is then empty', async () => {
    const categoryId = '11111111-1111-4111-8111-111111111111';
    const spaceId = await core.command('createSpace', { name: 'Launch', orgletIds: [scout.id, writer.id], categories: [{ id: categoryId, name: 'Field', orgletIds: [scout.id] }] }) as string;
    expect(placesOf(scout.id)).toEqual([{ kind: 'space', id: spaceId, name: 'Launch' }]);
    expect(await unfriend(scout.id)).toEqual({ outcome: 'deleted', kicked: 1, kept: 0 });
    const space = store.workspace().spaces.find(item => item.id === spaceId)!;
    expect(space.orgletIds).toEqual([writer.id]);
    expect(space.categories[0].orgletIds).toEqual([]);
  });

  it('deletes the orglet when every place lets it go', async () => {
    const spaceId = await newSpace([editor.id, writer.id]);
    const inSpace = await newChannel('inside', [editor.id], { spaceId });
    const loose = await newChannel('loose', [editor.id, writer.id]);

    expect(await unfriend(editor.id)).toEqual({ outcome: 'deleted', kicked: 2, kept: 0 });
    expect(liveWorkerIds()).not.toContain(editor.id);
    expect(store.workspace().spaces.find(space => space.id === spaceId)!.orgletIds).toEqual([writer.id]);
    expect(memberIds(emptyChannel(inSpace))).toEqual([writer.id]);
    expect(memberIds(emptyChannel(loose))).toEqual([writer.id]);
  });

  it('marks the orglet unfriended and keeps it where the person chose, and takes it out of the rest', async () => {
    const spaceId = await newSpace([editor.id, writer.id]);
    const inSpace = await newChannel('inside', [editor.id], { spaceId });
    const loose = await newChannel('loose', [editor.id, writer.id]);

    expect(await unfriend(editor.id, [{ kind: 'channel', id: loose }])).toEqual({ outcome: 'unfriended', kicked: 1, kept: 1 });
    const row = store.workspace().workers.find(worker => worker.id === editor.id)!;
    expect(row.unfriendedAt).toBeDefined();
    expect(store.workspace().archivedWorkers.map(worker => worker.id)).not.toContain(editor.id);
    expect(memberIds(emptyChannel(loose))).toEqual([editor.id, writer.id]);
    expect(memberIds(emptyChannel(inSpace))).toEqual([writer.id]);
    expect(placesOf(editor.id).map(place => place.id)).toEqual([loose]);
  });

  it('keeps an unfriended orglet answering in the place that kept it', async () => {
    const loose = await newChannel('loose', [editor.id, writer.id]);
    await unfriend(editor.id, [{ kind: 'channel', id: loose }]);
    const taskId = await core.command('createTask', { workerId: editor.id, channelId: loose, brief: 'Edit this', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([editor.id, writer.id]);
  });

  it('hands the lead to the first remaining member in a new revision of the crew', async () => {
    const lead = await newChannel('lead', [scout.id, writer.id, editor.id], { mode: 'lead', lead: { synthesizerId: scout.id } });
    const crewId = emptyChannel(lead).crewId!;
    const before = store.get<Team>('teams', crewId);
    expect(before.synthesizerId).toBe(scout.id);

    expect(await unfriend(scout.id)).toEqual({ outcome: 'deleted', kicked: 1, kept: 0 });
    const after = store.workspace().teams.find(team => team.id === crewId)!;
    expect(after.synthesizerId).toBe(writer.id);
    expect(after.memberIds).not.toContain(scout.id);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(memberIds(emptyChannel(lead))).toEqual([writer.id, editor.id]);
  });

  it('lets the last orglet leave a space and a loose turn channel, and both stay empty', async () => {
    const spaceId = await newSpace([editor.id]);
    const inSpace = await newChannel('inside', [editor.id], { spaceId });
    const alone = await newChannel('alone', [editor.id]);

    expect(await unfriend(editor.id)).toEqual({ outcome: 'deleted', kicked: 2, kept: 0 });
    expect(liveWorkerIds()).not.toContain(editor.id);
    const space = store.workspace().spaces.find(item => item.id === spaceId)!;
    expect(space.orgletIds).toEqual([]);
    expect(memberIds(emptyChannel(inSpace))).toEqual([]);
    expect(memberIds(emptyChannel(alone))).toEqual([]);
  });

  it('lets the last orglet leave a lead channel: the channel stays and falls back to taking turns', async () => {
    const lead = await newChannel('lead', [editor.id], { mode: 'lead' });
    const crewId = emptyChannel(lead).crewId!;
    expect(crewId).toBeDefined();

    expect(await unfriend(editor.id)).toEqual({ outcome: 'deleted', kicked: 1, kept: 0 });
    expect(memberIds(emptyChannel(lead))).toEqual([]);
    expect(emptyChannel(lead).crewId).toBeUndefined();
    expect(store.workspace().teams.map(team => team.id)).not.toContain(crewId);
  });

  it('keeps the orglet when the person unchecks the place it is alone in', async () => {
    const alone = await newChannel('alone', [editor.id]);
    expect(await unfriend(editor.id, [{ kind: 'channel', id: alone }])).toEqual({ outcome: 'unfriended', kicked: 0, kept: 1 });
    expect(memberIds(emptyChannel(alone))).toEqual([editor.id]);
  });

  it('keeps a written channel and its messages when its last orglet leaves, and refuses a new message', async () => {
    const loose = await newChannel('loose', [editor.id]);
    const taskId = await core.command('createTask', { workerId: editor.id, channelId: loose, brief: 'Before', ...message }) as string;
    await settled(taskId);

    await unfriend(editor.id);
    const row = store.get<Task>('tasks', taskId);
    expect(row.deletedAt).toBeUndefined();
    expect(row.assignees).toEqual([]);
    expect(row.channel!.members).toEqual([]);
    expect(store.workspace().tasks.map(task => task.id)).toContain(taskId);
    expect(store.detail(taskId).runs).toHaveLength(1);

    await expect(core.command('reviseTask', { taskId, brief: 'Anyone there?', ...message })).rejects.toThrow('Kênh chưa có Tí nào để trả lời. Thêm một Tí.');
    expect(store.detail(taskId).runs).toHaveLength(1);
  });

  it('refuses the first message of an empty channel with nobody in it, and answers once an orglet is added back', async () => {
    const loose = await newChannel('loose', [editor.id]);
    await unfriend(editor.id);
    await expect(core.command('createTask', { workerId: scout.id, channelId: loose, brief: 'Hello', ...message })).rejects.toThrow('Kênh chưa có Tí nào để trả lời. Thêm một Tí.');

    await core.command('updateChannel', { id: loose, name: 'loose', topic: '', members: [orglet(writer.id)] });
    const taskId = await core.command('createTask', { workerId: writer.id, channelId: loose, brief: 'Hello', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([writer.id]);
    expect(store.detail(taskId).runs).toHaveLength(1);
  });

  it('adds an orglet back to a written channel that was empty, and it answers the next message', async () => {
    const loose = await newChannel('loose', [editor.id]);
    const taskId = await core.command('createTask', { workerId: editor.id, channelId: loose, brief: 'Before', ...message }) as string;
    await settled(taskId);
    await unfriend(editor.id);

    await core.command('updateChannel', { id: loose, name: 'loose', topic: '', members: [orglet(writer.id)] });
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([writer.id]);
    expect(store.get<Task>('tasks', taskId).workerId).toBe(writer.id);
    await core.command('reviseTask', { taskId, brief: 'Now?', ...message });
    await settled(taskId);
    expect(store.detail(taskId).runs).toHaveLength(2);
  });

  it('saves an existing space and channel with no orglets through the editor commands, but a new one still needs one', async () => {
    const spaceId = await newSpace([scout.id, writer.id]);
    const inSpace = await newChannel('inside', [scout.id], { spaceId, access: 'listed' });
    const loose = await newChannel('loose', [scout.id]);

    await core.command('updateChannel', { id: loose, name: 'loose', topic: '', members: [] });
    expect(memberIds(emptyChannel(loose))).toEqual([]);
    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [], categories: [] });
    expect(store.workspace().spaces.find(space => space.id === spaceId)!.orgletIds).toEqual([]);
    expect(memberIds(emptyChannel(inSpace))).toEqual([]);

    await expect(core.command('createSpace', { name: 'Nobody', orgletIds: [], categories: [] })).rejects.toThrow('Không gian cần ít nhất một Tí.');
    await expect(core.command('createChannel', { name: 'nobody', topic: '', members: [] })).rejects.toThrow('Kênh cần ít nhất một thành viên.');
  });

  it('adds an orglet back to an empty space and its channels can take it again', async () => {
    const spaceId = await newSpace([editor.id]);
    const inSpace = await newChannel('inside', [editor.id], { spaceId });
    await unfriend(editor.id);
    expect(memberIds(emptyChannel(inSpace))).toEqual([]);

    await core.command('updateSpace', { id: spaceId, name: 'Launch', orgletIds: [writer.id], categories: [] });
    expect(memberIds(emptyChannel(inSpace))).toEqual([writer.id]);
    const taskId = await core.command('createTask', { workerId: writer.id, channelId: inSpace, brief: 'Hello', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([writer.id]);
  });

  it('does not strand a schedule of a lead channel: its last orglet cannot leave while the schedule is on', async () => {
    const lead = await newChannel('lead', [editor.id], { mode: 'lead' });
    const crewId = emptyChannel(lead).crewId!;
    const schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 };
    await core.command('saveRoutine', { name: 'Digest', enabled: true, schedule, task: { workerId: editor.id, teamId: crewId, sourceIds: [], brief: 'Digest', consent: false, budgetMicros: 1000 } });
    await expect(unfriend(editor.id)).rejects.toThrow('Tắt hoặc xóa lịch Digest trước.');
    expect(memberIds(emptyChannel(lead))).toEqual([editor.id]);
  });

  it('archives the orglet\'s own DM chats and leaves its channel chats alone', async () => {
    const loose = await newChannel('loose', [editor.id, writer.id]);
    const channelTask = await core.command('createTask', { workerId: editor.id, channelId: loose, brief: 'In the channel', ...message }) as string;
    await settled(channelTask);
    const direct = await core.command('createTask', { workerId: editor.id, brief: 'Just us', ...message }) as string;
    await settled(direct);

    await unfriend(editor.id, [{ kind: 'channel', id: loose }]);
    expect(store.get<Task>('tasks', direct).archivedAt).toBeDefined();
    expect(store.get<Task>('tasks', direct).deletedAt).toBeUndefined();
    expect(store.get<Task>('tasks', channelTask).archivedAt).toBeUndefined();
  });

  it('refuses a new DM or side thread with an unfriended orglet until it is befriended again', async () => {
    const loose = await newChannel('loose', [editor.id, writer.id]);
    const direct = await core.command('createTask', { workerId: editor.id, brief: 'Just us', ...message }) as string;
    await settled(direct);
    await unfriend(editor.id, [{ kind: 'channel', id: loose }]);

    const sentence = 'Kết bạn lại với Editor trước khi nhắn riêng.';
    await expect(core.command('createTask', { workerId: editor.id, brief: 'Hello again', ...message })).rejects.toThrow(sentence);
    await expect(core.command('startSideThread', { taskId: direct, brief: 'Aside', ...message })).rejects.toThrow(sentence);
    expect(translateMessage(en, sentence)).toBe('Add Editor as a friend again before messaging them directly.');

    await core.command('befriendWorker', { id: editor.id });
    expect(store.workspace().workers.find(worker => worker.id === editor.id)!.unfriendedAt).toBeUndefined();
    const again = await core.command('createTask', { workerId: editor.id, brief: 'Hello again', ...message }) as string;
    await settled(again);
    expect(store.get<Task>('tasks', again).archivedAt).toBeUndefined();
    // Befriending does not bring the archived chat back.
    expect(store.get<Task>('tasks', direct).archivedAt).toBeDefined();
  });

  it('refuses while an enabled schedule runs the orglet or one of its chats is running', async () => {
    const schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 };
    const routine = await core.command('saveRoutine', { name: 'Morning review', enabled: true, schedule, task: { workerId: editor.id, sourceIds: [], brief: 'Review', consent: false, budgetMicros: 1000 } }) as { id: string };
    await expect(unfriend(editor.id)).rejects.toThrow('Tắt hoặc xóa lịch Morning review trước.');
    await core.command('deleteRoutine', { id: routine.id });

    const direct = await core.command('createTask', { workerId: editor.id, brief: 'Busy', ...message }) as string;
    await settled(direct);
    store.patchTask(direct, { status: 'running' });
    await expect(unfriend(editor.id)).rejects.toThrow('Đợi công việc đang chạy xong rồi thử lại.');
    expect(liveWorkerIds()).toContain(editor.id);
  });

  it('leaves deleteEntity as it was: an orglet in a crew still has to leave it first', async () => {
    const lead = await newChannel('lead', [editor.id, writer.id], { mode: 'lead' });
    expect(emptyChannel(lead).crewId).toBeDefined();
    await expect(core.command('deleteEntity', { kind: 'worker', id: editor.id })).rejects.toThrow('Bỏ Editor khỏi kênh lead trước.');
    await expect(core.command('archiveEntity', { kind: 'worker', id: editor.id, archived: true })).rejects.toThrow('Bỏ Editor khỏi kênh lead trước.');
    await core.command('deleteEntity', { kind: 'worker', id: scout.id });
    expect(liveWorkerIds()).not.toContain(scout.id);
  });
});
