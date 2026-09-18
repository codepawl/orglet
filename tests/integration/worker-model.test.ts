import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { resolveWorkerModel } from '../../apps/desktop/src/core/models/resolve';
import { modelCatalog } from '../../apps/desktop/src/core/adapters/catalog';
import { CATALOG_HINT_IDS, MODEL_LIST_CACHE_VERSION, MODEL_LISTS_SETTING } from '../../apps/desktop/src/shared/models';
import { harnessArgs } from '../../apps/desktop/src/core/harness/exec';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Run, Worker, Skill, Routine, Team } from '../../apps/desktop/src/shared/contracts';

let directory: string; let store: Store; let core: CoreService;
let requested: { provider?: string; model?: string }; let replies: ModelReply[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-worker-model-'));
  store = new Store(join(directory, 'test.sqlite'));
  requested = {}; replies = [];
  core = new CoreService(store, () => {}, async (provider, model) => {
    requested = { provider, model };
    return { async request() { const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply; } };
  });
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

function fixtureRun(worker: Worker): { task: Task; run: Run } {
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Review', status: 'running', budgetMicros: 100_000, sourceIds: [], consent: true, providerScopes: [worker.provider as 'openai'], accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'running', error: null, startedAt: now() };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}
const call = (name: string, args: unknown, usage: ModelReply['usage'] = { input: 500, output: 100 }): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(args) }], usage });
const report = { title: 'Review', summary: 'Text reviewed.', findings: [], limitations: ['No code executed.'] };

