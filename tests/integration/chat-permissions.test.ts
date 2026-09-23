import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { newChatKey } from '../../apps/desktop/src/shared/live-task';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-178: a run fixes its permissions when it starts, not when the turn was sent, and a chat's permissions can be
 * chosen before its first message. COD-186: so can its working folder, and granting or widening a folder does not
 * stop the turn. No network: the adapter is a fixture whose plan reply waits for the test. The workspace runtime is
 * a stub that refuses every file operation, because these runs only carry the grant and never touch the copy.
 */

let directory: string; let store: Store; let core: CoreService;
let folder: string;
let releasePlan: () => void; let planStarted: Promise<void>;
const report = (): ModelReply => ({ calls: [{ id: id(), name: 'submit_report', arguments: JSON.stringify({ title: 'Fixture report', summary: 'No source evidence provided.', findings: [], limitations: ['No files were supplied.'] }) }], usage: { input: 50, output: 20 } });
const answer = (): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Done.', knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-chat-permissions-'));
  store = new Store(join(directory, 'state.sqlite'));
  let announcePlan: () => void = () => {};
  planStarted = new Promise<void>(resolve => { announcePlan = resolve; });
  const planReleased = new Promise<void>(resolve => { releasePlan = resolve; });
  const adapter: ModelAdapter = { async request(messages, tools) {
    if (isPlanRequest(tools)) {
      announcePlan();
      await planReleased;
      return planReply(messages);
    }
    const isReply = tools.some(tool => tool.type === 'function' && tool.function.name === 'reply');
    const needsReport = tools.some(tool => tool.type === 'function' && tool.function.name === 'submit_report');
    return needsReport && !isReply ? report() : answer();
  } };
  const untouched = async () => { throw new Error('These fixtures never open the working copy.'); };
  const runtime = new WorkspaceRuntime(store, { createCopy: untouched, execute: untouched }, { apply: untouched });
  core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime);
  folder = join(directory, 'project');
  await mkdir(folder);
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId) || core.runner.isActive(taskId)).toBe(false);
}
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

describe('a run fixes its permissions when it starts', () => {
  it('gives the web to member runs still queued when it was granted during routing, and leaves the running plan as it was', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Find the latest release notes', ...scope }) as string;
    await planStarted;
    const atSend = store.detail(taskId).runs;
    expect(atSend.map(run => run.stage).sort()).toEqual(['member', 'member', 'plan', 'synthesis']);
    for (const run of atSend) expect(run.snapshot.toolCapabilities).not.toContain('network.web');

    // The whole current set plus the web: dropping a capability the runs froze (app.propose) would cancel them instead.
    await core.command('setToolCapabilities', { taskId, capabilities: ['source.read', 'dataset.check', 'skill.read', 'app.propose', 'network.web'] });
    releasePlan();
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    const plan = detail.runs.find(run => run.stage === 'plan')!;
    expect(plan.snapshot.toolCapabilities).not.toContain('network.web');
    for (const run of detail.runs.filter(run => run.stage !== 'plan')) {
      expect(run.status).toBe('completed');
      expect(run.snapshot.toolCapabilities).toContain('network.web');
    }
  });
});

