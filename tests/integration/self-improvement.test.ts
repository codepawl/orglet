import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { detectImprovementSignals, type ImprovementRows } from '../../apps/desktop/src/core/orchestration/self-improvement';
import { harnessAnswerSchema, toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { AppProposalCards, type ProposalActions } from '../../apps/desktop/src/renderer/components/AppProposals';
import { DECLINED_IMPROVEMENTS_SETTING, ProposeSelfImprovement } from '../../apps/desktop/src/shared/self-improvement';
import type { AppProposal } from '../../apps/desktop/src/shared/app-proposals';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import type { HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const toolNames = (run: Run, task: Task) => toolsFor(run, task).map(tool => tool.type === 'function' ? tool.function.name : '');

/** Rows the detector reads, built by hand: one worker, chats with answers, and whatever feedback the test attaches. */
describe('detecting repeated feedback', () => {
  const worker: Worker = { id: id(), revision: 1, name: 'Researcher', provider: 'openai', skillId: id(), instructions: 'Work with the user. Keep replies short.' };
  const other: Worker = { id: id(), revision: 1, name: 'Writer', provider: 'openai', skillId: worker.skillId, instructions: 'Write.' };
  const skill: Skill = { id: worker.skillId, name: 'General help', revision: 1, content: 'Help.' };
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 23, 9, minute)).toISOString();
  const chat = (brief: string, extra: Partial<Task> = {}): Task => ({ id: id(), workerId: worker.id, brief, sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: at(0), ...extra });
  const runOf = (task: Task, minute: number, overrides: Partial<Run> & { input?: Run['snapshot']['input']; by?: Worker } = {}): Run => {
    const { input, by, ...rest } = overrides;
    return { id: id(), taskId: task.id, status: 'completed', snapshot: { worker: by ?? worker, skill, inputRevision: 0, input: input ?? { brief: task.brief, sourceIds: [] } }, startedAt: at(minute), error: null, ...rest };
  };
  const answerOf = (run: Run, summary = 'An answer.'): Artifact => ({ id: id(), runId: run.id, report: { format: 'chat', title: 'Answer', summary, findings: [], limitations: [] }, hash: 'a'.repeat(64), createdAt: run.startedAt });
  const thumbsDown = (artifact: Artifact) => ({ messageId: artifact.id, emoji: 'against' as const, actor: 'user' as const, createdAt: at(30) });
  const rows = (overrides: Partial<ImprovementRows>): ImprovementRows => ({ workerId: worker.id, runs: [], tasks: [], artifacts: [], titles: {}, earlier: [], declined: [], ...overrides });

  it('needs the same kind of signal twice, and names the chats it came from', () => {
    const first = chat('Summarise the Q3 report');
    const second = chat('Plan the launch');
    const firstRun = runOf(first, 1);
    const secondRun = runOf(second, 2);
    const firstAnswer = answerOf(firstRun, 'Here is a long summary of everything.');
    const secondAnswer = answerOf(secondRun);
    const one = rows({ runs: [firstRun, secondRun], tasks: [{ ...first, messageReactions: [thumbsDown(firstAnswer)] }, second], artifacts: [firstAnswer, secondAnswer], titles: { [first.id]: 'Q3 summary' } });
    expect(detectImprovementSignals(one)).toEqual([]);
    const two = rows({ ...one, tasks: [{ ...first, messageReactions: [thumbsDown(firstAnswer)] }, { ...second, messageReactions: [thumbsDown(secondAnswer)] }] });
    expect(detectImprovementSignals(two)).toEqual([{
      kind: 'thumbs_down', count: 2,
      because: [{ taskId: first.id, title: 'Q3 summary', count: 1 }, { taskId: second.id, title: 'Plan the launch', count: 1 }],
      examples: [{ taskId: first.id, note: 'Thumbs-down on: "Here is a long summary of everything."' }, { taskId: second.id, note: 'Thumbs-down on: "An answer."' }],
    }]);
  });

  it('counts a reply to this worker’s answer as a revision asked for, not a reply to another worker’s', () => {
    const task = chat('Draft the memo');
    const firstRun = runOf(task, 1);
    const firstAnswer = answerOf(firstRun);
    const secondRun = runOf(task, 2, { input: { brief: 'Shorter, and drop the intro.', sourceIds: [], replyTo: firstAnswer.id } });
    const secondAnswer = answerOf(secondRun);
    const thirdRun = runOf(task, 3, { input: { brief: 'Still too long.', sourceIds: [], replyTo: secondAnswer.id } });
    const signals = detectImprovementSignals(rows({ runs: [firstRun, secondRun, thirdRun], tasks: [task], artifacts: [firstAnswer, secondAnswer] }));
    expect(signals).toEqual([expect.objectContaining({ kind: 'revision', count: 2, because: [{ taskId: task.id, title: 'Draft the memo', count: 2 }] })]);
    // Newest first, so the worker reads the latest complaint before the older one.
    expect(signals[0].examples.map(example => example.note)).toEqual(['Asked again: "Still too long."', 'Asked again: "Shorter, and drop the intro."']);
    // The same replies aimed at another worker's answers are that worker's feedback, not this one's.
    const otherRun = runOf(task, 1, { by: other });
    const otherAnswer = answerOf(otherRun);
    const replies = [runOf(task, 2, { input: { brief: 'Again', sourceIds: [], replyTo: otherAnswer.id } }), runOf(task, 3, { input: { brief: 'Again', sourceIds: [], replyTo: otherAnswer.id } })];
    expect(detectImprovementSignals(rows({ runs: [otherRun, ...replies], tasks: [task], artifacts: [otherAnswer] }))).toEqual([]);
  });

  it('counts refused reports, and the same failure twice, but not what the worker cannot change', () => {
    const task = chat('Review the dataset');
    const refused = (minute: number) => runOf(task, minute, { status: 'failed', errorCode: 'report_rejected', error: 'Finding chưa có nguồn đã đọc để đối chiếu.' });
    expect(detectImprovementSignals(rows({ runs: [refused(1), refused(2)], tasks: [task] }))).toEqual([expect.objectContaining({ kind: 'report_rejected', count: 2 })]);
    const failed = (minute: number, error: string, errorCode?: Run['errorCode']) => runOf(task, minute, { status: 'failed', error, errorCode });
    expect(detectImprovementSignals(rows({ runs: [failed(1, 'Đã chạm giới hạn 6 bước mà chưa có báo cáo hợp lệ.'), failed(2, 'Đã chạm giới hạn 6 bước mà chưa có báo cáo hợp lệ.')], tasks: [task] })))
      .toEqual([expect.objectContaining({ kind: 'run_failed', count: 2, examples: [expect.objectContaining({ note: 'Failed: Đã chạm giới hạn 6 bước mà chưa có báo cáo hợp lệ.' }), expect.anything()] })]);
    // Two different failures are not one class; a usage limit and an unresolved attempt are not the worker's doing.
    expect(detectImprovementSignals(rows({ runs: [failed(1, 'One thing'), failed(2, 'Another thing')], tasks: [task] }))).toEqual([]);
    expect(detectImprovementSignals(rows({ runs: [failed(1, 'You have hit your usage limit. Try again later.'), failed(2, 'You have hit your usage limit. Try again later.')], tasks: [task] }))).toEqual([]);
    expect(detectImprovementSignals(rows({ runs: [failed(1, 'x', 'unresolved_attempt'), failed(2, 'x', 'unresolved_attempt')], tasks: [task] }))).toEqual([]);
  });

  it('looks only at the latest runs, in chats that still exist, and only after the last proposal of that kind', () => {
    const task = chat('Check the numbers');
    const gone = chat('Old chat', { deletedAt: at(50) });
    const refused = (target: Task, minute: number) => runOf(target, minute, { status: 'failed', errorCode: 'report_rejected', error: 'Refused.' });
    const old = [refused(task, 1), refused(task, 2)];
    const recent = [runOf(task, 3), runOf(task, 4), runOf(task, 5)];
    expect(detectImprovementSignals(rows({ runs: [...old, ...recent], tasks: [task], windowRuns: 3 }))).toEqual([]);
    expect(detectImprovementSignals(rows({ runs: [...old, ...recent], tasks: [task], windowRuns: 5 }))).toEqual([expect.objectContaining({ kind: 'report_rejected', count: 2 })]);
    expect(detectImprovementSignals(rows({ runs: [refused(gone, 1), refused(gone, 2), refused(task, 3)], tasks: [task, gone] }))).toEqual([]);
    const earlier = (status: AppProposal['status'], createdAt: string): AppProposal => ({ id: id(), taskId: task.id, runId: id(), inputRevision: 0, sequence: 1, createdAt, kind: 'orglet', action: 'edit', title: worker.name, changes: [], payload: { targetId: worker.id }, hold: 'self', status, improvement: { signal: 'report_rejected', because: [] } });
    // A proposal already made for this kind starts the count over from its own time.
    expect(detectImprovementSignals(rows({ runs: [refused(task, 1), refused(task, 2), refused(task, 6)], tasks: [task], earlier: [earlier('applied', at(4))] }))).toEqual([]);
    expect(detectImprovementSignals(rows({ runs: [refused(task, 1), refused(task, 5), refused(task, 6)], tasks: [task], earlier: [earlier('applied', at(4))] }))).toEqual([expect.objectContaining({ kind: 'report_rejected', count: 2 })]);
    // Nothing while one is still waiting for a click, and never again for a kind the person declined.
    expect(detectImprovementSignals(rows({ runs: [refused(task, 5), refused(task, 6)], tasks: [task], earlier: [earlier('pending', at(4))] }))).toEqual([]);
    expect(detectImprovementSignals(rows({ runs: [refused(task, 5), refused(task, 6)], tasks: [task], declined: ['report_rejected'] }))).toEqual([]);
  });
});

