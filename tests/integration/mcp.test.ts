import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { McpServers } from '../../apps/desktop/src/core/tools/mcp';
import { assertToolCall, toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { McpSecretStore } from '../../apps/desktop/src/main/mcp-secrets';
import {
  emptyMcpSecrets, grantsAfterApproval, mcpToolNames, MCP_RESULT_CHARACTERS, parseMcpImport, splitMcpDraft,
  type McpSecrets, type McpServerConfig,
} from '../../apps/desktop/src/shared/mcp';

const sdk = (path: string) => pathToFileURL(fileURLToPath(new URL(`../../node_modules/@modelcontextprotocol/sdk/dist/esm/${path}`, import.meta.url))).href;

/**
 * A real stdio MCP server built on the SDK's low-level server class: an echo, a large answer, a call that never
 * finishes, a crash, one that reads a secret from its environment, and one that leaves a mark on disk when it runs.
 */
const fixtureSource = (markFile: string) => `
import { Server } from '${sdk('server/index.js')}';
import { StdioServerTransport } from '${sdk('server/stdio.js')}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${sdk('types.js')}';
import { appendFileSync } from 'node:fs';
const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
const object = (properties = {}) => ({ type: 'object', properties });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'echo', description: 'Repeats the text.\\nSecond line.', inputSchema: object({ text: { type: 'string' } }), annotations: { readOnlyHint: true } },
  { name: 'big', description: 'A very long answer.', inputSchema: object() },
  { name: 'slow', description: 'Never answers.', inputSchema: object() },
  { name: 'crash', description: 'Exits the process.', inputSchema: object() },
  { name: 'secret', description: 'Reads FIXTURE_TOKEN.', inputSchema: object() },
  { name: 'write_note', description: 'Writes a note.', inputSchema: object({ note: { type: 'string' } }) },
] }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const text = value => ({ content: [{ type: 'text', text: value }] });
  const name = request.params.name;
  const input = request.params.arguments ?? {};
  if (name === 'echo') return text('echo: ' + input.text);
  if (name === 'big') return text('x'.repeat(100000));
  if (name === 'slow') return await new Promise((resolve, reject) => extra.signal.addEventListener('abort', () => reject(new Error('cancelled'))));
  if (name === 'crash') process.exit(3);
  if (name === 'secret') return text(process.env.FIXTURE_TOKEN ?? 'missing');
  if (name === 'write_note') { appendFileSync(${JSON.stringify(markFile)}, String(input.note) + '\\n'); return text('written'); }
  return { content: [{ type: 'text', text: 'unknown' }], isError: true };
});
await server.connect(new StdioServerTransport());
`;

let directory: string;
let store: Store;
let core: CoreService | undefined;
let servers: McpServers | undefined;
let fixture: string;
let markFile: string;

const SECRET = 'sekret-value-8d2f';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-mcp-'));
  store = new Store(join(directory, 'state.sqlite'));
  markFile = join(directory, 'notes.txt');
  fixture = join(directory, 'fixture-server.mjs');
  await writeFile(fixture, fixtureSource(markFile));
});

afterEach(async () => {
  await servers?.shutdown();
  await core?.mcp.shutdown();
  await core?.runner.shutdown();
  servers = undefined;
  core = undefined;
  store.close();
  await rm(directory, { recursive: true, force: true });
});

const fixtureConfig = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: id(), name: 'Fixture', enabled: true,
  transport: { kind: 'stdio', command: process.execPath, args: [fixture], envNames: ['FIXTURE_TOKEN'] },
  ...overrides,
});
const secretsFor = async (): Promise<McpSecrets> => ({ env: { FIXTURE_TOKEN: SECRET }, headers: {} });

async function until(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 20));
  expect(check()).toBe(true);
}

const response = (name: string, argumentsValue: unknown): ModelReply => ({
  calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }],
  usage: { input: 100, output: 30 },
});