describe('permissions chosen before the first message', () => {
  it('land on the first turn of a team chat and are consumed by the row', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const capabilities = ['source.read', 'skill.read', 'network.web'] as const;
    await core.command('setToolCapabilities', { teamId: team.id, capabilities: [...capabilities] });
    expect(store.workspace().newChatCapabilities[newChatKey({ teamId: team.id, workerId: team.synthesizerId })]).toEqual([...capabilities]);

    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Find the latest release notes', ...scope }) as string;
    expect(store.workspace().newChatCapabilities).toEqual({});
    expect(store.get<{ toolCapabilities?: string[] }>('tasks', taskId).toolCapabilities).toEqual([...capabilities]);
    releasePlan();
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs).toHaveLength(4);
    for (const run of detail.runs) expect(run.snapshot.toolCapabilities).toEqual([...capabilities]);
  });

  it('land on the first turn of a worker chat', async () => {
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    await core.command('setToolCapabilities', { workerId: worker.id, capabilities: ['source.read', 'network.web'] });

    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Find the latest release notes', ...scope }) as string;
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.task.toolCapabilities).toEqual(['source.read', 'network.web']);
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0].snapshot.toolCapabilities).toEqual(['source.read', 'network.web']);
    expect(store.workspace().newChatCapabilities).toEqual({});
  });

  it('are left alone by a task that names its own capabilities', async () => {
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    await core.command('setToolCapabilities', { workerId: worker.id, capabilities: ['source.read', 'network.web'] });

    const explicit = await core.command('createTask', { workerId: worker.id, brief: 'Explicit capabilities', toolCapabilities: ['source.read'], ...scope }) as string;
    await settled(explicit);
    expect(store.detail(explicit).task.toolCapabilities).toEqual(['source.read']);
    expect(store.workspace().newChatCapabilities[newChatKey({ workerId: worker.id })]).toEqual(['source.read', 'network.web']);
  });

  it('are dropped with the worker', async () => {
    const template = store.all<Worker>('workers')[0];
    const { id: _id, ...draft } = template;
    const worker = await core.command('saveWorker', { ...draft, name: 'Second worker' }) as Worker;
    await core.command('setToolCapabilities', { workerId: worker.id, capabilities: ['source.read'] });
    await core.command('deleteEntity', { kind: 'worker', id: worker.id });
    expect(store.workspace().newChatCapabilities).toEqual({});
  });
});

describe('a working folder chosen before the first message', () => {
  it('lands on every run of the first team turn and is consumed by the row', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const kept = await core.grantWorkspace({ teamId: team.id, directory: folder, permissions: ['read', 'write'] });
    expect(kept).toEqual({ name: 'project', permissions: ['read', 'write'] });
    expect(store.workspace().newChatWorkspace).toEqual({ [newChatKey({ teamId: team.id })]: { name: 'project', permissions: ['read', 'write'] } });
    expect(JSON.stringify(store.workspace())).not.toContain(folder.replaceAll('\\', '\\\\'));

    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Set up the project', ...scope }) as string;
    expect(store.workspace().newChatWorkspace).toEqual({});
    expect(await core.command('workspaceAccess', { taskId })).toMatchObject({ name: 'project', permissions: ['read', 'write'], revoked: false });
    releasePlan();
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs).toHaveLength(4);
    for (const run of detail.runs) expect(run.snapshot.workspaceGrant).toMatchObject({ taskId, permissions: ['read', 'write'] });
  });

  it('lands on the first run of a worker chat', async () => {
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    await core.grantWorkspace({ workerId: worker.id, directory: folder, permissions: ['read'] });

    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Read the project', ...scope }) as string;
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0].snapshot.workspaceGrant).toMatchObject({ taskId, permissions: ['read'] });
    expect(store.workspace().newChatWorkspace).toEqual({});
  });

  it('is dropped by choosing no folder, and with the worker', async () => {
    const template = store.all<Worker>('workers')[0];
    const { id: _id, ...draft } = template;
    const worker = await core.command('saveWorker', { ...draft, name: 'Second worker' }) as Worker;
    await core.grantWorkspace({ workerId: worker.id, directory: folder, permissions: ['read'] });
    await core.command('revokeWorkspace', { workerId: worker.id });
    expect(store.workspace().newChatWorkspace).toEqual({});

    await core.grantWorkspace({ workerId: worker.id, directory: folder, permissions: ['read'] });
    await core.command('deleteEntity', { kind: 'worker', id: worker.id });
    expect(store.workspace().newChatWorkspace).toEqual({});
  });

  it('refuses a path that is not a folder and a worker that is gone', async () => {
    const worker = store.all<Worker>('workers')[0];
    await expect(core.grantWorkspace({ workerId: worker.id, directory: join(folder, 'missing'), permissions: ['read'] })).rejects.toThrow();
    await expect(core.grantWorkspace({ workerId: id(), directory: folder, permissions: ['read'] })).rejects.toThrow('Không tìm thấy');
    expect(store.workspace().newChatWorkspace).toEqual({});
  });

  it('starts the chat without the folder, and says so, when the folder disappeared before the first message', async () => {
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    await core.grantWorkspace({ workerId: worker.id, directory: folder, permissions: ['read', 'write'] });
    await rm(folder, { recursive: true });

    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Read the project', ...scope }) as string;
    expect(store.workspace().newChatWorkspace).toEqual({});
    expect(await core.command('workspaceAccess', { taskId })).toBeNull();
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs[0].snapshot.workspaceGrant).toBeUndefined();
    expect(detail.events.map(event => event.message)).toContain('Chat bắt đầu không có thư mục làm việc project: Thư mục không còn trên máy. Chọn lại thư mục trong Chi tiết.');
  });

  it('refuses a folder replaced at the same path before the first message', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    await core.grantWorkspace({ teamId: team.id, directory: folder, permissions: ['read'] });
    await rename(folder, join(directory, 'moved'));
    await mkdir(folder);

    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Read the project', ...scope }) as string;
    expect(await core.command('workspaceAccess', { taskId })).toBeNull();
    const plan = store.detail(taskId).runs.find(run => run.stage === 'plan')!;
    expect(store.detail(taskId).events.filter(event => event.runId === plan.id).map(event => event.message))
      .toContain('Chat bắt đầu không có thư mục làm việc project: Thư mục workspace đã bị thay thế. Chọn lại thư mục trước khi tiếp tục. Chọn lại thư mục trong Chi tiết.');
    releasePlan();
    await settled(taskId);
    expect(store.detail(taskId).task.status).toBe('completed');
  });
});

