import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { MessageInteractions } from '../../apps/desktop/src/core/orchestration/message-interactions';
import { harnessAnswerSchema, reactionsAllowed, toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import type { HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { MAX_ANSWER_REACTIONS, turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * COD-216: workers react too. A CLI harness worker has no tool loop, so its one JSON answer carries a `reactions`
 * array; a tool-loop worker keeps react_to_message. Both land through the same check in MessageInteractions.
 */

type Answer = Record<string, unknown>;
type HarnessProvider = 'claude-code' | 'codex' | 'cursor';
/** The messageId the prompt gave the worker for the latest message: what a real worker would copy back. */
const latestMessageId = (request: HarnessRequest) => /"messageId":"([0-9a-f-]{36})"/.exec(request.prompt)![1];
const settledStatuses = ['completed', 'failed', 'partial'];

describe('one-shot harness answers', () => {
  let core: CoreService; let store: Store; let requests: HarnessRequest[]; let answers: ((request: HarnessRequest) => Answer)[];
  let current = new Date('2026-01-05T01:59:50Z');
  function fixture(provider: HarnessProvider) {
    store = new Store(':memory:'); requests = []; answers = [];
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, () => current, {
      detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture.exe', version: 'fixture', auth: 'logged_in', status: 'signed_in' }],
      execute: async request => {
        requests.push(request);
        const next = answers.shift();
        if (!next) throw new Error('Fixture exhausted');
        const answer = next(request);
        return { output: provider === 'codex' ? { payload: JSON.stringify(answer) } : answer, costUsd: null };
      },
    });
  }
  async function harnessWorker(provider: HarnessProvider) {
    const worker = store.all<Worker>('workers')[0];
    return core.command('saveWorker', { ...worker, provider, taskBudgetMicros: 400_000 }) as Promise<Worker>;
  }
  async function settled(taskId: string) {
    const done = () => settledStatuses.includes(store.detail(taskId).task.status) && !core.runner.isActive(taskId);
    for (let tries = 0; tries < 300 && !done(); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(done()).toBe(true);
  }
  async function chat(workerId: string, provider: HarnessProvider, brief: string) {
    const taskId = await core.command('createTask', { workerId, brief, sourceIds: [], consent: true, providerScopes: [provider], budgetMicros: 1_000_000 }) as string;
    await settled(taskId);
    return taskId;
  }
  async function followUp(taskId: string, provider: HarnessProvider, brief: string) {
    await core.command('reviseTask', { taskId, brief, sourceIds: [], consent: true, providerScopes: [provider], budgetMicros: 1_000_000 });
    await settled(taskId);
  }
  const reactions = (taskId: string) => store.get<Task>('tasks', taskId).messageReactions ?? [];
  afterEach(async () => { if (core) await core.runner.shutdown(); store?.close(); });

  it('asks Claude Code for the field and puts the worker\'s mark on the person\'s message, never on its own answer', async () => {
    fixture('claude-code');
    const worker = await harnessWorker('claude-code');
    answers.push(request => ({ message: 'Chúc mừng nhé!', title: null, report: null, reactions: [{ messageId: latestMessageId(request), emoji: 'delighted' }] }));
    const taskId = await chat(worker.id, 'claude-code', 'Tôi vừa được nhận việc mới.');
    const schema = requests[0].schema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties).toHaveProperty('reactions');
    expect(schema.required).not.toContain('reactions');
    expect(requests[0].prompt).toContain('put a reaction in reactions');
    expect(requests[0].prompt).toContain('Most turns need no reaction');
    expect(latestMessageId(requests[0])).toBe(turnMessageId(taskId, 0));
    expect(reactions(taskId)).toMatchObject([{ messageId: turnMessageId(taskId, 0), actor: 'worker', workerId: worker.id, emoji: 'delighted', callId: 'answer-reaction-1' }]);
    expect(store.detail(taskId).artifacts[0].report.limitations).toEqual([]);

    // The next turn sees the earlier answer by id in the thread context, but it is the worker's own message.
    const ownAnswer = store.detail(taskId).artifacts[0].id;
    answers.push(() => ({ message: 'Ok.', title: null, report: null, reactions: [{ messageId: ownAnswer, emoji: 'agree' }] }));
    await followUp(taskId, 'claude-code', 'Cảm ơn.');
    expect(requests[1].prompt).toContain(ownAnswer);
    expect(reactions(taskId)).toHaveLength(1);
    // A refused reaction is noted in the run's activity, never under the answer.
    expect(store.detail(taskId).artifacts[1].report.limitations).toEqual([]);
    expect(store.detail(taskId).events.map(event => event.message)).toContain('Cảm xúc thứ 1 bị từ chối: Không thể thả cảm xúc cho tin của chính mình.');
    expect(store.detail(taskId).task.status).toBe('completed');
  });

  it('reads the field out of the Codex payload, drops an unseen id and a malformed item, and holds the cap', async () => {
    fixture('codex');
    const worker = await harnessWorker('codex');
    answers.push(request => ({ message: 'Đã đọc.', title: null, report: null, reactions: [
      { messageId: id(), emoji: 'agree' },
      'not an item',
      { messageId: latestMessageId(request), emoji: 'agree' },
      { messageId: latestMessageId(request), emoji: 'funny' },
    ] }));
    const taskId = await chat(worker.id, 'codex', 'Tôi thích trả lời ngắn.');
    expect(requests[0].prompt).toContain('reactions goes inside the payload JSON');
    expect(reactions(taskId)).toMatchObject([{ messageId: turnMessageId(taskId, 0), actor: 'worker', emoji: 'agree' }]);
    expect(store.detail(taskId).artifacts[0].report.limitations).toEqual([]);
    expect(store.detail(taskId).events.map(event => event.message)).toEqual(expect.arrayContaining([
      'Cảm xúc thứ 1 bị từ chối: Không tìm thấy tin nhắn trong cuộc trò chuyện này.',
      'Cảm xúc thứ 2 bị từ chối: Mỗi cảm xúc cần messageId và emoji.',
    ]));
    expect(store.detail(taskId).task.status).toBe('completed');
  });

  it('is not offered to a scheduled run, whose answer may not react', async () => {
    fixture('cursor');
    const worker = await harnessWorker('cursor');
    const routine = await core.command('saveRoutine', { name: 'Daily', enabled: true, schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 }, task: { workerId: worker.id, brief: 'Daily check', sourceIds: [], consent: true, providerScopes: ['cursor'], budgetMicros: 1_000_000 } }) as { id: string };
    answers.push(request => ({ message: 'Tried anyway.', title: null, report: null, reactions: [{ messageId: latestMessageId(request), emoji: 'agree' }] }));
    // The scheduler runs an occurrence once two ticks straddle its due time, the way the routine tests drive it.
    await core.tick(); current = new Date('2026-01-05T02:00:00Z'); await core.tick();
    const taskId = store.get<{ lastTaskId?: string }>('routines', routine.id).lastTaskId!;
    expect(taskId).toBeTruthy();
    await settled(taskId);
    expect(store.detail(taskId).task.routineId).toBe(routine.id);
    expect((requests[0].schema as { properties: Record<string, unknown> }).properties).not.toHaveProperty('reactions');
    expect(requests[0].prompt).not.toContain('put a reaction in reactions');
    expect(reactions(taskId)).toEqual([]);
    expect(store.detail(taskId).artifacts[0].report.limitations).toEqual([]);
    expect(store.detail(taskId).events.map(event => event.message)).toContain('Câu trả lời kèm 1 cảm xúc nhưng lượt chạy này không được phép thả cảm xúc; đã bỏ qua.');
  });
});

describe('who a worker may react to', () => {
  let store: Store;
  beforeEach(() => { store = new Store(':memory:'); });
  afterEach(() => store.close());

  function worker(name: string): Worker {
    const seed = store.all<Worker>('workers')[0];
    return { ...seed, id: id(), name, provider: 'openai' };
  }
  function crew() {
    const lead = worker('Lead'); const alice = worker('Alice'); const bob = worker('Bob'); const carol = worker('Carol');
    const skill = store.get<Skill>('skills', lead.skillId);
    const task: Task = { id: id(), workerId: lead.id, brief: 'Review the plan', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'running', createdAt: now() };
    store.put('tasks', task);
    const run = (member: Worker, stage: Run['stage'], status: Run['status'], extra: Partial<Run['snapshot']> = {}): Run => {
      const item: Run = { id: id(), taskId: task.id, stage, status, snapshot: { worker: member, skill, inputRevision: 0, ...extra }, startedAt: now(), error: null };
      store.put('runs', item, { column: 'task_id', value: task.id });
      return item;
    };
    const aliceRun = run(alice, 'member', 'completed');
    const report = { format: 'chat' as const, title: 'Alice', summary: 'Alice found the numbers.', findings: [], limitations: [] };
    const aliceAnswer: Artifact = { id: id(), runId: aliceRun.id, report, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now() };
    store.put('artifacts', aliceAnswer, { column: 'run_id', value: aliceRun.id });
    return { task, skill, alice, bob, carol, lead, aliceRun, aliceAnswer, run };
  }

  it('lets a crew member react to a colleague\'s answer it was handed, and the lead to any member\'s', () => {
    const { task, bob, carol, lead, aliceAnswer, run } = crew();
    const interactions = new MessageInteractions(store);
    const bobRun = run(bob, 'member', 'running', { upstreamArtifactIds: [aliceAnswer.id] });
    interactions.workerReaction(bobRun, 'bob-1', { messageId: aliceAnswer.id, emoji: 'agree', active: true });
    // The person's message is visible to every member too.
    interactions.workerReaction(bobRun, 'bob-2', { messageId: turnMessageId(task.id, 0), emoji: 'watching', active: true });
    const carolRun = run(carol, 'member', 'running');
    expect(() => interactions.workerReaction(carolRun, 'carol-1', { messageId: aliceAnswer.id, emoji: 'agree', active: true })).toThrow('ngoài phạm vi');
    const leadRun = run(lead, 'synthesis', 'running');
    interactions.workerReaction(leadRun, 'lead-1', { messageId: aliceAnswer.id, emoji: 'delighted', active: true });
    expect(store.get<Task>('tasks', task.id).messageReactions).toMatchObject([
      { messageId: aliceAnswer.id, actor: 'worker', workerId: bob.id, emoji: 'agree', runId: bobRun.id, callId: 'bob-1' },
      { messageId: turnMessageId(task.id, 0), actor: 'worker', workerId: bob.id, emoji: 'watching' },
      { messageId: aliceAnswer.id, actor: 'worker', workerId: lead.id, emoji: 'delighted' },
    ]);
    expect(store.all<Run>('runs').filter(item => item.taskId === task.id)).toHaveLength(4);
  });

  it('never lets a worker react to its own answer', () => {
    const { task, alice, aliceAnswer, run } = crew();
    const again = run(alice, 'member', 'running', { upstreamArtifactIds: [aliceAnswer.id] });
    expect(() => new MessageInteractions(store).workerReaction(again, 'alice-1', { messageId: aliceAnswer.id, emoji: 'agree', active: true })).toThrow('chính mình');
    expect(store.get<Task>('tasks', task.id).messageReactions ?? []).toEqual([]);
  });

  it('offers react_to_message to a chat run but not to a scheduled one, and the answer field follows', () => {
    const { task, bob, run } = crew();
    const chatRun = run(bob, undefined, 'running');
    expect(reactionsAllowed(chatRun, task)).toBe(true);
    expect(toolsFor(chatRun, task).map(tool => tool.type === 'function' && tool.function.name)).toContain('react_to_message');
    const scheduled = { ...task, routineId: id() };
    expect(reactionsAllowed(chatRun, scheduled)).toBe(false);
    expect(toolsFor(chatRun, scheduled).map(tool => tool.type === 'function' && tool.function.name)).not.toContain('react_to_message');
    expect(Object.keys(harnessAnswerSchema(chatRun, false, false, false, true).shape)).toContain('reactions');
    expect(Object.keys(harnessAnswerSchema(chatRun, false, false, false, false).shape)).not.toContain('reactions');
    expect(MAX_ANSWER_REACTIONS).toBe(3);
  });
});

describe('the mark on the person\'s bubble', () => {
  it('shows a worker\'s reaction under the user message with the worker\'s name', () => {
    const store = new Store(':memory:');
    try {
      const researcher: Worker = { ...store.all<Worker>('workers')[0], id: id(), name: 'Researcher', provider: 'openai' };
      const skill = store.get<Skill>('skills', researcher.skillId);
      const task: Task = { id: id(), workerId: researcher.id, brief: 'Tôi thích câu trả lời ngắn.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: now() };
      const run: Run = { id: id(), taskId: task.id, status: 'completed', snapshot: { worker: researcher, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } }, startedAt: now(), error: null };
      const report = { format: 'chat' as const, title: 'Answer', summary: 'Ghi nhận.', findings: [], limitations: [] };
      const artifact: Artifact = { id: id(), runId: run.id, report, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now(), replyTo: turnMessageId(task.id, 0) };
      store.put('tasks', { ...task, messageReactions: [{ messageId: turnMessageId(task.id, 0), emoji: 'agree', actor: 'worker', workerId: researcher.id, runId: run.id, callId: 'answer-reaction-1', createdAt: now() }] });
      store.put('runs', run, { column: 'task_id', value: task.id });
      store.put('artifacts', artifact, { column: 'run_id', value: run.id });
      const detail = store.detail(task.id);
      const html = renderToStaticMarkup(createElement(TaskThread, {
        detail, workspace: { workers: [researcher], skills: [skill], tasks: [detail.task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
        proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
        proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
      }));
      // The worker's mark sits on the user bubble itself (COD-219), before the action row and the worker's own answer.
      const bubble = html.indexOf(`id="message-${turnMessageId(task.id, 0)}"`);
      const mark = html.indexOf('class="reaction-badge"');
      const actions = html.indexOf('class="message-actions"');
      const answer = html.indexOf('class="assistant-message"');
      expect(bubble).toBeGreaterThan(-1);
      expect(mark).toBeGreaterThan(bubble);
      expect(actions).toBeGreaterThan(mark);
      expect(answer).toBeGreaterThan(actions);
      const markup = html.slice(mark, html.indexOf('</button>', mark));
      expect(markup).toContain('👍');
      expect(markup).toContain('Researcher');
      expect(markup).not.toContain('Bạn');
      expect(markup).toContain('aria-pressed="false"');
    } finally { store.close(); }
  });
});
