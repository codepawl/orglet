import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { OpenCodeAdapter } from '../../apps/desktop/src/core/adapters/opencode';
import { MODEL_LIST_ENDPOINTS, parseOpenCodeModels } from '../../apps/desktop/src/core/models/fetch';
import { resolveWorkerModel } from '../../apps/desktop/src/core/models/resolve';
import { isPaidApi, isPlanApi, type Run, type Skill, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';
import { snapshotCapabilities, supportedCapabilities } from '../../apps/desktop/src/shared/tool-policy';
import { OPENCODE_BASE_URLS, openCodeSupport, type OpenCodePlan } from '../../apps/desktop/src/shared/opencode';
import type { ModelListResult } from '../../apps/desktop/src/shared/models';

// Obviously fake keys; no live OpenCode call is made anywhere in this file.
const FAKE_KEYS: Record<OpenCodePlan, string> = {
  'opencode-zen': 'fixture-zen-not-a-real-key',
  'opencode-go': 'fixture-go-not-a-real-key',
};
// A chat/completions model in each plan's docs table.
const CHAT_MODEL: Record<OpenCodePlan, string> = { 'opencode-zen': 'glm-5.3', 'opencode-go': 'kimi-k3' };

type Step =
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'status'; status: number; message: string }
  | { kind: 'hang' };
type Received = { url: string; authorization?: string; body: Record<string, unknown> };