it('starts a stdio server, lists its tools and keeps the list for Settings', async () => {
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor });
  const saved = await servers.save(fixtureConfig());
  expect(saved.status).toBe('idle');
  const view = await servers.test(saved.id);
  expect(view.status).toBe('connected');
  expect(view.tools?.map(tool => tool.name)).toEqual(['echo', 'big', 'slow', 'crash', 'secret', 'write_note']);
  expect(view.tools?.[0].description).toBe('Repeats the text.');
  const offered = await servers.toolsForRun([saved.id], new AbortController().signal);
  expect(offered.problems).toEqual([]);
  expect(offered.tools.map(tool => tool.name)).toContain('mcp__fixture__echo');
  expect(offered.tools.find(tool => tool.tool === 'echo')?.readOnly).toBe(true);
  expect(offered.tools.find(tool => tool.tool === 'write_note')?.readOnly).toBe(false);
});

it('caps a large answer and says it was cut', async () => {
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor });
  const saved = await servers.save(fixtureConfig());
  const result = await servers.call(saved.id, 'big', {}, new AbortController().signal);
  expect(result.content).toHaveLength(MCP_RESULT_CHARACTERS);
  expect(result.truncated).toBe(true);
  expect(result.trust).toMatch(/Untrusted/);
});

it('stops a call at its timeout and when the run is cancelled', async () => {
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor });
  const saved = await servers.save(fixtureConfig());
  await servers.test(saved.id);
  const started = Date.now();
  await expect(servers.call(saved.id, 'slow', {}, new AbortController().signal, 300)).rejects.toThrow(/timed out|timeout/i);
  expect(Date.now() - started).toBeLessThan(5_000);
  const controller = new AbortController();
  const pending = servers.call(saved.id, 'slow', {}, controller.signal);
  setTimeout(() => controller.abort(new Error('Cancelled')), 100);
  await expect(pending).rejects.toThrow();
  // The server is still there for the next call.
  expect((await servers.call(saved.id, 'echo', { text: 'after' }, new AbortController().signal)).content).toBe('echo: after');
});

it('shows a crashed server as an error without taking the core down, and Test starts it again', async () => {
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor });
  const saved = await servers.save(fixtureConfig());
  await servers.test(saved.id);
  await expect(servers.call(saved.id, 'crash', {}, new AbortController().signal)).rejects.toThrow();
  await until(() => servers!.views()[0].status === 'error');
  expect(servers.views()[0].error).toMatch(/đã dừng/);
  const again = await servers.test(saved.id);
  expect(again.status).toBe('connected');
});

it('tells main each running server with its creation time, and drops it once the server exits', async () => {
  const reports: { pid: number; startedAt: string }[][] = [];
  const looked: number[] = [];
  // The real lookup is covered in process-identity.test.ts; here it answers at once, so only the reporting is tested.
  const startTimes = async (pids: readonly number[]) => {
    looked.push(...pids);
    return new Map(pids.map(pid => [pid, `created-${pid}`]));
  };
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor, onProcesses: processes => reports.push(processes), startTimes });
  const saved = await servers.save(fixtureConfig());
  await servers.test(saved.id);
  await until(() => (reports.at(-1)?.length ?? 0) === 1);
  const [running] = reports.at(-1)!;
  expect(running.pid).toBeGreaterThan(0);
  expect(looked).toEqual([running.pid]);
  expect(running.startedAt).toBe(`created-${running.pid}`);
  await expect(servers.call(saved.id, 'crash', {}, new AbortController().signal)).rejects.toThrow();
  await until(() => reports.at(-1)?.length === 0);
});

it('reports a server that cannot start as a problem of the run, not a crash', async () => {
  servers = new McpServers(store, () => {}, { readSecrets: secretsFor });
  const saved = await servers.save(fixtureConfig({ transport: { kind: 'stdio', command: join(directory, 'missing-server.exe'), args: [], envNames: [] } }));
  const offered = await servers.toolsForRun([saved.id], new AbortController().signal);
  expect(offered.tools).toEqual([]);
  expect(offered.problems[0]).toMatch(/Không khởi động được máy chủ MCP Fixture/);
  expect(servers.views()[0].status).toBe('error');
});

