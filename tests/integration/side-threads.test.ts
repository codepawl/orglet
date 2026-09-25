import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { liveWorkerTask } from '../../apps/desktop/src/shared/live-task';
import { sideThreadsOf } from '../../apps/desktop/src/shared/side-threads';
import { MAIN_CHAT_TURNS } from '../../apps/desktop/src/core/context/thread';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { WorkspaceGrantView } from '../../apps/desktop/src/shared/workspace-access';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-247: a side thread is its own row of an orglet, started from the orglet's main chat. It never becomes the main
 * chat, it starts with the main chat's permissions and never more, it follows the main chat when that one loses a
 * permission, its first turn reads the main chat's latest turns, and its answer can be brought back into the main
 * chat as a quote without starting anything. No network: the adapter is a fixture that records every request.
 */

type Request = { messages: string; toolNames: string[] };
let directory: string; let store: Store; let core: CoreService; let folder: string;
let requests: Request[];
let holdSideThread: Promise<void> | undefined;
let releaseSideThread: () => void;

const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } });
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-side-threads-'));
  store = new Store(join(directory, 'state.sqlite'));
  requests = [];
  holdSideThread = undefined;
  const adapter: ModelAdapter = { async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    const text = JSON.stringify(messages);
    requests.push({ messages: text, toolNames: tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []) });
    if (holdSideThread && text.includes('HOLD')) await holdSideThread;
    const contents = messages.map(message => typeof message.content === 'string' ? message.content : '');
    const latest = contents.findLast(content => content.includes('"brief"'));
    const brief = latest ? (JSON.parse(latest) as { brief?: string }).brief : undefined;
    return answer(`Answer to ${brief ?? 'message'}`);
  } };
  const untouched = async () => { throw new Error('These fixtures never open the working copy.'); };
  const runtime = new WorkspaceRuntime(store, { createCopy: untouched, execute: untouched }, { apply: untouched });
  core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime);
  folder = join(directory, 'project');
  await mkdir(folder);
});
afterEach(async () => { releaseSideThread?.(); await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function settled(taskId: string) {
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId) || core.runner.isActive(taskId)).toBe(false);
}

/** Researcher on a fixture API connection, so its chat calls the adapter above. */
async function researcher(): Promise<Worker> {
  const worker = store.all<Worker>('workers')[0];
  return await core.command('saveWorker', { ...worker, provider: 'openai' }) as Worker;
}

/** A main chat with `turns` answered messages, "Turn 0" to "Turn n-1". */
async function mainChat(worker: Worker, turns = 1): Promise<string> {
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Turn 0', ...scope }) as string;
  await settled(taskId);
  for (let turn = 1; turn < turns; turn++) {
    await core.command('reviseTask', { taskId, brief: `Turn ${turn}`, ...scope });
    await settled(taskId);
  }
  return taskId;
}

async function sideThread(mainTaskId: string, brief = 'A side question'): Promise<string> {
  const taskId = await core.command('startSideThread', { taskId: mainTaskId, brief, ...scope }) as string;
  await settled(taskId);
  return taskId;
}

const task = (taskId: string) => store.get<Task>('tasks', taskId);

