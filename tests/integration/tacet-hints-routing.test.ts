import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { BROWSER_THRESHOLD, FOLDER_THRESHOLD, needsSecondPass, PERMISSION_NEEDS_MAX_LENGTH, permissionNeedsFrom, TOOL_QUESTION, WEB_AND_FOLDER_QUESTIONS, WEB_THRESHOLD } from '../../apps/desktop/src/core/decisions/permission-questions';
import { EVERYONE_OPTION, MAX_ROUTED_GROUP, orgletOption, routableGroup, routedOrglet, ROUTING_MAX_LENGTH, ROUTING_THRESHOLD, routingQuestion } from '../../apps/desktop/src/core/decisions/group-routing';
import { PermissionSuggestions } from '../../apps/desktop/src/core/orchestration/permission-suggestions';
import { TurnRouting } from '../../apps/desktop/src/core/orchestration/turn-routing';
import { chatAllows, missingNeed } from '../../apps/desktop/src/shared/permission-needs';
import { permissionState } from '../../apps/desktop/src/shared/capability-status';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, planReply } from './team-plan';
import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../apps/desktop/src/shared/decisions';

/** A choice answer as the model gives it: the pick and a probability per option. */
function choice(probabilities: Record<string, number>): DecisionResponse['answers'][string] {
  const pick = Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0][0];
  return { type: 'choice', choice: pick, probabilities, confidence: 0.5 };
}
const response = (answers: DecisionResponse['answers']): DecisionResponse => ({ model: 'tacet-sonata', answers, usage: { inputTokens: 40 } });

type Asked = { state: DecisionState; questions: DecisionQuestions; maxLength: number };

/** Dependencies of a Tacet that has a connection; the stubs below answer instead of any provider. */
const connectedDependencies = {
  saved: () => ({ connection: 'openai', model: 'gpt-6-luna' }),
  save: () => {},
  readKey: async () => 'test-key',
  adapter: async () => { throw new Error('Not used by these tests.'); },
};

/** A Tacet that records every question and answers from `answer`; a throw is a provider failing. */
class AnsweringDecisions extends Decisions {
  constructor(private respond: (asked: Asked) => Promise<DecisionResponse> | DecisionResponse, private log: Asked[]) {
    super(connectedDependencies);
  }
  override async decide(state: DecisionState, questions: DecisionQuestions, maxLength = 1536): Promise<DecisionResponse | undefined> {
    const request = { state, questions, maxLength };
    this.log.push(request);
    return this.respond(request);
  }
}
const answering = (answer: (asked: Asked) => Promise<DecisionResponse> | DecisionResponse, asked: Asked[] = []): Decisions => new AnsweringDecisions(answer, asked);
/** A Tacet the person turned off. */
const turnedOff = (): Decisions => new Decisions({ ...connectedDependencies, saved: () => 'off' });

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-tacet-305-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('reading the permissions a message needs (COD-305)', () => {
  const tool = (internet: number, computer: number, website: number) => ({ web: internet, folder: computer, browser: website });

  it('offers the web from the average of both passes, and only at its threshold', () => {
    const second = response({ web: choice({ yes: 0.7, no: 0.3 }), folder: choice({ read: 0.5, edit: 0.3, run: 0.2 }) });
    expect(permissionNeedsFrom(tool(0.4, 0.05, 0.1), second)).toEqual(['web']);
    expect(permissionNeedsFrom(tool(0.3, 0.05, 0.1), second)).toEqual([]);
    expect((0.4 + 0.7) / 2).toBeGreaterThanOrEqual(WEB_THRESHOLD);
  });

  it('names the folder level the second pass picked, in the folder levels the app uses', () => {
    const run = response({ web: choice({ yes: 0.1, no: 0.9 }), folder: choice({ read: 0.1, edit: 0.2, run: 0.7 }) });
    const edit = response({ web: choice({ yes: 0.1, no: 0.9 }), folder: choice({ read: 0.1, edit: 0.7, run: 0.2 }) });
    expect(permissionNeedsFrom(tool(0.05, FOLDER_THRESHOLD, 0.1), run)).toEqual(['execute']);
    expect(permissionNeedsFrom(tool(0.05, 0.5, 0.1), edit)).toEqual(['write']);
    expect(permissionNeedsFrom(tool(0.05, FOLDER_THRESHOLD - 0.01, 0.1), edit)).toEqual([]);
  });

  it('lists every need that cleared its line, the one furthest above it first', () => {
    const second = response({ web: choice({ yes: 0.9, no: 0.1 }), folder: choice({ read: 0.8, edit: 0.1, run: 0.1 }) });
    expect(permissionNeedsFrom(tool(0.6, 0.25, BROWSER_THRESHOLD + 0.3), second)).toEqual(['browser', 'web', 'read']);
    expect(permissionNeedsFrom(tool(0.1, 0.1, BROWSER_THRESHOLD - 0.01), undefined)).toEqual([]);
  });

  it('skips the second pass when it cannot change the answer', () => {
    expect(needsSecondPass(tool(0.05, 0.1, 0.9))).toBe(false);
    expect(needsSecondPass(tool(0.2, 0.1, 0.1))).toBe(true);
    expect(needsSecondPass(tool(0.01, FOLDER_THRESHOLD, 0.1))).toBe(true);
  });

  it('offers the first need the chat lacks, and counts a higher folder level as covering a lower one', () => {
    const nothing = permissionState({ provider: 'openai', capabilities: ['source.read'], grant: null });
    const editing = { ...nothing, workspace: 'write' as const, folder: 'notes' };
    expect(missingNeed(['web', 'read'], { ...nothing, web: true })).toBe('read');
    expect(chatAllows('read', editing)).toBe(true);
    expect(chatAllows('execute', editing)).toBe(false);
    expect(missingNeed(['read', 'write'], editing)).toBeUndefined();
    expect(missingNeed(['execute'], editing)).toBe('execute');
    // Waving a folder hint away hides every folder hint in that chat, and nothing else.
    expect(missingNeed(['execute', 'web'], nothing, new Set(['folder']))).toBe('web');
  });
});