/** The whole path through a chat: the signals reach the next run, the worker proposes one sentence, the person decides. */
describe('a worker proposing a change to its own instructions', () => {
  let store: Store; let core: CoreService;
  let replies: ModelReply[]; let sent: { messages: { role: string; content?: unknown }[]; tools: string[] }[];
  beforeEach(() => {
    store = new Store(':memory:'); replies = []; sent = [];
    core = new CoreService(store, () => {}, async () => ({
      async request(messages, tools) {
        sent.push({ messages: structuredClone(messages) as { role: string; content?: unknown }[], tools: tools.map(tool => tool.type === 'function' ? tool.function.name : '') });
        const reply = replies.shift();
        if (!reply) throw new Error('Fixture exhausted');
        return reply;
      },
    }));
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); });

  const call = (name: string, argumentsValue: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 100, output: 20 } });
  const answer = (message = 'Done.'): ModelReply => call('reply', { message, title: null, knowledgeProposals: [] });
  const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 1_000_000 };
  const settled = (taskId: string) => ['completed', 'failed', 'partial'].includes(store.detail(taskId).task.status) && !core.runner.isActive(taskId);
  const until = async (check: () => boolean) => { for (let tries = 0; tries < 300 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
  const proposalsOf = (taskId: string) => store.detail(taskId).appProposals;
  const briefMessage = (request: { messages: { role: string; content?: unknown }[] }) => JSON.parse(String(request.messages.map(message => String(message.content ?? '')).find(content => content.includes('"brief"'))!));
  const toolResults = () => (sent.at(-1)?.messages ?? []).filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)) as Record<string, unknown>);

  async function chatWorker(overrides: Partial<Worker> = {}) {
    const worker = store.all<Worker>('workers')[0];
    return core.command('saveWorker', { ...worker, provider: 'openai', taskBudgetMicros: 400_000, ...overrides }) as Promise<Worker>;
  }
  async function chat(workerId: string, brief: string) {
    const taskId = await core.command('createTask', { workerId, brief, ...scope }) as string;
    await until(() => settled(taskId));
    return taskId;
  }
  /** Two chats whose answers the person marked with a thumbs-down: enough repeated feedback of one kind. */
  async function twoThumbsDown(workerId: string) {
    const taskIds: string[] = [];
    for (const brief of ['Summarise the Q3 report', 'Plan the launch']) {
      replies.push(answer('Here is everything I found, at length.'));
      const taskId = await chat(workerId, brief);
      await core.command('setMessageReaction', { taskId, messageId: store.detail(taskId).artifacts[0].id, emoji: 'against', active: true });
      taskIds.push(taskId);
    }
    return taskIds;
  }
  const proposalCall = (sentence: string, replaces: string | null = null, signal = 'thumbs_down') => call('propose_self_improvement', { signal, replaces, sentence });

  it('offers the tool and the evidence only once the same feedback repeats, and the proposal waits for a click even with auto-apply on', async () => {
    const worker = await chatWorker({ autoApplyProposals: true });
    const [first, second] = await twoThumbsDown(worker.id);
    // The first chats had no feedback yet: no tool, no evidence in the prompt.
    expect(sent[0].tools).not.toContain('propose_self_improvement');
    expect(briefMessage(sent[0])).not.toHaveProperty('selfImprovement');
    expect(store.detail(first).runs[0].snapshot.improvement).toEqual([]);

    replies.push(proposalCall('Lead with the answer in three sentences, then offer detail.'), answer('Noted, I will keep it short.'));
    const taskId = await chat(worker.id, 'What changed since last week?');
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(sent[2].tools).toContain('propose_self_improvement');
    const evidence = briefMessage(sent[2]).selfImprovement;
    expect(evidence.signals).toEqual([{ kind: 'thumbs_down', count: 2, because: [{ taskId: first, title: 'Summarise the Q3 report', count: 1 }, { taskId: second, title: 'Plan the launch', count: 1 }], examples: [{ taskId: first, note: 'Thumbs-down on: "Here is everything I found, at length."' }, { taskId: second, note: 'Thumbs-down on: "Here is everything I found, at length."' }] }]);
    expect(evidence.instruction).toContain('propose_self_improvement');
    expect(store.detail(taskId).runs[0].snapshot.improvement).toEqual(evidence.signals);
    expect(toolResults()[0]).toMatchObject({ status: 'pending' });

    const [proposal] = proposalsOf(taskId);
    expect(proposal).toMatchObject({ kind: 'orglet', action: 'edit', title: worker.name, status: 'pending', hold: 'self', heldReason: 'self', improvement: { signal: 'thumbs_down', because: [{ taskId: first, count: 1 }, { taskId: second, count: 1 }] } });
    expect(proposal.automatic).toBeUndefined();
    expect(proposal.changes).toEqual([{ field: 'instructions', before: null, after: 'Lead with the answer in three sentences, then offer detail.' }]);
    expect(proposal.payload).toMatchObject({ targetId: worker.id, fields: { instructions: `${worker.instructions}\nLead with the answer in three sentences, then offer detail.` } });
    // Auto-apply is on, and still nothing changed: the worker keeps its instructions until the click.
    expect(store.get<Worker>('workers', worker.id)).toMatchObject({ revision: worker.revision, instructions: worker.instructions });
    expect(store.detail(taskId).events.some(event => event.message.includes('đang chờ bạn áp dụng'))).toBe(true);

    // Apply is a worker revision; Undo puts the previous instructions back as another revision.
    const applied = await core.command('applyAppProposal', { id: proposal.id }) as AppProposal;
    expect(applied).toMatchObject({ status: 'applied', automatic: false, target: { kind: 'worker', id: worker.id }, undo: { kind: 'restore', entity: 'worker' } });
    expect(store.get<Worker>('workers', worker.id)).toMatchObject({ revision: worker.revision + 1, instructions: `${worker.instructions}\nLead with the answer in three sentences, then offer detail.` });
    const undone = await core.command('undoAppProposal', { id: proposal.id }) as AppProposal;
    expect(undone.undoneAt).toBeDefined();
    expect(store.get<Worker>('workers', worker.id)).toMatchObject({ revision: worker.revision + 2, instructions: worker.instructions });
  });

  it('replaces one quoted sentence exactly, and sends a wrong quote or an unknown signal back as the tool answer', async () => {
    const worker = await chatWorker();
    await twoThumbsDown(worker.id);
    replies.push(
      proposalCall('Answer in three sentences.', 'Keep replies clear and to the point.'),
      proposalCall('Whatever.', 'A sentence that is not there.'),
      proposalCall('Whatever.', null, 'revision'),
      answer(),
    );
    const taskId = await chat(worker.id, 'Anything new?');
    expect(store.detail(taskId).task.status).toBe('completed');
    const results = toolResults();
    expect(results[0]).toMatchObject({ status: 'pending' });
    expect(results[1]).toEqual({ error: 'Câu cần thay không có trong hướng dẫn hiện tại; trích đúng nguyên văn.' });
    expect(results[2]).toEqual({ error: 'Tín hiệu này không có trong phản hồi lặp lại của lượt chạy.' });
    const proposals = proposalsOf(taskId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].changes).toEqual([{ field: 'instructions', before: 'Keep replies clear and to the point.', after: 'Answer in three sentences.' }]);
    await core.command('applyAppProposal', { id: proposals[0].id });
    expect(store.get<Worker>('workers', worker.id).instructions).toBe(worker.instructions.replace('Keep replies clear and to the point.', 'Answer in three sentences.'));
  });

  it('cannot reach another worker or any field but the instructions', async () => {
    const valid = { signal: 'thumbs_down', replaces: null, sentence: 'Be brief.' };
    for (const forbidden of ['targetId', 'name', 'instructions', 'provider', 'modelId', 'skillId', 'skillRef', 'taskBudgetMicros', 'autoApplyProposals', 'toolCapabilities']) {
      expect(ProposeSelfImprovement.safeParse({ ...valid, [forbidden]: 'x' }).success).toBe(false);
    }
    const worker = await chatWorker();
    const bystander = await core.command('saveWorker', { name: 'Writer', instructions: 'Write.', provider: 'openai', skillId: worker.skillId }) as Worker;
    await twoThumbsDown(worker.id);
    // A call that names a target is off the schema: the run fails and nothing is stored or changed.
    replies.push(call('propose_self_improvement', { ...valid, targetId: bystander.id }));
    const taskId = await chat(worker.id, 'Anything new?');
    expect(store.detail(taskId).task.status).toBe('failed');
    expect(proposalsOf(taskId)).toEqual([]);
    expect(store.get<Worker>('workers', bystander.id)).toMatchObject({ revision: 1, instructions: 'Write.' });
    expect(store.get<Worker>('workers', worker.id)).toMatchObject({ revision: worker.revision, instructions: worker.instructions });
  });

  it('never asks again for a kind the person dismissed, and offers nothing to a scheduled run or a team job', async () => {
    const worker = await chatWorker();
    await twoThumbsDown(worker.id);
    replies.push(proposalCall('Be brief.'), answer());
    const taskId = await chat(worker.id, 'Anything new?');
    const [proposal] = proposalsOf(taskId);
    await core.command('dismissAppProposal', { id: proposal.id });
    expect(proposalsOf(taskId)[0].status).toBe('dismissed');
    expect(store.setting(DECLINED_IMPROVEMENTS_SETTING, {})).toEqual({ [worker.id]: ['thumbs_down'] });
    // More of the same feedback changes nothing: the next chat gets neither the tool nor the evidence.
    await twoThumbsDown(worker.id);
    replies.push(answer());
    const later = await chat(worker.id, 'And now?');
    expect(sent.at(-1)!.tools).not.toContain('propose_self_improvement');
    expect(briefMessage(sent.at(-1)!)).not.toHaveProperty('selfImprovement');
    expect(store.detail(later).runs[0].snapshot.improvement).toEqual([]);

    // The tool follows the frozen signals, and only into a chat run: a schedule or a team stage never gets it.
    const run = store.detail(taskId).runs[0];
    const task = store.detail(taskId).task;
    expect(run.snapshot.improvement).toHaveLength(1);
    expect(toolNames(run, task)).toContain('propose_self_improvement');
    expect(toolNames(run, { ...task, routineId: id() })).not.toContain('propose_self_improvement');
    expect(toolNames({ ...run, stage: 'member' }, task)).not.toContain('propose_self_improvement');
    expect(toolNames({ ...run, stage: 'synthesis' }, task)).not.toContain('propose_self_improvement');
    expect(toolNames({ ...run, snapshot: { ...run.snapshot, improvement: [] } }, task)).not.toContain('propose_self_improvement');
    expect(toolNames({ ...run, stage: 'group' }, task)).toContain('propose_self_improvement');
  });
});

