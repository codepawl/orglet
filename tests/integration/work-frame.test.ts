import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';

let store: Store;
let core: CoreService;

const response = (name: string, argumentsValue: unknown): ModelReply => ({
  calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }],
  usage: { input: 100, output: 30 },
});

const frame = {
  goal: 'Update only the pricing page',
  statedConstraints: ['Keep billing unchanged'],
  assumptions: ['The visual design may change'],
  plannedChecks: ['Run the existing pricing tests'],
};

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

beforeEach(() => {
  store = new Store(':memory:');
});

afterEach(async () => {
  await core?.runner.shutdown();
  store.close();
});

it('records a worker interpretation without treating planned checks as completed evidence', async () => {
  let calls = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request(_messages, tools) {
      expect(tools.some(tool => tool.type === 'function' && tool.function.name === 'record_work_frame')).toBe(true);
      calls++;
      return calls === 1
        ? response('record_work_frame', frame)
        : response('reply', { message: 'The pricing page needs a change.', title: null, knowledgeProposals: [] });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'Keep billing unchanged, adjust pricing UI', sourceIds: [],
    consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
  }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  const detail = store.detail(taskId);
  expect(detail.runs).toHaveLength(1);
  expect(detail.runs[0].snapshot.workFrame).toEqual(frame);
  expect(detail.artifacts[0].report.review).toBeUndefined();
  expect(detail.events.some(event => event.message.includes('đã kiểm tra'))).toBe(false);

  const restored = new Store(':memory:');
  try {
    const receiver = new CoreService(restored, () => {}, async () => { throw new Error('No provider call'); });
    const preview = receiver.backups.preview(core.backups.export());
    receiver.backups.restore(preview.token);
    expect(restored.detail(taskId).runs[0].snapshot.workFrame).toEqual(frame);
  } finally {
    restored.close();
  }
});

it('saves a team goal before member dispatch without changing assignment ownership', async () => {
  let team: Team;
  let planCalls = 0;
  let memberCalls = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request(_messages, tools) {
      const names = tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
      if (names.includes('submit_plan')) {
        planCalls++;
        return planCalls === 1 ? response('record_work_frame', frame) : response('submit_plan', {
          assignments: [{ workerId: team.memberIds[0], brief: 'Inspect pricing page', expectedOutput: 'Findings', dependsOn: [], writeResources: [] }],
        });
      }
      memberCalls++;
      expect(store.all<{ snapshot: { workFrame?: unknown }; stage?: string }>('runs').find(run => run.stage === 'plan')?.snapshot.workFrame).toEqual(frame);
      expect(names).not.toContain('record_work_frame');
      return response('submit_report', { title: 'Result', summary: 'Checked the brief.', findings: [], limitations: [] });
    },
  }));
  team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', {
    workerId: team.synthesizerId, teamId: team.id, brief: 'Keep billing unchanged, adjust pricing UI',
    sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  expect(planCalls).toBe(2);
  expect(memberCalls).toBe(2);
  expect(store.detail(taskId).runs.find(run => run.stage === 'plan')?.snapshot.workFrame).toEqual(frame);
});
