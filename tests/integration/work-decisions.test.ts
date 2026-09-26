import { afterEach, beforeEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';

let directory: string;
let store: Store;
let core: CoreService;

const response = (name: string, argumentsValue: unknown): ModelReply => ({
  calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }],
  usage: { input: 100, output: 30 },
});

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-decisions-'));
  store = new Store(join(directory, 'state.sqlite'));
});

afterEach(async () => {
  await core?.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

it('pauses one worker turn for a decision and resumes the same run once', async () => {
  let calls = 0;
  let resumedMessages: unknown[] = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, tools) {
      expect(tools.some(tool => tool.type === 'function' && tool.function.name === 'request_user_decision')).toBe(true);
      calls++;
      if (calls === 1) return response('request_user_decision', {
        question: 'Giảm giá hiển thị hay giá tính tiền?',
        options: ['Chỉ giao diện', 'Giá tính tiền'],
      });
      resumedMessages = structuredClone(messages);
      return response('reply', { message: 'Đã sửa giá hiển thị.', title: null, knowledgeProposals: [] });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'Giảm giá pricing', sourceIds: [], consent: true,
    providerScopes: ['openai'], budgetMicros: 100_000,
  }) as string;
  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core.runner.isActive(taskId));
  const waiting = store.detail(taskId);
  const question = waiting.task.decisionRequests![0];
  expect(waiting.runs).toHaveLength(1);
  expect(waiting.artifacts).toHaveLength(0);
  expect(question).toMatchObject({ runId: waiting.runs[0].id, inputRevision: 0, options: ['Chỉ giao diện', 'Giá tính tiền'] });
  await expect(core.command('answerDecision', { taskId, requestId: id(), answer: 'Chỉ giao diện' })).rejects.toThrow('không còn hiệu lực');

  await core.command('answerDecision', { taskId, requestId: question.id, answer: 'Chỉ giao diện' });
  await until(() => store.detail(taskId).task.status === 'completed');
  const finished = store.detail(taskId);
  expect(finished.runs).toHaveLength(1);
  expect(finished.runs[0].id).toBe(question.runId);
  expect(finished.task.inputRevision ?? 0).toBe(0);
  expect(finished.task.decisionRequests![0].answer).toBe('Chỉ giao diện');
  expect(finished.artifacts[0].report.summary).toBe('Đã sửa giá hiển thị.');
  expect(JSON.stringify(resumedMessages)).toContain('Chỉ giao diện');
  expect(calls).toBe(2);
  await expect(core.command('answerDecision', { taskId, requestId: question.id, answer: 'Giá tính tiền' })).rejects.toThrow();
});

it('waits at the team plan boundary without starting members, then uses the saved answer', async () => {
  let team: Team;
  let planCalls = 0;
  let memberCalls = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request(messages, tools) {
      const names = tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
      if (names.includes('submit_plan')) {
        planCalls++;
        if (planCalls === 1) return response('request_user_decision', {
          question: 'Làm trang giá hay đổi giá billing?', options: ['Trang giá', 'Billing'],
        });
        expect(JSON.stringify(messages)).toContain('Trang giá');
        return response('submit_plan', { assignments: [{ workerId: team.memberIds[0], brief: 'Sửa trang giá', expectedOutput: 'Bản nháp', dependsOn: [], writeResources: [] }] });
      }
      expect(names).not.toContain('request_user_decision');
      memberCalls++;
      return response('submit_report', { title: 'Kết quả', summary: 'Đã làm.', findings: [], limitations: [] });
    },
  }));
  team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', {
    workerId: team.synthesizerId, teamId: team.id, brief: 'Giảm giá pricing',
    sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000,
  }) as string;
  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core.teams.isActive(taskId));
  expect(memberCalls).toBe(0);
  // The question is the lead's plan asking, so it waits under "routing", not under the combining step that has not run.
  const workspace = store.workspace();
  const waitingHtml = renderToStaticMarkup(createElement(TaskThread, {
    detail: store.detail(taskId), workspace: { workers: workspace.workers, skills: workspace.skills, tasks: workspace.tasks }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
  expect(waitingHtml).toContain('Làm trang giá hay đổi giá billing?');
  expect(waitingHtml).toContain('<span class="byline-role">routing</span>');
  expect(waitingHtml).not.toContain('<span class="byline-role">combining</span>');
  const request = store.detail(taskId).task.decisionRequests![0];
  await core.command('answerDecision', { taskId, requestId: request.id, answer: 'Trang giá' });
  await until(() => store.detail(taskId).task.status === 'completed' && !core.teams.isActive(taskId));
  const detail = store.detail(taskId);
  expect(planCalls).toBe(2);
  expect(memberCalls).toBe(2);
  expect(detail.runs.filter(run => run.stage === 'plan')).toHaveLength(1);
  expect(detail.artifacts).toHaveLength(2);
});

it('records an abandoned question when a new message replaces the waiting turn', async () => {
  let calls = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request() {
      calls++;
      return calls === 1
        ? response('request_user_decision', { question: 'Đổi phần nào?', options: ['Giao diện', 'Billing'] })
        : response('reply', { message: 'Đã nhận yêu cầu mới.', title: null, knowledgeProposals: [] });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const scope = { sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 };
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Giảm giá', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core.runner.isActive(taskId));
  const requestId = store.detail(taskId).task.decisionRequests![0].id;
  await core.command('reviseTask', { taskId, brief: 'Thôi, chỉ giải thích giá hiện tại', ...scope });
  await until(() => store.detail(taskId).task.status === 'completed');
  const detail = store.detail(taskId);
  expect(detail.task.inputRevision).toBe(1);
  expect(detail.task.decisionRequests![0].interruptedAt).toBeDefined();
  expect(detail.task.decisionRequests![0].answer).toBeUndefined();
  expect(detail.artifacts[0].report.summary).toBe('Đã nhận yêu cầu mới.');
  await expect(core.command('answerDecision', { taskId, requestId, answer: 'Billing' })).rejects.toThrow();
});

it('keeps a backed-up pending question but does not pretend its absent checkpoint can resume', async () => {
  core = new CoreService(store, () => {}, async () => ({
    async request() {
      return response('request_user_decision', {
        question: 'Dùng cách nào?', options: ['Cách A', 'Cách B'],
      });
    },
  }));
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const taskId = await core.command('createTask', {
    workerId: worker.id, brief: 'Làm việc này', sourceIds: [], consent: true,
    providerScopes: ['openai'], budgetMicros: 100_000,
  }) as string;
  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core.runner.isActive(taskId));
  const backup = core.backups.export();
  const restored = new Store(':memory:');
  try {
    const receiver = new CoreService(restored, () => {}, async () => { throw new Error('No provider call'); });
    const preview = receiver.backups.preview(backup);
    receiver.backups.restore(preview.token);
    const task = restored.detail(taskId).task;
    expect(task.status).toBe('interrupted');
    expect(task.decisionRequests![0].question).toBe('Dùng cách nào?');
    expect(task.decisionRequests![0].interruptedAt).toBeDefined();
    await expect(receiver.command('answerDecision', { taskId, requestId: task.decisionRequests![0].id, answer: 'Cách A' })).rejects.toThrow();
  } finally {
    restored.close();
  }
});
