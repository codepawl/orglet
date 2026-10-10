import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { CliRequest } from '../../apps/desktop/src/cli/protocol';
import { ManagementCatalog, type ManagementClient, type ManagementResult } from '../../apps/desktop/src/cli/management';
import { ManagementEditor, parseDollarLimit } from '../../apps/desktop/src/cli/management-editor';
import { parseArguments, type ManagementCommand } from '../../apps/desktop/src/cli/arguments';
import { runManagementCommand } from '../../apps/desktop/src/cli/management-command';
import { completeSlash, parseSlash } from '../../apps/desktop/src/cli/slash';
import type { Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string;
let store: Store;
let core: CoreService;
let operations: CliOperations;
const token = 'a'.repeat(64);
const signal = new AbortController().signal;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-cli-management-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('Management must not call a model.'); });
  operations = new CliOperations({ request: (command, args) => core.command(command as never, args as never), version: () => 'test', open: () => undefined, translate: text => text });
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function catalog(): Promise<ManagementCatalog> {
  return ManagementCatalog.parse(await operations.run({ op: 'config', token }, signal));
}
async function createOrglet(name = 'Terminal orglet'): Promise<ManagementResult> {
  return await operations.run({ op: 'save-orglet', token, config: { name, instructions: 'Review the supplied work.', provider: 'codex', skillId: store.all<Skill>('skills')[0].id } }, signal) as ManagementResult;
}
async function createCrew(worker: ManagementResult): Promise<ManagementResult> {
  return await operations.run({ op: 'save-crew', token, config: { name: 'Terminal crew', instructions: 'Review together.', memberIds: [worker.id], synthesizerId: store.all<Worker>('workers')[0].id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 } }, signal) as ManagementResult;
}

