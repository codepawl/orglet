import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Decisions, type DecisionsDependencies } from '../../apps/desktop/src/core/decisions/service';
import { askThroughCodex, CODEX_DECISION_SCHEMA, namedByQuestion, DecisionBackendUnavailable, type CodexDecisionRuntime } from '../../apps/desktop/src/core/decisions/codex';
import { decideWithin, HARNESS_MIN_BUDGET_MS } from '../../apps/desktop/src/core/decisions/budget';
import { readDecisionModelSetting } from '../../apps/desktop/src/core/decisions/stored-setting';
import { DecisionUsageLedger } from '../../apps/desktop/src/core/budgets/decision-usage';
import { executeHarness, harnessArgs, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { REPORT_TOOL } from '../../apps/desktop/src/core/decisions/emulated';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import { parseStoredDecisionModelSetting, type DecisionModelSetting, type DecisionQuestions } from '../../apps/desktop/src/shared/decisions';

/**
 * The decision model as a priority list (owner, 2026-10-08): the stored value moves to a list, each question tries the
 * entries in order, a slow harness entry serves only decisions that can wait, the answering entry is recorded, and the
 * Codex backend runs the harness the way a chat does, with its restricted flags. Nothing here calls a provider or a CLI.
 */

const oneQuestion: DecisionQuestions = { yes: { type: 'noul', instructions: 'Is it a greeting?' } };
const yesReport = (probabilityOfYes: number) => ({ answers: [{ question: 'yes', probabilities: [1 - probabilityOfYes, probabilityOfYes] }] });

const openAi = { connection: 'openai', model: 'gpt-6-luna' };
const anthropic = { connection: 'anthropic', model: 'claude-sonnet-5-5' };
const ollama = { connection: 'ollama', model: 'llama3.2' };
const codex = { connection: 'codex', model: 'gpt-6-luna' };

function reportingAdapter(probabilityOfYes: number): ModelAdapter {
  const reply: ModelReply = { calls: [{ id: 'call', name: REPORT_TOOL, arguments: JSON.stringify(yesReport(probabilityOfYes)) }], usage: { input: 100, output: 10 } };
  return { request: async () => reply };
}
const failingAdapter = (message: string): ModelAdapter => ({ request: async () => { throw new Error(message); } });
const hangingAdapter = (): ModelAdapter => ({
  request: (_messages, _tools, signal) => new Promise<ModelReply>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }),
});

type Fixture = {
  saved: DecisionModelSetting | undefined;
  adapters?: Record<string, ModelAdapter>;
  keys?: Record<string, string>;
  codexOutput?: unknown | Error;
  timeoutMs?: number;
  harnessTimeoutMs?: number;
};

/** The service over fakes, with a log of which connections it reached and in what order. */
function fixture(options: Fixture) {
  const reached: string[] = [];
  const usage: { provider: string; model: string }[] = [];
  const codexRequests: HarnessRequest[] = [];
  const runtime: CodexDecisionRuntime = {
    locate: async () => {
      reached.push('codex:locate');
      return { executable: process.execPath };
    },
    execute: async request => {
      reached.push('codex');
      codexRequests.push(request);
      if (options.codexOutput instanceof Error) throw options.codexOutput;
      return { output: options.codexOutput ?? yesReport(0.9), costUsd: null };
    },
  };
  const dependencies: DecisionsDependencies = {
    saved: () => options.saved,
    save: () => {},
    readKey: async provider => options.keys?.[provider] ?? null,
    adapter: async provider => {
      reached.push(provider);
      return options.adapters?.[provider] ?? failingAdapter(`No adapter for ${provider}.`);
    },
    codex: runtime,
    recordUsage: entry => usage.push({ provider: entry.provider, model: entry.model }),
    fetcher: async () => { reached.push('openai'); return new Response(JSON.stringify({ answers: [{ type: 'predicate', name: 'yes', probability: 0.8 }], usage: { input_tokens: 5 } })); },
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.harnessTimeoutMs ? { harnessTimeoutMs: options.harnessTimeoutMs } : {}),
  };
  return { decisions: new Decisions(dependencies), reached, usage, codexRequests };
}

