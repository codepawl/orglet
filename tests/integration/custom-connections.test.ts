import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { CustomConnectionAdapter, customConnectionAdapter } from '../../apps/desktop/src/core/adapters/custom';
import { requireCustomConnection } from '../../apps/desktop/src/core/storage/custom-connections';
import { cost } from '../../apps/desktop/src/core/budgets/ledger';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { Credentials } from '../../apps/desktop/src/main/credentials';
import {
  commands, emptyConnections, isPaidApi, ProviderId, ProviderScope, TeamInput, TeamPlan,
  type Run, type Skill, type Task, type Worker, type Workspace,
} from '../../apps/desktop/src/shared/contracts';
import {
  BASE_URL_ERRORS, checkBaseUrl, CustomConnectionInput, customProviderId, MAX_CUSTOM_CONNECTIONS,
  connectionPricing, type CustomConnection, type CustomConnectionPrice, type CustomProviderId,
} from '../../apps/desktop/src/shared/custom-connections';
import { ModelListCache } from '../../apps/desktop/src/shared/models';
import { ERASE_CONFIRMATION } from '../../apps/desktop/src/shared/erase';
import { CustomConnectionsSection } from '../../apps/desktop/src/renderer/components/CustomConnections';
import { rememberCustomConnections } from '../../apps/desktop/src/renderer/customConnections';
import { providerName } from '../../apps/desktop/src/renderer/components/workerModel';
import { readiness } from '../../apps/desktop/src/renderer/components/providers';

// safeStorage stands in for DPAPI: the "encrypted" bytes are the key reversed, so a test can tell they were written
// through it without any real secret store.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (text: string) => Buffer.from([...text].reverse().join(''), 'utf8'),
    decryptString: (buffer: Buffer) => [...buffer.toString('utf8')].reverse().join(''),
  },
}));

// An obviously fake key; no live provider is called anywhere in this file.
const FAKE_KEY = 'fixture-custom-key-not-real-0123456789';
const CHAT_MODEL = 'qwen3-8b-instruct';

type Step = { kind: 'tool'; name: string; args: unknown; withoutUsage?: true } | { kind: 'status'; status: number; message: string };
/** A hosted server's address; the test routes its requests to the local fake so the price rules see a remote host. */
const REMOTE_URL = 'https://api.example-llm.test/v1';
type Received = { url: string; authorization?: string; body: Record<string, unknown> };

/** A stand-in for an OpenAI-compatible server such as LM Studio: `/v1/models` and a streamed chat/completions. */
async function fakeOpenAiCompatibleServer(models: string[]) {
  const steps: Step[] = [];
  const received: Received[] = [];
  let modelsStatus = 200;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void answer(request, response);
  });
  async function answer(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    received.push({ url: request.url ?? '', authorization: request.headers.authorization, body: text ? JSON.parse(text) : {} });
    if (request.url === '/v1/models') {
      response.writeHead(modelsStatus, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: models.map(model => ({ id: model, object: 'model', owned_by: 'organization_owner' })) }));
      return;
    }
    const step = steps.shift() ?? { kind: 'status', status: 500, message: 'Fixture exhausted' };
    if (step.kind === 'status') {
      response.writeHead(step.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: step.message, type: 'error' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: CHAT_MODEL };
    const toolCall = { index: 0, id: `call_${received.length}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } };
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: 'tool_calls' }] })}\n\n`);
    if (!step.withoutUsage) response.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    steps,
    received,
    failModels(status: number) { modelsStatus = status; },
    chatRequests: () => received.filter(item => item.url === '/v1/chat/completions'),
    close() { server.closeAllConnections(); server.close(); },
  };
}

type Fake = Awaited<ReturnType<typeof fakeOpenAiCompatibleServer>>;
let directory: string;
let store: Store;
let core: CoreService;
let fake: Fake;
let keys: Partial<Record<string, string>>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-custom-'));
  store = new Store(join(directory, 'test.sqlite'));
  fake = await fakeOpenAiCompatibleServer([CHAT_MODEL, 'text-embedding-nomic-embed-text-v1.5', 'llama-3.2-3b']);
  keys = {};
  const readKey = async (provider: string) => keys[provider] ?? null;
  core = new CoreService(store, () => {}, async (provider, model) => {
    if (!provider.startsWith('custom:')) throw new Error(`Unexpected provider ${provider}`);
    const connection = requireCustomConnection(store, provider);
    if (connection.baseUrl !== REMOTE_URL) return customConnectionAdapter(store, provider as CustomProviderId, model, readKey);
    return new CustomConnectionAdapter({ ...connection, baseUrl: fake.baseUrl }, await readKey(provider), model);
  }, undefined, undefined, undefined, undefined, { readKey });
});

afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  fake.close();
  rememberCustomConnections([]);
  await rm(directory, { recursive: true, force: true });
});

async function addConnection(name = 'LM Studio', baseUrl = fake.baseUrl, price?: CustomConnectionPrice): Promise<CustomConnection> {
  return await core.command('saveCustomConnection', { name, baseUrl, ...(price ? { price } : {}) }) as CustomConnection;
}

/** $0.40 in and $1.60 out per million tokens, as integer USD micros. */
const PRICE: CustomConnectionPrice = { inputMicrosPerMillion: 400_000, outputMicrosPerMillion: 1_600_000 };

async function workerOn(connection: CustomConnection, modelId = CHAT_MODEL): Promise<Worker> {
  const worker = store.all<Worker>('workers')[0];
  return await core.command('saveWorker', { ...worker, provider: customProviderId(connection.id), modelId }) as Worker;
}

function fixtureRun(worker: Worker): { task: Task; run: Run } {
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Say hello', status: 'running', budgetMicros: 100_000, sourceIds: [], consent: true, providerScopes: [worker.provider as ProviderScope], accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'running', error: null, startedAt: now() };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}

const chatReply = { title: 'Hello', summary: 'Hello from the fake server.', findings: [], limitations: ['No sources.'] };

describe('base URL rules', () => {
  it.each([
    ['https://api.groq.com/openai/v1', 'https://api.groq.com/openai/v1'],
    ['https://api.deepseek.com/', 'https://api.deepseek.com'],
    ['http://localhost:1234/v1/', 'http://localhost:1234/v1'],
    ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1'],
    ['http://192.168.1.20:8000/v1', 'http://192.168.1.20:8000/v1'],
    ['http://10.0.0.5/v1', 'http://10.0.0.5/v1'],
    ['http://172.16.4.2:11434/v1', 'http://172.16.4.2:11434/v1'],
    ['http://100.101.102.103:1234/v1', 'http://100.101.102.103:1234/v1'],
    ['http://gpu-box.local:1234/v1', 'http://gpu-box.local:1234/v1'],
    ['http://[::1]:1234/v1', 'http://[::1]:1234/v1'],
    ['http://[fd12:3456::1]:8000/v1', 'http://[fd12:3456::1]:8000/v1'],
    ['http://[::ffff:127.0.0.1]:1234/v1', 'http://[::ffff:7f00:1]:1234/v1'],
    ['http://2130706433:1234/v1', 'http://127.0.0.1:1234/v1'],
  ])('accepts %s', (raw, normalized) => {
    expect(checkBaseUrl(raw)).toEqual({ ok: true, url: normalized });
  });

  it.each([
    ['http://api.groq.com/openai/v1', BASE_URL_ERRORS.insecureRemote],
    ['http://8.8.8.8/v1', BASE_URL_ERRORS.insecureRemote],
    ['http://172.32.0.1/v1', BASE_URL_ERRORS.insecureRemote],
    ['http://0.0.0.0:1234/v1', BASE_URL_ERRORS.insecureRemote],
    ['http://llm.corp:8000/v1', BASE_URL_ERRORS.insecureRemote],
    ['https://user:secret@proxy.example.com/v1', BASE_URL_ERRORS.credentials],
    ['https://proxy.example.com/v1?api_key=abc', BASE_URL_ERRORS.query],
    ['https://proxy.example.com/v1#token', BASE_URL_ERRORS.query],
    ['ftp://files.example.com/v1', BASE_URL_ERRORS.scheme],
    ['localhost:1234', BASE_URL_ERRORS.scheme],
    ['not a url', BASE_URL_ERRORS.invalid],
    [`https://example.com/${'a'.repeat(600)}`, BASE_URL_ERRORS.tooLong],
  ])('refuses %s', (raw, error) => {
    expect(checkBaseUrl(raw)).toEqual({ ok: false, error });
  });
});

describe('schemas', () => {
  it('names a custom connection as a provider of its own and counts it as a paid API', () => {
    const provider = customProviderId('0b8e7a52-2a0b-4c1e-9c6a-0d3d6f1e2a11');
    expect(ProviderId.parse(provider)).toBe(provider);
    expect(ProviderScope.parse(provider)).toBe(provider);
    expect(ProviderId.safeParse('custom:not-a-uuid').success).toBe(false);
    expect(ProviderId.safeParse('custom:').success).toBe(false);
    expect(isPaidApi(provider)).toBe(true);
  });

  it('prices a local server at zero unless a price was entered, and leaves a remote one unknown', () => {
    expect(connectionPricing({ baseUrl: 'http://localhost:1234/v1' })).toEqual({ kind: 'local', price: { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 } });
    expect(connectionPricing({ baseUrl: 'https://192.168.1.20/v1' }).kind).toBe('local');
    expect(connectionPricing({ baseUrl: 'http://localhost:1234/v1', price: PRICE })).toEqual({ kind: 'entered', price: PRICE });
    expect(connectionPricing({ baseUrl: REMOTE_URL })).toEqual({ kind: 'unknown' });
    expect(connectionPricing({ baseUrl: REMOTE_URL, price: PRICE })).toEqual({ kind: 'entered', price: PRICE });
    expect(CustomConnectionInput.safeParse({ name: 'X', baseUrl: REMOTE_URL, price: { inputMicrosPerMillion: 0.5, outputMicrosPerMillion: 1 } }).success).toBe(false);
    expect(CustomConnectionInput.safeParse({ name: 'X', baseUrl: REMOTE_URL, price: { inputMicrosPerMillion: 1 } }).success).toBe(false);
    expect(CustomConnectionInput.safeParse({ name: 'X', baseUrl: REMOTE_URL, price: { inputMicrosPerMillion: -1, outputMicrosPerMillion: 1 } }).success).toBe(false);
  });

  it('trims and bounds a connection name and address', () => {
    expect(CustomConnectionInput.parse({ name: '  LM Studio ', baseUrl: ' http://localhost:1234/v1 ' })).toEqual({ name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' });
    expect(CustomConnectionInput.safeParse({ name: '   ', baseUrl: 'http://localhost:1234/v1' }).success).toBe(false);
    expect(CustomConnectionInput.safeParse({ name: 'x'.repeat(61), baseUrl: 'http://localhost:1234/v1' }).success).toBe(false);
    expect(CustomConnectionInput.safeParse({ name: 'Proxy', baseUrl: 'https://proxy.example.com/v1', key: FAKE_KEY }).success).toBe(false);
  });

  it('keeps model lists of custom connections in the one cache, and refuses a key that is neither', () => {
    const provider = customProviderId('0b8e7a52-2a0b-4c1e-9c6a-0d3d6f1e2a11');
    const row = { fetchedAt: now(), source: 'native' as const, models: [] };
    expect(ModelListCache.safeParse({ version: 1, byProvider: { openai: row, [provider]: row } }).success).toBe(true);
    expect(ModelListCache.safeParse({ version: 1, byProvider: { mystery: row } }).success).toBe(false);
  });
});

describe('saving connections', () => {
  it('stores the checked address, refuses plain http to a remote host and a name already taken', async () => {
    const saved = await addConnection('LM Studio', `${fake.baseUrl}/`);
    expect(saved.baseUrl).toBe(fake.baseUrl);
    await expect(core.command('saveCustomConnection', { name: 'Groq', baseUrl: 'http://api.groq.com/openai/v1' })).rejects.toThrow(BASE_URL_ERRORS.insecureRemote);
    await expect(core.command('saveCustomConnection', { name: 'lm studio', baseUrl: 'https://proxy.example.com/v1' })).rejects.toThrow('Đã có kết nối tên LM Studio');
    const renamed = await core.command('saveCustomConnection', { id: saved.id, name: 'Local model', baseUrl: fake.baseUrl }) as CustomConnection;
    expect(renamed.id).toBe(saved.id);
    expect((await core.command('workspace', {}) as Workspace).customConnections).toEqual([renamed]);
  });

  it('keeps the price when an edit leaves it out and clears it with null', async () => {
    const connection = await addConnection('Hosted', REMOTE_URL, PRICE);
    expect(connection.price).toEqual(PRICE);
    const renamed = await core.command('saveCustomConnection', { id: connection.id, name: 'Hosted 2', baseUrl: REMOTE_URL }) as CustomConnection;
    expect(renamed.price).toEqual(PRICE);
    const cleared = await core.command('saveCustomConnection', { id: connection.id, name: 'Hosted 2', baseUrl: REMOTE_URL, price: null }) as CustomConnection;
    expect(cleared.price).toBeUndefined();
  });

  it(`holds at most ${MAX_CUSTOM_CONNECTIONS} connections`, async () => {
    for (let index = 0; index < MAX_CUSTOM_CONNECTIONS; index++) await addConnection(`Server ${index}`);
    await expect(addConnection('One too many')).rejects.toThrow(`Tối đa ${MAX_CUSTOM_CONNECTIONS}`);
  });

  it('needs an existing connection and a model ID for an orglet, and keeps a connection in use', async () => {
    const connection = await addConnection();
    const worker = store.all<Worker>('workers')[0];
    await expect(core.command('saveWorker', { ...worker, provider: customProviderId(id()), modelId: CHAT_MODEL })).rejects.toThrow('không còn');
    await expect(core.command('saveWorker', { ...worker, provider: customProviderId(connection.id) })).rejects.toThrow('Chọn hoặc gõ ID model cho LM Studio');
    const saved = await workerOn(connection);
    await expect(core.command('deleteCustomConnection', { id: connection.id })).rejects.toThrow(saved.name);
    await core.command('saveWorker', { ...saved, provider: 'demo', modelId: undefined });
    await core.command('deleteCustomConnection', { id: connection.id });
    expect((await core.command('workspace', {}) as Workspace).customConnections).toEqual([]);
  });

  it('survives a full erase, like the keys beside it', async () => {
    const connection = await addConnection();
    await core.command('eraseData', { scope: 'everything', confirm: ERASE_CONFIRMATION });
    expect((await core.command('workspace', {}) as Workspace).customConnections).toEqual([connection]);
  });
});

describe('model list', () => {
  it('lists the connection\'s own /models with its key, keeps typed IDs open and hides embedding rows', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    keys[provider] = FAKE_KEY;
    const result = await core.modelList({ provider, refresh: true });
    expect(result.models.map(model => model.id)).toEqual([CHAT_MODEL, 'llama-3.2-3b']);
    expect(result.models.every(model => model.provider === provider)).toBe(true);
    expect(result.customIdOk).toBe(true);
    expect(fake.received.find(item => item.url === '/v1/models')?.authorization).toBe(`Bearer ${FAKE_KEY}`);
    // Cached: a second read answers from the store without another request.
    const before = fake.received.length;
    expect((await core.modelList({ provider })).models).toHaveLength(2);
    expect(fake.received.length).toBe(before);
  });

  it('sends no Authorization header without a key, and keeps the typed ID when the list fails', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    const listed = await core.modelList({ provider, refresh: true });
    expect(listed.models).toHaveLength(2);
    expect(fake.received[0].authorization).toBeUndefined();
    fake.failModels(500);
    const failed = await core.modelList({ provider, refresh: true });
    expect(failed.error).toContain('500');
    expect(failed.customIdOk).toBe(true);
    // The last good list stays next to the error rather than being wiped.
    expect(failed.models).toHaveLength(2);
  });

  it('drops the cached list when the address changes or the connection goes', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    await core.modelList({ provider, refresh: true });
    await core.command('saveCustomConnection', { id: connection.id, name: connection.name, baseUrl: fake.baseUrl });
    expect(ModelListCache.parse(store.setting('modelLists', null)).byProvider[provider]).toBeUndefined();
    await core.modelList({ provider, refresh: true });
    await core.command('deleteCustomConnection', { id: connection.id });
    expect(ModelListCache.parse(store.setting('modelLists', null)).byProvider[provider]).toBeUndefined();
  });
});