it('hands secret values to the server but never to the window or the database', async () => {
  const draft = { name: 'Fixture', enabled: true, transport: { kind: 'stdio' as const, command: process.execPath, args: [fixture], env: [{ name: 'FIXTURE_TOKEN', value: SECRET }] } };
  const serverId = id();
  const { config, secrets } = splitMcpDraft(draft, serverId, emptyMcpSecrets());
  expect(JSON.stringify(config)).not.toContain(SECRET);
  expect(secrets.env.FIXTURE_TOKEN).toBe(SECRET);
  // An edit that leaves the value empty keeps the saved one; a name with neither is refused.
  const kept = splitMcpDraft({ ...draft, id: serverId, transport: { ...draft.transport, env: [{ name: 'FIXTURE_TOKEN' }] } }, serverId, secrets);
  expect(kept.secrets.env.FIXTURE_TOKEN).toBe(SECRET);
  expect(() => splitMcpDraft({ ...draft, transport: { ...draft.transport, env: [{ name: 'OTHER' }] } }, serverId, emptyMcpSecrets())).toThrow(/OTHER/);

  // Main's store writes ciphertext only.
  const secretDirectory = join(directory, 'secrets');
  await mkdir(secretDirectory);
  const encryption = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(Buffer.from(text).toString('base64').split('').reverse().join('')), decryptString: (data: Buffer) => Buffer.from(data.toString().split('').reverse().join(''), 'base64').toString() };
  const secretStore = new McpSecretStore(secretDirectory, encryption);
  await secretStore.save(serverId, secrets);
  const files = await readdir(secretDirectory);
  expect(files).toEqual([`mcp-${serverId}.secrets`]);
  expect((await readFile(join(secretDirectory, files[0]))).toString()).not.toContain(SECRET);
  expect(await secretStore.read(serverId)).toEqual(secrets);

  core = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets: serverSecretId => secretStore.read(serverSecretId) });
  await core.saveMcpServer(config);
  expect((await core.mcp.call(serverId, 'secret', {}, new AbortController().signal)).content).toBe(SECRET);
  const windowView = await core.command('workspace', {});
  expect(JSON.stringify(windowView)).toContain('FIXTURE_TOKEN');
  expect(JSON.stringify(windowView)).not.toContain(SECRET);
  expect(JSON.stringify(await core.command('testMcpServer', { id: serverId }))).not.toContain(SECRET);
  const rows = store.db.prepare('SELECT data FROM mcp_servers').all().map(row => String(row.data)).join('\n');
  expect(rows).not.toContain(SECRET);
  expect(core.backups.export()).not.toContain(SECRET);

  await secretStore.remove(serverId);
  expect(await readdir(secretDirectory)).toEqual([]);
});

it('keeps MCP servers through Erase all data, like API keys and custom connections', async () => {
  core = new CoreService(store, () => {}, async () => { throw new Error('no model'); }, undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets: secretsFor });
  const server = await core.saveMcpServer(fixtureConfig());
  await core.command('eraseData', { scope: 'everything', confirm: 'Orglet' });
  expect(core.mcp.views().map(view => view.id)).toEqual([server.id]);
  expect(store.all<Worker>('workers')).toHaveLength(1);
});

it('never loads another app’s MCP settings on its own; only a file the person picks is read', async () => {
  const home = join(directory, 'home');
  const config = JSON.stringify({ mcpServers: { planted: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc' } }, remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token-1' } } } });
  for (const file of [join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), join(home, '.cursor', 'mcp.json'), join(home, '.vscode', 'mcp.json'), join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')]) {
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, config);
  }
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming') });
  try {
    core = new CoreService(store, () => {}, async () => { throw new Error('no model'); });
    const workspace = await core.command('workspace', {}) as { mcpServers: unknown[] };
    expect(workspace.mcpServers).toEqual([]);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM mcp_servers').get()!.count).toBe(0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  // The same file, picked on purpose, is understood: values split off for main, the bearer token recognised.
  const picked = parseMcpImport(config);
  expect(picked.drafts.map(draft => draft.name)).toEqual(['planted', 'remote']);
  expect(picked.drafts[1].transport).toMatchObject({ kind: 'http', bearer: 'token-1', headers: [] });
});