describe('person-driven terminal configuration', () => {
  it('projects editable fields without grants, connection addresses or unrelated workspace state', async () => {
    const worker = store.all<Worker>('workers')[0];
    store.version('workers', { ...worker, revision: worker.revision + 1, autoApplyProposals: true, mcpServerIds: ['11111111-1111-4111-8111-111111111111'] });
    store.setSetting('newChatCapabilities', { [worker.id]: ['workspace_write'] });
    const value = await catalog();
    expect(value.orglets[0].config).not.toHaveProperty('revision');
    expect(value.orglets[0].config).not.toHaveProperty('autoApplyProposals');
    expect(value.orglets[0].config).not.toHaveProperty('mcpServerIds');
    expect(Object.keys(value)).toEqual(['orglets', 'crews', 'channels', 'skills', 'providers']);
    expect(value.providers.every(provider => provider.id !== 'demo')).toBe(true);
    expect(JSON.stringify(value)).not.toContain('workspace_write');
  });

  it('creates real orglets and crews and preserves unexposed options when patching', async () => {
    const worker = await createOrglet();
    const current = store.get<Worker>('workers', worker.id);
    await core.command('saveWorker', { ...current, modelId: 'configured-model', autoApplyProposals: true, avatar: { emoji: '🐾', color: '#223344' }, taskBudgetMicros: 100_000 });
    const revision = store.get<Worker>('workers', worker.id).revision;
    const edited = await operations.run({ op: 'save-orglet', token, target: { id: worker.id, revision }, config: { name: 'Renamed', modelId: null, taskBudgetMicros: null } }, signal) as ManagementResult;
    expect(edited.revision).toBe(revision + 1);
    expect(store.get<Worker>('workers', worker.id)).toMatchObject({ name: 'Renamed', autoApplyProposals: true, avatar: { emoji: '🐾', color: '#223344' } });
    expect(store.get<Worker>('workers', worker.id)).not.toHaveProperty('modelId');
    expect(store.get<Worker>('workers', worker.id)).not.toHaveProperty('expectedRevision');
    const crew = await createCrew(edited);
    const team = store.get<Team>('teams', crew.id);
    await core.command('saveTeam', { ...team, workHours: { timeZone: 'UTC', start: '08:00', end: '17:00', days: [1, 2] } });
    const teamRevision = store.get<Team>('teams', crew.id).revision;
    await operations.run({ op: 'save-crew', token, target: { id: crew.id, revision: teamRevision }, config: { instructions: 'Updated crew instructions.' } }, signal);
    expect(store.get<Team>('teams', crew.id).workHours).toEqual({ timeZone: 'UTC', start: '08:00', end: '17:00', days: [1, 2] });
    expect(store.get<Team>('teams', crew.id).synthesizerId).not.toBe(worker.id);
  });

  it('makes a channel of a new crew, in the space kept for channels, and keeps it there when the crew is edited', async () => {
    const crew = await createCrew(await createOrglet());
    expect(crew.space).toBe('Kênh');
    const workspace = store.workspace();
    const channel = workspace.emptyChannels.find(item => item.crewId === crew.id);
    expect(channel).toBeDefined();
    expect(workspace.spaces.find(space => space.id === channel!.spaceId)?.name).toBe('Kênh');
    const edited = await operations.run({ op: 'save-crew', token, target: { id: crew.id, revision: crew.revision }, config: { name: 'Renamed crew' } }, signal) as ManagementResult;
    expect(edited).not.toHaveProperty('space');
    expect(store.workspace().emptyChannels.find(item => item.crewId === crew.id)).toMatchObject({ name: 'Renamed crew', spaceId: channel!.spaceId });
  });

  it('refuses incomplete inputs, demo, duplicate members and permission fields without mutations', async () => {
    const count = store.workspace().workers.length;
    await expect(operations.run({ op: 'save-orglet', token, config: { name: 'Missing fields' } }, signal)).rejects.toThrow('instructions');
    await expect(operations.run({ op: 'save-orglet', token, config: { name: 'Demo', instructions: 'Test', provider: 'demo', skillId: store.all<Skill>('skills')[0].id } }, signal)).rejects.toThrow('kết nối thật');
    expect(CliRequest.safeParse({ op: 'save-orglet', token, config: { autoApplyProposals: true } }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'save-orglet', token, config: { mcpServerIds: [] } }).success).toBe(false);
    const workerId = store.all<Worker>('workers')[0].id;
    expect(CliRequest.safeParse({ op: 'save-crew', token, config: { memberIds: [workerId, workerId] } }).success).toBe(false);
    expect(store.workspace().workers.length).toBe(count);
  });

  it('compares revisions inside core even when the desktop changes after the CLI read', async () => {
    const worker = await createOrglet();
    const changingOperations = new CliOperations({
      version: () => 'test', open: () => undefined, translate: text => text,
      request: async (command, args) => {
        if (command === 'saveWorker') await core.command('saveWorker', { ...store.get<Worker>('workers', worker.id), instructions: 'Desktop won the race.' });
        return core.command(command as never, args as never);
      },
    });
    await expect(changingOperations.run({ op: 'save-orglet', token, target: { id: worker.id, revision: worker.revision! }, config: { name: 'Stale CLI edit' } }, signal)).rejects.toThrow('đã thay đổi');
    expect(store.get<Worker>('workers', worker.id).instructions).toBe('Desktop won the race.');
    expect(store.get<Worker>('workers', worker.id).name).toBe('Terminal orglet');
    await expect(core.command('deleteEntity', { kind: 'worker', id: worker.id, expectedRevision: worker.revision, expectedName: worker.name })).rejects.toThrow('đã thay đổi');
    await expect(core.command('saveTeam', { id: undefined, name: 'Bad compare', instructions: 'Test', memberIds: [worker.id], synthesizerId: worker.id, workflow: 'parallel', monthlyBudgetMicros: 1000, expectedRevision: 1 })).rejects.toThrow('đã thay đổi');
  });

  it('requires exact confirmation, retains rows, and respects crew and running-work blockers', async () => {
    const worker = await createOrglet();
    await expect(operations.run({ op: 'delete-entity', token, kind: 'worker', target: worker, confirmName: 'terminal orglet' }, signal)).rejects.toThrow('đúng tên');
    const crew = await createCrew(worker);
    await expect(operations.run({ op: 'delete-entity', token, kind: 'worker', target: worker, confirmName: worker.name }, signal)).rejects.toThrow('Terminal crew');
    const deleted = await operations.run({ op: 'delete-entity', token, kind: 'team', target: crew, confirmName: crew.name }, signal);
    expect(deleted).toMatchObject({ deleted: true });
    expect(store.get<Team>('teams', crew.id).name).toBe(crew.name);
    store.put('tasks', { id: '11111111-1111-4111-8111-111111111111', workerId: worker.id, brief: 'Pending', status: 'queued', sourceIds: [], budgetMicros: 1000, createdAt: new Date().toISOString(), consent: true, accepted: false });
    await expect(operations.run({ op: 'delete-entity', token, kind: 'worker', target: worker, confirmName: worker.name }, signal)).rejects.toThrow('công việc đang chạy');
    store.db.prepare('DELETE FROM tasks').run();
    await operations.run({ op: 'delete-entity', token, kind: 'worker', target: worker, confirmName: worker.name }, signal);
    expect((await catalog()).orglets.some(entity => entity.id === worker.id)).toBe(false);
    expect(store.get<Worker>('workers', worker.id).name).toBe(worker.name);
    await expect(core.command('saveWorker', { ...store.get<Worker>('workers', worker.id), expectedRevision: worker.revision })).rejects.toThrow('đã thay đổi');
  });
});

