import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { readModelListCache } from '../../apps/desktop/src/core/models/cache';
import { Checkpoints } from '../../apps/desktop/src/core/storage/checkpoints';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { Effort, RunEffort, modelEffort, resolveEffort, type NativeEffortSetting } from '../../apps/desktop/src/shared/effort';
import { resolveWorkerModel, resolveWorkerEffort } from '../../apps/desktop/src/core/models/resolve';
import { MODEL_LIST_CACHE_VERSION, MODEL_LISTS_SETTING } from '../../apps/desktop/src/shared/models';
import { parseCodexModels, parseOllamaEffort, parseOpenRouterModels } from '../../apps/desktop/src/core/models/fetch';
import { harnessArgs, prepareHarnessToolPolicy, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import type { Run, Skill, Task, Worker, Team, ProviderScope } from '../../apps/desktop/src/shared/contracts';

let store: Store;
let core: CoreService;
let directory: string;
let dispatchedRequests: { model?: string; effort?: NativeEffortSetting }[];
beforeEach(async () => {
  store = new Store(':memory:');
  directory = await mkdtemp(join(tmpdir(), 'orglet-effort-'));
  dispatchedRequests = [];
  core = new CoreService(store, () => {}, async (_provider, model, effort) => {
    dispatchedRequests.push({ model, effort });
    return { async request() {
      return { calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Fixture reply.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } };
    } };
  });
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});
async function worker(overrides: Partial<Worker> = {}) {
  return core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai', modelId: 'gpt-5.4', ...overrides }) as Promise<Worker>;
}
function fixture(selectedWorker: Worker, stage?: Run['stage']) {
  const task: Task = { id: id(), workerId: selectedWorker.id, brief: 'Say hello', status: 'running', budgetMicros: 1_000_000, sourceIds: [], consent: true, providerScopes: [selectedWorker.provider as ProviderScope], accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker: selectedWorker, skill: store.all<Skill>('skills')[0] }, status: 'running', error: null, startedAt: now(), ...(stage ? { stage } : {}) };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}
function cache(model = 'gpt-6-sol', levels = ['low', 'medium', 'high', 'ultra']) {
  store.setSetting(MODEL_LISTS_SETTING, { version: MODEL_LIST_CACHE_VERSION, byProvider: { codex: { fetchedAt: now(), source: 'native', models: [{ provider: 'codex', id: model, source: 'native', isDefault: true, effort: { levels } }] } } });
}
function useHarness() {
  const requests: HarnessRequest[] = [];
  core = new CoreService(store, () => {}, async () => {
    throw Error('No API route');
  }, undefined, undefined, {
    detect: async () => [{ ...missingHarness('codex', 'win32'), executable: 'fixture.exe', version: 'fixture', auth: 'logged_in', status: 'signed_in' }],
    execute: async request => {
      requests.push(request);
      return { output: request.coreToolsOnly ? { call: { name: 'reply', arguments: JSON.stringify({ message: 'Fixture reply.', title: null, knowledgeProposals: [] }) }, notes: '' } : { payload: JSON.stringify({ message: 'Fixture reply.', title: null, report: null }) }, costUsd: null };
    },
  });
  return requests;
}