it('offers MCP tools only to orglets allowed to use the server', async () => {
  const seen = new Map<string, string[]>();
  core = new CoreService(store, () => {}, async () => ({
    async request(_messages, tools) {
      const names = tools.flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
      seen.set(String(seen.size), names);
      return response('reply', { message: 'Xong.', title: null, knowledgeProposals: [] });
    },
  }), undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets: secretsFor });
  const server = await core.saveMcpServer(fixtureConfig());
  const base = store.all<Worker>('workers')[0];
  const allowed = await core.command('saveWorker', { ...base, id: undefined, name: 'Allowed', provider: 'openai', mcpServerIds: [server.id] }) as Worker;
  const other = await core.command('saveWorker', { ...base, id: undefined, name: 'Other', provider: 'openai' }) as Worker;
  expect(allowed.mcpServerIds).toEqual([server.id]);
  expect(other.mcpServerIds).toBeUndefined();
  const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
  const allowedTask = await core.command('createTask', { workerId: allowed.id, brief: 'Dùng echo', ...scope }) as string;
  await until(() => store.detail(allowedTask).task.status === 'completed');
  const otherTask = await core.command('createTask', { workerId: other.id, brief: 'Dùng echo', ...scope }) as string;
  await until(() => store.detail(otherTask).task.status === 'completed');
  expect(seen.get('0')).toContain('mcp__fixture__echo');
  expect(seen.get('1')?.some(name => name.startsWith('mcp__'))).toBe(false);

  // The frozen list decides, and a name the run was not offered is refused.
  const otherRun = store.detail(otherTask).runs[0];
  const otherTaskRow = store.get<Task>('tasks', otherTask);
  expect(() => assertToolCall(otherRun, otherTaskRow, 'mcp__fixture__echo', '{"text":"x"}')).toThrow('Tool không được policy cho phép.');
  const allowedRun = store.detail(allowedTask).runs[0];
  expect(toolsFor(allowedRun, store.get<Task>('tasks', allowedTask)).some(tool => tool.type === 'function' && tool.function.name === 'mcp__fixture__write_note')).toBe(true);
  // A scheduled run and a lead's routing step are never offered them.
  expect(toolsFor(allowedRun, { ...store.get<Task>('tasks', allowedTask), routineId: id() }).some(tool => tool.type === 'function' && tool.function.name.startsWith('mcp__'))).toBe(false);
  expect(toolsFor({ ...allowedRun, stage: 'plan' } as Run, store.get<Task>('tasks', allowedTask)).some(tool => tool.type === 'function' && tool.function.name.startsWith('mcp__'))).toBe(false);
});

