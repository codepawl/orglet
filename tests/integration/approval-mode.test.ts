import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { Run, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ToolCapability } from '../../apps/desktop/src/shared/tool-policy';
import type { WorkspaceGrantView } from '../../apps/desktop/src/shared/workspace-access';
import { answersWithPlan, approvalModeOf, canFollowPlan, capabilitiesForMode, changesMode, folderNeedFor } from '../../apps/desktop/src/shared/approval-mode';
import { PermissionControls } from '../../apps/desktop/src/renderer/components/PermissionControls';
import { ChatModePicker } from '../../apps/desktop/src/renderer/components/ApprovalModePicker';
import { movePlanFirst, planFirstChosen, setPlanFirst } from '../../apps/desktop/src/renderer/planFirst';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-367: the approval mode under the prompt bar. Ask before applying and Apply changes are the chat's
 * `workspace.apply`, the same value as the Details switch; Plan first is a flag on one message's input, frozen with the
 * run, which withholds every tool that changes something. No network: the adapter is a fixture recording each request.
 */

const CHANGE_TOOLS = ['workspace_write', 'workspace_create_folder', 'workspace_move', 'workspace_delete', 'workspace_start_process', 'workspace_process_status', 'workspace_process_output', 'workspace_cancel_process'];
const READ_TOOLS = ['workspace_list', 'workspace_read', 'workspace_search'];

describe('the mode mapping', () => {
  it('reads Ask and Apply off workspace.apply and keeps every other permission', () => {
    const base: ToolCapability[] = ['source.read', 'network.web'];
    expect(changesMode(base, false)).toBe('ask');
    expect(changesMode([...base, 'workspace.apply'], false)).toBe('apply');
    expect(capabilitiesForMode(base, 'apply')).toEqual(['source.read', 'network.web', 'workspace.apply']);
    expect(capabilitiesForMode([...base, 'workspace.apply'], 'ask')).toEqual(base);
  });

  it('shows Plan first over the chat mode, and a crew or channel as Apply, since it never holds changes', () => {
    expect(approvalModeOf({ capabilities: ['workspace.apply'], planFirst: true, appliesAtOnce: false })).toBe('plan');
    expect(approvalModeOf({ capabilities: [], planFirst: false, appliesAtOnce: false })).toBe('ask');
    expect(approvalModeOf({ capabilities: [], planFirst: false, appliesAtOnce: true })).toBe('apply');
  });

  it('asks for a folder only for the modes that change the folder', () => {
    expect(folderNeedFor('ask', 'none')).toBe('pick');
    expect(folderNeedFor('apply', 'read')).toBe('edit');
    expect(folderNeedFor('apply', 'write')).toBeUndefined();
    expect(folderNeedFor('plan', 'none')).toBeUndefined();
  });

  it('offers Follow the plan under the latest Plan first answer only, never a crew member part', () => {
    const planned = { stage: undefined, snapshot: { input: { brief: 'b', sourceIds: [], planFirst: true } } } as unknown as Run;
    const idle = { latest: true, busy: false, pendingStart: false };
    expect(answersWithPlan(planned)).toBe(true);
    expect(canFollowPlan(planned, idle)).toBe(true);
    expect(canFollowPlan(planned, { ...idle, latest: false })).toBe(false);
    expect(canFollowPlan(planned, { ...idle, busy: true })).toBe(false);
    expect(answersWithPlan({ ...planned, stage: 'member' } as Run)).toBe(false);
    expect(answersWithPlan({ ...planned, snapshot: { ...planned.snapshot, input: { brief: 'b', sourceIds: [] } } } as Run)).toBe(false);
  });
});

