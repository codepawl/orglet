import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { isPlanRequest, memberIdsFromPlanPrompt, planReply } from './team-plan';

/*
 * Removing an orglet from a channel: the lead's next turn must not plan a part for the one who left, and a channel
 * left with one orglet takes turns again (owner, 2026-10-12).
 */

const rosters: string[][] = [];
const adapter: ModelAdapter = {
  async request(messages, tools) {
    if (isPlanRequest(tools)) {
      rosters.push(memberIdsFromPlanPrompt(messages));
      return planReply(messages);
    }
    return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Part', summary: 'Done.', findings: [], limitations: [] }) }], usage: { input: 10, output: 10 } };
  },
};
const message = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

let directory: string;
let store: Store;
let core: CoreService;

beforeEach(async () => {
  rosters.length = 0;
  directory = await mkdtemp(join(tmpdir(), 'orglet-removal-'));
  store = new Store(join(directory, 'state.sqlite'));
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

function orglet(name: string): Worker {
  const seed = store.all<Worker>('workers')[0];
  const worker: Worker = { ...seed, id: id(), name, revision: 1 };
  store.version('workers', worker);
  return worker;
}

const member = (worker: Worker) => ({ kind: 'orglet' as const, id: worker.id });

describe('removing an orglet from a channel', () => {
  async function leadChannel(workers: Worker[], lead: Worker) {
    const channelId = await core.command('createChannel', { name: 'room', topic: '', members: workers.map(member), mode: 'lead', lead: { synthesizerId: lead.id } }) as string;
    const teamId = store.workspace().emptyChannels.find(channel => channel.id === channelId)!.crewId!;
    const taskId = await core.command('createTask', { workerId: lead.id, teamId, channelId, brief: 'First', ...message }) as string;
    await settled(taskId);
    return { channelId, taskId };
  }

  it('passes the lead to the chosen orglet when the lead is removed with two or more staying', async () => {
    const first = store.all<Worker>('workers')[0];
    const second = orglet('Second');
    const third = orglet('Third');
    const { channelId, taskId } = await leadChannel([first, second, third], first);
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [member(second), member(third)], lead: { synthesizerId: third.id } });
    const row = store.get<Task>('tasks', taskId);
    expect(row.workerId).toBe(third.id);
    expect(store.get<Team>('teams', row.channel!.crewId!)).toMatchObject({ synthesizerId: third.id });
    expect(store.get<Team>('teams', row.channel!.crewId!).memberIds).not.toContain(first.id);
  });

  it('keeps a lead channel at two orglets when a non-lead leaves, then takes turns with the one left', async () => {
    const first = store.all<Worker>('workers')[0];
    const second = orglet('Second');
    const { channelId, taskId } = await leadChannel([first, second], first);
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [member(first)] });
    const row = store.get<Task>('tasks', taskId);
    expect(row.teamId).toBeUndefined();
    expect(row.channel?.crewId).toBeUndefined();
    expect(row.assignees).toEqual([first.id]);
  });

  it('takes turns when the lead is removed and one orglet is left', async () => {
    const first = store.all<Worker>('workers')[0];
    const second = orglet('Second');
    const { channelId, taskId } = await leadChannel([first, second], first);
    const crewId = store.get<Task>('tasks', taskId).channel!.crewId!;
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [member(second)] });
    const row = store.get<Task>('tasks', taskId);
    expect(row.teamId).toBeUndefined();
    expect(row.assignees).toEqual([second.id]);
    expect(store.entityState().teams[crewId]?.deletedAt).toBeTruthy();
  });

  it('leaves an empty channel when the last orglet is removed', async () => {
    const first = store.all<Worker>('workers')[0];
    const { channelId, taskId } = await leadChannel([first, orglet('Second')], first);
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [member(first)] });
    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [] });
    expect(store.get<Task>('tasks', taskId).assignees).toEqual([]);
  });

  it('gives the removed orglet no part in the lead\'s next turn', async () => {
    const lead = store.all<Worker>('workers')[0];
    const writer = orglet('Writer');
    const listener = orglet('Listener');
    const everyone = [member(lead), member(writer), member(listener)];
    const channelId = await core.command('createChannel', { name: 'room', topic: '', members: everyone, mode: 'lead', lead: { synthesizerId: lead.id } }) as string;
    const teamId = store.workspace().emptyChannels.find(channel => channel.id === channelId)!.crewId!;
    const taskId = await core.command('createTask', { workerId: lead.id, teamId, channelId, brief: 'First', ...message }) as string;
    await settled(taskId);
    const turn = (revision: number) => store.detail(taskId).runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
    expect(turn(0).some(run => run.snapshot.worker.id === listener.id)).toBe(true);

    await core.command('updateChannel', { id: channelId, name: 'room', topic: '', members: [member(lead), member(writer)] });
    const crewId = store.get<Task>('tasks', taskId).channel!.crewId!;
    expect(store.get<Team>('teams', crewId).memberIds).not.toContain(listener.id);

    await core.command('reviseTask', { taskId, brief: 'Second', ...message });
    await settled(taskId);
    const nextTurn = turn(1);
    expect(nextTurn.length).toBeGreaterThan(0);
    expect(nextTurn.some(run => run.snapshot.worker.id === listener.id)).toBe(false);
    expect(nextTurn.some(run => (run.error ?? '').includes('Listener'))).toBe(false);
    expect(nextTurn.flatMap(run => run.snapshot.plan?.assignments ?? []).some(assignment => assignment.workerId === listener.id)).toBe(false);
    // The turn that ran before the removal keeps its snapshot.
    expect(turn(0).some(run => run.snapshot.worker.id === listener.id)).toBe(true);
  });
});
