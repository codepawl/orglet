import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Checkpoints } from '../../apps/desktop/src/core/storage/checkpoints';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { CoreService } from '../../apps/desktop/src/core/service';
import { WebTools } from '../../apps/desktop/src/core/tools/web-tools';
import type { WebNetwork } from '../../apps/desktop/src/core/tools/web-network';
import { RESEARCH_STEP_LIMIT } from '../../apps/desktop/src/core/orchestration/runner';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Team } from '../../apps/desktop/src/shared/contracts';
import { canContinueRun } from '../../apps/desktop/src/shared/out-of-steps';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';

/*
 * COD-257, found dogfooding a crew asked to look up three competitors' prices: the researcher made one search and
 * thirteen page reads and was still reading when its 16 steps told it to hand in. Research now gets 24 steps, and an
 * answer handed in because the steps ran out offers Continue, whose run starts from the calls and results already made
 * instead of reading the same pages again.
 */

const CONTINUE_BRIEF = 'Continue from where you stopped.';

let directory: string;
let store: Store;
let core: CoreService;
let requests: ChatCompletionMessageParam[][];
/** How many pages the fixture model wants to read before it answers, when it is not told to hand in first. */
let pagesWanted: number;

const toolResults = (messages: ChatCompletionMessageParam[]) => messages.filter(message => message.role === 'tool');
const wrappingUp = (messages: ChatCompletionMessageParam[]) => messages.some(message => message.role === 'user' && String(message.content).includes('almost out of steps'));

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-out-of-steps-'));
  store = new Store(join(directory, 'state.sqlite'));
  requests = [];
  pagesWanted = 30;
  const network: WebNetwork = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<title>Pricing</title><p>Pro $14/month.</p>') }),
  };
  const page = await new WebTools(network).read({ url: 'https://invoiceninja.com/pricing-plans/' }, new AbortController().signal);
  vi.spyOn(WebTools.prototype, 'read').mockResolvedValue(page);
  let calls = 0;
  const adapter: ModelAdapter = { async request(messages) {
    calls++;
    // A copy: the runner keeps adding to the same list step after step.
    requests.push([...messages]);
    // A researcher reads page after page until it has what it wants or is told to hand in, counting the pages it
    // already has in this request, carried ones included.
    if (!wrappingUp(messages) && toolResults(messages).length < pagesWanted) {
      return { calls: [{ id: `read-${calls}`, name: 'web_read_url', arguments: '{"url":"https://invoiceninja.com/pricing-plans/"}' }], usage: { input: 50, output: 20 } };
    }
    return { calls: [{ id: `answer-${calls}`, name: 'reply', arguments: JSON.stringify({ message: `Read ${toolResults(messages).length} pages.` }) }], usage: { input: 50, output: 20 } };
  } };
  core = new CoreService(store, () => {}, async () => adapter);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function settled(taskId: string) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const status = store.detail(taskId).task.status;
    if (!core.runner.isActive(taskId) && !['queued', 'running', 'pausing'].includes(status)) return store.detail(taskId);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The chat did not settle');
}

/** A solo chat with an orglet on an API connection that may use the web. */
async function startResearch(brief: string) {
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.memberIds[0], brief, sourceIds: [], consent: true, providerScopes: ['openai'],
    budgetMicros: 20_000_000, toolCapabilities: ['network.web'] }) as string;
  return { taskId, detail: await settled(taskId) };
}

function followUp(taskId: string, brief: string, continueFrom?: string) {
  const detail = store.detail(taskId);
  return core.command('reviseTask', { taskId, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: detail.task.budgetMicros,
    ...(continueFrom ? { continueFrom } : {}) });
}

