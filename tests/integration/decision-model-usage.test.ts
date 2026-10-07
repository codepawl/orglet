// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import { BudgetError, BudgetLedger, cost } from '../../apps/desktop/src/core/budgets/ledger';
import { DecisionUsageLedger } from '../../apps/desktop/src/core/budgets/decision-usage';
import { Decisions, type DecisionsDependencies } from '../../apps/desktop/src/core/decisions/service';
import { REPORT_TOOL } from '../../apps/desktop/src/core/decisions/emulated';
import { readDecisionModelSetting, saveDecisionModelSetting } from '../../apps/desktop/src/core/decisions/stored-setting';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import type { DecisionModelSetting, DecisionQuestions } from '../../apps/desktop/src/shared/decisions';
import { permissionState } from '../../apps/desktop/src/shared/capability-status';

/**
 * The decision model after its rename and its approved changes: a saved choice moves from the old `tacet` key, its
 * requests are counted on the connection they went through, and the composer reads a message when it is sent.
 */

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../apps/desktop/src/renderer/api', () => ({ orglet: { call: bridge.call } }));
import { ComposerPermissionHint, readSentMessage, type PermissionHintControls } from '../../apps/desktop/src/renderer/permissionHints';
import { t } from '../../apps/desktop/src/renderer/i18n';

const stores: Store[] = [];
const createStore = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('a choice saved under the old name', () => {
  const chosen: DecisionModelSetting = { connection: 'ollama', model: 'llama3.2' };

  it('moves to the new key the first time it is read, and the old row goes', () => {
    const store = createStore();
    store.setSetting('tacet', chosen);
    expect(readDecisionModelSetting(store)).toEqual(chosen);
    expect(store.setting('decisionModel', undefined)).toEqual(chosen);
    expect(store.setting('tacet', undefined)).toBeUndefined();
    expect(readDecisionModelSetting(store)).toEqual(chosen);
  });

  it('keeps "off" as a choice', () => {
    const store = createStore();
    store.setSetting('tacet', 'off');
    expect(readDecisionModelSetting(store)).toBe('off');
    expect(store.setting('decisionModel', undefined)).toBe('off');
  });

  it('prefers the new key, and saving clears an old row that was left behind', () => {
    const store = createStore();
    store.setSetting('decisionModel', 'off');
    store.setSetting('tacet', chosen);
    expect(readDecisionModelSetting(store)).toBe('off');
    saveDecisionModelSetting(store, chosen);
    expect(store.setting('decisionModel', undefined)).toEqual(chosen);
    expect(store.setting('tacet', undefined)).toBeUndefined();
  });

  it('drops an old value that is not a choice and reads as nothing chosen', () => {
    const store = createStore();
    store.setSetting('tacet', { connection: 'ollama' });
    expect(readDecisionModelSetting(store)).toBeUndefined();
    expect(store.setting('tacet', undefined)).toBeUndefined();
    expect(store.setting('decisionModel', undefined)).toBeUndefined();
  });

  it('is what the core shows in Settings, still marked as chosen', async () => {
    const store = createStore();
    store.setSetting('tacet', chosen);
    const core = new CoreService(store, () => {}, async () => { throw new Error('unused'); });
    expect(await core.command('decisionModelSetting', {})).toEqual({ setting: chosen, chosen: true });
    expect(store.setting('decisionModel', undefined)).toEqual(chosen);
  });
});

const oneQuestion: DecisionQuestions = { yes: { type: 'noul', instructions: 'Is it a greeting?' } };
const openAiReply = (inputTokens?: number) => ({ answers: [{ type: 'predicate', name: 'yes', probability: 0.9 }], ...(inputTokens === undefined ? {} : { usage: { input_tokens: inputTokens } }) });
const answerFetcher = (reply: unknown, status = 200) => async () => new Response(JSON.stringify(reply), { status });

function reportingAdapter(usage: ModelReply['usage']): ModelAdapter {
  const reply: ModelReply = { calls: [{ id: 'call', name: REPORT_TOOL, arguments: JSON.stringify({ answers: [{ question: 'yes', probabilities: [0.2, 0.8] }] }) }], ...(usage ? { usage } : {}) };
  return { request: async () => reply } as unknown as ModelAdapter;
}