describe('PermissionSuggestions (COD-305)', () => {
  it('says nothing, and asks nothing, while Tacet is off', async () => {
    const suggestions = new PermissionSuggestions(() => turnedOff());
    expect(await suggestions.suggest('What is the weather in Hanoi today?')).toBeNull();
  });

  it('reads a message in two passes with the tuned questions and returns what it needs', async () => {
    const asked: Asked[] = [];
    const decisions = answering(request => request.questions.tool
      ? response({ tool: choice({ none: 0.1, internet: 0.8, computer: 0.05, website: 0.05 }) })
      : response({ web: choice({ yes: 0.9, no: 0.1 }), folder: choice({ read: 0.4, edit: 0.3, run: 0.3 }) }), asked);
    const suggestions = new PermissionSuggestions(() => decisions);
    expect(await suggestions.suggest('What is the weather in Hanoi today?')).toEqual({ needs: ['web'] });
    expect(asked.map(request => request.questions)).toEqual([TOOL_QUESTION, WEB_AND_FOLDER_QUESTIONS]);
    expect(asked[0].state).toEqual({ request: 'What is the weather in Hanoi today?' });
    expect(asked[0].maxLength).toBe(PERMISSION_NEEDS_MAX_LENGTH);
  });

  it('does not read a message too short to say anything', async () => {
    const asked: Asked[] = [];
    const decisions = answering(() => response({}), asked);
    expect(await new PermissionSuggestions(() => decisions).suggest('hi there')).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('answers only the latest of the requests that waited behind a running one', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const asked: Asked[] = [];
    const decisions = answering(async () => {
      await gate;
      return response({ tool: choice({ none: 0.9, internet: 0.05, computer: 0.03, website: 0.02 }) });
    }, asked);
    const suggestions = new PermissionSuggestions(() => decisions);
    const first = suggestions.suggest('Find the latest news about the rates');
    for (let tries = 0; tries < 100 && asked.length === 0; tries++) await new Promise(resolve => setTimeout(resolve, 5));
    const second = suggestions.suggest('Find the latest news about the rate decision');
    const third = suggestions.suggest('Find the latest news about the rate decision today');
    release();
    expect(await Promise.all([first, second, third])).toEqual([{ needs: [] }, null, { needs: [] }]);
    // The superseded request never reached the model.
    expect(asked.map(request => (request.state as { request: string }).request)).toEqual(['Find the latest news about the rates', 'Find the latest news about the rate decision today']);
  });

  it('gives up on an answer slower than its limit', async () => {
    const decisions = answering(() => new Promise(resolve => setTimeout(() => resolve(response({ tool: choice({ none: 0.1, internet: 0.9, computer: 0, website: 0 }) })), 200)));
    const suggestions = new PermissionSuggestions(() => decisions, 20);
    expect(await suggestions.suggest('What is the price of gold today?')).toBeNull();
  });

  it('keeps quiet when the provider fails', async () => {
    const decisions = answering(() => { throw new Error('Nhà cung cấp lỗi.'); });
    expect(await new PermissionSuggestions(() => decisions).suggest('What is the price of gold today?')).toBeNull();
  });
});

describe('the group-chat routing question (COD-305)', () => {
  const orglets = [
    { id: id(), name: 'Scout', description: 'Researcher: finds facts and sources', instructions: 'Research questions on the web.' },
    { id: id(), name: 'Quill', description: '', instructions: 'Write clear prose. '.repeat(40) },
  ];

  it('offers each orglet by name with its description and instructions, and the whole group', () => {
    const question = routingQuestion(orglets).route;
    expect(question.type).toBe('choice');
    expect(Object.keys(question.type === 'choice' ? question.criteria : {})).toEqual(['Scout', 'Quill', EVERYONE_OPTION]);
    expect(orgletOption(orglets[0])).toBe('Researcher: finds facts and sources. Research questions on the web.');
    expect(orgletOption(orglets[1]).length).toBeLessThanOrEqual(300);
  });

  it('routes only groups it can name every orglet in', () => {
    expect(routableGroup(orglets)).toBe(true);
    expect(routableGroup([orglets[0]])).toBe(false);
    expect(routableGroup([orglets[0], { ...orglets[1], name: 'scout' }])).toBe(false);
    expect(routableGroup([orglets[0], { ...orglets[1], name: 'Everyone' }])).toBe(false);
    expect(routableGroup(Array.from({ length: MAX_ROUTED_GROUP + 1 }, (_, index) => ({ ...orglets[0], id: id(), name: `Orglet ${index}` })))).toBe(false);
  });

  it('picks one orglet only with enough confidence, and never when the whole group wins', () => {
    expect(routedOrglet(response({ route: choice({ Scout: ROUTING_THRESHOLD, Quill: 0.2, everyone: 0.15 }) }), orglets)?.orglet.name).toBe('Scout');
    expect(routedOrglet(response({ route: choice({ Scout: ROUTING_THRESHOLD - 0.01, Quill: 0.2, everyone: 0.16 }) }), orglets)).toBeUndefined();
    expect(routedOrglet(response({ route: choice({ Scout: 0.1, Quill: 0.1, everyone: 0.8 }) }), orglets)).toBeUndefined();
    expect(routedOrglet(undefined, orglets)).toBeUndefined();
  });
});

describe('a group-chat message that tags nobody (COD-305)', () => {
  let store: Store;
  let core: CoreService;
  let replies: ModelReply[];
  let asked: Asked[];
  let routeAnswer: Record<string, number>;
  let workers: Worker[];
  const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
  const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 200, output: 50 } });
  const until = async (check: () => boolean) => { for (let tries = 0; tries < 300 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
  const answeredBy = (taskId: string, revision: number) => store.detail(taskId).runs.filter(run => run.stage === 'group' && (run.snapshot.inputRevision ?? 0) === revision).map(run => run.snapshot.worker.name);
  const settled = (taskId: string) => !['queued', 'running', 'pausing'].includes(store.get<Task>('tasks', taskId).status);

  beforeEach(async () => {
    store = new Store(join(directory, 'state.sqlite'));
    replies = [];
    asked = [];
    routeAnswer = { Researcher: 0.1, Accountant: 0.8, everyone: 0.1 };
    core = new CoreService(store, () => {}, async () => ({ async request() {
      const reply = replies.shift();
      if (!reply) throw new Error('Fixture exhausted');
      return reply;
    } }));
    const first = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...first, provider: 'openai', description: 'Research and web facts' });
    const accountant = await core.command('saveWorker', { name: 'Accountant', description: 'Books, taxes and invoices', instructions: 'Help with accounting.', provider: 'openai', skillId: first.skillId, taskBudgetMicros: 100_000 }) as Worker;
    workers = [store.get<Worker>('workers', first.id), accountant];
    core.decisions = answering(() => response({ route: choice(routeAnswer) }), asked);
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); });

  async function groupChat(brief: string): Promise<string> {
    const taskId = await core.command('createTask', { workerId: workers[0].id, assignees: workers.map(worker => worker.id), brief, ...scope }) as string;
    await until(() => settled(taskId));
    return taskId;
  }

  it('lets the orglet Tacet picks answer alone, and keeps the pick on the chat', async () => {
    replies.push(answer('VAT is 10%.'));
    const taskId = await groupChat('How much VAT do we owe this month?');
    expect(answeredBy(taskId, 0)).toEqual(['Accountant']);
    expect(asked).toHaveLength(1);
    expect(asked[0].state).toBe('How much VAT do we owe this month?');
    expect(asked[0].questions).toEqual(routingQuestion(workers));
    expect(asked[0].maxLength).toBe(ROUTING_MAX_LENGTH);
    expect(store.get<Task>('tasks', taskId).routedTurns).toEqual([expect.objectContaining({ inputRevision: 0, workerIds: [workers[1].id], probability: 0.8 })]);
    // The pick travels with a backup.
    expect(() => core.backups.preview(core.backups.export())).not.toThrow();
  });

  it('keeps everyone when Tacet is unsure', async () => {
    routeAnswer = { Researcher: 0.45, Accountant: 0.35, everyone: 0.2 };
    replies.push(answer('Researcher here.'), answer('Accountant here.'));
    const taskId = await groupChat('What do you both think of the plan?');
    expect(answeredBy(taskId, 0)).toEqual(['Researcher', 'Accountant']);
    expect(store.get<Task>('tasks', taskId).routedTurns).toBeUndefined();
  });

  it('never asks about a message that tags someone or replies to an answer', async () => {
    replies.push(answer('Researcher here.'), answer('Accountant here.'));
    const taskId = await groupChat('@all roll call');
    expect(answeredBy(taskId, 0)).toEqual(['Researcher', 'Accountant']);
    replies.push(answer('Researcher again.'));
    await core.command('reviseTask', { taskId, brief: '@Researcher what about you?', ...scope });
    await until(() => settled(taskId) && answeredBy(taskId, 1).length === 1);
    expect(answeredBy(taskId, 1)).toEqual(['Researcher']);
    const accountantAnswer = store.detail(taskId).artifacts.find(artifact => artifact.report.summary === 'Accountant here.')!;
    replies.push(answer('Accountant explains.'));
    await core.command('reviseTask', { taskId, brief: 'Can you say more?', replyTo: accountantAnswer.id, ...scope });
    await until(() => settled(taskId) && answeredBy(taskId, 2).length === 1);
    expect(asked).toHaveLength(0);
  });

  it('keeps today\'s behaviour when Tacet is off or fails', async () => {
    core.decisions = turnedOff();
    replies.push(answer('1'), answer('2'));
    const absent = await groupChat('How much VAT do we owe?');
    expect(answeredBy(absent, 0)).toEqual(['Researcher', 'Accountant']);
    core.decisions = answering(() => { throw new Error('Nhà cung cấp lỗi.'); });
    replies.push(answer('3'), answer('4'));
    const failing = await groupChat('How much VAT do we owe now?');
    expect(answeredBy(failing, 0)).toEqual(['Researcher', 'Accountant']);
  });

  it('keeps the pick on a retry instead of asking again', async () => {
    // No reply queued: the picked orglet's run fails, so the turn can be retried.
    const taskId = await groupChat('Reconcile the August invoices.');
    expect(asked).toHaveLength(1);
    expect(store.get<Task>('tasks', taskId).status).not.toBe('completed');
    replies.push(answer('Reconciled.'));
    await core.command('retry', { id: taskId });
    await until(() => settled(taskId));
    expect(asked).toHaveLength(1);
    expect(new Set(answeredBy(taskId, 0))).toEqual(new Set(['Accountant']));
  });

  it('answers the composer through the core command', async () => {
    core.decisions = answering(request => request.questions.tool
      ? response({ tool: choice({ none: 0.1, internet: 0.05, computer: 0.05, website: 0.8 }) })
      : response({ web: choice({ yes: 0.1, no: 0.9 }), folder: choice({ read: 0.4, edit: 0.3, run: 0.3 }) }));
    expect(await core.command('suggestPermissions', { text: 'Log in to my store and check the new orders' })).toEqual({ needs: ['browser'] });
    expect(await core.command('suggestPermissions', { text: 'ok' })).toBeNull();
  });

  it('gives up on a slow answer and starts the turn with everyone', async () => {
    const slow = answering(() => new Promise(resolve => setTimeout(() => resolve(response({ route: choice(routeAnswer) })), 200)));
    const routing = new TurnRouting(store, () => slow, () => new Date(), 20);
    const task = { id: id(), brief: 'How much VAT?', currentInput: { brief: 'How much VAT?', sourceIds: [] } } as unknown as Task;
    const router = routing.router(task, workers);
    expect(router).toBeDefined();
    expect((await router!()).map(worker => worker.name)).toEqual(['Researcher', 'Accountant']);
  });
});

describe('a crew message that tags nobody (COD-305)', () => {
  it('is planned by the crew\'s lead, never routed by Tacet', async () => {
    const store = new Store(join(directory, 'crew.sqlite'));
    const core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
      if (isPlanRequest(tools)) return planReply(messages);
      return { calls: [{ id: id(), name: 'submit_report', arguments: JSON.stringify({ title: 'Fixture report', summary: 'No source evidence provided.', findings: [], limitations: ['No files were supplied.'] }) }], usage: { input: 500, output: 100 } };
    } }));
    const asked: Asked[] = [];
    core.decisions = answering(() => response({ route: choice({ everyone: 1 }) }), asked);
    try {
      const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
      const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Review only supplied evidence', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
      for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || store.get<Task>('tasks', taskId).status === 'queued'); tries++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(store.detail(taskId).runs.some(run => run.stage === 'plan')).toBe(true);
      expect(asked).toHaveLength(0);
      expect(store.get<Task>('tasks', taskId).routedTurns).toBeUndefined();
    } finally {
      await core.runner.shutdown();
      store.close();
    }
  });
});
