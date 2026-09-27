import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { compileContext, frozenTacetFits, KNOWLEDGE_ITEM_LIMIT } from '../../apps/desktop/src/core/context/compiler';
import { Decisions, type DecisionRuntime } from '../../apps/desktop/src/core/decisions/service';
import { TACET_FILES } from '../../apps/desktop/src/core/decisions/manifest';
import type { Decider } from '../../apps/desktop/src/core/decisions/budget';
import { askKnowledgeFit, fitThreshold, KNOWLEDGE_FIT_LIFT, noteRouting, type NoteCandidate } from '../../apps/desktop/src/core/decisions/knowledge-fit';
import { ACTION_RISK_QUESTIONS, ACTION_RISK_THRESHOLD, actionFields, askActionRisk, riskShare, type ActionToJudge } from '../../apps/desktop/src/core/decisions/action-risk';
import { TacetEngine } from '../../apps/desktop/src/core/decisions/engine';
import type { ChoiceAnswer, DecisionQuestions, DecisionResponse, DecisionState } from '../../apps/desktop/src/shared/decisions';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/**
 * Tacet's two COD-306 uses with a fake decision runtime: notes the keywords missed, and a second opinion on browser and
 * desktop steps (the steps themselves are in `browser-act-loop.test.ts` and `desktop-apps.test.ts`). The last block
 * runs the real model and skips when it is not on this computer.
 */

const noteId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

type Asked = { state: DecisionState; questions: DecisionQuestions; maxLength?: number };

/** A decider that records what it was asked and answers with `answer`, or never answers when `answer` is 'late'. */
function fakeDecider(answer: ((asked: Asked) => DecisionResponse) | 'late' | 'fails', installed = true) {
  const asked: Asked[] = [];
  const decider: Decider = {
    isInstalled: () => installed,
    decide: async (state, questions, maxLength) => {
      asked.push({ state, questions, maxLength });
      if (answer === 'late') return new Promise<DecisionResponse>(() => {});
      if (answer === 'fails') throw new Error('Tacet gặp lỗi.');
      return answer({ state, questions, maxLength });
    },
  };
  return { decider, asked };
}

function choice(probabilities: Record<string, number>): ChoiceAnswer {
  const [best] = Object.entries(probabilities).sort((left, right) => right[1] - left[1]);
  return { type: 'choice', choice: best[0], probabilities, confidence: best[1] };
}

/** Both copies of the routing question answered alike: `picked` option names get their share, the rest split what is left. */
function routedAnswer(shares: Record<string, number>) {
  return (asked: Asked): DecisionResponse => {
    const answers: DecisionResponse['answers'] = {};
    for (const [questionId, question] of Object.entries(asked.questions)) {
      if (question.type !== 'choice') continue;
      const names = Object.keys(question.criteria);
      const given = Object.values(shares).reduce((sum, share) => sum + share, 0);
      const rest = names.filter(name => !(name in shares));
      answers[questionId] = choice(Object.fromEntries(names.map(name => [name, shares[name] ?? (1 - given) / rest.length])));
    }
    return { model: 'tacet-sonata', answers, usage: { inputTokens: 100 } };
  };
}