/** The decision model over fakes, counting its usage in `store` the way the core does. */
function counted(store: Store, options: { saved: DecisionModelSetting; fetcher?: DecisionsDependencies['fetcher']; adapter?: ModelAdapter; timeoutMs?: number }) {
  const usage = new DecisionUsageLedger(store);
  return new Decisions({
    saved: () => options.saved,
    save: () => {},
    readKey: async () => 'sk-test',
    adapter: async () => options.adapter ?? reportingAdapter(undefined),
    recordUsage: entry => usage.record(entry),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}

describe('counting what the decision model used', () => {
  const openAi: DecisionModelSetting = { connection: 'openai', model: 'gpt-6-luna' };

  it('records an OpenAI request at the Decisions API price, in the workspace totals', async () => {
    const store = createStore();
    await counted(store, { saved: openAi, fetcher: answerFetcher(openAiReply(1_000_000)) }).decide('hello', oneQuestion);
    // $0.10 per million input tokens is 100,000 micro-dollars.
    expect(store.usage()).toMatchObject({ chargedMicros: 100_000, inputTokens: 1_000_000, outputTokens: 0, uncertainCount: 0 });
    expect(store.usage().unpricedDecisionCalls).toBeUndefined();
    expect(store.workspace().usage.chargedMicros).toBe(100_000);
  });

  it('attributes a request to the chat it was for, and to the connection alone when none is named', async () => {
    const store = createStore();
    const decisions = counted(store, { saved: openAi, fetcher: answerFetcher(openAiReply(1_000)) });
    await decisions.decide('hello', oneQuestion, 1536, { taskId: 'chat-1' });
    await decisions.decide('hello', oneQuestion);
    expect(store.usage('chat-1').inputTokens).toBe(1_000);
    expect(store.usage('chat-2').inputTokens).toBe(0);
    expect(store.usage().inputTokens).toBe(2_000);
    expect(store.db.prepare('SELECT provider, task_id FROM decision_usage ORDER BY rowid').all().map(row => [row.provider, row.task_id])).toEqual([['openai', 'chat-1'], ['openai', null]]);
  });

  it('prices another connection like a chat request when the model has a verified price', async () => {
    const store = createStore();
    const saved = { connection: 'anthropic', model: 'claude-sonnet-5-5' };
    const decisions = counted(store, { saved, adapter: reportingAdapter({ input: 1_000, output: 100, cacheRead: 200 }) });
    await decisions.decide('hello', oneQuestion);
    const total = store.usage();
    expect(total).toMatchObject({ inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 200 });
    expect(total.chargedMicros).toBe(cost(1_000, 100, 'anthropic', { read: 200, write: 0 }));
    expect(total.unpricedDecisionCalls).toBeUndefined();
  });

  it('keeps a request visible, with its tokens, when the model has no verified price', async () => {
    const store = createStore();
    const decisions = counted(store, { saved: { connection: 'anthropic', model: 'a-model-nobody-priced' }, adapter: reportingAdapter({ input: 500, output: 50 }) });
    await decisions.decide('hello', oneQuestion);
    expect(store.usage()).toMatchObject({ chargedMicros: 0, inputTokens: 500, outputTokens: 50, unpricedDecisionCalls: 1 });
  });

  it('does not call a request free when the provider reported no usage', async () => {
    const store = createStore();
    const decisions = counted(store, { saved: openAi, fetcher: answerFetcher(openAiReply()) });
    await decisions.decide('hello there, how are you doing today?', oneQuestion);
    const total = store.usage();
    expect(total.unpricedDecisionCalls).toBe(1);
    expect(total.chargedMicros).toBe(0);
    expect(total.inputTokens).toBeGreaterThan(0);
  });

  it('counts a request that ran out of time as a call of unknown cost, and one the provider refused as nothing', async () => {
    const store = createStore();
    const neverAnswers: DecisionsDependencies['fetcher'] = (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    });
    expect(await counted(store, { saved: openAi, fetcher: neverAnswers, timeoutMs: 20 }).decide('hello', oneQuestion)).toBeUndefined();
    expect(store.usage()).toMatchObject({ chargedMicros: 0, inputTokens: 0, unpricedDecisionCalls: 1 });
    expect(await counted(store, { saved: openAi, fetcher: answerFetcher({ error: 'no' }, 401) }).decide('hello', oneQuestion)).toBeUndefined();
    expect(store.usage().unpricedDecisionCalls).toBe(1);
  });

  it('counts nothing while off, and an unreadable count never costs the answer', async () => {
    const store = createStore();
    expect(await counted(store, { saved: 'off' as never }).decide('hello', oneQuestion)).toBeUndefined();
    expect(store.usage().inputTokens).toBe(0);
    const failing = new Decisions({
      saved: () => openAi, save: () => {}, readKey: async () => 'sk-test', adapter: async () => reportingAdapter(undefined),
      recordUsage: () => { throw new Error('disk full'); }, fetcher: answerFetcher(openAiReply(10)),
    });
    expect((await failing.decide('hello', oneQuestion))?.answers.yes).toMatchObject({ type: 'noul' });
  });

  it('counts against the connection\'s monthly limit and the chat\'s budget', async () => {
    const store = createStore();
    const worker = store.all<Worker>('workers')[0];
    const skill = store.all<Skill>('skills')[0];
    const task: Task = { id: id(), workerId: worker.id, brief: 'Check a charge', status: 'failed', budgetMicros: 650_000, sourceIds: [], consent: true, providerScopes: ['openai'], accepted: false, createdAt: now() };
    const run: Run = { id: id(), taskId: task.id, status: 'failed', snapshot: { worker: { ...worker, provider: 'openai' }, skill }, error: 'x', startedAt: now() };
    store.put('tasks', task);
    store.put('runs', run, { column: 'task_id', value: task.id });
    // 6,000,000 tokens at $0.10 per million: 600,000 micro-dollars on OpenAI, for this chat.
    await counted(store, { saved: openAi, fetcher: answerFetcher(openAiReply(6_000_000)) }).decide('hello', oneQuestion, 1536, { taskId: task.id });
    const ledger = new BudgetLedger(store);
    expect(() => ledger.reserve(run.id, task.id, 'openai', 200_000, 10_000_000, 700_000)).toThrow(BudgetError);
    expect(() => ledger.reserve(run.id, task.id, 'openai', 100_000, 650_000, 10_000_000)).toThrow(BudgetError);
    expect(ledger.reserve(run.id, task.id, 'openai', 40_000, 10_000_000, 700_000)).toBeTruthy();
    // Another connection has its own allowance.
    expect(ledger.reserve(run.id, task.id, 'anthropic', 200_000, 10_000_000, 700_000)).toBeTruthy();
  });
});

describe('the composer reads a message when it is sent', () => {
  let root: Root | undefined;
  const controls: PermissionHintControls = {
    chatKey: 'chat-hint',
    permissions: permissionState({ provider: 'openai', capabilities: [], grant: null }),
    enabled: true,
    busy: false,
    onApply: () => {},
  };
  async function show(text: string) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (!root) {
      const container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root!.render(createElement(ComposerPermissionHint, { text, controls })));
  }
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    bridge.call.mockReset();
  });

  it('never sends a draft while it is typed', async () => {
    bridge.call.mockResolvedValue({ needs: ['web'] });
    vi.useFakeTimers();
    try {
      await show('look up the weather in Hanoi');
      await show('look up the weather in Hanoi and Hue');
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    } finally {
      vi.useRealTimers();
    }
    expect(bridge.call).not.toHaveBeenCalled();
    expect(document.querySelector('.permission-hint')).toBeNull();
  });

  it('asks once for the message that was sent, names its chat, and shows the line after the box empties', async () => {
    bridge.call.mockResolvedValue({ needs: ['web'] });
    await show('');
    readSentMessage('chat-hint', 'look up the weather in Hanoi', true);
    await act(async () => { await Promise.resolve(); });
    expect(bridge.call).toHaveBeenCalledTimes(1);
    expect(bridge.call).toHaveBeenCalledWith('suggestPermissions', { text: 'look up the weather in Hanoi', taskId: 'chat-hint' });
    expect(document.querySelector('.permission-hint')?.textContent).toContain(t('Tin nhắn này có vẻ cần web, mà chat chưa bật web.'));
    // The next message has begun: the line about the last one goes.
    await show('and the');
    expect(document.querySelector('.permission-hint')).toBeNull();
  });

  it('asks nothing where a hint could not be acted on, or for a message too short to read', async () => {
    readSentMessage('chat-hint', 'look up the weather in Hanoi', false);
    readSentMessage('chat-hint', 'hi', true);
    expect(bridge.call).not.toHaveBeenCalled();
  });
});