describe('thinking effort', () => {
  it('validates the optional worker choice and each native transport boundary', () => {
    expect(Effort.safeParse('ultra').success).toBe(false);
    expect(RunEffort.safeParse({ requested: 'max', origin: 'explicit', support: 'unknown', native: { transport: 'codex', level: 'ultra' } }).success).toBe(false);
    expect(RunEffort.safeParse({ requested: 'max', origin: 'explicit', support: 'supported', native: { transport: 'anthropic', level: 'ultra' } }).success).toBe(false);
  });
  it('uses contextual defaults and explicit override, mapping max only from actual levels', () => {
    for (const stage of ['plan', 'synthesis']) {
      expect(resolveEffort(undefined, stage, { levels: ['low', 'medium', 'high'] }, 'codex')).toMatchObject({ requested: 'high', origin: 'contextual', native: { level: 'high' } });
    }
    for (const stage of [undefined, 'group', 'member']) {
      expect(resolveEffort(undefined, stage, undefined, undefined)).toEqual({ requested: 'medium', origin: 'contextual', support: 'unknown' });
    }
    expect(resolveEffort('low', 'plan', { levels: ['low', 'high'] }, 'codex')).toMatchObject({ requested: 'low', origin: 'explicit', native: { level: 'low' } });
    expect(resolveEffort('max', undefined, { levels: ['ultra', 'high'] }, 'codex')).toMatchObject({ native: { level: 'ultra' } });
    expect(resolveEffort('medium', undefined, { levels: ['low', 'high'] }, 'codex').support).toBe('unsupported');
    expect(modelEffort('openai', 'gpt-6.1-sol').unsupported).toBe(true);
    expect(modelEffort('cursor', 'composer-2')).toEqual({});
    for (const stage of ['plan', 'synthesis']) {
      expect(resolveEffort(undefined, stage, { levels: ['medium', 'high'] }, 'codex', false, true)).toMatchObject({ requested: 'medium', native: { level: 'medium' } });
    }
    expect(resolveEffort('high', 'plan', { levels: ['medium', 'high'] }, 'codex', false, true)).toMatchObject({ requested: 'high', origin: 'explicit' });
  });
  it('preserves advertised model controls without inventing level support', () => {
    expect(parseCodexModels(JSON.stringify({ models: [{ id: 'gpt-6-sol', supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'ultra' }, { reasoningEffort: 'bogus' }] }] }))[0]?.effort).toEqual({ levels: ['high', 'ultra'] });
    expect(parseOllamaEffort({ thinking: { values: [false, 'low', 'medium', 'xhigh', 'evil'], default: 'medium' } })).toEqual({ levels: ['low', 'medium', 'xhigh'] });
    expect(parseOllamaEffort({ thinking: { values: [true, false] } })).toBeUndefined();
    const local = modelEffort('ollama', 'local', parseOllamaEffort({ thinking: { values: ['low', 'high', 'ultra'] } }));
    const maximum = resolveEffort('max', undefined, local.capability, local.transport);
    expect(maximum).toMatchObject({ support: 'supported', native: { transport: 'ollama', level: 'ultra' } });
    expect(RunEffort.parse(maximum)).toEqual(maximum);
    const entry = (reasoning?: unknown, name = 'vendor/model') => parseOpenRouterModels({ data: [{ id: name, architecture: { modality: 'text->text' }, supported_parameters: ['reasoning'], ...(reasoning ? { reasoning } : {}) }] })[0];
    expect(entry()?.effort).toBeUndefined();
    expect(entry({ supported_efforts: ['high', 'nonsense', 'ultra'] })?.effort).toEqual({ levels: ['high'] });
    expect(entry({ supported_efforts: null })?.effort?.levels).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(entry({ supported_efforts: null }, 'openrouter/auto')?.effort).toBeUndefined();
    expect(entry({ supported_efforts: ['high'] }, 'openrouter/free')?.effort).toBeUndefined();
  });
  it('saves revisions, clears automatic choice and roundtrips worker/run backup and templates', async () => {
    const selectedWorker = await worker({ effort: 'max' });
    const { task, run } = fixture(selectedWorker);
    run.snapshot.effort = { requested: 'max', origin: 'explicit', support: 'supported', native: { transport: 'reasoning_effort', level: 'xhigh' } };
    store.update('runs', run);
    const text = core.backups.export();
    const restored = new Store(':memory:');
    try {
      const backups = new Backups(restored, () => false, () => {});
      backups.restore(backups.preview(text).token);
      expect(restored.get<Run>('runs', run.id).snapshot.effort).toEqual(run.snapshot.effort);
      expect(restored.get<Worker>('workers', selectedWorker.id).effort).toBe('max');
    } finally {
      restored.close();
    }
    const team = await core.command('saveTeam', { name: 'Effort', instructions: 'Review', memberIds: [selectedWorker.id], synthesizerId: selectedWorker.id, workflow: 'sequential', monthlyBudgetMicros: 1_000_000 }) as Team;
    const template = core.templates.export(team.id);
    expect(JSON.parse(template).workers[0].effort).toBe('max');
    const imported = core.templates.import(template);
    expect(store.get<Worker>('workers', imported.memberIds[0]).effort).toBe('max');
    const cleared = await core.command('saveWorker', { ...selectedWorker, effort: undefined }) as Worker;
    expect(cleared.effort).toBeUndefined();
    expect(cleared.revision).toBe(selectedWorker.revision + 1);
    expect(store.get<Run>('runs', run.id).snapshot.worker.effort).toBe('max');
    expect(store.get<Task>('tasks', task.id).id).toBe(task.id);
  });
  it('distinguishes proposal null from automatic reset and does not inherit proposer effort', async () => {
    const selectedWorker = await worker({ effort: 'max' });
    const { task, run } = fixture(selectedWorker);
    const unchanged = core.appProposals.record(run, task, 'propose_orglet', { targetId: selectedWorker.id, description: 'Updated', effort: null });
    core.appProposals.apply(unchanged.proposalId);
    expect(store.get<Worker>('workers', selectedWorker.id).effort).toBe('max');
    const reset = core.appProposals.record(run, task, 'propose_orglet', { targetId: selectedWorker.id, effort: 'auto' });
    expect(core.appProposals.get(reset.proposalId).changes).toContainEqual({ field: 'effort', before: 'max', after: 'auto' });
    core.appProposals.apply(reset.proposalId);
    expect(store.get<Worker>('workers', selectedWorker.id).effort).toBeUndefined();
    const create = core.appProposals.record(run, task, 'propose_orglet', { name: 'New', instructions: 'Review', effort: null });
    const result = core.appProposals.apply(create.proposalId);
    expect(store.get<Worker>('workers', result.target!.id).effort).toBeUndefined();
  });
  it('passes API resolution once and preserves a frozen unknown across cache refresh', async () => {
    const selectedWorker = await worker({ effort: 'max' });
    const { task, run } = fixture(selectedWorker);
    await core.runner.run(task, run);
    expect(dispatchedRequests[0]).toEqual({ model: 'gpt-5.4', effort: { transport: 'reasoning_effort', level: 'xhigh' } });
    const other = fixture(await worker({ provider: 'codex', modelId: undefined, effort: 'max' }));
    const requests = useHarness();
    other.run.snapshot.effort = { requested: 'max', origin: 'explicit', support: 'unknown' };
    store.update('runs', other.run);
    cache();
    await core.runner.run(other.task, other.run);
    expect(requests[0].model).toBeUndefined();
    expect(requests[0].effort).toBeUndefined();
  });
  it('freezes an executable harness alias and preserves it on resume after native metadata changes', async () => {
    const requests = useHarness();
    const selectedWorker = await worker({ provider: 'codex', modelId: 'sol', effort: 'max' });
    store.setSetting(MODEL_LISTS_SETTING, { version: MODEL_LIST_CACHE_VERSION, byProvider: { codex: { fetchedAt: now(), source: 'native', models: [{ provider: 'codex', id: 'sol', resolvedId: 'gpt-6-sol', source: 'native', effort: { levels: ['low', 'medium', 'high', 'ultra'] } }] } } });
    const { task, run } = fixture(selectedWorker);
    await core.runner.run(task, run);
    const frozen = store.get<Run>('runs', run.id);
    expect(requests[0]).toMatchObject({ model: 'gpt-6-sol', effort: { transport: 'codex', level: 'ultra' } });
    cache('gpt-future', ['low']);
    store.db.prepare('DELETE FROM checkpoints WHERE id=?').run(run.id);
    frozen.status = 'paused';
    store.update('runs', frozen);
    await core.runner.run(task, frozen);
    expect(requests[1]).toMatchObject({ model: 'gpt-6-sol', effort: { transport: 'codex', level: 'ultra' } });
  });
  it('omits effort and model selection for a legacy resumed harness checkpoint', async () => {
    const requests = useHarness();
    const selectedWorker = await worker({ provider: 'codex', modelId: undefined, effort: 'max' });
    const { task, run } = fixture(selectedWorker);
    new Checkpoints(store).save({ id: run.id, phase: 'ready', step: 1, messages: [{ role: 'system', content: 'Original legacy policy' }, { role: 'user', content: 'Original legacy request' }], readIds: [] });
    cache();
    await core.runner.run(task, run);
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBeUndefined();
    expect(requests[0].effort).toBeUndefined();
    expect(store.get<Run>('runs', run.id).snapshot.effort).toEqual({ requested: 'max', origin: 'explicit', support: 'unknown' });
  });
  it('keeps restricted harness flags and writes only the private Gemini generation override', async () => {
    const base = { cwd: directory, schema: { type: 'object' }, maxBudgetUsd: .1 };
    const args = harnessArgs({ harness: 'codex', ...base, effort: { transport: 'codex', level: 'ultra' } });
    expect(args).toContain('model_reasoning_effort=ultra');
    expect(args).toContain('read-only');
    expect(harnessArgs({ harness: 'cursor', ...base, effort: { transport: 'codex', level: 'ultra' } })).not.toContain('model_reasoning_effort=ultra');
    expect(harnessArgs({ harness: 'claude-code', ...base, effort: { transport: 'claude-code', level: 'max' } })).toEqual(expect.arrayContaining(['--effort', 'max', '--restricted', '--safe-mode']));
    await prepareHarnessToolPolicy({ harness: 'gemini', cwd: directory, model: 'gemini-3-flash-preview', effort: { transport: 'gemini', level: 'medium' } });
    const settings = JSON.parse(await readFile(join(directory, '.gemini', 'settings.json'), 'utf8'));
    expect(settings.tools.core).toEqual([]);
    expect(settings.skills.enabled).toBe(false);
    expect(settings.modelConfigs.overrides[0]).toMatchObject({ match: { model: 'gemini-3-flash-preview' }, modelConfig: { generateContentConfig: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } } });
  });
});

