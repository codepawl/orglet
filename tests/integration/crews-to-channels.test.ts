import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { CoreService } from '../../apps/desktop/src/core/service';
import { crewForChannel, migrateCrews } from '../../apps/desktop/src/core/storage/channels';
import type { Routine, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { channelMode } from '../../apps/desktop/src/shared/channels';
import { liveTeamTask } from '../../apps/desktop/src/shared/live-task';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-369: crews become channels. A crew's lead, workflow, budget and hours are how its channel works ("the lead
 * splits the work"), kept in the crew record its `crewId` names; the crew's chat row keeps its `teamId`, so the crew
 * engine runs it as before and an older build still reads it as the crew's chat.
 */

const adapter: ModelAdapter = {
  async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Part', summary: 'Done.', findings: [], limitations: ['No files were supplied.'] }) }], usage: { input: 10, output: 10 } };
  },
};
const message = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

let directory: string;
let path: string;
let store: Store;
let core: CoreService;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-crews-'));
  path = join(directory, 'state.sqlite');
  store = new Store(path);
  core = new CoreService(store, () => {}, async () => adapter);
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
}

async function reopen() {
  await core.runner.shutdown();
  store.close();
  store = new Store(path);
  core = new CoreService(store, () => {}, async () => adapter);
}

function orglet(name: string): Worker {
  const seed = store.all<Worker>('workers')[0];
  const worker: Worker = { ...seed, id: id(), name, revision: 1 };
  store.version('workers', worker);
  return worker;
}

/** A crew written the way a build before COD-369 wrote one: the record and its chat row, no channel anywhere. */
function legacyCrew(name: string, memberIds: string[], synthesizerId: string, withChat: boolean): { team: Team; chat?: Task } {
  const team: Team = { id: id(), name, instructions: 'Combine.', memberIds, synthesizerId, workflow: 'sequential', monthlyBudgetMicros: 7_000_000, maxConcurrentTasks: 2, revision: 1 };
  store.version('teams', team);
  if (!withChat) return { team };
  const chat: Task = { id: id(), workerId: synthesizerId, teamId: team.id, teamSnapshot: team, brief: 'Old crew work', status: 'completed', createdAt: now(), budgetMicros: 500_000, sourceIds: [], consent: true, accepted: false, inputRevision: 2 };
  store.put('tasks', chat);
  return { team, chat };
}

describe('the migration', () => {
  it('gives every crew a channel on a real database round trip, keeps the crew rows readable and runs once', async () => {
    const scout = store.all<Worker>('workers')[0];
    const writer = orglet('Writer');
    const editor = orglet('Editor');
    const written = legacyCrew('Launch crew', [writer.id], editor.id, true);
    const fresh = legacyCrew('Research crew', [scout.id, writer.id], scout.id, false);
    const archived = legacyCrew('Old crew', [writer.id], writer.id, false);
    store.setSetting('entityState', { workers: {}, teams: { [archived.team.id]: { archivedAt: now() } } });
    const teamRowBefore = store.db.prepare('SELECT data FROM teams WHERE id=?').get(written.team.id)!.data;
    await reopen();

    const chat = store.get<Task>('tasks', written.chat!.id);
    // Same row, same history, the crew's chat as before, now with a channel record naming the crew.
    expect(chat).toMatchObject({ teamId: written.team.id, workerId: editor.id, brief: 'Old crew work', inputRevision: 2, channel: { name: 'Launch crew', crewId: written.team.id } });
    expect(chat.channel!.members).toEqual([{ kind: 'orglet', id: writer.id }, { kind: 'orglet', id: editor.id }]);
    expect(chat.assignees).toBeUndefined();
    expect(liveTeamTask(store.workspace().tasks, written.team.id)?.id).toBe(chat.id);
    expect(store.db.prepare('SELECT data FROM teams WHERE id=?').get(written.team.id)!.data).toBe(teamRowBefore);
    // A crew nobody wrote to is an empty channel; an archived crew waits until it is restored.
    const empty = store.workspace().emptyChannels;
    expect(empty.map(channel => channel.crewId)).toEqual([fresh.team.id]);
    expect(empty[0]).toMatchObject({ name: 'Research crew', members: [{ kind: 'orglet', id: scout.id }, { kind: 'orglet', id: writer.id }] });
    expect(channelMode(empty[0])).toBe('lead');

    await reopen();
    expect(store.get<Task>('tasks', chat.id).channel?.id).toBe(chat.channel!.id);
    expect(store.workspace().emptyChannels.map(channel => channel.id)).toEqual([empty[0].id]);
    expect(migrateCrews(store, now)).toEqual({ adopted: 0, expanded: 0 });

    await core.command('archiveEntity', { kind: 'team', id: archived.team.id, archived: false });
    expect(store.workspace().emptyChannels.map(channel => channel.crewId)).toEqual(expect.arrayContaining([archived.team.id, fresh.team.id]));
  });

  it('turns a crew named as a channel member into its orglets', async () => {
    const scout = store.all<Worker>('workers')[0];
    const writer = orglet('Writer');
    const { team } = legacyCrew('Crew', [writer.id], scout.id, false);
    const channel: Task = { id: id(), workerId: scout.id, assignees: [scout.id, writer.id], brief: 'Hi', status: 'completed', createdAt: now(), budgetMicros: 500_000, sourceIds: [], consent: true, accepted: false,
      channel: { id: id(), name: 'room', members: [{ kind: 'orglet', id: scout.id }, { kind: 'crew', id: team.id }] } };
    store.put('tasks', channel);
    expect(migrateCrews(store, now).expanded).toBe(1);
    expect(store.get<Task>('tasks', channel.id).channel!.members).toEqual([{ kind: 'orglet', id: scout.id }, { kind: 'orglet', id: writer.id }]);
    expect(migrateCrews(store, now).expanded).toBe(0);
  });

  it('brings a crew back from a backup made before crews became channels as a channel', async () => {
    const writer = orglet('Writer');
    const { team, chat } = legacyCrew('Backed up crew', [writer.id], writer.id, true);
    const text = new Backups(store, () => false, () => {}).export();
    const restored = new Store(':memory:');
    try {
      const manager = new Backups(restored, () => false, () => {});
      manager.restore(manager.preview(text).token);
      expect(restored.get<Task>('tasks', chat!.id)).toMatchObject({ teamId: team.id, channel: { name: 'Backed up crew', crewId: team.id } });
    } finally {
      restored.close();
    }
  });
});

