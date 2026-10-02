import { describe, expect, it } from 'vitest';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

describe('terminal revision idle guard', () => {
  it('refuses an active run atomically without cancelling it or changing its saved input', async () => {
    const store = new Store(':memory:');
    let finishRequest: (reply: ModelReply) => void = () => {};
    let markStarted: () => void = () => {};
    let requestSignal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const core = new CoreService(store, () => {}, async () => ({ request: async (_messages, _tools, signal) => {
      requestSignal = signal;
      markStarted();
      return new Promise<ModelReply>(resolve => { finishRequest = resolve; });
    } }));
    try {
      const worker = store.all<Worker>('workers')[0];
      await core.command('saveWorker', { ...worker, provider: 'openai' });
      const scope = { sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 500_000 };
      const taskId = await core.command('createTask', { workerId: worker.id, brief: 'original message', ...scope }) as string;
      await started;
      const before = structuredClone(store.detail(taskId));
      await expect(core.command('reviseTask', { taskId, brief: 'corrected message', onlyWhenIdle: true, ...scope })).rejects.toThrow('Đợi lượt');
      expect(requestSignal?.aborted).toBe(false);
      expect(core.runner.isActive(taskId)).toBe(true);
      expect(store.detail(taskId).task).toEqual(before.task);
      expect(store.detail(taskId).runs).toEqual(before.runs);
      finishRequest({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Original answer.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } });
      for (let attempt = 0; attempt < 300 && core.runner.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(core.runner.isActive(taskId)).toBe(false);
      await core.command('reviseTask', { taskId, brief: 'corrected message', onlyWhenIdle: true, ...scope });
      expect(store.get<Task>('tasks', taskId).currentInput?.brief).toBe('corrected message');
      expect(store.detail(taskId).runs.find(run => run.id === before.runs[0].id)?.snapshot.input?.brief).toBe('original message');
    } finally {
      finishRequest({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Done.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } });
      await core.runner.shutdown();
      store.close();
    }
  });
});