describe('terminal editor and script inputs', () => {
  it('parses management commands, completes slashes, and requires explicit delete confirmation', () => {
    expect(parseArguments(['create', 'orglet', '--config', 'input.json'])).toMatchObject({ kind: 'create', entity: 'worker', config: 'input.json' });
    expect(parseArguments(['edit', 'crew', 'Review crew', '--config=patch.json', '--json'])).toMatchObject({ kind: 'edit', entity: 'team', name: 'Review crew', json: true });
    expect(() => parseArguments(['delete', 'orglet', 'Researcher'])).toThrow('--confirm');
    expect(() => parseArguments(['status', '--config=x'])).toThrow('--config');
    expect(parseSlash('/new team')).toEqual({ kind: 'new', entity: 'team' });
    expect(completeSlash('/edit Re', ['Researcher'])[0]).toEqual(['/edit Researcher']);
  });

  it('keeps deletion inert until the exact displayed name is entered', async () => {
    const worker = await createOrglet();
    const editor = new ManagementEditor('delete', await catalog(), 'worker', worker.name);
    expect(editor.submit('')).toBeUndefined();
    expect(editor.submit(worker.name.toLowerCase())).toBeUndefined();
    expect(editor.submit(worker.name)).toEqual({ action: 'delete', kind: 'worker', target: { id: worker.id, revision: worker.revision }, confirmName: worker.name });
  });

  it('selects multiple members, keeps a separate lead, and goes back without saving', async () => {
    const value = await catalog();
    const worker = await createOrglet();
    value.orglets = (await catalog()).orglets;
    const editor = new ManagementEditor('new', value, 'team');
    editor.submit('Members');
    editor.submit('');
    editor.submit(worker.name);
    expect(editor.values.memberIds).toEqual([value.orglets[0].id, worker.id]);
    editor.submit('Done choosing');
    editor.submit('Lead');
    editor.submit(worker.name);
    expect(editor.values.synthesizerId).toBe(worker.id);
    editor.submit('Instructions');
    expect(editor.escape()).toBe(false);
    expect(editor.escape()).toBe(true);
  });

  it('preserves other avatar properties, accepts exact integer money and rejects bad limits', async () => {
    const worker = await createOrglet();
    await core.command('saveWorker', { ...store.get<Worker>('workers', worker.id), avatar: { emoji: '🐾', color: '#334455' } });
    const editor = new ManagementEditor('edit', await catalog(), 'worker', worker.name);
    editor.submit('Color');
    editor.submit('#8899aa');
    expect(editor.values.avatar).toEqual({ emoji: '🐾', color: '#8899aa' });
    editor.submit('Color');
    editor.submit('');
    const saved = await operations.run({ op: 'save-orglet', token, target: editor.target, config: editor.values }, signal) as ManagementResult;
    expect(store.get<Worker>('workers', saved.id).avatar).toEqual({ emoji: '🐾' });
    expect(parseDollarLimit('0.100001', 100_000_000)).toBe(100_001);
    expect(() => parseDollarLimit('0.000001', 100_000_000)).toThrow();
    expect(() => parseDollarLimit('1.0000001', 100_000_000)).toThrow();
  });

  it('reads bounded JSON patches and never mutates on an ambiguous name or wrong confirmation', async () => {
    const worker = await createOrglet();
    const saveOrglet = vi.fn(async () => worker);
    const remove = vi.fn(async () => ({ ...worker, deleted: true }));
    const client: ManagementClient = { catalog, saveOrglet, saveCrew: vi.fn(), delete: remove };
    const path = join(directory, 'patch.json');
    await writeFile(path, JSON.stringify({ description: 'New description' }));
    const command = parseArguments(['edit', 'orglet', worker.name, '--config', path]) as ManagementCommand;
    await runManagementCommand(command, client, directory);
    expect(saveOrglet).toHaveBeenCalledWith({ description: 'New description' }, { id: worker.id, revision: worker.revision });
    await expect(runManagementCommand({ kind: 'delete', entity: 'worker', name: worker.name, confirm: 'wrong', json: false }, client, directory)).rejects.toThrow('--confirm');
    expect(remove).not.toHaveBeenCalled();
    await writeFile(path, Buffer.alloc(65 * 1024, 65));
    await expect(runManagementCommand(command, client, directory)).rejects.toThrow('64 KiB');
  });
});