describe('the stored value becomes a list', () => {
  it('reads the old shapes as lists and refuses what is not a list or a choice', () => {
    expect(parseStoredDecisionModelSetting('off')).toEqual([]);
    expect(parseStoredDecisionModelSetting(ollama)).toEqual([ollama]);
    expect(parseStoredDecisionModelSetting([ollama, codex])).toEqual([ollama, codex]);
    expect(parseStoredDecisionModelSetting([])).toEqual([]);
    expect(parseStoredDecisionModelSetting([ollama, ollama])).toBeUndefined();
    expect(parseStoredDecisionModelSetting([openAi, anthropic, ollama, codex])).toBeUndefined();
    expect(parseStoredDecisionModelSetting({ connection: 'ollama' })).toBeUndefined();
    expect(parseStoredDecisionModelSetting('on')).toBeUndefined();
  });

  it('rewrites a stored single choice or off as a list the first time it is read, and leaves a list alone', () => {
    const store = new Store(':memory:');
    try {
      store.setSetting('decisionModel', ollama);
      expect(readDecisionModelSetting(store)).toEqual([ollama]);
      expect(store.setting('decisionModel', undefined)).toEqual([ollama]);
      store.setSetting('decisionModel', 'off');
      expect(readDecisionModelSetting(store)).toEqual([]);
      expect(store.setting('decisionModel', undefined)).toEqual([]);
      store.setSetting('decisionModel', [anthropic, codex]);
      expect(readDecisionModelSetting(store)).toEqual([anthropic, codex]);
      store.setSetting('decisionModel', 'garbage');
      store.clearSetting('tacet');
      expect(readDecisionModelSetting(store)).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

describe('trying the entries in order', () => {
  it('answers with the first entry that works and says which one it was', async () => {
    const { decisions, reached } = fixture({ saved: [anthropic, ollama], adapters: { anthropic: reportingAdapter(0.7), ollama: reportingAdapter(0.2) } });
    const response = await decisions.decide('hello', oneQuestion);
    expect(response?.answeredBy).toEqual(anthropic);
    expect(response?.answers.yes).toMatchObject({ noul: 0.7 });
    expect(reached).toEqual(['anthropic']);
  });

  it('passes over an entry that is missing, one that errors and one that times out, then uses the next', async () => {
    const { decisions, reached, usage } = fixture({
      saved: [openAi, anthropic, { connection: 'xai', model: 'grok-3-mini' }],
      adapters: { anthropic: failingAdapter('Chưa kết nối Anthropic.'), xai: reportingAdapter(0.6) },
    });
    const response = await decisions.decide('hello', oneQuestion);
    expect(response?.answeredBy).toEqual({ connection: 'xai', model: 'grok-3-mini' });
    // OpenAI has no key, so nothing was sent to it; Anthropic was reached and failed.
    expect(reached).toEqual(['anthropic', 'xai']);
    expect(usage.map(entry => entry.provider)).toEqual(['xai']);

    const slow = fixture({ saved: [anthropic, ollama], adapters: { anthropic: hangingAdapter(), ollama: reportingAdapter(0.8) }, timeoutMs: 30 });
    const late = await slow.decisions.decide('hello', oneQuestion);
    expect(late?.answeredBy).toEqual(ollama);
    // The entry that ran out of time may still have been billed, so it is counted as a call of unknown cost.
    expect(slow.usage.map(entry => entry.provider)).toEqual(['anthropic', 'ollama']);
  });

  it('passes over an entry whose reply it cannot read', async () => {
    const unreadable: ModelAdapter = { request: async () => ({ calls: [], usage: { input: 1, output: 1 } }) };
    const { decisions } = fixture({ saved: [anthropic, ollama], adapters: { anthropic: unreadable, ollama: reportingAdapter(0.9) } });
    expect((await decisions.decide('hello', oneQuestion))?.answeredBy).toEqual(ollama);
  });

  it('never falls back to anything outside the list, and returns nothing when every entry fails', async () => {
    const { decisions, reached } = fixture({ saved: [anthropic], adapters: { anthropic: failingAdapter('down'), ollama: reportingAdapter(0.9) }, keys: { openai: 'sk-test' } });
    expect(await decisions.decide('hello', oneQuestion)).toBeUndefined();
    expect(reached).toEqual(['anthropic']);
    expect(await fixture({ saved: [] }).decisions.decide('hello', oneQuestion)).toBeUndefined();
  });

  it('keeps the default of OpenAI with a key while nothing is chosen, and an empty list is off', async () => {
    const withKey = fixture({ saved: undefined, keys: { openai: 'sk-test' } });
    expect((await withKey.decisions.decide('hello', oneQuestion))?.answeredBy).toEqual(openAi);
    const off = fixture({ saved: [], keys: { openai: 'sk-test' } });
    expect(off.decisions.isEnabled()).toBe(false);
    expect(await off.decisions.decide('hello', oneQuestion)).toBeUndefined();
    expect(fixture({ saved: [codex] }).decisions.isEnabled()).toBe(true);
  });

  it('stops starting entries once the caller has stopped waiting', async () => {
    const { decisions, reached } = fixture({ saved: [anthropic, ollama], adapters: { anthropic: failingAdapter('slow failure'), ollama: reportingAdapter(0.9) } });
    expect(await decisions.decide('hello', oneQuestion, 1536, { budgetMs: -1 })).toBeUndefined();
    expect(reached).toEqual([]);
  });
});

describe('a harness entry is for the background', () => {
  it('is skipped, without starting Codex, for a decision someone is waiting on', async () => {
    const { decisions, reached } = fixture({ saved: [codex, ollama], adapters: { ollama: reportingAdapter(0.9) } });
    for (const context of [{}, { budgetMs: 4000 }, { budgetMs: HARNESS_MIN_BUDGET_MS - 1 }]) {
      expect((await decisions.decide('hello', oneQuestion, 1536, context))?.answeredBy).toEqual(ollama);
    }
    expect(reached.filter(name => name.startsWith('codex'))).toEqual([]);
  });

  it('serves a background decision and one that can wait 15 seconds or more', async () => {
    const { decisions, reached } = fixture({ saved: [codex, ollama], adapters: { ollama: reportingAdapter(0.1) } });
    const background = await decisions.decide('hello', oneQuestion, 1536, { background: true });
    expect(background?.answeredBy).toEqual(codex);
    expect(background?.answers.yes).toMatchObject({ noul: 0.9 });
    expect((await decisions.decide('hello', oneQuestion, 1536, { budgetMs: HARNESS_MIN_BUDGET_MS }))?.answeredBy).toEqual(codex);
    expect(reached).toEqual(['codex:locate', 'codex', 'codex:locate', 'codex']);
  });

  it('passes the budget through decideWithin, so a short one never reaches Codex', async () => {
    const { decisions, reached } = fixture({ saved: [codex] });
    expect(await decideWithin(decisions, 3000, 'hello', oneQuestion, 512)).toBeUndefined();
    expect(reached).toEqual([]);
  });

  it('moves on from a Codex that is not signed in, fails or runs out of time', async () => {
    const signedOut = fixture({ saved: [codex, ollama], adapters: { ollama: reportingAdapter(0.9) } });
    signedOut.decisions['dependencies'].codex = { locate: async () => { throw new DecisionBackendUnavailable('Codex chưa đăng nhập.'); }, execute: async () => { throw new Error('unused'); } };
    expect((await signedOut.decisions.decide('hello', oneQuestion, 1536, { background: true }))?.answeredBy).toEqual(ollama);

    const failing = fixture({ saved: [codex, ollama], adapters: { ollama: reportingAdapter(0.9) }, codexOutput: new Error('Codex báo lỗi') });
    expect((await failing.decisions.decide('hello', oneQuestion, 1536, { background: true }))?.answeredBy).toEqual(ollama);

    const garbled = fixture({ saved: [codex, ollama], adapters: { ollama: reportingAdapter(0.9) }, codexOutput: { answers: [] } });
    expect((await garbled.decisions.decide('hello', oneQuestion, 1536, { background: true }))?.answeredBy).toEqual(ollama);
  });

  it('tests the whole list and reports which entry answered, with what happened to the ones before it', async () => {
    const { decisions } = fixture({
      saved: [codex, anthropic, ollama],
      adapters: { anthropic: failingAdapter('Chưa kết nối Anthropic.'), ollama: reportingAdapter(0.3) },
      codexOutput: new Error('Codex báo lỗi'),
    });
    const sample = { answers: [{ question: 'kind', probabilities: [0.05, 0.15, 0.8] }] };
    const withSample = fixture({ saved: [anthropic, ollama], adapters: { anthropic: failingAdapter('Chưa kết nối Anthropic.'), ollama: { request: async () => ({ calls: [{ id: 'c', name: REPORT_TOOL, arguments: JSON.stringify(sample) }], usage: { input: 9, output: 3 } }) } } });
    const tested = await withSample.decisions.test();
    expect(tested).toMatchObject({ connection: 'ollama', model: 'llama3.2', choice: 'request', probability: 0.8 });
    expect(tested.attempts.map(attempt => [attempt.connection, attempt.outcome])).toEqual([['anthropic', 'failed'], ['ollama', 'answered']]);
    expect(tested.attempts[0].reason).toContain('Chưa kết nối Anthropic');

    await expect(decisions.test()).rejects.toThrow('1. Codex báo lỗi');
    await expect(fixture({ saved: [] }).decisions.test()).rejects.toThrow('đang tắt');
  });

  it('runs Codex in a test, since nobody waits on one', async () => {
    const sample = { answers: [{ question: 'kind', probabilities: [0.1, 0.1, 0.8] }] };
    const { decisions, reached } = fixture({ saved: [codex], codexOutput: sample });
    const tested = await decisions.test();
    expect(tested).toMatchObject({ connection: 'codex', choice: 'request' });
    expect(reached).toEqual(['codex:locate', 'codex']);
  });
});

describe('the Codex backend', () => {
  it('asks one JSON answer with reasoning off, in a private folder, and reads it like the other backends', async () => {
    const { decisions, codexRequests } = fixture({ saved: [codex] });
    const response = await decisions.decide('hello there', oneQuestion, 1536, { background: true });
    expect(response).toMatchObject({ model: 'gpt-6-luna', answeredBy: codex, answers: { yes: { type: 'noul', noul: 0.9 } } });
    expect(response?.usage.estimated).toBe(true);
    const [request] = codexRequests;
    expect(request).toMatchObject({ harness: 'codex', model: 'gpt-6-luna', reasoningOff: true, coreToolsOnly: true, schema: CODEX_DECISION_SCHEMA });
    expect(request.prompt).toContain('<text>\nhello there\n</text>');
    expect(request.prompt).toContain('Question "yes" (false or true): Is it a greeting?');
    expect(request.prompt).toContain('Use no tools');
    // The folder is the CLI's alone and is removed afterwards.
    expect(existsSync(request.cwd)).toBe(false);
  });

  it('runs with the restricted flags a chat uses, reasoning off and the model named, never loosened', () => {
    const request: Pick<HarnessRequest, 'harness' | 'cwd' | 'schema' | 'model' | 'coreToolsOnly' | 'reasoningOff'> = { harness: 'codex', cwd: 'C:/decision', schema: CODEX_DECISION_SCHEMA, model: 'gpt-6-luna', coreToolsOnly: true, reasoningOff: true };
    const args = harnessArgs(request, 'win32');
    expect(args.slice(0, 3)).toEqual(['exec', '-m', 'gpt-6-luna']);
    expect(args).toContain('model_reasoning_effort="none"');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    for (const flag of ['--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules']) expect(args).toContain(flag);
    for (const feature of ['shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use']) expect(args[args.indexOf(feature) - 1]).toBe('--disable');
    for (const loosened of ['--yolo', '--force', '--dangerously-bypass-approvals-and-sandbox', '--full-auto', 'danger-full-access', 'workspace-write']) expect(args).not.toContain(loosened);
    // The prompt arrives on stdin, which is closed after it.
    expect(args.at(-1)).toBe('-');
    expect(harnessArgs({ ...request, reasoningOff: false }, 'win32').some(arg => arg.startsWith('model_reasoning_effort'))).toBe(false);
  });
});

/** A `codex exec` that is a fake process: it reports the arguments it got, writes its last message and exits. */
const spawnLog = vi.hoisted(() => ({ calls: [] as { file: string; args: string[] }[], stdinWrites: [] as string[], stdinEnded: false, lastMessage: '' }));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawn: (file: string, args: string[]) => {
      spawnLog.calls.push({ file, args });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 4242, stdin: new PassThrough() });
      child.stdin.on('data', chunk => spawnLog.stdinWrites.push(String(chunk)));
      child.stdin.on('finish', () => { spawnLog.stdinEnded = true; });
      child.stdin.on('end', () => {
        const output = args[args.indexOf('-o') + 1];
        void writeFile(output, spawnLog.lastMessage).then(() => {
          child.stdout.end('{"type":"turn.completed"}\n');
          child.emit('close', 0);
        });
      });
      return child;
    },
  };
});