it('asks before a call, runs it once allowed, and never runs a refused one', async () => {
  let step = 0;
  let resumed: unknown[] = [];
  core = new CoreService(store, () => {}, async () => ({
    async request(messages) {
      step++;
      if (step === 1) return response('mcp__fixture__echo', { text: 'hi' });
      if (step === 2) { resumed = structuredClone(messages); return response('mcp__fixture__write_note', { note: 'refused note' }); }
      return response('reply', { message: 'Xong.', title: null, knowledgeProposals: [] });
    },
  }), undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets: secretsFor });
  const server = await core.saveMcpServer(fixtureConfig());
  const base = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...base, provider: 'openai', mcpServerIds: [server.id] });
  const taskId = await core.command('createTask', { workerId: base.id, brief: 'Echo rồi ghi chú', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 }) as string;

  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core!.runner.isActive(taskId));
  const first = store.detail(taskId).task.decisionRequests![0];
  expect(first.approval).toMatchObject({ serverId: server.id, serverName: 'Fixture', tool: 'echo' });
  expect(first.approval!.arguments).toContain('"text": "hi"');
  // Typing an answer is not one of the four choices.
  await expect(core.command('answerDecision', { taskId, requestId: first.id, answer: 'ok' })).rejects.toThrow();
  await core.command('answerDecision', { taskId, requestId: first.id, answer: 'once' });

  await until(() => store.detail(taskId).task.decisionRequests!.length === 2 && store.detail(taskId).task.status === 'waiting_input' && !core!.runner.isActive(taskId));
  expect(JSON.stringify(resumed)).toContain('echo: hi');
  expect(store.detail(taskId).task.mcpGrants ?? []).toEqual([]);
  const second = store.detail(taskId).task.decisionRequests![1];
  expect(second.approval?.tool).toBe('write_note');
  await core.command('answerDecision', { taskId, requestId: second.id, answer: 'refuse' });

  await until(() => store.detail(taskId).task.status === 'completed');
  const detail = store.detail(taskId);
  expect(existsSync(markFile)).toBe(false);
  expect(detail.runs).toHaveLength(1);
  const events = detail.events.map(event => event.message);
  expect(events).toContain('Đã dùng công cụ MCP: echo · Fixture');
  expect(events).toContain('Bạn đã từ chối công cụ MCP: write_note · Fixture');
  expect(detail.artifacts[0].report.summary).toBe('Xong.');
});

it('remembers "always for this chat" and lets the person take it back', async () => {
  let step = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request() {
      step++;
      if (step <= 2) return response('mcp__fixture__write_note', { note: `note ${step}` });
      return response('reply', { message: 'Xong.', title: null, knowledgeProposals: [] });
    },
  }), undefined, undefined, undefined, undefined, undefined, undefined, { readSecrets: secretsFor });
  const server = await core.saveMcpServer(fixtureConfig());
  const base = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...base, provider: 'openai', mcpServerIds: [server.id] });
  const taskId = await core.command('createTask', { workerId: base.id, brief: 'Ghi hai chú thích', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 }) as string;
  await until(() => store.detail(taskId).task.status === 'waiting_input' && !core!.runner.isActive(taskId));
  await core.command('answerDecision', { taskId, requestId: store.detail(taskId).task.decisionRequests![0].id, answer: 'server' });
  await until(() => store.detail(taskId).task.status === 'completed');
  // The second call ran without a second card.
  expect(store.detail(taskId).task.decisionRequests).toHaveLength(1);
  expect(await readFile(markFile, 'utf8')).toBe('note 1\nnote 2\n');
  expect(store.detail(taskId).task.mcpGrants).toEqual([{ serverId: server.id, tool: null }]);
  await core.command('setMcpGrant', { taskId, serverId: server.id, tool: null, allowed: false });
  expect(store.detail(taskId).task.mcpGrants).toEqual([]);
});

it('names tools uniquely within the providers’ limits and folds approval answers into grants', () => {
  const serverId = id();
  const otherId = id();
  const names = mcpToolNames([
    { serverId, serverName: 'GitHub Tools', tool: 'search.issues' },
    { serverId, serverName: 'GitHub Tools', tool: 'search_issues' },
    { serverId: otherId, serverName: 'github tools', tool: 'x'.repeat(120) },
  ]);
  expect(names[0]).toBe('mcp__github_tools__search_issues');
  expect(new Set(names).size).toBe(3);
  for (const name of names) expect(name).toMatch(/^mcp__[A-Za-z0-9_-]{1,59}$/);
  expect(names[2].startsWith('mcp__github_tools_2__')).toBe(true);
  const approval = { serverId, tool: 'search' };
  expect(grantsAfterApproval([], approval, 'once')).toEqual([]);
  expect(grantsAfterApproval([], approval, 'refuse')).toEqual([]);
  expect(grantsAfterApproval([], approval, 'tool')).toEqual([{ serverId, tool: 'search' }]);
  expect(grantsAfterApproval([{ serverId, tool: 'search' }], approval, 'server')).toEqual([{ serverId, tool: null }]);
});