describe('granting a folder while a turn is routing', () => {
  it('cancels nothing, and the member runs still queued start with the widened grant', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Set up the project', ...scope }) as string;
    await planStarted;

    await core.grantWorkspace({ taskId, directory: folder, permissions: ['read'] });
    await core.grantWorkspace({ taskId, directory: folder, permissions: ['read', 'write', 'execute'] });
    expect(core.teams.isActive(taskId)).toBe(true);
    releasePlan();
    await settled(taskId);

    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs.map(run => run.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const plan = detail.runs.find(run => run.stage === 'plan')!;
    expect(plan.snapshot.workspaceGrant).toBeUndefined();
    for (const run of detail.runs.filter(run => run.stage !== 'plan')) {
      expect(run.snapshot.workspaceGrant).toMatchObject({ taskId, permissions: ['read', 'write', 'execute'] });
    }
  });

  it('still stops the turn when the folder is revoked', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Set up the project', ...scope }) as string;
    await planStarted;
    await core.grantWorkspace({ taskId, directory: folder, permissions: ['read'] });
    expect(core.teams.isActive(taskId)).toBe(true);

    await core.command('revokeWorkspace', { taskId });
    releasePlan();
    await settled(taskId);
    expect(store.detail(taskId).task.status).toBe('cancelled');
  });

  it('still stops the turn when the folder is switched to another one', async () => {
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Set up the project', ...scope }) as string;
    await planStarted;
    await core.grantWorkspace({ taskId, directory: folder, permissions: ['read', 'write'] });
    const other = join(directory, 'other');
    await mkdir(other);

    await core.grantWorkspace({ taskId, directory: other, permissions: ['read', 'write'] });
    releasePlan();
    await settled(taskId);
    expect(store.detail(taskId).task.status).toBe('cancelled');
    expect(await core.command('workspaceAccess', { taskId })).toMatchObject({ name: 'other' });
  });
});