describe('a channel where the lead splits the work', () => {
  it('is made for a crew from a template, and its first message runs the crew turn: plan, parts, combine', async () => {
    const crew = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const channel = store.workspace().emptyChannels.find(item => item.crewId === crew.id)!;
    expect(channel.name).toBe(crew.name);
    const taskId = await core.command('createTask', { workerId: crew.memberIds[0], channelId: channel.id, assignees: crew.memberIds, brief: 'Review the evidence', ...message }) as string;
    await settled(taskId);
    const detail = store.detail(taskId);
    expect(detail.task).toMatchObject({ teamId: crew.id, workerId: crew.synthesizerId, channel: { id: channel.id, crewId: crew.id } });
    expect(detail.task.assignees).toBeUndefined();
    expect(detail.runs.map(run => run.stage)).toEqual(expect.arrayContaining(['plan', 'member', 'synthesis']));
    expect(store.workspace().emptyChannels.find(item => item.crewId === crew.id)).toBeUndefined();
  });

  it('starts as a channel when the crew is messaged the older way, by its crew id', async () => {
    const crew = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const waiting = store.workspace().emptyChannels.find(item => item.crewId === crew.id)!;
    const taskId = await core.command('createTask', { workerId: crew.synthesizerId, teamId: crew.id, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    expect(store.get<Task>('tasks', taskId).channel).toMatchObject({ id: waiting.id, crewId: crew.id });
    expect(store.workspace().emptyChannels).toEqual([]);
  });

  it('switches from taking turns and back, keeping the settings in a crew record that goes when nobody uses it', async () => {
    const scout = store.all<Worker>('workers')[0];
    const writer = orglet('Writer');
    const members = [{ kind: 'orglet' as const, id: scout.id }, { kind: 'orglet' as const, id: writer.id }];
    const channelId = await core.command('createChannel', { name: 'room', topic: '', members }) as string;
    const taskId = await core.command('createTask', { workerId: scout.id, channelId, brief: 'Hi', ...message, providerScopes: [] }) as string;
    await settled(taskId);
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members, mode: 'lead', lead: { synthesizerId: writer.id, workflow: 'sequential', monthlyBudgetMicros: 2_000_000, workHours: { timeZone: 'UTC', start: '09:00', end: '17:00', days: [1] } } });
    const lead = store.get<Task>('tasks', taskId);
    const crewId = lead.channel!.crewId!;
    expect(lead).toMatchObject({ teamId: crewId, workerId: writer.id });
    expect(lead.assignees).toBeUndefined();
    expect(store.get<Team>('teams', crewId)).toMatchObject({ name: 'room', memberIds: [scout.id, writer.id], synthesizerId: writer.id, workflow: 'sequential', monthlyBudgetMicros: 2_000_000, workHours: { start: '09:00' } });

    // Renaming the channel renames its crew; a setting left out keeps its value, null turns one off.
    await core.command('renameTask', { id: taskId, title: 'war-room' });
    expect(store.get<Team>('teams', crewId)).toMatchObject({ name: 'war-room', workflow: 'sequential' });
    await core.command('updateChannel', { id: channelId, name: 'war-room', topic: '', members, lead: { workHours: null } });
    expect(store.get<Team>('teams', crewId).workHours).toBeUndefined();

    // A schedule that runs the crew holds the crew record, so going back to turns waits for it.
    const routine = await core.command('saveRoutine', { name: 'Daily', enabled: true, schedule: { timeZone: 'UTC', time: '09:00', frequency: 'daily', weekday: 1 }, task: { workerId: writer.id, teamId: crewId, sourceIds: [], brief: 'Report', consent: false, budgetMicros: 1000 } }) as Routine;
    await expect(core.command('updateChannel', { id: channelId, name: 'war-room', topic: '', members, mode: 'turns' })).rejects.toThrow();
    expect(store.get<Task>('tasks', taskId).teamId).toBe(crewId);
    await core.command('deleteRoutine', { id: routine.id });

    await core.command('updateChannel', { id: channelId, name: 'war-room', topic: '', members, mode: 'turns' });
    const turns = store.get<Task>('tasks', taskId);
    expect(turns).toMatchObject({ assignees: [scout.id, writer.id], workerId: scout.id });
    expect(turns.teamId).toBeUndefined();
    expect(turns.channel?.crewId).toBeUndefined();
    expect(store.entityState().teams[crewId]?.deletedAt).toBeTruthy();
  });

  it('takes its crew record with it when deleted, empty or written in', async () => {
    const crew = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const waiting = store.workspace().emptyChannels.find(item => item.crewId === crew.id)!;
    await core.command('deleteChannel', { id: waiting.id });
    expect(store.entityState().teams[crew.id]?.deletedAt).toBeTruthy();
    // Deleted with its crew, it is never made again.
    await reopen();
    expect(store.workspace().emptyChannels.some(item => item.crewId === crew.id)).toBe(false);

    const second = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: second.synthesizerId, teamId: second.id, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    await core.command('deleteTask', { id: taskId });
    expect(store.entityState().teams[second.id]?.deletedAt).toBeTruthy();
  });

  it('follows its crew when the crew is saved some other way, such as the terminal', async () => {
    const crew = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    await core.command('saveTeam', { ...crew, name: 'Renamed', memberIds: [crew.memberIds[0]], expectedRevision: crew.revision });
    const channel = store.workspace().emptyChannels.find(item => item.crewId === crew.id)!;
    expect(channel).toMatchObject({ name: 'Renamed', members: [{ kind: 'orglet', id: crew.memberIds[0] }, { kind: 'orglet', id: crew.synthesizerId }] });
  });
});

describe('the crew record behind a channel', () => {
  const [a, b, c] = ['a', 'b', 'c'];

  it('takes the lead from the members, and a new lead does a part of the work as a new crew always did', () => {
    expect(crewForChannel('room', [a, b], undefined)).toMatchObject({ name: 'room', memberIds: [a, b], synthesizerId: a, workflow: 'parallel', instructions: expect.any(String) });
    expect(() => crewForChannel('room', [a, b], { synthesizerId: c })).toThrow('Tí trưởng');
  });

  it("keeps an existing lead out of the parts when it was out, and refuses more than eight working orglets", () => {
    const existing: Team = { id: 'crew', name: 'x', instructions: 'Combine.', memberIds: [b], synthesizerId: a, workflow: 'sequential', monthlyBudgetMicros: 1_000_000, revision: 3 };
    expect(crewForChannel('x', [a, b, c], undefined, existing)).toMatchObject({ id: 'crew', memberIds: [b, c], synthesizerId: a, workflow: 'sequential' });
    const nine = Array.from({ length: 9 }, (_, index) => `w${index}`);
    expect(() => crewForChannel('big', nine, undefined)).toThrow('tối đa 8');
  });
});
