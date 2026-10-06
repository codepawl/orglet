import { describe, expect, it } from 'vitest';
import { entriesFromList } from '../../apps/desktop/src/cli/picker';
import { chatKindLabel, formatList, formatSpaces, formatStatus } from '../../apps/desktop/src/cli/output';
import type { ChatsValue, CliRequest, ListValue } from '../../apps/desktop/src/cli/protocol';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import type { Task, Workspace } from '../../apps/desktop/src/shared/contracts';

/** Every channel, those that take turns and those with a lead, listed under its space in the order the app keeps them. */

const researcherId = '11111111-1111-4111-8111-111111111111';
const writerId = '22222222-2222-4222-8222-222222222222';
const crewId = '33333333-3333-4333-8333-333333333333';
const launchId = '55555555-5555-4555-8555-555555555555';
const studioId = '55555555-5555-4555-8555-555555555556';
const draftsId = '66666666-6666-4666-8666-666666666666';
const readyId = '66666666-6666-4666-8666-666666666667';
const plansId = 'c1000000-0000-4000-8000-000000000001';
const notesId = 'c1000000-0000-4000-8000-000000000002';
const reviewId = 'c1000000-0000-4000-8000-000000000003';
const ideasId = 'c1000000-0000-4000-8000-000000000004';
const looseId = 'c1000000-0000-4000-8000-000000000005';
const oldId = 'c1000000-0000-4000-8000-000000000006';
const orglets = [{ kind: 'orglet' as const, id: researcherId }, { kind: 'orglet' as const, id: writerId }];

function chatRow(id: string, createdAt: string, channel: Record<string, unknown>, extra: Partial<Task> = {}): Task {
  return { id: `${id.slice(0, 8)}-0000-4000-8000-00000000aaaa`, workerId: researcherId, brief: 'hi', status: 'completed', createdAt, budgetMicros: 300_000, sourceIds: [], consent: true, accepted: false, assignees: [researcherId, writerId], channel, ...extra } as unknown as Task;
}

function workspace(channelOrder: string[] = []): Workspace {
  return {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'openai' }, { id: writerId, name: 'Writer', provider: 'anthropic' }],
    teams: [{ id: crewId, name: 'Review', memberIds: [researcherId], synthesizerId: writerId }],
    archivedWorkers: [],
    archivedTeams: [],
    tasks: [
      chatRow(plansId, '2026-10-01T12:00:00.000Z', { id: plansId, name: 'plans', spaceId: launchId, access: 'listed', members: orglets }),
      chatRow(notesId, '2026-10-01T14:00:00.000Z', { id: notesId, name: 'notes', spaceId: launchId, access: 'listed', members: orglets }),
      chatRow(reviewId, '2026-10-01T11:00:00.000Z', { id: reviewId, name: 'review', spaceId: launchId, categoryId: readyId, access: 'listed', members: orglets, crewId }, { teamId: crewId, workerId: writerId, assignees: undefined }),
      chatRow(looseId, '2026-10-01T09:00:00.000Z', { id: looseId, name: 'loose', members: orglets }),
      chatRow(oldId, '2026-09-01T09:00:00.000Z', { id: oldId, name: 'old', spaceId: launchId, members: orglets }, { archivedAt: '2026-09-02T09:00:00.000Z' }),
    ],
    emptyChannels: [{ id: ideasId, name: 'ideas', spaceId: launchId, categoryId: draftsId, access: 'listed', members: orglets, createdAt: '2026-10-01T13:00:00.000Z' }],
    spaces: [
      { id: launchId, name: 'Launch', orgletIds: [researcherId, writerId], categories: [{ id: draftsId, name: 'Drafts' }, { id: readyId, name: 'Ready' }] },
      { id: studioId, name: 'Studio', orgletIds: [writerId], categories: [] },
    ],
    channelOrder,
    routines: [],
  } as unknown as Workspace;
}

function operations(current: Workspace) {
  return new CliOperations({ request: async () => current, version: () => '1', open: () => undefined, translate: message => message });
}