describe('the picker and the Details switch', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const grant: WorkspaceGrantView = { id: '22222222-2222-4222-8222-222222222222', taskId, revision: 1, permissions: ['read', 'write'], name: 'project', revoked: false };
  const details = (capabilities: ToolCapability[]) => renderToStaticMarkup(createElement(PermissionControls, {
    workers: [{ id: 'w1', name: 'Minh', provider: 'openai', connected: true }], capabilities, grant, taskId, sourceCount: 0, searchProvider: 'exa',
    onCapability: () => {}, onWorkspace: () => {},
  }));
  const picker = (capabilities: ToolCapability[], planKey = 'task:sync') => renderToStaticMarkup(createElement(ChatModePicker, {
    planKey, capabilities, level: 'write', appliesAtOnce: false, sideThread: false, onChange: () => {},
  }));
  // Sources are on in every case below, so one switch on means review is off and two mean it is on.
  const reviewOn = (html: string) => (html.match(/role="switch"[^>]*aria-checked="true"/g) ?? []).length === 2;

  it('show the same mode from the same permissions, whichever control changed them', () => {
    const asking: ToolCapability[] = ['source.read'];
    expect(picker(asking)).toContain('aria-label="Mode: Ask before applying"');
    expect(details(asking)).toContain('Review before applying');
    expect(reviewOn(details(asking))).toBe(true);

    // Choosing Apply changes in the picker gives the chat workspace.apply, which Details shows as review off.
    const applying = capabilitiesForMode(asking, 'apply');
    expect(picker(applying)).toContain('aria-label="Mode: Apply changes"');
    expect(reviewOn(details(applying))).toBe(false);
  });

  it('keeps Plan first on the bar, without touching the permissions Details shows', () => {
    setPlanFirst('task:plan', true);
    expect(picker(['source.read'], 'task:plan')).toContain('aria-label="Mode: Plan first"');
    expect(reviewOn(details(['source.read']))).toBe(true);
    movePlanFirst('task:plan', 'task:created');
    expect(planFirstChosen('task:plan')).toBe(false);
    expect(planFirstChosen('task:created')).toBe(true);
    setPlanFirst('task:created', false);
  });
});

type Request = { messages: string; toolNames: string[] };
let directory: string; let store: Store; let core: CoreService; let folder: string;
let requests: Request[];