describe('side threads', () => {
  it('are their own rows and never the main chat', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker);
    const sideTaskId = await sideThread(mainTaskId);

    const tasks = store.workspace().tasks;
    expect(liveWorkerTask(tasks, worker.id)?.id).toBe(mainTaskId);
    expect(task(sideTaskId)).toMatchObject({ workerId: worker.id, sideOf: { taskId: mainTaskId, throughRevision: 0 }, status: 'completed' });
    expect(sideThreadsOf(tasks, worker.id).map(item => item.id)).toEqual([sideTaskId]);
    // The main chat is untouched: one turn, one run, and still its own answer.
    expect(store.detail(mainTaskId).runs).toHaveLength(1);
    expect(task(mainTaskId).inputRevision ?? 0).toBe(0);
    // A later send from the main chat keeps going to the main chat.
    await core.command('reviseTask', { taskId: mainTaskId, brief: 'Back in the main chat', ...scope });
    await settled(mainTaskId);
    expect(liveWorkerTask(store.workspace().tasks, worker.id)?.id).toBe(mainTaskId);
    expect(store.detail(sideTaskId).runs).toHaveLength(1);
  });

  it('start with a copy of the main chat’s permissions, folder and MCP grants, and can never widen them', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker);
    const serverId = id();
    await core.command('setToolCapabilities', { taskId: mainTaskId, capabilities: ['source.read', 'skill.read', 'network.web'] });
    await core.grantWorkspace({ taskId: mainTaskId, directory: folder, permissions: ['read', 'write'] });
    await core.command('setMcpGrant', { taskId: mainTaskId, serverId, tool: 'search', allowed: true });

    const sideTaskId = await sideThread(mainTaskId);
    expect(task(sideTaskId).toolCapabilities).toEqual(['source.read', 'skill.read', 'network.web']);
    expect(task(sideTaskId).mcpGrants).toEqual([{ serverId, tool: 'search' }]);
    const mainGrant = await core.command('workspaceAccess', { taskId: mainTaskId }) as WorkspaceGrantView;
    const sideGrant = await core.command('workspaceAccess', { taskId: sideTaskId }) as WorkspaceGrantView;
    expect(sideGrant).toMatchObject({ taskId: sideTaskId, name: 'project', permissions: ['read', 'write'], revoked: false });
    expect(sideGrant.id).not.toBe(mainGrant.id);
    expect(store.detail(sideTaskId).runs[0].snapshot).toMatchObject({ toolCapabilities: ['source.read', 'skill.read', 'network.web'], workspaceGrant: { taskId: sideTaskId, permissions: ['read', 'write'] } });

    await expect(core.command('setToolCapabilities', { taskId: sideTaskId, capabilities: ['source.read', 'skill.read', 'network.web', 'dataset.check'] })).rejects.toThrow('rộng hơn chat chính');
    await expect(core.grantWorkspace({ taskId: sideTaskId, directory: folder, permissions: ['read', 'write', 'execute'] })).rejects.toThrow('thư mục của chat chính');
    await expect(core.command('setMcpGrant', { taskId: sideTaskId, serverId, tool: null, allowed: true })).rejects.toThrow('rộng hơn chat chính');
    await expect(core.command('setMcpGrant', { taskId: sideTaskId, serverId: id(), tool: 'other', allowed: true })).rejects.toThrow('rộng hơn chat chính');
    expect(task(sideTaskId).toolCapabilities).toEqual(['source.read', 'skill.read', 'network.web']);
    expect(await core.command('workspaceAccess', { taskId: sideTaskId })).toMatchObject({ permissions: ['read', 'write'] });

    // Widening the main chat later does not reach a side thread that already started.
    await core.grantWorkspace({ taskId: mainTaskId, directory: folder, permissions: ['read', 'write', 'execute'] });
    await core.command('setToolCapabilities', { taskId: mainTaskId, capabilities: ['source.read', 'skill.read', 'network.web', 'dataset.check'] });
    expect(await core.command('workspaceAccess', { taskId: sideTaskId })).toMatchObject({ permissions: ['read', 'write'] });
    expect(task(sideTaskId).toolCapabilities).toEqual(['source.read', 'skill.read', 'network.web']);
  });

  it('lose at once what the main chat loses, and a side run using it is stopped', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker);
    const serverId = id();
    await core.command('setToolCapabilities', { taskId: mainTaskId, capabilities: ['source.read', 'skill.read', 'network.web'] });
    await core.grantWorkspace({ taskId: mainTaskId, directory: folder, permissions: ['read', 'write'] });
    await core.command('setMcpGrant', { taskId: mainTaskId, serverId, tool: null, allowed: true });
    const sideTaskId = await sideThread(mainTaskId);
    expect(task(sideTaskId).mcpGrants).toEqual([{ serverId, tool: null }]);

    await core.command('setToolCapabilities', { taskId: mainTaskId, capabilities: ['source.read', 'skill.read'] });
    expect(task(sideTaskId).toolCapabilities).toEqual(['source.read', 'skill.read']);

    await core.grantWorkspace({ taskId: mainTaskId, directory: folder, permissions: ['read'] });
    expect(await core.command('workspaceAccess', { taskId: sideTaskId })).toMatchObject({ permissions: ['read'], revoked: false });

    await core.command('setMcpGrant', { taskId: mainTaskId, serverId, tool: null, allowed: false });
    expect(task(sideTaskId).mcpGrants).toEqual([]);

    // A side run working with the folder when the main chat's folder is revoked is stopped, and its grant is gone.
    holdSideThread = new Promise<void>(resolve => { releaseSideThread = resolve; });
    await core.command('reviseTask', { taskId: sideTaskId, brief: 'HOLD while reading', ...scope });
    for (let tries = 0; tries < 300 && !requests.some(request => request.messages.includes('HOLD')); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    const heldRun = store.detail(sideTaskId).runs.at(-1)!;
    expect(heldRun.snapshot.workspaceGrant).toMatchObject({ taskId: sideTaskId, permissions: ['read'] });
    await core.command('revokeWorkspace', { taskId: mainTaskId });
    releaseSideThread();
    await settled(sideTaskId);
    expect(await core.command('workspaceAccess', { taskId: sideTaskId })).toMatchObject({ revoked: true });
    expect(store.get<Task>('tasks', sideTaskId).status).toBe('cancelled');
    // Archived side threads follow too, so restoring one never brings back more than the main chat has.
    const archivedSide = await sideThread(mainTaskId, 'Another side question');
    await core.command('archiveTask', { id: archivedSide, archived: true });
    await core.command('setToolCapabilities', { taskId: mainTaskId, capabilities: ['source.read'] });
    expect(task(archivedSide).toolCapabilities).toEqual(['source.read']);
  });

  it('read the main chat’s last turns on their first turn only', async () => {
    const worker = await researcher();
    const turns = MAIN_CHAT_TURNS + 2;
    const mainTaskId = await mainChat(worker, turns);
    requests = [];
    const sideTaskId = await sideThread(mainTaskId, 'Side first');

    const first = requests.find(request => request.messages.includes('Side first'))!;
    const mainChatLayer = JSON.parse(JSON.parse(first.messages).find((message: { content: string }) => message.content.includes('"mainChat"')).content) as { mainChat: { from: string; text: string }[] };
    const userTurns = mainChatLayer.mainChat.filter(turn => turn.from === 'user').map(turn => turn.text);
    expect(userTurns).toEqual(Array.from({ length: MAIN_CHAT_TURNS }, (_, index) => `Turn ${turns - MAIN_CHAT_TURNS + index}`));
    expect(mainChatLayer.mainChat.filter(turn => turn.from === 'you')).toHaveLength(MAIN_CHAT_TURNS);
    expect(first.messages).not.toContain('Turn 1');
    const context = store.detail(sideTaskId).runs[0].snapshot.context!;
    expect(context.manifest.mainChatTurns).toBe(MAIN_CHAT_TURNS * 2);
    expect(context.manifest.loaded.some(entry => entry.kind === 'main_chat')).toBe(true);

    // A later turn in the side thread is that thread's own history, without the main chat.
    requests = [];
    await core.command('reviseTask', { taskId: sideTaskId, brief: 'Side second', ...scope });
    await settled(sideTaskId);
    const second = requests.find(request => request.messages.includes('Side second'))!;
    expect(second.messages).not.toContain('"mainChat"');
    expect(second.messages).toContain('Side first');
    // The main chat's own turns never read a side thread.
    requests = [];
    await core.command('reviseTask', { taskId: mainTaskId, brief: 'Main again', ...scope });
    await settled(mainTaskId);
    expect(requests.find(request => request.messages.includes('Main again'))!.messages).not.toContain('Side first');
  });

  it('bring an answer into the main chat as a quote without starting a run', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker, 2);
    const sideTaskId = await sideThread(mainTaskId, 'Compare the two plans');
    const artifact = store.detail(sideTaskId).artifacts[0];
    const before = store.detail(mainTaskId);

    expect(await core.command('bringIntoMainChat', { artifactId: artifact.id })).toBe(mainTaskId);
    const after = store.detail(mainTaskId);
    expect(after.runs).toHaveLength(before.runs.length);
    expect(after.task.status).toBe(before.task.status);
    expect(after.task.inputRevision).toBe(before.task.inputRevision);
    expect(core.runner.isActive(mainTaskId)).toBe(false);
    expect(after.task.quotes).toMatchObject([{ fromTaskId: sideTaskId, artifactId: artifact.id, author: worker.name, authorId: worker.id, text: 'Answer to Compare the two plans', afterRevision: 1 }]);
    // Bringing the same answer in again adds nothing.
    await core.command('bringIntoMainChat', { artifactId: artifact.id });
    expect(task(mainTaskId).quotes).toHaveLength(1);
    // Only a side thread's answer can be brought in.
    await expect(core.command('bringIntoMainChat', { artifactId: before.artifacts[0].id })).rejects.toThrow('chat phụ');

    // The orglet reads the quote with the next message sent in the main chat.
    requests = [];
    await core.command('reviseTask', { taskId: mainTaskId, brief: 'What do you think now', ...scope });
    await settled(mainTaskId);
    const next = requests.find(request => request.messages.includes('What do you think now'))!;
    expect(next.messages).toContain('Answer from a side thread (written by you)');
    expect(next.messages).toContain('Answer to Compare the two plans');
  });

  it('cannot start from a crew chat, a group chat or another side thread', async () => {
    const worker = await researcher();
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const crewTaskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Crew work', ...scope }) as string;
    await settled(crewTaskId);
    await expect(core.command('startSideThread', { taskId: crewTaskId, brief: 'Side', ...scope })).rejects.toThrow('hội');

    const { id: _id, ...draft } = worker;
    const second = await core.command('saveWorker', { ...draft, name: 'Second' }) as Worker;
    const groupTaskId = await core.command('createTask', { workerId: worker.id, assignees: [worker.id, second.id], brief: 'Group work', ...scope }) as string;
    await settled(groupTaskId);
    await expect(core.command('startSideThread', { taskId: groupTaskId, brief: 'Side', ...scope })).rejects.toThrow('chat nhóm');

    const mainTaskId = await mainChat(worker);
    const sideTaskId = await sideThread(mainTaskId);
    await expect(core.command('startSideThread', { taskId: sideTaskId, brief: 'Side of side', ...scope })).rejects.toThrow('chat chính');
    await expect(core.command('updateTask', { id: sideTaskId, title: '', assignee: { kind: 'team', teamId: team.id }, budgetMicros: 1_000_000 })).rejects.toThrow('Chat phụ');
    // Files it carries must already be in the main chat.
    await expect(core.command('startSideThread', { taskId: mainTaskId, brief: 'Side', ...scope, sourceIds: [id()] })).rejects.toThrow('tệp');
  });

  it('archive, restore and delete like any chat, and a deleted one leaves its quote', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker);
    const sideTaskId = await sideThread(mainTaskId);
    await core.command('renameTask', { id: sideTaskId, title: 'Pricing ideas' });
    expect(store.workspace().tasks.find(item => item.id === sideTaskId)?.title).toBe('Pricing ideas');

    await core.command('archiveTask', { id: sideTaskId, archived: true });
    expect(sideThreadsOf(store.workspace().tasks, worker.id)).toEqual([]);
    expect(liveWorkerTask(store.workspace().tasks, worker.id)?.id).toBe(mainTaskId);
    await core.command('archiveTask', { id: sideTaskId, archived: false });
    expect(sideThreadsOf(store.workspace().tasks, worker.id).map(item => item.id)).toEqual([sideTaskId]);

    await core.command('bringIntoMainChat', { artifactId: store.detail(sideTaskId).artifacts[0].id });
    await core.command('deleteTask', { id: sideTaskId });
    expect(store.workspace().tasks.some(item => item.id === sideTaskId)).toBe(false);
    expect(task(mainTaskId).quotes).toHaveLength(1);
    expect(liveWorkerTask(store.workspace().tasks, worker.id)?.id).toBe(mainTaskId);

    // A main chat archived since: bringing an answer in lands in the orglet's current main chat instead.
    const second = await sideThread(mainTaskId, 'Second side');
    await core.command('archiveTask', { id: mainTaskId, archived: true });
    const nextMain = await mainChat(worker);
    expect(await core.command('bringIntoMainChat', { artifactId: store.detail(second).artifacts[0].id })).toBe(nextMain);
  });

  it('keep their main chat and quotes through backup and restore', async () => {
    const worker = await researcher();
    const mainTaskId = await mainChat(worker);
    const sideTaskId = await sideThread(mainTaskId);
    await core.command('bringIntoMainChat', { artifactId: store.detail(sideTaskId).artifacts[0].id });
    const text = new Backups(store, () => false, () => {}).export();

    const restored = new Store(join(directory, 'restored.sqlite'));
    try {
      const backups = new Backups(restored, () => false, () => {});
      backups.restore(backups.preview(text).token);
      const tasks = restored.workspace().tasks;
      expect(tasks.find(item => item.id === sideTaskId)?.sideOf).toEqual({ taskId: mainTaskId, throughRevision: 0 });
      expect(liveWorkerTask(tasks, worker.id)?.id).toBe(mainTaskId);
      expect(tasks.find(item => item.id === mainTaskId)?.quotes).toHaveLength(1);
      expect(sideThreadsOf(tasks, worker.id).map(item => item.id)).toEqual([sideTaskId]);
    } finally {
      restored.close();
    }

    // A backup whose side thread claims another orglet's chat as its main chat is refused.
    const { id: _id, ...draft } = worker;
    const second = await core.command('saveWorker', { ...draft, name: 'Second' }) as Worker;
    const otherMain = await mainChat(second);
    const envelope = JSON.parse(new Backups(store, () => false, () => {}).export()) as { checksum: string; payload: { tasks: Task[] } };
    envelope.payload.tasks.find(item => item.id === sideTaskId)!.sideOf = { taskId: otherMain, throughRevision: 0 };
    envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
    expect(() => new Backups(store, () => false, () => {}).preview(JSON.stringify(envelope))).toThrow('Chat phụ không khớp chat chính.');
  });
});