describe('which notes Tacet adds (COD-306)', () => {
  const notes: NoteCandidate[] = [
    { id: noteId(1), title: 'Invoice format', tags: ['billing'] },
    { id: noteId(2), title: 'Travel expenses', tags: ['finance'] },
    { id: noteId(3), title: 'Invoice format', tags: [] },
  ];

  it('offers every note twice, in opposite orders, named by title and described by tags', () => {
    const { questions, noteOf } = noteRouting([...notes, { id: noteId(4), title: 'Other', tags: [] }]);
    expect([...noteOf]).toEqual([['Invoice format', noteId(1)], ['Travel expenses', noteId(2)], ['Invoice format (2)', noteId(3)], ['Other (2)', noteId(4)]]);
    const forward = questions.topic;
    const backward = questions.reversed;
    if (forward.type !== 'choice' || backward.type !== 'choice') throw new Error('expected choice questions');
    expect(Object.entries(forward.criteria)).toEqual([['Invoice format', 'billing'], ['Travel expenses', 'finance'], ['Invoice format (2)', null], ['Other (2)', null], ['other', 'something else']]);
    expect(Object.keys(backward.criteria)).toEqual(['Other (2)', 'Invoice format (2)', 'Travel expenses', 'Invoice format', 'other']);
  });

  it('loads a note at the bar for this many notes when it beats "other", and the bar rises as notes get fewer', async () => {
    expect(fitThreshold(20)).toBeCloseTo(0.2);
    expect(fitThreshold(6)).toBeCloseTo(KNOWLEDGE_FIT_LIFT / 7);
    expect(fitThreshold(2)).toBe(0.75);

    // Twenty notes: the bar is 0.20.
    const workspace = [...notes, ...Array.from({ length: 17 }, (_, index) => ({ id: noteId(10 + index), title: `Filler ${index}`, tags: [] }))];
    const { decider, asked } = fakeDecider(routedAnswer({ 'Invoice format': 0.21, 'Travel expenses': 0.19, other: 0.05 }));
    const fits = await askKnowledgeFit(decider, 'bill Acme for May', workspace);
    expect([...fits!.keys()]).toEqual([noteId(1)]);
    expect(fits!.get(noteId(1))).toBeCloseTo(0.21);
    expect(asked[0].state).toBe('bill Acme for May');
    expect(Object.keys(asked[0].questions)).toEqual(['topic', 'reversed']);

    // Three notes: the same share is far below the bar of 0.75, and a note has to beat "other" too.
    expect((await askKnowledgeFit(fakeDecider(routedAnswer({ 'Invoice format': 0.21, other: 0.05 })).decider, 'bill Acme', notes))!.size).toBe(0);
    expect((await askKnowledgeFit(fakeDecider(routedAnswer({ 'Invoice format': 0.76, other: 0.2 })).decider, 'bill Acme', notes))!.size).toBe(1);
    expect((await askKnowledgeFit(fakeDecider(routedAnswer({ 'Travel expenses': 0.3, other: 0.35 })).decider, 'bill Acme', workspace))!.size).toBe(0);
  });

  it('answers nothing when Tacet is not installed, fails or is late, within the budget', async () => {
    const absent = fakeDecider(routedAnswer({}), false);
    expect(await askKnowledgeFit(absent.decider, 'bill Acme', notes)).toBeUndefined();
    expect(absent.asked).toEqual([]);
    expect(await askKnowledgeFit(fakeDecider('fails').decider, 'bill Acme', notes)).toBeUndefined();
    const started = Date.now();
    expect(await askKnowledgeFit(fakeDecider('late').decider, 'bill Acme', notes, 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await askKnowledgeFit(fakeDecider(routedAnswer({})).decider, 'bill Acme', [])).toBeUndefined();
  });

  it('only adds: keyword and pinned notes load first and keep their reasons, and Tacet\'s picks fill what room is left', () => {
    const store = new Store(':memory:');
    try {
      const [worker] = store.workspace().workers;
      const skill = store.get<Skill>('skills', worker.skillId);
      const item = (index: number, overrides: Partial<Knowledge> = {}) => ({ id: noteId(index), revision: 1, title: `Note ${index}`, content: `Unrelated text ${index}`, tags: [], hash: 'a'.repeat(64), scope: { type: 'workspace' as const }, pinned: false, ...overrides });
      const candidates = [
        item(1, { pinned: true, content: 'Pinned house rule' }),
        item(2, { content: 'Scoring leakage guidance' }),
        item(3, { title: 'Invoice format', content: 'PDF, numbered INV-YYYY-NNN' }),
        item(4, { content: 'Gardening tip' }),
      ];
      const { context, knowledgeMessage } = compileContext({ worker, skill, brief: 'Review scoring leakage', candidates, tacetFits: new Map([[noteId(3), 0.31], [noteId(2), 0.9]]) });
      const loaded = context.manifest.loaded.filter(entry => entry.kind === 'knowledge');
      expect(loaded.map(entry => [entry.id, entry.because, entry.fit])).toEqual([[noteId(1), 'pinned', undefined], [noteId(2), 'keywords', undefined], [noteId(3), 'tacet', 0.31]]);
      expect(knowledgeMessage).toContain('INV-YYYY-NNN');
      expect(context.manifest.omitted).toContainEqual(expect.objectContaining({ id: noteId(4), reason: 'not_relevant' }));
      expect(frozenTacetFits(context)).toEqual(new Map([[noteId(3), 0.31]]));

      // Compiling the frozen context again (as every step of a run does) keeps Tacet's note.
      const again = compileContext({ worker, skill, brief: 'Review scoring leakage', candidates: context.knowledge, tacetFits: frozenTacetFits(context) });
      expect(again.context.knowledge.map(entry => entry.id)).toEqual([noteId(1), noteId(2), noteId(3)]);

      // A full context: Tacet's picks are the ones left out, never a keyword match.
      const matches = Array.from({ length: KNOWLEDGE_ITEM_LIMIT }, (_, index) => item(100 + index, { content: `Scoring note ${index}` }));
      const full = compileContext({ worker, skill, brief: 'Review scoring', candidates: [item(3), ...matches], tacetFits: new Map([[noteId(3), 0.99]]) });
      expect(full.context.knowledge.map(entry => entry.id)).not.toContain(noteId(3));
      expect(full.context.manifest.omitted).toContainEqual(expect.objectContaining({ id: noteId(3), reason: 'context_limit' }));
    } finally {
      store.close();
    }
  });
});

describe('a run asks Tacet about the notes its keywords missed', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let knowledgeMessages: (string | null)[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-tacet-uses-'));
    store = new Store(join(directory, 'state.sqlite'));
    knowledgeMessages = [];
    core = new CoreService(store, () => {}, async () => ({ async request(messages) {
      knowledgeMessages.push(messages.map(message => String(message.content ?? '')).find(content => content.includes('approvedKnowledge')) ?? null);
      return { calls: [{ id: 'reply', name: 'reply', arguments: JSON.stringify({ message: 'Done.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } };
    } }));
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function runWith(brief: string) {
    const worker = await core.command('saveWorker', { ...store.workspace().workers[0], provider: 'openai' }) as Worker;
    const taskId = await core.command('createTask', { workerId: worker.id, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as string;
    for (let index = 0; index < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); index++) await new Promise(resolve => setTimeout(resolve, 10));
    return store.detail(taskId).runs[0];
  }

  it('sends only the unpinned, unmatched notes and loads what Tacet picks, saying why', async () => {
    const invoice = await core.command('saveKnowledge', { title: 'Invoice format', content: 'Invoices go out as PDF.', tags: ['billing'], pinned: false, scope: { type: 'workspace' } }) as Knowledge;
    const matched = await core.command('saveKnowledge', { title: 'Acme contacts', content: 'Acme pays within 30 days.', tags: [], pinned: false, scope: { type: 'workspace' } }) as Knowledge;
    const pinned = await core.command('saveKnowledge', { title: 'House rule', content: 'Always answer briefly.', tags: [], pinned: true, scope: { type: 'workspace' } }) as Knowledge;
    const asked: NoteCandidate[][] = [];
    core.runner.knowledgeFit = async (message, notes) => {
      asked.push(notes);
      expect(message).toBe('bill Acme for May');
      return new Map([[invoice.id, 0.42]]);
    };

    const run = await runWith('bill Acme for May');
    expect(asked).toEqual([[{ id: invoice.id, title: 'Invoice format', tags: ['billing'] }]]);
    const loaded = run.snapshot.context!.manifest.loaded.filter(entry => entry.kind === 'knowledge');
    expect(loaded.map(entry => [entry.id, entry.because, entry.fit])).toEqual([[pinned.id, 'pinned', undefined], [matched.id, 'keywords', undefined], [invoice.id, 'tacet', 0.42]]);
    expect(knowledgeMessages.at(-1)).toContain('Invoices go out as PDF.');
  });

  it('loads what the keywords matched, as before, when Tacet has no answer', async () => {
    await core.command('saveKnowledge', { title: 'Invoice format', content: 'Invoices go out as PDF.', tags: [], pinned: false, scope: { type: 'workspace' } });
    let asked = 0;
    core.runner.knowledgeFit = async () => {
      asked += 1;
      return undefined;
    };
    const run = await runWith('bill Acme for May');
    expect(asked).toBe(1);
    expect(run.snapshot.context!.knowledge).toEqual([]);
    expect(run.snapshot.context!.manifest.loaded.filter(entry => entry.kind === 'knowledge')).toEqual([]);
    expect(knowledgeMessages.at(-1)).toBeNull();
  });

  it('asks nothing of a Tacet that is not installed: the service wires the real ask and it answers undefined', async () => {
    await core.command('saveKnowledge', { title: 'Invoice format', content: 'Invoices go out as PDF.', tags: [], pinned: false, scope: { type: 'workspace' } });
    expect(core.decisions.isInstalled()).toBe(false);
    const run = await runWith('bill Acme for May');
    expect(run.snapshot.context!.knowledge).toEqual([]);
  });
});

describe('Tacet\'s second opinion on a step (COD-306)', () => {
  const emptyTrash: ActionToJudge = { surface: 'browser', kind: 'click', element: 'Empty trash now', role: 'button', site: 'mail.google.com', page: 'Trash - Gmail' };

  function riskAnswer(risky: number, consequential: number) {
    return (): DecisionResponse => ({
      model: 'tacet-sonata',
      answers: {
        does: choice({ look: 1 - risky, edit: 0, send: risky, pay: 0, delete: 0, publish: 0 }),
        happens: choice({ harmless: 1 - consequential, consequential }),
      },
      usage: { inputTokens: 40 },
    });
  }

  it('averages the two questions and reads a step at the threshold or above as risky', async () => {
    const at = fakeDecider(riskAnswer(ACTION_RISK_THRESHOLD, ACTION_RISK_THRESHOLD));
    expect(await askActionRisk(at.decider, emptyTrash)).toEqual({ risky: true, score: ACTION_RISK_THRESHOLD });
    expect(at.asked[0].state).toEqual(actionFields(emptyTrash));
    expect(at.asked[0].questions).toBe(ACTION_RISK_QUESTIONS);
    const below = fakeDecider(riskAnswer(0.5, 0.1));
    expect(await askActionRisk(below.decider, emptyTrash)).toEqual({ risky: false, score: 0.3 });
    expect(riskShare({})).toBeUndefined();
  });

  it('describes each kind of step by its fields', () => {
    expect(actionFields(emptyTrash)).toEqual({ action: 'click', element: 'Empty trash now', element_type: 'button', site: 'mail.google.com', page: 'Trash - Gmail' });
    expect(actionFields({ surface: 'browser', kind: 'type', text: 'See you  at 5', element: 'Message', role: 'textbox', site: 'chat.example.com', page: 'Chat' }))
      .toMatchObject({ action: 'type and press Enter', text: 'See you at 5' });
    expect(actionFields({ surface: 'desktop', kind: 'invoke', element: 'Hoàn tất', controlType: 'button', program: 'bank.exe', window: 'Chuyển tiền', inDialog: true }))
      .toEqual({ action: 'press', element: 'Hoàn tất', element_type: 'button', window: 'Chuyển tiền', app: 'bank.exe', dialog: true });
  });

  it('has no opinion when Tacet is not installed, fails or is late', async () => {
    const absent = fakeDecider(riskAnswer(1, 1), false);
    expect(await askActionRisk(absent.decider, emptyTrash)).toBeUndefined();
    expect(absent.asked).toEqual([]);
    expect(await askActionRisk(fakeDecider('fails').decider, emptyTrash)).toBeUndefined();
    const started = Date.now();
    expect(await askActionRisk(fakeDecider('late').decider, emptyTrash, 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('warming the model before a question', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-tacet-warm-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('loads the runtime once when installed, and does nothing when not', async () => {
    const files = { model: { ...TACET_FILES.model, bytes: 4 }, tokenizer: { ...TACET_FILES.tokenizer, bytes: 2 } };
    let loads = 0;
    const runtime: DecisionRuntime = { decide: async () => ({ model: 'tacet-sonata', answers: {}, usage: { inputTokens: 1 } }), close: async () => {} };
    const decisions = new Decisions({ directory, files, runtime: async () => { loads += 1; return runtime; }, idleMs: 60_000 });
    decisions.warm();
    expect(loads).toBe(0);
    await writeFile(join(directory, files.model.name), 'four');
    await writeFile(join(directory, files.tokenizer.name), '{}');
    decisions.warm();
    decisions.warm();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(loads).toBe(1);
    await decisions.decide('text', { yes: { type: 'noul', instructions: 'Is it?' } });
    expect(loads).toBe(1);
    await decisions.shutdown();
  });
});

/**
 * The real model on this computer, when `ORGLET_TACET_MODEL_DIR` names a folder holding the pinned ONNX file and
 * tokenizer (the app's `models/tacet-sonata` folder works). Skipped otherwise, which is every CI run.
 */
const modelDirectory = process.env.ORGLET_TACET_MODEL_DIR;
const realModel = modelDirectory && existsSync(join(modelDirectory, TACET_FILES.model.name)) && existsSync(join(modelDirectory, TACET_FILES.tokenizer.name)) ? modelDirectory : undefined;

describe.runIf(realModel !== undefined)('the real model on the measured cases', { timeout: 120_000 }, () => {
  let engine: TacetEngine;
  const decider: Decider = { isInstalled: () => true, decide: (state, questions, maxLength) => engine.decide(state, questions, maxLength ?? 1024) };
  beforeAll(async () => {
    engine = await TacetEngine.load({ model: join(realModel!, TACET_FILES.model.name), tokenizer: join(realModel!, TACET_FILES.tokenizer.name) });
  });
  afterAll(async () => {
    await engine?.close();
  });

  it('picks the invoice note for "bill Acme for May" among twenty, and nothing wrong', async () => {
    const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', 'scripts', 'tacet', 'knowledge_cases.json'), 'utf8')) as { notes: Record<string, { title: string; tags: string[] }> };
    const notes = Object.entries(cases.notes).map(([key, note]) => ({ id: key, title: note.title, tags: note.tags }));
    const fits = await askKnowledgeFit(decider, 'bill Acme for May', notes, 60_000);
    expect([...fits!.keys()]).toEqual(['invoice']);
  });

  it('reads cancelling a subscription as risky and a filter as harmless', async () => {
    expect((await askActionRisk(decider, { surface: 'browser', kind: 'click', element: 'Cancel subscription', role: 'button', site: 'www.netflix.com', page: 'Membership - Netflix' }, 60_000))!.risky).toBe(true);
    expect((await askActionRisk(decider, { surface: 'browser', kind: 'click', element: 'Filter: last 30 days', role: 'button', site: 'analytics.google.com', page: 'Reports - Google Analytics' }, 60_000))!.risky).toBe(false);
  });
});