describe('worker model preference', () => {
  it('saves a typed custom ID even when the fetched list is empty', async () => {
    const worker = store.all<Worker>('workers')[0];
    const saved = await core.command('saveWorker', { ...worker, provider: 'openai', modelId: 'gpt-5-custom' }) as Worker;
    expect(saved.modelId).toBe('gpt-5-custom');
    expect(store.get<Worker>('workers', saved.id).modelId).toBe('gpt-5-custom');
  });

  it('omits modelId for Demo and when the field is cleared', async () => {
    const worker = store.all<Worker>('workers')[0];
    const withId = await core.command('saveWorker', { ...worker, provider: 'openai', modelId: 'gpt-4o' }) as Worker;
    expect(withId.modelId).toBe('gpt-4o');
    const demo = await core.command('saveWorker', { ...withId, provider: 'demo', modelId: 'should-drop' }) as Worker;
    expect(demo.modelId).toBeUndefined();
    const { modelId: _ignored, ...withoutId } = withId;
    const cleared = await core.command('saveWorker', { ...withoutId, provider: 'openai' }) as Worker;
    expect(cleared.modelId).toBeUndefined();
  });

  it('rejects an empty or oversized modelId', async () => {
    const worker = store.all<Worker>('workers')[0];
    await expect(core.command('saveWorker', { ...worker, provider: 'openai', modelId: '   ' })).rejects.toThrow();
    await expect(core.command('saveWorker', { ...worker, provider: 'openai', modelId: 'x'.repeat(201) })).rejects.toThrow();
  });

  it('dispatches the selected ID and keeps catalog prices only for the pinned suggestion', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    replies.push(call('submit_report', report));
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    expect(requested).toEqual({ provider: 'openai', model: CATALOG_HINT_IDS.openai });
    expect(store.detail(task.id).runs[0].snapshot.model).toBe(CATALOG_HINT_IDS.openai);
    expect(store.detail(task.id).runs[0].snapshot.pricingVersion).toBe(modelCatalog.openai.pricingVersion);
    expect(store.detail(task.id).usage.chargedMicros).toBeGreaterThan(0);
    expect(store.detail(task.id).usage.uncertainCount).toBe(0);
  });

  it('does not bill a custom OpenAI ID at mini rates', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai', modelId: 'gpt-5-nano' }) as Worker;
    replies.push(call('submit_report', report));
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    expect(requested).toEqual({ provider: 'openai', model: 'gpt-5-nano' });
    expect(store.detail(task.id).runs[0].snapshot.model).toBe('gpt-5-nano');
    expect(store.detail(task.id).runs[0].snapshot.pricingVersion).toBe('unknown:gpt-5-nano');
    expect(store.detail(task.id).usage.uncertainCount).toBe(1);
    expect(store.detail(task.id).usage.reservedMicros).toBeGreaterThan(0);
    expect(store.detail(task.id).usage.chargedMicros).toBe(0);
  });

  it('settles an OpenRouter ID using native tenths from the cached list', async () => {
    store.setSetting(MODEL_LISTS_SETTING, {
      version: MODEL_LIST_CACHE_VERSION,
      byProvider: {
        openrouter: {
          fetchedAt: new Date().toISOString(),
          source: 'native',
          models: [{ provider: 'openrouter', id: 'anthropic/claude-sonnet-4', source: 'native', inputTenths: 10, outputTenths: 20 }],
        },
      },
    });
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4' }) as Worker;
    replies.push(call('submit_report', report, { input: 500, output: 100 }));
    const { task, run } = fixtureRun({ ...worker });
    task.providerScopes = ['openrouter']; store.put('tasks', task);
    run.snapshot.worker = worker; store.put('runs', run, { column: 'task_id', value: task.id });
    await core.runner.run(task, run);
    expect(requested).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4' });
    expect(store.detail(task.id).usage.chargedMicros).toBe(700);
    expect(store.detail(task.id).usage.uncertainCount).toBe(0);
  });

  it('does not reserve Orglet budget for a local Ollama run', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'ollama', modelId: 'llama3.2' }) as Worker;
    replies.push(call('submit_report', report, { input: 500, output: 100 }));
    const { task, run } = fixtureRun({ ...worker });
    task.providerScopes = ['ollama']; store.put('tasks', task);
    run.snapshot.worker = worker; store.put('runs', run, { column: 'task_id', value: task.id });
    await core.runner.run(task, run);
    expect(requested).toEqual({ provider: 'ollama', model: 'llama3.2' });
    expect(store.detail(task.id).runs[0].snapshot.pricingVersion).toBe('ollama:llama3.2');
    expect(store.detail(task.id).usage.chargedMicros).toBe(0);
    expect(store.detail(task.id).usage.reservedMicros).toBe(0);
    expect(store.detail(task.id).usage.uncertainCount).toBe(0);
    expect(store.detail(task.id).task.status).toBe('completed');
  });

  it('settles an xAI ID using native tenths from the cached list', async () => {
    store.setSetting(MODEL_LISTS_SETTING, {
      version: MODEL_LIST_CACHE_VERSION,
      byProvider: {
        xai: {
          fetchedAt: new Date().toISOString(),
          source: 'native',
          models: [{ provider: 'xai', id: 'grok-4', source: 'native', inputTenths: 10, outputTenths: 20 }],
        },
      },
    });
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'xai', modelId: 'grok-4' }) as Worker;
    replies.push(call('submit_report', report, { input: 500, output: 100 }));
    const { task, run } = fixtureRun({ ...worker });
    task.providerScopes = ['xai']; store.put('tasks', task);
    run.snapshot.worker = worker; store.put('runs', run, { column: 'task_id', value: task.id });
    await core.runner.run(task, run);
    expect(requested).toEqual({ provider: 'xai', model: 'grok-4' });
    expect(store.detail(task.id).usage.chargedMicros).toBe(700);
    expect(store.detail(task.id).usage.uncertainCount).toBe(0);
  });

  it('keeps a frozen catalog snapshot when the worker has no modelId', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const { task, run } = fixtureRun(worker);
    run.snapshot.model = 'old-mini';
    run.snapshot.pricingVersion = 'old-mini:0.10:0.20';
    store.put('runs', run, { column: 'task_id', value: task.id });
    await core.runner.run(task, run);
    expect(requested.model).toBeUndefined();
    expect(store.detail(task.id).runs[0].error).toContain('bảng giá đã đổi');
  });

  it('does not retarget a worker that already has its own modelId when the catalog moves', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai', modelId: 'gpt-4o' }) as Worker;
    replies.push(call('submit_report', report));
    const { task, run } = fixtureRun(worker);
    run.snapshot.model = 'gpt-4o';
    run.snapshot.pricingVersion = 'unknown:gpt-4o';
    store.put('runs', run, { column: 'task_id', value: task.id });
    const original = modelCatalog.openai.pricingVersion;
    try {
      Object.assign(modelCatalog.openai, { pricingVersion: 'fixture-new-pricing' });
      await core.runner.run(task, run);
      expect(requested).toEqual({ provider: 'openai', model: 'gpt-4o' });
      expect(store.detail(task.id).task.status).toBe('completed');
    } finally { Object.assign(modelCatalog.openai, { pricingVersion: original }); }
  });

  it('includes modelId in the routine approval fingerprint and ignores a later catalog bump', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai', modelId: 'gpt-4o' }) as Worker;
    const routine = await core.command('saveRoutine', {
      name: 'Nightly', enabled: true, schedule: { frequency: 'daily', time: '09:00', timeZone: 'UTC', weekday: 1 },
      task: { workerId: worker.id, sourceIds: [], brief: 'Check', consent: true, providerScopes: ['openai'], budgetMicros: 1000 },
    }) as Routine;
    const original = modelCatalog.openai.pricingVersion;
    try {
      Object.assign(modelCatalog.openai, { pricingVersion: 'fixture-new-pricing' });
      expect(core.routines.configuration(routine.task)).toBe(routine.approvedConfig);
    } finally { Object.assign(modelCatalog.openai, { pricingVersion: original }); }
    await core.command('saveWorker', { ...worker, modelId: 'gpt-4.1' });
    expect(core.routines.configuration(routine.task)).not.toBe(routine.approvedConfig);
  });

  it('passes --model / -m only when a harness worker has a modelId', () => {
    const base = { cwd: directory, schema: { type: 'object' }, maxBudgetUsd: 0.25 };
    expect(harnessArgs({ harness: 'claude-code', ...base })).not.toContain('--model');
    expect(harnessArgs({ harness: 'claude-code', ...base, model: 'sonnet' })).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(harnessArgs({ harness: 'codex', ...base, model: 'gpt-5' })).toEqual(expect.arrayContaining(['-m', 'gpt-5']));
    expect(harnessArgs({ harness: 'cursor', ...base, model: 'composer-2' })).toEqual(expect.arrayContaining(['--model', 'composer-2']));
  });

  it('roundtrips modelId through a team template', async () => {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai', modelId: 'gpt-4.1-mini-2025-04-14' }) as Worker;
    const team = await core.command('saveTeam', {
      name: 'Review', instructions: 'Review.', memberIds: [worker.id], synthesizerId: worker.id, workflow: 'sequential', monthlyBudgetMicros: 5_000_000,
    }) as Team;
    const text = core.templates.export(team.id);
    expect(JSON.parse(text).workers[0].modelId).toBe('gpt-4.1-mini-2025-04-14');
    const imported = core.templates.import(text);
    expect(store.get<Worker>('workers', imported.synthesizerId).modelId).toBe('gpt-4.1-mini-2025-04-14');
  });
});

describe('resolveWorkerModel', () => {
  it('treats a missing modelId as the catalog suggestion', () => {
    expect(resolveWorkerModel({ provider: 'openai' }).id).toBe(CATALOG_HINT_IDS.openai);
    expect(resolveWorkerModel({ provider: 'openai' }).rates?.pricingVersion).toBe(modelCatalog.openai.pricingVersion);
    expect(resolveWorkerModel({ provider: 'claude-code' }).id).toBeUndefined();
    expect(resolveWorkerModel({ provider: 'claude-code', modelId: 'opus' }).id).toBe('opus');
    expect(resolveWorkerModel({ provider: 'openai', modelId: 'gpt-4o' }).rates).toBeUndefined();
    expect(resolveWorkerModel({ provider: 'ollama' })).toEqual({ id: CATALOG_HINT_IDS.ollama, pricingVersion: 'ollama' });
    expect(resolveWorkerModel({ provider: 'openrouter' }).id).toBe(CATALOG_HINT_IDS.openrouter);
    expect(resolveWorkerModel({ provider: 'openrouter' }).rates?.pricingVersion).toBe(modelCatalog.openrouter.pricingVersion);
  });
});