describe('the Codex backend through the real harness executor with a fake process', () => {
  afterEach(() => {
    spawnLog.calls.length = 0;
    spawnLog.stdinWrites.length = 0;
    spawnLog.stdinEnded = false;
  });

  it('spawns the restricted command, sends the prompt on stdin and closes it, then validates the JSON it prints', async () => {
    spawnLog.lastMessage = JSON.stringify(yesReport(0.85));
    const runtime: CodexDecisionRuntime = { locate: async () => ({ executable: process.execPath, configDir: 'C:/accounts/codex/1' }), execute: executeHarness };
    const response = await askThroughCodex({ runtime, model: 'gpt-6-luna', input: 'hello', questions: oneQuestion, signal: AbortSignal.timeout(5000) });
    expect(response.answers.yes).toMatchObject({ type: 'noul', noul: 0.85 });
    const [call] = spawnLog.calls;
    expect(call.file).toBe(process.execPath);
    expect(call.args.slice(0, 3)).toEqual(['exec', '-m', 'gpt-6-luna']);
    expect(call.args).toContain('model_reasoning_effort="none"');
    expect(call.args).toContain('read-only');
    expect(call.args.at(-1)).toBe('-');
    expect(spawnLog.stdinEnded).toBe(true);
    expect(spawnLog.stdinWrites.join('')).toContain('Question "yes"');
  });

  it('fails, so the list moves on, when what it prints is not the shape asked for', async () => {
    spawnLog.lastMessage = '{"unexpected":true}';
    const runtime: CodexDecisionRuntime = { locate: async () => ({ executable: process.execPath }), execute: executeHarness };
    const response = await askThroughCodex({ runtime, model: 'gpt-6-luna', input: 'hello', questions: oneQuestion, signal: AbortSignal.timeout(5000) });
    expect(response.answers).toEqual({});
  });
});