it('keeps adaptive no-tool recovery bounded without forcing tool choice', async () => {
  let requests = 0;
  const efforts: (NativeEffortSetting | undefined)[] = [];
  core = new CoreService(store, () => {}, async (_provider, _model, effort) => {
    efforts.push(effort);
    return { async request() {
      requests++;
      return { calls: [], notes: 'Need another step.', usage: { input: 10, output: 10 } };
    } };
  });
  const selectedWorker = await worker({ provider: 'anthropic', modelId: 'claude-sonnet-5-5', effort: 'medium' });
  const { task, run } = fixture(selectedWorker);
  await core.runner.run(task, run);
  expect(requests).toBe(2);
  expect(efforts).toEqual([{ transport: 'anthropic', level: 'medium', adaptive: true }]);
  expect(store.get<Run>('runs', run.id).status).toBe('failed');
});

it('passes the same frozen effort through the tool-loop harness route', async () => {
  const requests = useHarness();
  cache();
  const selectedWorker = await worker({ provider: 'codex', modelId: 'gpt-6-sol', effort: 'low' });
  const { task, run } = fixture(selectedWorker);
  task.toolCapabilities = ['source.read', 'skill.read', 'network.web'];
  store.update('tasks', task);
  run.snapshot.toolCapabilities = task.toolCapabilities;
  store.update('runs', run);
  await core.runner.run(task, run);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ coreToolsOnly: true, effort: { transport: 'codex', level: 'low' } });
  expect(store.get<Run>('runs', run.id).status).toBe('completed');
});