/** A Claude Code chat with no working folder is one CLI call, so the proposal travels as a `selfImprovement` field. */
describe('a one-shot harness answer', () => {
  let store: Store; let core: CoreService; let requests: HarnessRequest[]; let answers: Record<string, unknown>[];
  beforeEach(() => {
    store = new Store(':memory:'); requests = []; answers = [];
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'fixture.exe', version: 'fixture', auth: 'logged_in', status: 'signed_in' }],
      execute: async request => {
        requests.push(request);
        const answer = answers.shift();
        if (!answer) throw new Error('Fixture exhausted');
        return { output: answer, costUsd: null };
      },
    });
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); });

  async function chat(workerId: string, brief: string) {
    const taskId = await core.command('createTask', { workerId, brief, sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 1_000_000 }) as string;
    const settled = () => ['completed', 'failed', 'partial'].includes(store.detail(taskId).task.status) && !core.runner.isActive(taskId);
    for (let tries = 0; tries < 300 && !settled(); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(settled()).toBe(true);
    return taskId;
  }

  it('asks for the field only when feedback repeats, stores the one item, and turns a bad one into a limitation', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'claude-code' }) as Worker;
    const seeded: string[] = [];
    for (const brief of ['Summarise the Q3 report', 'Plan the launch']) {
      // An item sent before any feedback repeats is ignored and named as a limitation: the run may not propose one yet.
      answers.push({ message: 'Everything, at length.', title: null, report: null, selfImprovement: { signal: 'thumbs_down', replaces: null, sentence: 'Too early.' } });
      const taskId = await chat(worker.id, brief);
      await core.command('setMessageReaction', { taskId, messageId: store.detail(taskId).artifacts[0].id, emoji: 'against', active: true });
      seeded.push(taskId);
    }
    const quiet = requests[0].schema as { properties: Record<string, unknown> };
    expect(quiet.properties).not.toHaveProperty('selfImprovement');
    expect(requests[0].prompt).not.toContain('selfImprovement');
    expect(store.detail(seeded[0]).appProposals).toEqual([]);
    expect(store.detail(seeded[0]).artifacts[0].report.limitations).toEqual(['Câu trả lời kèm một đề xuất sửa hướng dẫn của Tí nhưng lượt chạy này không được phép đề xuất; đã bỏ qua.']);

    // A malformed item is a limitation of the answer, not a failed run, and nothing is stored.
    answers.push({ message: 'Again.', title: null, report: null, selfImprovement: { signal: 'thumbs_down', sentence: 'y' } });
    const malformed = await chat(worker.id, 'And now?');
    expect(store.detail(malformed).task.status).toBe('completed');
    expect(store.detail(malformed).appProposals).toEqual([]);
    expect(store.detail(malformed).artifacts[0].report.limitations).toEqual(['Đề xuất sửa hướng dẫn của Tí bị từ chối: Arguments do not match the tool schema.']);

    answers.push({ message: 'Noted.', title: null, report: null, selfImprovement: { signal: 'thumbs_down', replaces: null, sentence: 'Lead with the answer.' } });
    const taskId = await chat(worker.id, 'What changed?');
    expect(store.detail(taskId).task.status).toBe('completed');
    const schema = requests[3].schema as { properties: Record<string, { properties?: Record<string, unknown> }>; required: string[] };
    expect(Object.keys(schema.properties.selfImprovement.properties ?? {})).toEqual(['signal', 'replaces', 'sentence']);
    expect(schema.required).not.toContain('selfImprovement');
    expect(requests[3].prompt).toContain('put that one call in selfImprovement');
    expect(requests[3].prompt).toContain('"selfImprovement"');
    const [proposal] = store.detail(taskId).appProposals;
    expect(proposal).toMatchObject({ kind: 'orglet', action: 'edit', status: 'pending', hold: 'self', heldReason: 'self', improvement: { signal: 'thumbs_down' } });
    expect(proposal.changes).toEqual([{ field: 'instructions', before: null, after: 'Lead with the answer.' }]);
    expect(store.detail(taskId).artifacts[0].report.limitations).toEqual([]);
    expect(store.get<Worker>('workers', worker.id).instructions).toBe(worker.instructions);
    expect(harnessAnswerSchema(store.detail(taskId).runs[0], true, true, true).safeParse({ message: 'x', title: null, report: null, selfImprovement: { signal: 'thumbs_down', replaces: null, sentence: 'y', targetId: 'z' } }).success).toBe(false);

    // While that card waits for a click, the next chat is not asked again.
    answers.push({ message: 'Quiet.', title: null, report: null });
    const next = await chat(worker.id, 'Anything else?');
    expect((requests[4].schema as { properties: Record<string, unknown> }).properties).not.toHaveProperty('selfImprovement');
    expect(store.detail(next).runs[0].snapshot.improvement).toEqual([]);
  });
});

