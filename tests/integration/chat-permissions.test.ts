import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { newChatKey } from '../../apps/desktop/src/shared/live-task';
import { isPlanRequest, planReply } from './team-plan';

/*
 * COD-178: a run fixes its permissions when it starts, not when the turn was sent, and a chat's permissions can be
 * chosen before its first message. No network: the adapter is a fixture whose plan reply waits for the test.
 */

let directory: string; let store: Store; let core: CoreService;
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
  core = new CoreService(store, () => {}, async () => adapter);
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

    await core.command('setToolCapabilities', { taskId, capabilities: ['source.read', 'dataset.check', 'skill.read', 'network.web'] });
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