describe('channels made and changed from the terminal', () => {
  const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

  function orgletMembers(...orgletIds: string[]) {
    return orgletIds.map(id => ({ kind: 'orglet' as const, id }));
  }
  function save(config: Record<string, unknown>, target?: { id: string; revision?: number }) {
    return operations.run({ op: 'save-crew', token, config, ...(target ? { target } : {}) } as never, signal) as Promise<ManagementResult>;
  }
  function remove(target: { id: string; revision?: number }, confirmName: string) {
    return operations.run({ op: 'delete-entity', token, kind: 'team', target, confirmName } as never, signal);
  }
  async function secondOrglet(): Promise<Worker> {
    return await core.command('saveWorker', { ...store.all<Worker>('workers')[0], id: undefined, name: 'Second orglet' }) as Worker;
  }
  async function settled(taskId: string): Promise<void> {
    for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  }

  it('makes a channel that takes turns with createChannel and puts it in the space kept for channels', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await secondOrglet();
    const created = await save({ name: '#ideas', topic: 'Anything goes', members: orgletMembers(first.id, second.id) });
    expect(created).toMatchObject({ kind: 'team', name: 'ideas', space: 'Kênh' });
    expect(created.id).toBe(created.channelId);
    expect(created).not.toHaveProperty('revision');
    const channel = store.workspace().emptyChannels.find(item => item.id === created.channelId)!;
    expect(channel).toMatchObject({ name: 'ideas', topic: 'Anything goes', members: orgletMembers(first.id, second.id) });
    expect(channel.crewId).toBeUndefined();
    expect(store.workspace().spaces.find(space => space.id === channel.spaceId)?.name).toBe('Kênh');
    expect(store.all<Team>('teams')).toHaveLength(0);
  });

  it('makes a channel where the lead splits the work, with the lead settings as a field of the channel', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await secondOrglet();
    const created = await save({ name: 'launch', members: orgletMembers(first.id, second.id), lead: { synthesizerId: second.id, instructions: 'Combine the parts.', workflow: 'sequential', monthlyBudgetMicros: 7_000_000, maxConcurrentTasks: 2 } });
    const crew = store.get<Team>('teams', created.id);
    expect(crew).toMatchObject({ name: 'launch', synthesizerId: second.id, instructions: 'Combine the parts.', workflow: 'sequential', monthlyBudgetMicros: 7_000_000, maxConcurrentTasks: 2 });
    expect(created.revision).toBe(crew.revision);
    expect(store.workspace().emptyChannels.find(item => item.id === created.channelId)).toMatchObject({ crewId: crew.id });
    const listed = (await catalog()).channels!.find(item => item.id === created.channelId)!;
    expect(listed).toMatchObject({ revision: crew.revision, config: { name: 'launch', mode: 'lead', lead: { synthesizerId: second.id, workflow: 'sequential' } } });
  });

  it('still reads a crew file with the older flat names and makes the same lead channel', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await secondOrglet();
    const created = await save({ name: 'Old crew', instructions: 'Review together.', memberIds: [first.id], synthesizerId: second.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 });
    expect(store.get<Team>('teams', created.id)).toMatchObject({ synthesizerId: second.id, instructions: 'Review together.' });
    const channel = store.workspace().emptyChannels.find(item => item.id === created.channelId)!;
    expect(channel.members).toEqual(orgletMembers(first.id, second.id));
    expect((await catalog()).crews.map(crew => crew.id)).toContain(created.id);
  });

  it('edits a channel by its own id or by its crew id, and keeps what the patch leaves out', async () => {
    const [first] = store.all<Worker>('workers');
    const second = await secondOrglet();
    const turns = await save({ name: 'ideas', topic: 'Old topic', members: orgletMembers(first.id, second.id) });
    // The space kept for channels holds the orglets its channels had, so the list can narrow but not widen past it.
    const renamed = await save({ topic: 'New topic', members: orgletMembers(second.id) }, { id: turns.id });
    expect(store.workspace().emptyChannels.find(item => item.id === turns.id)).toMatchObject({ name: 'ideas', topic: 'New topic', members: orgletMembers(second.id) });
    expect(renamed.channelId).toBe(turns.id);
    const lead = await save({ name: 'launch', memberIds: [first.id], synthesizerId: first.id });
    await save({ topic: 'Cleared soon', lead: { workflow: 'sequential' } }, { id: lead.id, revision: lead.revision });
    await save({ topic: '' }, { id: lead.channelId! });
    const channel = store.workspace().emptyChannels.find(item => item.id === lead.channelId)!;
    expect(channel).toMatchObject({ name: 'launch', crewId: lead.id });
    expect(channel).not.toHaveProperty('topic');
    expect(store.get<Team>('teams', lead.id)).toMatchObject({ workflow: 'sequential', synthesizerId: first.id });
  });

  it('refuses lead settings on a channel that takes turns until the patch says the mode, and switches it when it does', async () => {
    const [first] = store.all<Worker>('workers');
    const turns = await save({ name: 'ideas', members: orgletMembers(first.id) });
    await expect(save({ instructions: 'Lead it.' }, { id: turns.id })).rejects.toThrow('lần lượt');
    expect(store.all<Team>('teams')).toHaveLength(0);
    const switched = await save({ mode: 'lead', lead: { instructions: 'Lead it.' } }, { id: turns.id });
    expect(switched.id).not.toBe(turns.id);
    expect(store.get<Team>('teams', switched.id).instructions).toBe('Lead it.');
  });

  it('refuses a stale revision, a wrong field and a channel that is gone, and changes nothing', async () => {
    const [first] = store.all<Worker>('workers');
    const lead = await save({ name: 'launch', members: orgletMembers(first.id), lead: { instructions: 'Combine.' } });
    await expect(save({ topic: 'x' }, { id: lead.id, revision: lead.revision! + 1 })).rejects.toThrow('đã thay đổi');
    await expect(save({ name: 'no members' })).rejects.toThrow('members');
    await expect(save({ topic: 'x' }, { id: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow('đã thay đổi');
    expect(CliRequest.safeParse({ op: 'save-crew', token, config: { lead: { workHours: null } } }).success).toBe(false);
    expect(store.workspace().emptyChannels.find(item => item.id === lead.channelId)).not.toHaveProperty('topic');
  });

  it('deletes an empty channel with deleteChannel after the name is typed, with or without the mark', async () => {
    const [first] = store.all<Worker>('workers');
    const turns = await save({ name: 'ideas', members: orgletMembers(first.id) });
    await expect(remove({ id: turns.id }, 'Ideas')).rejects.toThrow('đúng tên');
    expect(store.workspace().emptyChannels.some(item => item.id === turns.id)).toBe(true);
    expect(await remove({ id: turns.id }, '#ideas')).toMatchObject({ deleted: true, name: 'ideas' });
    expect(store.workspace().emptyChannels.some(item => item.id === turns.id)).toBe(false);
  });

  it('keeps how a channel with messages was deleted: a lead channel leaves the list, one that takes turns is refused', async () => {
    const [first] = store.all<Worker>('workers');
    const turns = await save({ name: 'ideas', members: orgletMembers(first.id) });
    const taskId = await core.command('createTask', { workerId: first.id, channelId: turns.id, brief: 'Hi', ...message }) as string;
    await settled(taskId);
    await expect(remove({ id: turns.id }, 'ideas')).rejects.toThrow('orglet delete --chat');
    expect(store.get<Task>('tasks', taskId).deletedAt).toBeUndefined();
    const lead = await save({ name: 'launch', members: orgletMembers(first.id), lead: { instructions: 'Combine.' } });
    const leadTask = await core.command('createTask', { workerId: first.id, channelId: lead.channelId, brief: 'Hi', ...message }) as string;
    await settled(leadTask);
    const deleted = await remove({ id: lead.id, revision: store.get<Team>('teams', lead.id).revision }, 'launch');
    expect(deleted).toMatchObject({ deleted: true, id: lead.id });
    expect((await catalog()).crews.some(crew => crew.id === lead.id)).toBe(false);
    expect(store.get<Task>('tasks', leadTask).deletedAt).toBeUndefined();
  });

  it('finds a channel by #name in a file command and sends its own id and the typed name', async () => {
    const [first] = store.all<Worker>('workers');
    const turns = await save({ name: 'ideas', members: orgletMembers(first.id) });
    const saveCrew = vi.fn(async () => turns);
    const deleteChannel = vi.fn(async () => ({ ...turns, deleted: true }));
    const client: ManagementClient = { catalog, saveOrglet: vi.fn(), saveCrew, delete: deleteChannel };
    const path = join(directory, 'patch.json');
    await writeFile(path, JSON.stringify({ topic: 'Changed' }));
    await runManagementCommand(parseArguments(['edit', 'channel', '#Ideas', '--config', path]) as ManagementCommand, client, directory);
    expect(saveCrew).toHaveBeenCalledWith({ topic: 'Changed' }, { id: turns.id });
    await runManagementCommand({ kind: 'delete', entity: 'team', name: 'ideas', confirm: '#ideas', json: false }, client, directory);
    expect(deleteChannel).toHaveBeenCalledWith('team', { id: turns.id }, 'ideas');
  });

  it('reads an app that sends only crews as the channels with a lead', async () => {
    const crewId = '33333333-3333-4333-8333-333333333333';
    const orgletId = store.all<Worker>('workers')[0].id;
    const older: ManagementCatalog = { ...(await catalog()), channels: undefined, crews: [{ id: crewId, revision: 3, config: { name: 'Review', instructions: 'Combine.', memberIds: [orgletId], synthesizerId: orgletId, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 } }] };
    const saveCrew = vi.fn(async () => ({ kind: 'team' as const, id: crewId, name: 'Review', revision: 4 }));
    const client: ManagementClient = { catalog: async () => older, saveOrglet: vi.fn(), saveCrew, delete: vi.fn() };
    const path = join(directory, 'patch.json');
    await writeFile(path, JSON.stringify({ instructions: 'Changed.' }));
    await runManagementCommand({ kind: 'edit', entity: 'team', name: 'review', config: path, json: false }, client, directory);
    expect(saveCrew).toHaveBeenCalledWith({ instructions: 'Changed.' }, { id: crewId, revision: 3 });
  });
});
