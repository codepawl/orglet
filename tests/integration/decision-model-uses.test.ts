import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { compileContext, frozenDecisionModelFits, KNOWLEDGE_ITEM_LIMIT } from '../../apps/desktop/src/core/context/compiler';
import type { Decider } from '../../apps/desktop/src/core/decisions/budget';
import { askKnowledgeFit, fitThreshold, KNOWLEDGE_FIT_LIFT, noteRouting, type NoteCandidate } from '../../apps/desktop/src/core/decisions/knowledge-fit';
import { ACTION_RISK_QUESTIONS, ACTION_RISK_THRESHOLD, actionFields, askActionRisk, riskShare, type ActionToJudge } from '../../apps/desktop/src/core/decisions/action-risk';
import type { ChoiceAnswer, DecisionQuestions, DecisionResponse, DecisionState } from '../../apps/desktop/src/shared/decisions';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/**
 * The decision model's two COD-306 uses with a fake decider: notes the keywords missed, and a second opinion on browser and desktop
 * steps (the steps themselves are in `browser-act-loop.test.ts` and `desktop-apps.test.ts`).
 */

const noteId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

type Asked = { state: DecisionState; questions: DecisionQuestions; maxLength?: number };

/** A decider that records what it was asked and answers with `answer`, or never answers when `answer` is 'late'. */
function fakeDecider(answer: ((asked: Asked) => DecisionResponse) | 'late' | 'fails', enabled = true) {
  const asked: Asked[] = [];
  const decider: Decider = {
    isEnabled: () => enabled,
    decide: async (state, questions, maxLength) => {
      asked.push({ state, questions, maxLength });
      if (answer === 'late') return new Promise<DecisionResponse>(() => {});
      if (answer === 'fails') throw new Error('The decision model gặp lỗi.');
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
    return { model: 'decision-sonata', answers, usage: { inputTokens: 100 } };
  };
}

describe('which notes the decision model adds (COD-306)', () => {
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

  it('answers nothing when the decision model is off, fails or is late, within the budget', async () => {
    const absent = fakeDecider(routedAnswer({}), false);
    expect(await askKnowledgeFit(absent.decider, 'bill Acme', notes)).toBeUndefined();
    expect(absent.asked).toEqual([]);
    expect(await askKnowledgeFit(fakeDecider('fails').decider, 'bill Acme', notes)).toBeUndefined();
    const started = Date.now();
    expect(await askKnowledgeFit(fakeDecider('late').decider, 'bill Acme', notes, 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await askKnowledgeFit(fakeDecider(routedAnswer({})).decider, 'bill Acme', [])).toBeUndefined();
  });

  it('only adds: keyword and pinned notes load first and keep their reasons, and the decision model\'s picks fill what room is left', () => {
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
      const { context, knowledgeMessage } = compileContext({ worker, skill, brief: 'Review scoring leakage', candidates, decisionModelFits: new Map([[noteId(3), 0.31], [noteId(2), 0.9]]) });
      const loaded = context.manifest.loaded.filter(entry => entry.kind === 'knowledge');
      expect(loaded.map(entry => [entry.id, entry.because, entry.fit])).toEqual([[noteId(1), 'pinned', undefined], [noteId(2), 'keywords', undefined], [noteId(3), 'tacet', 0.31]]);
      expect(knowledgeMessage).toContain('INV-YYYY-NNN');
      expect(context.manifest.omitted).toContainEqual(expect.objectContaining({ id: noteId(4), reason: 'not_relevant' }));
      expect(frozenDecisionModelFits(context)).toEqual(new Map([[noteId(3), 0.31]]));

      // Compiling the frozen context again (as every step of a run does) keeps the decision model's note.
      const again = compileContext({ worker, skill, brief: 'Review scoring leakage', candidates: context.knowledge, decisionModelFits: frozenDecisionModelFits(context) });
      expect(again.context.knowledge.map(entry => entry.id)).toEqual([noteId(1), noteId(2), noteId(3)]);

      // A full context: the decision model's picks are the ones left out, never a keyword match.
      const matches = Array.from({ length: KNOWLEDGE_ITEM_LIMIT }, (_, index) => item(100 + index, { content: `Scoring note ${index}` }));
      const full = compileContext({ worker, skill, brief: 'Review scoring', candidates: [item(3), ...matches], decisionModelFits: new Map([[noteId(3), 0.99]]) });
      expect(full.context.knowledge.map(entry => entry.id)).not.toContain(noteId(3));
      expect(full.context.manifest.omitted).toContainEqual(expect.objectContaining({ id: noteId(3), reason: 'context_limit' }));
    } finally {
      store.close();
    }
  });
});

describe('a run asks the decision model about the notes its keywords missed', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let knowledgeMessages: (string | null)[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-decision-model-uses-'));
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

  it('sends only the unpinned, unmatched notes and loads what the decision model picks, saying why', async () => {
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

  it('loads what the keywords matched, as before, when the decision model has no answer', async () => {
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

  it('asks nothing of a decision model with no connection: the service wires the real ask and it answers undefined', async () => {
    await core.command('saveKnowledge', { title: 'Invoice format', content: 'Invoices go out as PDF.', tags: [], pinned: false, scope: { type: 'workspace' } });
    // No OpenAI key is saved and nothing was chosen, so the setting in force is off and no request is made.
    expect((await core.decisions.view()).setting).toBe('off');
    expect(await core.decisions.decide('bill Acme for May', { topic: { type: 'noul', instructions: 'Is it billing?' } })).toBeUndefined();
    const run = await runWith('bill Acme for May');
    expect(run.snapshot.context!.knowledge).toEqual([]);
  });
});

describe('The decision model\'s second opinion on a step (COD-306)', () => {
  const emptyTrash: ActionToJudge = { surface: 'browser', kind: 'click', element: 'Empty trash now', role: 'button', site: 'mail.google.com', page: 'Trash - Gmail' };

  function riskAnswer(risky: number, consequential: number) {
    return (): DecisionResponse => ({
      model: 'decision-sonata',
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

  it('has no opinion when the decision model is off, fails or is late', async () => {
    const absent = fakeDecider(riskAnswer(1, 1), false);
    expect(await askActionRisk(absent.decider, emptyTrash)).toBeUndefined();
    expect(absent.asked).toEqual([]);
    expect(await askActionRisk(fakeDecider('fails').decider, emptyTrash)).toBeUndefined();
    const started = Date.now();
    expect(await askActionRisk(fakeDecider('late').decider, emptyTrash, 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
