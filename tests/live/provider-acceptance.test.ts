import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { OpenAIAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

/**
 * Live provider acceptance (OpenAI or xAI). Gated on ORGLET_LIVE_KEY_FILE.
 * Cap: $0.05 (50_000 micros). Anthropic is not authorized here.
 *
 *   $env:ORGLET_LIVE_KEY_FILE = 'C:\path\to\key.txt'
 *   $env:ORGLET_LIVE_PROVIDER = 'openai'   # or 'xai'
 *   pnpm test:live
 */
const keyFile = process.env.ORGLET_LIVE_KEY_FILE;
const provider = (process.env.ORGLET_LIVE_PROVIDER ?? 'openai') as 'openai' | 'xai';
const BUDGET_MICROS = 50_000;
const authorized = Boolean(keyFile) && (provider === 'openai' || provider === 'xai');

describe('live provider acceptance', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;

  beforeEach(async () => {
    if (!authorized) return;
    directory = await mkdtemp(join(tmpdir(), 'orglet-live-'));
    const key = (await readFile(keyFile!, 'utf8')).trim();
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.includes('\n')).toBe(false);
    store = new Store(join(directory, 'orglet.sqlite'));
    core = new CoreService(store, () => {}, async (id, model) => {
      expect(id).toBe(provider);
      if (provider === 'xai') return new OpenAIAdapter(key, { baseURL: 'https://api.x.ai/v1', provider: 'xai', model });
      return new OpenAIAdapter(key, { model });
    });
  });

  afterEach(async () => {
    if (!authorized) return;
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.runIf(authorized)('completes one capped review against the real provider', async () => {
    const note = join(directory, 'note.txt');
    await writeFile(note, 'line one\nline two: the answer is 42\nline three: ignore this\n');
    const sources = await core.sources.import([note]);
    const worker = await core.command('saveWorker', {
      ...store.workspace().workers[0],
      name: 'Live acceptance',
      provider,
      taskBudgetMicros: BUDGET_MICROS,
    }) as Worker;
    const taskId = await core.command('createTask', {
      workerId: worker.id,
      brief: 'Read the note and report what line two says is the answer. Cite the source line.',
      sourceIds: sources.map(source => source.id),
      consent: true,
      providerScopes: [provider],
      budgetMicros: BUDGET_MICROS,
    }) as string;

    for (let i = 0; i < 600 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const detail = store.detail(taskId);
    expect(['completed', 'waiting_input', 'partial']).toContain(detail.task.status);
    expect(detail.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(detail.usage.chargedMicros).toBeLessThanOrEqual(BUDGET_MICROS);
  }, 5 * 60_000);

  it.runIf(!authorized)('documents how to authorize a live run without searching for keys', () => {
    expect(keyFile).toBeFalsy();
  });
});
