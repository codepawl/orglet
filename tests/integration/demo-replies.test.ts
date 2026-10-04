import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Run, Worker } from '../../apps/desktop/src/shared/contracts';
import { DEMO_REPLIES_VARIABLE, demoRepliesEnabled, MODEL_NOT_CONNECTED } from '../../apps/desktop/src/shared/demo-replies';

/*
 * Sample replies are a test tool (owner, 2026-10-05). An orglet whose provider is `demo` has no model: in an app a
 * person runs it does not answer, and the workspace tells the window so. The suite itself runs with them on.
 */

describe('sample replies', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let scout: Worker;
  const message = { sourceIds: [], consent: true, providerScopes: [], budgetMicros: 500_000 };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-demo-replies-'));
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => { throw new Error('An orglet with no model never calls one.'); });
    scout = store.workspace().workers[0];
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function settled(taskId: string) {
    for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  }
  const runsOf = (taskId: string) => store.all<Run>('runs').filter(run => run.taskId === taskId);

  it('are on only where the variable says so', () => {
    expect(demoRepliesEnabled({})).toBe(false);
    expect(demoRepliesEnabled({ [DEMO_REPLIES_VARIABLE]: '0' })).toBe(false);
    expect(demoRepliesEnabled({ [DEMO_REPLIES_VARIABLE]: '1' })).toBe(true);
    // The suite runs with them on, which is what lets every other test chat without a key.
    expect(demoRepliesEnabled()).toBe(true);
    expect(store.workspace().demoReplies).toBe(true);
  });

  it('answer for an orglet with no model while they are on', async () => {
    expect(scout.provider).toBe('demo');
    const taskId = await core.command('createTask', { workerId: scout.id, brief: 'Say hello', ...message }) as string;
    await settled(taskId);
    expect(runsOf(taskId).map(run => run.status)).toEqual(['completed']);
  });

  it('do not answer in an app a person runs: the run fails and says to connect a model', async () => {
    vi.stubEnv(DEMO_REPLIES_VARIABLE, '');
    expect(store.workspace().demoReplies).toBe(false);
    const taskId = await core.command('createTask', { workerId: scout.id, brief: 'Say hello', ...message }) as string;
    await settled(taskId);
    const runs = runsOf(taskId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toContain(MODEL_NOT_CONNECTED);
  });
});