describe('every channel in the listings', () => {
  it('lists channels that take turns and channels with a lead under their space, then the ones outside', async () => {
    const list = await operations(workspace()).list();
    expect(list.channels!.map(channel => [channel.space ?? '-', channel.category ?? '-', channel.name, channel.mode])).toEqual([
      ['Launch', '-', 'notes', 'turns'],
      ['Launch', '-', 'plans', 'turns'],
      ['Launch', 'Drafts', 'ideas', 'turns'],
      ['Launch', 'Ready', 'review', 'lead'],
      ['-', '-', 'loose', 'turns'],
    ]);
    const review = list.channels!.find(channel => channel.name === 'review')!;
    expect(review).toMatchObject({ lead: 'Writer', members: ['Researcher'] });
    // A channel with messages names its chat; one nobody has written in does not.
    expect(list.channels!.find(channel => channel.name === 'plans')!.chat).toBe(plansId.slice(0, 8));
    expect(list.channels!.find(channel => channel.name === 'ideas')).not.toHaveProperty('chat');
    // The older key stays for one release.
    expect(list.crews.map(crew => crew.name)).toEqual(['Review']);
  });

  it('keeps the order the person saved with reorder, and puts a channel nobody placed after those that are', async () => {
    const list = await operations(workspace([plansId])).list();
    expect(list.channels!.filter(channel => channel.space === 'Launch' && !channel.category).map(channel => channel.name)).toEqual(['plans', 'notes']);
  });

  it('counts every channel in the status', async () => {
    const status = await operations(workspace()).status();
    expect(status).toMatchObject({ orglets: 2, channels: 5, crews: 1 });
    expect(formatStatus(status)).toContain('2 orglets, 5 channels');
  });

  it('shows the spaces with channels in the same order and says how each answers', async () => {
    const value = await operations(workspace([plansId])).spaces();
    const launch = value.spaces.find(space => space.name === 'Launch')!;
    expect(launch.categories).toEqual(['Drafts', 'Ready']);
    expect(launch.channels.map(channel => channel.name)).toEqual(['plans', 'notes', 'ideas', 'review']);
    expect(launch.channels.find(channel => channel.name === 'review')).toMatchObject({ mode: 'lead', lead: 'Writer', category: 'Ready' });
    expect(formatSpaces(value)).toContain('#review  Ready  lead Writer');
  });

  it('lists the channels of one space in the order the space shows them', async () => {
    const request: CliRequest = { op: 'chats', token: 'x'.repeat(64), archived: false, space: 'Launch' };
    const { chats } = await operations(workspace([plansId])).run(request, new AbortController().signal) as ChatsValue;
    expect(chats.map(chat => chat.name)).toEqual(['#plans', '#notes', '#review']);
    expect(chats.every(chat => chat.space === 'Launch')).toBe(true);
  });

  it('prints channels in plain text under their space', async () => {
    const text = formatList(await operations(workspace()).list());
    expect(text).toContain('Channels\n  Launch\n    #notes');
    expect(text).toContain('#review  lead Writer  Researcher');
    expect(text).toContain('  Not in a space\n    #loose');
    expect(text).not.toMatch(/crew/i);
  });

  it('offers a channel in the picker when it can be opened', async () => {
    const entries = entriesFromList(await operations(workspace()).list());
    const names = entries.filter(entry => entry.kind === 'team').map(entry => entry.name);
    // `ideas` has no chat and takes turns, so there is nothing to open yet.
    expect(names).toEqual(['notes', 'plans', 'review', 'loose']);
    const plans = entries.find(entry => entry.name === 'plans')!;
    expect(plans.target).toBe(`#${plansId.slice(0, 8)}`);
    expect(entries.find(entry => entry.name === 'review')).not.toHaveProperty('target');
  });

  it('reads an app that sends only crews as channels with a lead', () => {
    const older: ListValue = { orglets: [{ name: 'Researcher', provider: 'openai' }], crews: [{ name: 'Review', lead: 'Researcher', members: ['Researcher'] }] };
    expect(entriesFromList(older).map(entry => [entry.kind, entry.name])).toEqual([['worker', 'Researcher'], ['team', 'Review']]);
    expect(formatList(older)).toContain('#Review  lead Researcher');
  });

  it('reads a crew chat as a channel to a person and keeps crew in the JSON', () => {
    expect(chatKindLabel('crew')).toBe('channel');
    expect(chatKindLabel('side')).toBe('side');
  });
});