function thread(taskId: string) {
  const workspace = store.workspace();
  return renderToStaticMarkup(createElement(TaskThread, {
    detail: store.detail(taskId), workspace: { workers: workspace.workers, skills: workspace.skills, tasks: workspace.tasks }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

it('gives web research 24 steps and hands in its best answer when they run out', async () => {
  const { detail } = await startResearch('Look up 3 competitors and their prices.');
  const run = detail.runs[0];
  expect(RESEARCH_STEP_LIMIT).toBe(24);
  // Two steps before the limit the orglet is told to hand in, so it read 22 pages, not the 14 that 16 steps allowed.
  expect(toolResults(requests.at(-1)!)).toHaveLength(RESEARCH_STEP_LIMIT - 2);
  expect(run.status).toBe('completed');
  expect(run.outOfSteps).toBe(true);
  expect(canContinueRun(run)).toBe(true);
  expect(detail.task.status).toBe('completed');
  expect(detail.artifacts[0].report.summary).toBe('Read 22 pages.');
  // The answer says it was cut short and offers Continue.
  const html = thread(detail.task.id);
  expect(html).toContain('Ran out of steps before finishing; this is what it got done.');
  expect(html).toContain('>Continue</button>');
});

it('continues from the calls and results the cut-short run already made', async () => {
  const { taskId, detail } = await startResearch('Look up 3 competitors and their prices.');
  const cutShort = detail.runs[0];
  expect(new Checkpoints(store).get(cutShort.id)?.phase).toBe('done');
  pagesWanted = 25;
  requests = [];
  await followUp(taskId, CONTINUE_BRIEF, cutShort.id);
  const after = await settled(taskId);
  const continued = after.runs.find(run => run.id !== cutShort.id)!;
  expect(continued.snapshot.input?.continueFrom).toBe(cutShort.id);
  // The first request already carries the 22 pages, after the instruction that says what they are.
  const first = requests[0];
  expect(toolResults(first)).toHaveLength(22);
  expect(first.some(message => message.role === 'user' && String(message.content).includes('ran out of steps before finishing, and the person asked you to continue'))).toBe(true);
  // The wrap-up the earlier run was given is not carried over.
  expect(wrappingUp(first)).toBe(false);
  // So the orglet read only the three pages it still wanted, and finished on its own this time.
  expect(requests).toHaveLength(4);
  expect(continued.status).toBe('completed');
  expect(continued.outOfSteps).toBeUndefined();
  expect(after.artifacts.find(artifact => artifact.runId === continued.id)?.report.summary).toBe('Read 25 pages.');
  expect(after.events.some(event => event.runId === continued.id && event.message === 'Tiếp tục từ 22 bước của lượt trước.')).toBe(true);
  // The cut-short run keeps what it carried until a newer turn starts; the finished one keeps nothing.
  expect(new Checkpoints(store).get(continued.id)).toBeUndefined();
  // A backup keeps both marks, and never the kept conversation.
  const backups = new Backups(store, () => false, () => {});
  const backup = backups.export();
  expect(backups.preview(backup).tasks).toBeGreaterThan(0);
  expect(backup).toContain('"outOfSteps":true');
  expect(backup).toContain(`"continueFrom":"${cutShort.id}"`);
  expect(backup).not.toContain('ran out of steps before finishing, and the person asked you to continue');
  pagesWanted = 0;
  await followUp(taskId, 'Thanks, one more question.');
  await settled(taskId);
  expect(new Checkpoints(store).get(cutShort.id)).toBeUndefined();
  expect(thread(taskId)).not.toContain('>Continue</button>');
  // An older turn cannot be continued any more.
  await expect(followUp(taskId, CONTINUE_BRIEF, cutShort.id)).rejects.toThrow('Lượt này không tiếp tục được nữa.');
});

it('refuses Continue for a run that is not the latest turn or did not run out of steps', async () => {
  pagesWanted = 1;
  const { taskId, detail } = await startResearch('Read one pricing page.');
  const finished = detail.runs[0];
  expect(finished.outOfSteps).toBeUndefined();
  expect(new Checkpoints(store).get(finished.id)).toBeUndefined();
  await expect(followUp(taskId, CONTINUE_BRIEF, finished.id)).rejects.toThrow('Lượt này không tiếp tục được nữa.');
  expect(thread(taskId)).not.toContain('Ran out of steps');
});