describe('reading the question names Codex gives', () => {
  const ids = new Map([['kind', 'kind'], ['size', 'size']]);
  it('takes the name from a whole echoed question line, or from the position when the count matches', () => {
    const echoed = { answers: [{ question: 'Question "kind" (choose one option): What does it ask?', probabilities: [1, 0] }, { question: 'size', probabilities: [0, 1] }] };
    expect(namedByQuestion(echoed, ids)).toEqual({ answers: [{ question: 'kind', probabilities: [1, 0] }, { question: 'size', probabilities: [0, 1] }] });
    const renamed = { answers: [{ question: 'first', probabilities: [1, 0] }, { question: 'second', probabilities: [0, 1] }] };
    expect(namedByQuestion(renamed, ids)).toEqual({ answers: [{ question: 'kind', probabilities: [1, 0] }, { question: 'size', probabilities: [0, 1] }] });
    // A count that does not match leaves an unknown name unknown, so that question stays unanswered.
    const short = { answers: [{ question: 'first', probabilities: [1, 0] }] };
    expect(namedByQuestion(short, ids)).toEqual(short);
    expect(namedByQuestion('text', ids)).toBe('text');
  });
});

describe('counting a Codex request', () => {
  it('is a plan request: no money, and not an unknown cost', () => {
    const store = new Store(':memory:');
    try {
      const ledger = new DecisionUsageLedger(store);
      ledger.record({ provider: 'codex', model: 'gpt-6-luna', usage: { inputTokens: 40, estimated: true } });
      ledger.record({ provider: 'codex', model: 'gpt-6-luna', usage: undefined });
      const total = store.usage();
      expect(total.chargedMicros).toBe(0);
      expect(total.unpricedDecisionCalls).toBeUndefined();
      expect(total.inputTokens).toBe(40);
      const rows = store.db.prepare('SELECT provider, amount, pricing_version AS version FROM decision_usage').all();
      expect(rows).toEqual([{ provider: 'codex', amount: 0, version: 'harness-plan' }, { provider: 'codex', amount: 0, version: 'harness-plan' }]);
    } finally {
      store.close();
    }
  });
});