/** A stand-in for one OpenCode plan: `/models` and a streamed chat/completions endpoint driven by a script. */
async function fakeOpenCode(models: string[]) {
  const steps: Step[] = [];
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void answer(request, response);
  });
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    received.push({ url: request.url ?? '', authorization: request.headers.authorization, body: text ? JSON.parse(text) : {} });
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: models.map(model => ({ id: model, object: 'model', owned_by: 'opencode' })) }));
      return;
    }
    const step = steps.shift() ?? { kind: 'status', status: 500, message: 'Fixture exhausted' };
    if (step.kind === 'hang') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return;
    }
    if (step.kind === 'status') {
      response.writeHead(step.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: step.message, type: 'error' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
    const toolCall = { index: 0, id: `call_${received.length}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } };
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: 'tool_calls' }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    steps,
    received,
    chatRequests: () => received.filter(item => item.url === '/v1/chat/completions'),
    close() { server.closeAllConnections(); server.close(); },
  };
}

type Fake = Awaited<ReturnType<typeof fakeOpenCode>>;
let directory: string;
let store: Store;
let core: CoreService;
let fakes: Record<OpenCodePlan, Fake>;
let storedKeys: Partial<Record<string, string>>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-opencode-'));
  store = new Store(join(directory, 'test.sqlite'));
  fakes = {
    'opencode-zen': await fakeOpenCode(['glm-5.3', 'claude-sonnet-4-6', 'gpt-5.5', 'mystery-model']),
    'opencode-go': await fakeOpenCode(['kimi-k3', 'minimax-m3', 'glm-5.3']),
  };
  storedKeys = { ...FAKE_KEYS };
  core = new CoreService(store, () => {}, async (provider, model) => {
    const plan = provider as OpenCodePlan;
    const key = storedKeys[plan];
    if (!key) throw new Error(`Chưa kết nối ${plan}.`);
    return new OpenCodeAdapter(plan, key, model, fakes[plan].url);
  }, undefined, undefined, undefined, undefined, {
    readKey: async provider => storedKeys[provider] ?? null,
    endpoints: { 'opencode-zen': fakes['opencode-zen'].url, 'opencode-go': fakes['opencode-go'].url },
  });
});

afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  fakes['opencode-zen'].close();
  fakes['opencode-go'].close();
  await rm(directory, { recursive: true, force: true });
});

async function saveWorker(plan: OpenCodePlan, modelId = CHAT_MODEL[plan]) {
  const worker = store.all<Worker>('workers')[0];
  return await core.command('saveWorker', { ...worker, provider: plan, modelId }) as Worker;
}

function fixtureRun(worker: Worker): { task: Task; run: Run } {
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Review', status: 'running', budgetMicros: 100_000, sourceIds: [], consent: true, providerScopes: [worker.provider as OpenCodePlan], accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'running', error: null, startedAt: now() };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}

const report = { title: 'Review', summary: 'Text reviewed.', findings: [], limitations: ['No code executed.'] };
const workFrame = { goal: 'Review', statedConstraints: [], assumptions: [], plannedChecks: [] };
const plans: OpenCodePlan[] = ['opencode-zen', 'opencode-go'];

describe('OpenCode plan tables', () => {
  it('keeps the plans apart where their docs disagree', () => {
    expect(openCodeSupport('opencode-zen', 'minimax-m3')).toEqual({ supported: true });
    expect(openCodeSupport('opencode-go', 'minimax-m3')).toEqual({ supported: false, reason: 'protocol', protocol: 'messages' });
    expect(openCodeSupport('opencode-go', 'longcat-2.0')).toEqual({ supported: true });
    expect(openCodeSupport('opencode-zen', 'longcat-2.0')).toEqual({ supported: false, reason: 'undocumented' });
  });

  it('refuses models the docs put on another endpoint, and IDs the docs do not list', () => {
    expect(openCodeSupport('opencode-zen', 'claude-sonnet-4-6')).toMatchObject({ reason: 'protocol', protocol: 'messages' });
    expect(openCodeSupport('opencode-zen', 'gpt-5.5')).toMatchObject({ reason: 'protocol', protocol: 'responses' });
    expect(openCodeSupport('opencode-zen', 'gemini-3.1-pro')).toMatchObject({ reason: 'protocol', protocol: 'google' });
    expect(openCodeSupport('opencode-zen', 'jev-1.13')).toMatchObject({ reason: 'protocol', protocol: 'systemone' });
    expect(openCodeSupport('opencode-go', 'grok-4.6')).toMatchObject({ reason: 'protocol', protocol: 'responses' });
    expect(openCodeSupport('opencode-go', 'mystery-model')).toEqual({ supported: false, reason: 'undocumented' });
  });

  it('points each plan at its own documented base URL', () => {
    expect(OPENCODE_BASE_URLS['opencode-zen']).toBe('https://opencode.ai/zen/v1');
    expect(OPENCODE_BASE_URLS['opencode-go']).toBe('https://opencode.ai/zen/go/v1');
    expect(MODEL_LIST_ENDPOINTS['opencode-zen']).toBe(OPENCODE_BASE_URLS['opencode-zen']);
    expect(MODEL_LIST_ENDPOINTS['opencode-go']).toBe(OPENCODE_BASE_URLS['opencode-go']);
  });

  it('bills both plans outside Orglet budgets, with no pinned price or default model', () => {
    expect(isPaidApi('opencode-zen')).toBe(false);
    expect(isPlanApi('opencode-zen')).toBe(true);
    expect(isPaidApi('opencode-go')).toBe(false);
    expect(isPlanApi('opencode-go')).toBe(true);
    expect(resolveWorkerModel({ provider: 'opencode-zen', modelId: 'glm-5.3' })).toEqual({ id: 'glm-5.3', pricingVersion: 'plan:opencode-zen:glm-5.3' });
    expect(resolveWorkerModel({ provider: 'opencode-go', modelId: 'kimi-k3' })).toEqual({ id: 'kimi-k3', pricingVersion: 'plan:opencode-go:kimi-k3' });
    expect(resolveWorkerModel({ provider: 'opencode-zen' }).id).toBeUndefined();
  });
});

describe.each(plans)('%s connection', plan => {
  const other: OpenCodePlan = plan === 'opencode-zen' ? 'opencode-go' : 'opencode-zen';

  it('lists models from its own endpoint with its own key and keeps every ID', async () => {
    const list = await core.command('modelList', { provider: plan }) as ModelListResult;
    const models = fakes[plan].received.filter(item => item.url === '/v1/models');
    expect(models).toHaveLength(1);
    expect(models[0].authorization).toBe(`Bearer ${FAKE_KEYS[plan]}`);
    expect(fakes[other].received).toEqual([]);
    expect(list.source).toBe('native');
    expect(list.models.every(entry => entry.provider === plan && entry.source === 'native')).toBe(true);
    expect(list.models.every(entry => entry.inputTenths === undefined && entry.outputTenths === undefined)).toBe(true);
  });

  it('reports a missing key without falling back to the other plan', async () => {
    delete storedKeys[plan];
    const list = await core.command('modelList', { provider: plan }) as ModelListResult;
    const planName = plan === 'opencode-zen' ? 'OpenCode Zen' : 'OpenCode Go';
    expect(list.error).toContain(planName);
    expect(list.models).toEqual([]);
    expect(fakes[other].received).toEqual([]);
  });

  it('requires a model and refuses one on an unsupported endpoint when saving a worker', async () => {
    const worker = store.all<Worker>('workers')[0];
    await expect(core.command('saveWorker', { ...worker, provider: plan })).rejects.toThrow('không có model mặc định');
    const unsupported = plan === 'opencode-zen' ? 'claude-sonnet-4-6' : 'minimax-m3';
    await expect(saveWorker(plan, unsupported)).rejects.toThrow('chat/completions');
    await expect(saveWorker(plan, 'mystery-model')).rejects.toThrow('chưa ghi endpoint');
    expect((await saveWorker(plan)).modelId).toBe(CHAT_MODEL[plan]);
  });

  it('refuses an unsupported model before any request is sent', () => {
    expect(() => new OpenCodeAdapter(plan, FAKE_KEYS[plan], 'gpt-5.6-luna', fakes[plan].url)).toThrow('OpenAI Responses');
    expect(fakes[plan].received).toEqual([]);
  });

  it('sends the documented chat/completions request with Orglet tools and grants the same tools as other API workers', async () => {
    const worker = await saveWorker(plan);
    fakes[plan].steps.push({ kind: 'tool', name: 'submit_report', args: report });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    const [request] = fakes[plan].chatRequests();
    expect(request.authorization).toBe(`Bearer ${FAKE_KEYS[plan]}`);
    expect(request.body).toMatchObject({ model: CHAT_MODEL[plan], stream: true, tool_choice: 'required', parallel_tool_calls: false });
    expect(fakes[other].received).toEqual([]);
    expect(snapshotCapabilities(plan)).toEqual(snapshotCapabilities('openai'));
    expect(supportedCapabilities(plan)).toEqual(supportedCapabilities('openai'));
    expect(detail.runs[0].snapshot.toolCapabilities).not.toContain('network.web');
  });

  it('shows an exhausted plan clearly, then a retry runs again on the same plan', async () => {
    const worker = await saveWorker(plan);
    fakes[plan].steps.push({ kind: 'status', status: 402, message: 'Payment required' });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const failed = store.detail(task.id);
    expect(failed.task.status).toBe('failed');
    const expected = plan === 'opencode-zen' ? 'OpenCode Zen báo hết số dư' : 'OpenCode Go báo đã chạm hạn mức';
    expect(failed.runs[0].error).toContain(expected);
    expect(store.budgetReservations()).toEqual([]);

    fakes[plan].steps.push({ kind: 'tool', name: 'submit_report', args: report });
    await core.command('retry', { id: task.id });
    for (let attempt = 0; attempt < 300 && store.detail(task.id).task.status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(store.detail(task.id).task.status).toBe('completed');
    expect(fakes[plan].chatRequests()).toHaveLength(2);
    expect(fakes[other].received).toEqual([]);
  });

  it.each([
    [401, 'Invalid API key', 'từ chối API key'],
    [404, 'Model not found', 'không nhận model'],
    [429, 'Rate limit exceeded', 'quá nhiều yêu cầu'],
    [500, 'Upstream failure', 'trả lỗi 500: Upstream failure'],
  ])('words a %i response for this plan', async (status, message, expected) => {
    const worker = await saveWorker(plan);
    fakes[plan].steps.push({ kind: 'status', status, message });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const error = store.detail(task.id).runs[0].error ?? '';
    expect(error).toContain(expected);
    expect(error).toContain(plan === 'opencode-zen' ? 'OpenCode Zen' : 'OpenCode Go');
  });

  it('cancels a request in flight', async () => {
    const worker = await saveWorker(plan);
    fakes[plan].steps.push({ kind: 'hang' });
    const { task, run } = fixtureRun(worker);
    const running = core.runner.run(task, run);
    for (let attempt = 0; attempt < 300 && fakes[plan].chatRequests().length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    core.runner.cancel(task.id);
    await running;
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('cancelled');
    // OpenCode bills the cancelled request, not Orglet; nothing is held.
    expect(detail.usage.uncertainCount).toBe(0);
    expect(detail.usage.reservedMicros).toBe(0);
  });
});

describe.each(plans)('%s budgets', plan => {
  it('completes a two-call task without writing to the reservations ledger', async () => {
    const worker = await saveWorker(plan);
    fakes[plan].steps.push(
      { kind: 'tool', name: 'record_work_frame', args: workFrame },
      { kind: 'tool', name: 'submit_report', args: report },
    );
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    expect(fakes[plan].chatRequests()).toHaveLength(2);
    expect(detail.usage.reservedMicros).toBe(0);
    expect(detail.usage.chargedMicros).toBe(0);
    expect(detail.usage.uncertainCount).toBe(0);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM reservations').get()).toEqual({ count: 0 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM ledger').get()).toEqual({ count: 0 });
  });
});

describe('OpenCode model list parser', () => {
  it('rejects a payload without a data array and drops duplicate IDs', () => {
    expect(() => parseOpenCodeModels('opencode-zen', { models: [] })).toThrow();
    expect(parseOpenCodeModels('opencode-go', { data: [{ id: 'kimi-k3' }, { id: 'kimi-k3' }, { id: 42 }] }))
      .toEqual([{ provider: 'opencode-go', id: 'kimi-k3', source: 'native' }]);
  });
});