describe('a chat run through the adapter', () => {
  it('answers a local server for free, so two messages in a row never wait for budget', async () => {
    const connection = await addConnection();
    const worker = await workerOn(connection);
    fake.steps.push({ kind: 'tool', name: 'submit_report', args: chatReply }, { kind: 'tool', name: 'submit_report', args: chatReply });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const second: Run = { ...run, id: id(), status: 'running', startedAt: now() };
    store.put('runs', second, { column: 'task_id', value: task.id });
    await core.runner.run(store.get<Task>('tasks', task.id), second);
    const detail = store.detail(task.id);
    expect(detail.runs.map(item => item.status)).toEqual(['completed', 'completed']);
    expect(detail.artifacts[0].report.summary).toBe('Hello from the fake server.');
    const [request] = fake.chatRequests();
    expect(request.authorization).toBeUndefined();
    expect(request.body).toMatchObject({ model: CHAT_MODEL, stream: true, tool_choice: 'required' });
    // A known price of zero: nothing held, nothing to reconcile, and the tokens still counted.
    expect(detail.usage).toMatchObject({ chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 80, outputTokens: 24 });
    expect(store.budgetReservations()).toEqual([]);
  });

  it('keeps a reply without token counts unknown and visible even when the server is free', async () => {
    const connection = await addConnection();
    const worker = await workerOn(connection);
    fake.steps.push({ kind: 'tool', name: 'submit_report', args: chatReply, withoutUsage: true });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    expect(detail.usage).toMatchObject({ uncertainCount: 1, reservedMicros: 0 });
    expect(store.budgetReservations()).toMatchObject([{ provider: customProviderId(connection.id), reason: 'missing_usage', originalMicros: 0 }]);
  });

  it('charges a remote connection at the price entered: held first, settled from the reported tokens', async () => {
    const connection = await addConnection('Hosted', REMOTE_URL, PRICE);
    const worker = await workerOn(connection);
    fake.steps.push({ kind: 'tool', name: 'submit_report', args: chatReply });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    const expected = cost(40, 12, PRICE);
    expect(expected).toBe(36);
    expect(detail.usage).toMatchObject({ chargedMicros: expected, reservedMicros: 0, uncertainCount: 0 });
    expect(store.db.prepare('SELECT pricing_version AS version FROM ledger').get()).toEqual({ version: `entered:${CHAT_MODEL}:400000:1600000` });
  });

  it('lets an entered price win over the free default of a local server', async () => {
    const connection = await addConnection('Priced local', fake.baseUrl, PRICE);
    const worker = await workerOn(connection);
    fake.steps.push({ kind: 'tool', name: 'submit_report', args: chatReply });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    expect(store.detail(task.id).usage.chargedMicros).toBe(36);
  });

  it('holds the unknown cost of a remote connection without a price for reconciliation', async () => {
    const connection = await addConnection('Hosted', REMOTE_URL);
    const worker = await workerOn(connection);
    fake.steps.push({ kind: 'tool', name: 'submit_report', args: chatReply });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    expect(detail.usage.chargedMicros).toBe(0);
    expect(detail.usage.uncertainCount).toBe(1);
    expect(detail.usage.reservedMicros).toBe(task.budgetMicros);
    expect(store.budgetReservations()).toMatchObject([{ provider: customProviderId(connection.id), reason: 'missing_usage', actualMicros: null }]);
  });

  it('sends the saved key and words a refusal with the connection\'s name', async () => {
    const connection = await addConnection('Company proxy');
    const worker = await workerOn(connection);
    keys[worker.provider] = FAKE_KEY;
    fake.steps.push({ kind: 'status', status: 401, message: 'Invalid key' });
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(fake.chatRequests()[0].authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(detail.task.status).toBe('failed');
    expect(detail.runs[0].error).toContain('Company proxy từ chối yêu cầu (401)');
    // Free and local: the failed request stays visible, but there is no held cost to talk about.
    expect(detail.runs[0].error).not.toContain('Chi phí chưa rõ');
    expect(detail.usage.uncertainCount).toBe(1);
    expect(detail.usage.reservedMicros).toBe(0);
  });

  it('says so when the server is not running', async () => {
    const connection = await addConnection('Stopped server', 'http://127.0.0.1:9/v1');
    const worker = await workerOn(connection);
    const { task, run } = fixtureRun(worker);
    await core.runner.run(task, run);
    expect(store.detail(task.id).runs[0].error).toContain('Không kết nối được Stopped server tại 127.0.0.1:9');
  });
});

describe('the key stays in main', () => {
  it('writes the key through safeStorage under the connection id and reports only that one exists', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    const credentials = new Credentials(directory);
    await credentials.save(provider, FAKE_KEY);
    expect(await readdir(directory)).toContain(`custom-${connection.id}.credential`);
    expect(await credentials.read(provider)).toBe(FAKE_KEY);
    const status = await credentials.status();
    expect(status.custom).toEqual({ [connection.id]: true });
    expect(JSON.stringify(status)).not.toContain(FAKE_KEY);
    await expect(credentials.save(provider, 'has a space')).rejects.toThrow('API key không hợp lệ.');
    await credentials.remove(provider);
    expect((await credentials.status()).custom).toEqual({});
  });

  it('never puts the key in the workspace, a model list, a backup or the rendered settings', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    keys[provider] = FAKE_KEY;
    const workspace = await core.command('workspace', {}) as Workspace;
    const list = await core.modelList({ provider, refresh: true });
    const backup = new Backups(store, () => false, () => {}).export();
    rememberCustomConnections(workspace.customConnections);
    const html = renderToStaticMarkup(createElement(CustomConnectionsSection, {
      connections: workspace.customConnections, keys: { [connection.id]: true }, busy: false,
      act: async () => {}, onConnections: () => {},
    }));
    for (const view of [JSON.stringify(workspace), JSON.stringify(list), backup, html]) expect(view).not.toContain(FAKE_KEY);
    expect(html).toContain('LM Studio');
    expect(html).toContain('Local · free');
    expect(JSON.parse(backup).payload.customConnections).toEqual([connection]);
  });

  it('restores a backed-up connection by id and renames it when the name is taken here', async () => {
    const connection = await addConnection();
    const backup = new Backups(store, () => false, () => {}).export();
    const other = new Store(':memory:');
    try {
      other.setSetting('customConnections', [{ id: id(), name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' }]);
      const manager = new Backups(other, () => false, () => {});
      manager.restore(manager.preview(backup).token);
      const restored = other.workspace().customConnections;
      expect(restored).toHaveLength(2);
      expect(restored[1]).toEqual({ ...connection, name: 'LM Studio (2)' });
    } finally { other.close(); }
  });
});

describe('the renderer names a custom connection', () => {
  it('uses the person\'s name, counts it ready without a key, and falls back once it is deleted', async () => {
    const connection = await addConnection();
    const provider = customProviderId(connection.id);
    rememberCustomConnections([connection]);
    expect(providerName(provider)).toBe('LM Studio');
    expect(readiness(emptyConnections(), [], [connection])[provider]).toBe(true);
    rememberCustomConnections([]);
    expect(providerName(provider)).not.toBe(provider);
    expect(readiness(emptyConnections(), [], [])[provider]).toBeFalsy();
  });
});

describe('limits raised to eight', () => {
  it('accepts a crew of eight running eight chats at once, and refuses nine', () => {
    const memberIds = Array.from({ length: 9 }, () => id());
    const crew = { name: 'Eight', instructions: 'Work together.', synthesizerId: memberIds[0], workflow: 'parallel' as const, monthlyBudgetMicros: 5_000_000 };
    expect(TeamInput.safeParse({ ...crew, memberIds: memberIds.slice(0, 8), maxConcurrentTasks: 8 }).success).toBe(true);
    expect(TeamInput.safeParse({ ...crew, memberIds }).success).toBe(false);
    expect(TeamInput.safeParse({ ...crew, memberIds: memberIds.slice(0, 8), maxConcurrentTasks: 9 }).success).toBe(false);
    const assignments = memberIds.slice(0, 8).map(workerId => ({ workerId, brief: 'Do your part.' }));
    expect(TeamPlan.safeParse({ assignments }).success).toBe(true);
    expect(TeamPlan.safeParse({ assignments: [...assignments, { workerId: memberIds[8], brief: 'One more.' }] }).success).toBe(false);
  });

  it('lets up to eight requests run at once per provider', () => {
    const settings = { theme: 'system' as const, connectionLimitMicros: 5_000_000 };
    expect(commands.settings.safeParse({ ...settings, providerConcurrency: 8 }).success).toBe(true);
    expect(commands.settings.safeParse({ ...settings, providerConcurrency: 9 }).success).toBe(false);
  });
});