it('resolves a scheduled lead plan at medium and routine approval tracks effort revisions', async () => {
  const selectedWorker = await worker();
  const { run } = fixture(selectedWorker, 'plan');
  expect(resolveWorkerEffort(run, { version: MODEL_LIST_CACHE_VERSION, byProvider: {} }, true)).toMatchObject({ requested: 'medium', native: { level: 'medium' } });
  const routine = await core.command('saveRoutine', { name: 'Daily', enabled: true, schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC', weekday: 1 }, task: { workerId: selectedWorker.id, sourceIds: [], brief: 'Check', consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 } }) as import('../../apps/desktop/src/shared/contracts').Routine;
  await worker({ effort: 'low' });
  expect(core.routines.configuration(routine.task)).not.toBe(routine.approvedConfig);
});

it('refreshes a newly saved Ollama selection before freezing despite a fresh tags cache', async () => {
  const hits: string[] = [];
  core = new CoreService(store, () => {}, async (_provider, model, effort) => {
    dispatchedRequests.push({ model, effort });
    return { async request() {
      return { calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Fixture.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } };
    } };
  }, undefined, undefined, undefined, undefined, {
    readKey: async () => 'ollama-local', fetch: async input => {
      const path = new URL(String(input)).pathname;
      hits.push(path);
      return new Response(JSON.stringify(path === '/api/tags' ? { models: [{ name: 'held:latest' }, { name: 'unselected:latest' }] } : { thinking: { values: ['low', 'high', 'ultra'] } }));
    },
  });
  store.setSetting(MODEL_LISTS_SETTING, { version: MODEL_LIST_CACHE_VERSION, byProvider: { ollama: { fetchedAt: now(), source: 'native', models: [{ provider: 'ollama', id: 'held:latest', source: 'native' }, { provider: 'ollama', id: 'unselected:latest', source: 'native' }] } } });
  const selectedWorker = await worker({ provider: 'ollama', modelId: 'held:latest', effort: 'max' });
  const { task, run } = fixture(selectedWorker);
  await core.runner.run(task, run);
  expect(hits).toEqual(['/api/tags', '/api/show']);
  expect(dispatchedRequests[0]).toEqual({ model: 'held:latest', effort: { transport: 'ollama', level: 'ultra' } });
  expect(store.get<Run>('runs', run.id).status).toBe('completed');
});

it('upgrades a fresh pre-effort Codex list before the first dispatch and keeps other connection prices', async () => {
  const requests: HarnessRequest[] = [];
  let lists = 0;
  core = new CoreService(store, () => {}, async () => {
    throw Error('No API');
  }, undefined, undefined, { detect: async () => [{ ...missingHarness('codex', 'win32'), executable: 'fixture.exe', version: 'fixture', auth: 'logged_in', status: 'signed_in' }], execute: async request => {
    requests.push(request);
    return { output: { payload: JSON.stringify({ message: 'Fixture.', title: null, report: null }) }, costUsd: null };
  } }, undefined, { appServer: async () => {
    lists++;
    return [{ data: [{ id: 'gpt-6-sol', model: 'gpt-6-sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'ultra' }] }] }];
  } });
  store.setSetting(MODEL_LISTS_SETTING, { version: 2, byProvider: { codex: { fetchedAt: now(), source: 'native', models: [{ provider: 'codex', id: 'gpt-6-sol', source: 'native', isDefault: true }] }, openrouter: { fetchedAt: now(), source: 'native', models: [{ provider: 'openrouter', id: 'vendor/model', source: 'native', inputTenths: 10, outputTenths: 20 }] } } });
  const selectedWorker = await worker({ provider: 'codex', modelId: undefined, effort: 'max' });
  const { task, run } = fixture(selectedWorker);
  await core.runner.run(task, run);
  expect(lists).toBe(1);
  expect(requests[0]).toMatchObject({ model: 'gpt-6-sol', effort: { transport: 'codex', level: 'ultra' } });
  expect(resolveWorkerModel({ provider: 'openrouter', modelId: 'vendor/model' }, readModelListCache(store)).rates).toMatchObject({ inputTenths: 10, outputTenths: 20 });
});

it('preserves migrated OpenRouter rates on failed metadata refresh and omits unverified effort', async () => {
  let hits = 0;
  core = new CoreService(store, () => {}, async (_provider, model, effort) => {
    dispatchedRequests.push({ model, effort });
    return { async request() {
      return { calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Fixture.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 10 } };
    } };
  }, undefined, undefined, undefined, undefined, { readKey: async () => null, fetch: async () => {
    hits++;
    throw Error('No network');
  } });
  store.setSetting(MODEL_LISTS_SETTING, { version: 2, byProvider: { openrouter: { fetchedAt: now(), source: 'native', models: [{ provider: 'openrouter', id: 'vendor/model', source: 'native', inputTenths: 10, outputTenths: 20 }] } } });
  const selectedWorker = await worker({ provider: 'openrouter', modelId: 'vendor/model', effort: 'max' });
  const { task, run } = fixture(selectedWorker);
  await core.runner.run(task, run);
  expect(hits).toBe(0);
  expect(dispatchedRequests[0].effort).toBeUndefined();
  expect(store.get<Run>('runs', run.id).snapshot.effort?.support).toBe('unknown');
  expect(resolveWorkerModel(selectedWorker, readModelListCache(store)).rates).toMatchObject({ inputTenths: 10, outputTenths: 20 });
  expect(store.get<Run>('runs', run.id).status).toBe('completed');
});

it('does not refresh migrated metadata or change rates for a legacy resumed request', async () => {
  let preparation = 0;
  core.runner.prepareEffort = async () => {
    preparation++;
    throw Error('Must not refresh');
  };
  store.setSetting(MODEL_LISTS_SETTING, { version: 2, byProvider: { openrouter: { fetchedAt: now(), source: 'native', models: [{ provider: 'openrouter', id: 'vendor/model', source: 'native', inputTenths: 10, outputTenths: 20 }] } } });
  const selectedWorker = await worker({ provider: 'openrouter', modelId: 'vendor/model', effort: 'max' });
  const { task, run } = fixture(selectedWorker);
  run.snapshot.model = 'vendor/model';
  run.snapshot.pricingVersion = 'vendor/model:1.00:2.00';
  store.update('runs', run);
  new Checkpoints(store).save({ id: run.id, phase: 'ready', step: 1, messages: [{ role: 'user', content: 'Continue legacy' }], readIds: [] });
  await core.runner.run(task, run);
  expect(preparation).toBe(0);
  expect(dispatchedRequests[0]).toEqual({ model: 'vendor/model', effort: undefined });
  expect(store.get<Run>('runs', run.id).snapshot.pricingVersion).toBe(run.snapshot.pricingVersion);
  expect(resolveWorkerModel(selectedWorker, readModelListCache(store)).rates).toMatchObject({ inputTenths: 10, outputTenths: 20 });
});
