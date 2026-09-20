import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
let core: CoreService;

const response = (name: string, argumentsValue: unknown): ModelReply => ({
  calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }],
  usage: { input: 100, output: 30 },
});

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

const changed = (taskId: string, brief: string) => ({
  taskId, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000,
});

beforeEach(() => { store = new Store(':memory:'); });
afterEach(async () => { await core?.runner.shutdown(); store.close(); });

it('saves a changed request before stopping an active worker, then starts one new revision', async () => {
  let firstStarted = false;
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, _tools, signal) {
      const current = messages.findLast(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('"brief"'))?.content;
      if (typeof current === 'string' && current.includes('"brief":"mobile cũng làm"')) {
        firstStarted = true;
        return new Promise<ModelReply>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return response('reply', { message: 'Chỉ desktop đã xong.', title: null, knowledgeProposals: [] });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'mobile cũng làm', sourceIds: [], consent: true,
    providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => firstStarted);
  await core.command('reviseTask', changed(taskId, 'chỉ desktop'));
  const pending = store.detail(taskId);
  expect(pending.task.inputRevision).toBe(1);
  expect(pending.task.currentInput?.brief).toBe('chỉ desktop');
  expect(pending.task.pendingStart).toBe(true);
  await expect(core.command('reviseTask', changed(taskId, 'đổi nữa'))).rejects.toThrow('Đã lưu tin nhắn mới');
  await until(() => !core.runner.isActive(taskId));
  await core.tick();
  await until(() => store.detail(taskId).task.status === 'completed');
  const detail = store.detail(taskId);
  expect(detail.task.pendingStart).toBeUndefined();
  expect(detail.runs.map(run => [run.snapshot.inputRevision, run.status])).toEqual([[0, 'cancelled'], [1, 'completed']]);
  expect(detail.artifacts).toHaveLength(1);
  expect(detail.artifacts[0].report.summary).toBe('Chỉ desktop đã xong.');
});

it('stops an old team plan before dispatching members for the changed request', async () => {
  let team: Team;
  let oldPlanStarted = false;
  let memberCalls = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, tools, signal) {
      const current = messages.findLast(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('"brief"'))?.content;
      const names = tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
      if (names.includes('submit_plan')) {
        if (typeof current === 'string' && current.includes('"brief":"mobile cũng làm"')) {
          oldPlanStarted = true;
          return new Promise<ModelReply>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        return response('submit_plan', { assignments: [{ workerId: team.memberIds[0], brief: 'Chỉ desktop', expectedOutput: 'Kiểm tra desktop', dependsOn: [], writeResources: [] }] });
      }
      memberCalls++;
      return response('submit_report', { title: 'Desktop', summary: 'Đã xem desktop.', findings: [], limitations: [] });
    },
  }));
  team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', {
    workerId: team.synthesizerId, teamId: team.id, brief: 'mobile cũng làm', sourceIds: [],
    consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => oldPlanStarted);
  await core.command('reviseTask', changed(taskId, 'chỉ desktop'));
  await until(() => !core.teams.isActive(taskId) && !core.runner.isActive(taskId));
  expect(store.detail(taskId).runs.filter(run => (run.snapshot.inputRevision ?? 0) === 0).every(run => run.status !== 'completed')).toBe(true);
  await core.tick();
  await until(() => store.detail(taskId).task.status === 'completed');
  expect(memberCalls).toBe(2);
  expect(store.detail(taskId).artifacts.every(artifact => store.get<{ snapshot: { inputRevision?: number } }>('runs', artifact.runId).snapshot.inputRevision === 1)).toBe(true);
});

it('does not automatically dispatch a saved correction after recovery', async () => {
  let oldStarted = false;
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, _tools, signal) {
      const current = messages.findLast(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('"brief"'))?.content;
      if (typeof current === 'string' && current.includes('"brief":"mobile cũng làm"')) {
        oldStarted = true;
        return new Promise<ModelReply>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return response('reply', { message: 'Chỉ desktop.', title: null, knowledgeProposals: [] });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'mobile cũng làm', sourceIds: [], consent: true,
    providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => oldStarted);
  await core.command('reviseTask', changed(taskId, 'chỉ desktop'));
  await until(() => !core.runner.isActive(taskId));
  store.update('tasks', { ...store.detail(taskId).task, status: 'interrupted' });
  await core.tick();
  expect(store.detail(taskId).runs).toHaveLength(1);
  expect(store.detail(taskId).task.pendingStart).toBe(true);
  await core.command('resume', { id: taskId });
  await until(() => store.detail(taskId).task.status === 'completed');
  expect(store.detail(taskId).runs).toHaveLength(2);
  expect(store.detail(taskId).artifacts).toHaveLength(1);
});

it('cancel drops a correction that has not started', async () => {
  let oldStarted = false;
  core = new CoreService(store, () => {}, async () => ({
    async request(_messages, _tools, signal) {
      oldStarted = true;
      return new Promise<ModelReply>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'mobile cũng làm', sourceIds: [], consent: true,
    providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => oldStarted);
  await core.command('reviseTask', changed(taskId, 'chỉ desktop'));
  await core.command('cancel', { id: taskId });
  await until(() => !core.runner.isActive(taskId));
  await core.tick();
  expect(store.detail(taskId).task.pendingStart).toBeUndefined();
  expect(store.detail(taskId).runs).toHaveLength(1);
  expect(store.detail(taskId).artifacts).toHaveLength(0);
});