const call = (name: string, args: object): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(args) }], usage: { input: 50, output: 20 } });
const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-approval-mode-'));
  store = new Store(join(directory, 'state.sqlite'));
  requests = [];
  const adapter: ModelAdapter = { async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    const toolNames = tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
    requests.push({ messages: JSON.stringify(messages), toolNames });
    if (toolNames.includes('reply')) return call('reply', { message: 'Plan: edit notes.md, then run the tests.', knowledgeProposals: [] });
    return call('submit_report', { title: 'Part', summary: 'My part of the plan.', findings: [], limitations: [], knowledgeProposals: [], assignmentOutcome: 'completed' });
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

async function researcher(): Promise<Worker> {
  const worker = store.all<Worker>('workers')[0];
  return await core.command('saveWorker', { ...worker, provider: 'openai' }) as Worker;
}

/** A chat with one answered message and a folder the orglet may edit and run commands in. */
async function chatWithFolder(worker: Worker): Promise<string> {
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Hello', ...scope }) as string;
  await settled(taskId);
  await core.grantWorkspace({ taskId, directory: folder, permissions: ['read', 'write', 'execute'] });
  return taskId;
}

const latestRuns = (taskId: string) => {
  const detail = store.detail(taskId);
  const revision = store.get<Task>('tasks', taskId).inputRevision ?? 0;
  return detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
};
const requestFor = (brief: string) => requests.filter(request => request.messages.includes(brief));

describe('Plan first in the core', () => {
  it('reads but never edits, moves, deletes or runs commands, and is told to answer with a plan', async () => {
    const taskId = await chatWithFolder(await researcher());
    await core.command('reviseTask', { taskId, brief: 'Tidy the notes', planFirst: true, ...scope });
    await settled(taskId);
    const [request] = requestFor('Tidy the notes');
    for (const name of READ_TOOLS) expect(request.toolNames).toContain(name);
    for (const name of CHANGE_TOOLS) expect(request.toolNames).not.toContain(name);
    expect(request.messages).toContain('chose Plan first');
    const [run] = latestRuns(taskId);
    expect(run.snapshot.input?.planFirst).toBe(true);
    // The flag is the turn's, never the chat's.
    expect(Object.hasOwn(store.get<Task>('tasks', taskId), 'planFirst')).toBe(false);
  });

  it('lets Follow the plan, the next message without the flag, edit and run commands as the chat allows', async () => {
    const taskId = await chatWithFolder(await researcher());
    await core.command('reviseTask', { taskId, brief: 'Plan the tidy-up', planFirst: true, ...scope });
    await settled(taskId);
    const plan = store.detail(taskId).artifacts.at(-1)!;
    await core.command('reviseTask', { taskId, brief: 'Follow the plan above.', replyTo: plan.id, ...scope });
    await settled(taskId);
    const [request] = requestFor('Follow the plan above.');
    for (const name of CHANGE_TOOLS) expect(request.toolNames).toContain(name);
    expect(request.messages).not.toContain('chose Plan first');
    expect(latestRuns(taskId)[0].snapshot.input?.planFirst).toBeUndefined();
  });

  it('starts the first message of a chat in Plan first without keeping it on the chat row', async () => {
    const worker = await researcher();
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'First, plan it', planFirst: true, ...scope }) as string;
    await settled(taskId);
    const task = store.get<Task>('tasks', taskId);
    expect(task.currentInput?.planFirst).toBe(true);
    expect(Object.hasOwn(task, 'planFirst')).toBe(false);
    expect(store.detail(taskId).runs[0].snapshot.input?.planFirst).toBe(true);
  });

  it('lets a side thread start in Plan first, never wider than its main chat', async () => {
    const mainTaskId = await chatWithFolder(await researcher());
    const sideTaskId = await core.command('startSideThread', { taskId: mainTaskId, brief: 'Plan on the side', planFirst: true, ...scope }) as string;
    await settled(sideTaskId);
    const [request] = requestFor('Plan on the side');
    for (const name of CHANGE_TOOLS) expect(request.toolNames).not.toContain(name);
    expect(store.get<Task>('tasks', sideTaskId).toolCapabilities).toEqual(store.get<Task>('tasks', mainTaskId).toolCapabilities);
    // The main chat's next message is not affected by the side thread's mode.
    await core.command('reviseTask', { taskId: mainTaskId, brief: 'Main goes on', ...scope });
    await settled(mainTaskId);
    expect(requestFor('Main goes on')[0].toolNames).toContain('workspace_write');
  });

  it('freezes Plan first on every run of a crew turn, so no member edits the folder', async () => {
    await researcher();
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Crew hello', ...scope }) as string;
    await settled(taskId);
    await core.grantWorkspace({ taskId, directory: folder, permissions: ['read', 'write', 'execute'] });
    requests = [];
    await core.command('reviseTask', { taskId, brief: 'Crew, plan the release', planFirst: true, ...scope });
    await settled(taskId);
    const runs = latestRuns(taskId);
    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) expect(run.snapshot.input?.planFirst).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) for (const name of CHANGE_TOOLS) expect(request.toolNames).not.toContain(name);
  });
});

describe('Plan first in the tool catalog', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const task = { id: taskId, toolCapabilities: ['source.read', 'browser.read', 'browser.act', 'network.web'] } as Task;
  const run = (planFirst: boolean) => ({ taskId, snapshot: {
    worker: { provider: 'openai' }, toolCapabilities: task.toolCapabilities, browser: { profileId: 'clean' },
    workspaceGrant: { id: '22222222-2222-4222-8222-222222222222', taskId, revision: 1, permissions: ['read', 'write', 'execute'] },
    mcpTools: [{ name: 'mcp__fixture__write_note', serverId: id(), serverName: 'fixture', tool: 'write_note', description: '', inputSchema: { type: 'object' } }],
    input: { brief: 'b', sourceIds: [], ...(planFirst ? { planFirst: true } : {}) },
  } }) as unknown as Run;
  const names = (planFirst: boolean) => toolsFor(run(planFirst), task).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);

  it('keeps reading the web and pages, and withholds acting on pages and MCP tools', () => {
    expect(names(false)).toEqual(expect.arrayContaining(['browser_click', 'mcp__fixture__write_note', 'workspace_write']));
    const planned = names(true);
    expect(planned).toEqual(expect.arrayContaining(['web_search', 'browser_open', 'browser_snapshot', 'read_source', 'reply', ...READ_TOOLS]));
    for (const name of ['browser_click', 'browser_type', 'mcp__fixture__write_note', ...CHANGE_TOOLS]) expect(planned).not.toContain(name);
  });
});