it('draws the card with the hold line, the sentence before → after, and the chats it came from', () => {
  const noop = () => {};
  const opened: string[] = [];
  const actions: ProposalActions = { busy: false, onApply: noop, onApplyAll: noop, onDismiss: noop, onDismissAll: noop, onUndo: noop, onOpen: noop, onOpenChat: taskId => opened.push(taskId) };
  const workerId = '44444444-4444-4444-8444-444444444441';
  const chatId = '11111111-1111-4111-8111-111111111111';
  const goneId = '11111111-1111-4111-8111-111111111112';
  const proposal: AppProposal = {
    id: '33333333-3333-4333-8333-333333333331', taskId: chatId, runId: '22222222-2222-4222-8222-222222222222', inputRevision: 0, sequence: 1, createdAt: '2026-09-23T09:00:00.000Z',
    kind: 'orglet', action: 'edit', title: 'Researcher', status: 'pending', hold: 'self', heldReason: 'self', payload: { targetId: workerId, fields: {} },
    changes: [{ field: 'instructions', before: 'Keep replies clear and to the point.', after: 'Answer in three sentences, then offer detail.' }],
    improvement: { signal: 'thumbs_down', because: [{ taskId: chatId, title: 'Q3 summary', count: 2 }, { taskId: goneId, title: 'Old chat', count: 1 }] },
  };
  const workers: Worker[] = [{ id: workerId, revision: 1, name: 'Researcher', instructions: 'Work.', provider: 'anthropic', skillId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
  const tasks = [{ id: chatId, title: 'Q3 summary (renamed)' }];
  const html = renderToStaticMarkup(createElement(AppProposalCards, { proposals: [proposal], workers, skills: [], tasks, actions }));
  expect(html).toContain('Learning from feedback · Researcher');
  expect(html).toContain('Waiting for you: this changes how this orglet works.');
  expect(html).toMatch(/app-proposal-before[^>]*>Keep replies clear and to the point\.</);
  expect(html).toContain('Answer in three sentences, then offer detail.');
  expect(html).toContain('Thumbs-down ×3');
  expect(html).toContain('because of');
  // A chat that still exists is a link under its current name; a deleted one is plain text under the name it had.
  expect(html).toMatch(/<button[^>]*class="app-proposal-chat"[^>]*>Q3 summary \(renamed\) ×2<\/button>/);
  expect(html).toContain('Old chat ×1');
  expect(html).not.toMatch(/<button[^>]*>Old chat ×1/);
  expect(html).toContain('>Apply<');
  expect(html).toContain('>Dismiss<');
  expect(html).not.toContain('Applied automatically');
});
