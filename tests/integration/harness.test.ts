import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { candidates, detectHarnesses, type Probe } from '../../apps/desktop/src/core/harness/detect';
import { executeHarness, harnessArgs, HarnessError, parseClaudeOutput, parseCodexOutput, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { harnessReady, harnessStatus, loginCommand, missingHarness, type HarnessInfo } from '../../apps/desktop/src/shared/harness';
import type { Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-harness-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const touch = async (path: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, ''); };

describe('detection', () => {
  it('finds PATH, desktop-bundled (including MSIX package) and Codex app installs, newest bundle first', async () => {
    const home = join(directory, 'home'); const local = join(home, 'AppData', 'Local'); const roaming = join(home, 'AppData', 'Roaming');
    const bin = join(directory, 'bin');
    await touch(join(bin, 'codex.cmd'));
    await touch(join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.9', 'claude.exe'));
    await touch(join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.10', 'claude.exe'));
    await touch(join(local, 'OpenAI', 'Codex', 'bin', 'bffc', 'codex.exe'));
    const env = { USERPROFILE: home, LOCALAPPDATA: local, APPDATA: roaming, PATH: bin };
    expect(await candidates('claude-code', env, 'win32')).toEqual([
      join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.10', 'claude.exe'),
      join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.9', 'claude.exe'),
    ]);
    expect(await candidates('codex', env, 'win32')).toEqual([join(bin, 'codex.cmd'), join(local, 'OpenAI', 'Codex', 'bin', 'bffc', 'codex.exe')]);

    const calls: string[] = [];
    const probe: Probe = async (executable, args) => {
      calls.push(`${executable} ${args.join(' ')}`);
      if (executable.endsWith('codex.cmd')) return { code: 1, stdout: '', stderr: 'broken shim' };
      if (args[0] === '--version') return { code: 0, stdout: executable.includes('claude') ? '2.1.10 (Claude Code)\n' : 'codex-cli 0.154.0\n', stderr: '' };
      if (args.join(' ') === 'auth status') return { code: 0, stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), stderr: '' };
      return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    };
    const found = await detectHarnesses(env, 'win32', probe);
    expect(found.map(item => item.id)).toEqual(['claude-code', 'codex', 'cursor']);
    expect(found[0]).toEqual(expect.objectContaining({
      id: 'claude-code', version: '2.1.10 (Claude Code)', auth: 'logged_out', status: 'detected',
      executable: expect.stringContaining('2.1.10'), runnable: true,
      loginCommand: expect.stringContaining('auth login'),
    }));
    expect(found[1]).toEqual(expect.objectContaining({
      id: 'codex', version: 'codex-cli 0.154.0', auth: 'logged_in', status: 'signed_in',
      executable: expect.stringContaining('bffc'), runnable: true,
    }));
    expect(found[2]).toEqual(expect.objectContaining({ id: 'cursor', auth: 'missing', status: 'not_installed', runnable: false, loginCommand: 'agent login' }));
    expect(found[0].authDetail).toContain('chưa đăng nhập nên chưa sẵn sàng chạy');
    expect(found[0].loginCommand).toMatch(/^& "/);
    // Probing is limited to version and the CLI's own login status command.
    expect(calls.every(call => /(--version|auth status|login status|status)$/.test(call))).toBe(true);
  });

  it('finds Claude desktop bundles and PATH installs on macOS', async () => {
    const home = join(directory, 'home');
    const bin = join(directory, 'bin');
    await touch(join(bin, 'claude'));
    await touch(join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.9', 'claude'));
    await touch(join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.10', 'claude'));
    const env = { HOME: home, USERPROFILE: home, PATH: bin };
    expect(await candidates('claude-code', env, 'darwin')).toEqual([
      join(bin, 'claude'),
      join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.10', 'claude'),
      join(home, 'Library', 'Application Support', 'Claude', 'claude-code', '2.1.9', 'claude'),
    ]);
  });

  it('lists Cursor from its Windows install folder and records auth-probe failures as auth_error, not ready', async () => {
    const home = join(directory, 'home'); const local = join(home, 'AppData', 'Local');
    const agent = join(local, 'cursor-agent', 'agent.cmd');
    await touch(agent);
    const env = { USERPROFILE: home, LOCALAPPDATA: local, APPDATA: join(home, 'AppData', 'Roaming'), PATH: '' };
    expect(await candidates('cursor', env, 'win32')).toEqual([agent]);
    const probe: Probe = async (executable, args) => {
      if (args[0] === '--version') return { code: 0, stdout: executable.includes('agent') ? '2026.3.11\n' : '2.1.10\n', stderr: '' };
      if (args[0] === 'status') return { code: 1, stdout: '', stderr: 'Error checking authentication' };
      if (args.join(' ') === 'auth status') return { code: 0, stdout: 'not-json', stderr: '' };
      if (args.join(' ') === 'login status') return { code: 2, stdout: '', stderr: 'Error checking login status' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const found = await detectHarnesses(env, 'win32', probe);
    expect(found).toEqual([
      expect.objectContaining({ id: 'claude-code', status: 'not_installed', auth: 'missing' }),
      expect.objectContaining({ id: 'codex', status: 'not_installed', auth: 'missing' }),
      expect.objectContaining({
        id: 'cursor', auth: 'unknown', status: 'auth_error', runnable: false,
        executable: agent, loginCommand: `& "${agent}" login`,
      }),
    ]);
    expect(found[2].authDetail).toContain('không đọc được trạng thái đăng nhập');
    expect(found[2].authDetail).toContain('không chuyển sang Demo');
    expect(found[2].installCommand).toBe("irm 'https://cursor.com/install?win32=true' | iex");
    expect(harnessReady(found[2])).toBe(false);
  });

  it('treats Cursor "Not authenticated" as detected, not ready-to-run', async () => {
    const agent = join(directory, 'agent');
    await touch(agent);
    const env = { HOME: directory, PATH: directory };
    const probe: Probe = async (_executable, args) => {
      if (args[0] === '--version') return { code: 0, stdout: '2026.3.11\n', stderr: '' };
      return { code: 1, stdout: 'Not authenticated\n', stderr: '' };
    };
    const [cursor] = (await detectHarnesses(env, 'linux', probe)).filter(item => item.id === 'cursor');
    expect(cursor).toEqual(expect.objectContaining({
      auth: 'logged_out',
      status: 'detected',
      executable: agent,
      loginCommand: loginCommand('cursor', agent, 'linux'),
    }));
    expect(cursor.loginCommand).toMatch(/login$/);
    expect(harnessReady(cursor)).toBe(false);
  });
});

describe('status matrix', () => {
  it('does not treat detected or unread auth as ready, and never maps a failed harness onto Demo', () => {
    expect(harnessStatus('missing')).toBe('not_installed');
    expect(harnessStatus('logged_out')).toBe('detected');
    expect(harnessStatus('unknown')).toBe('auth_error');
    expect(harnessStatus('logged_in')).toBe('signed_in');
    const loggedOut = { auth: 'logged_out' as const, runnable: true };
    const unread = { auth: 'unknown' as const, runnable: true };
    const signedIn = { auth: 'logged_in' as const, runnable: true };
    const cursorSignedIn = { auth: 'logged_in' as const, runnable: false };
    expect(harnessReady(loggedOut)).toBe(false);
    expect(harnessReady(unread)).toBe(false);
    expect(harnessReady(signedIn)).toBe(true);
    expect(harnessReady(cursorSignedIn)).toBe(false);
    const catalog = [
      { ...missingHarness('claude-code', 'linux'), auth: 'logged_out' as const, status: 'detected' as const, runnable: true },
      missingHarness('codex', 'linux'),
    ];
    expect(harnessReady(catalog[0])).toBe(false);
    expect(harnessReady(catalog[1])).toBe(false);
    expect(loginCommand('claude-code', 'C:\\Claude\\claude.exe', 'win32')).toBe('& "C:\\Claude\\claude.exe" auth login');
    expect(loginCommand('codex', undefined, 'linux')).toBe('codex login');
    expect(loginCommand('cursor', '/home/me/.local/bin/agent', 'linux')).toBe('/home/me/.local/bin/agent login');
    expect(loginCommand('claude-code', '/Users/me/claude', 'darwin')).toBe('/Users/me/claude auth login');
  });
});

describe('command contract', () => {
  it('runs Claude Code without command, network or user customization tools and Codex in a read-only sandbox', () => {
    const claude = harnessArgs({ harness: 'claude-code', cwd: directory, schema: { type: 'object' }, maxBudgetUsd: 0.25 });
    expect(claude).toEqual(expect.arrayContaining(['-p', '--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']));
    expect(claude[claude.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    // Streamed events let the window show reads and the answer as they happen.
    expect(claude[claude.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(claude).toEqual(expect.arrayContaining(['--verbose', '--include-partial-messages']));
    expect(claude[claude.indexOf('--max-budget-usd') + 1]).toBe('0.2500');
    expect(claude).not.toContain('--dangerously-skip-permissions');
    const codex = harnessArgs({ harness: 'codex', cwd: directory, schema: {}, maxBudgetUsd: 1 });
    expect(codex[codex.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(codex).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', 'apps', 'browser_use', 'computer_use', 'shell_tool', 'unified_exec']));
    expect(codex.join(' ')).not.toMatch(/danger|workspace-write|approve-for-me/);
  });

  it('parses real CLI failure shapes into actionable login messages', () => {
    const notLoggedIn = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', total_cost_usd: 0 });
    expect(() => parseClaudeOutput(notLoggedIn)).toThrow('chưa đăng nhập');
    expect(() => parseClaudeOutput(notLoggedIn)).toThrow('không chuyển sang Demo');
    expect(parseClaudeOutput(JSON.stringify({ is_error: false, result: '', structured_output: { title: 'x' }, total_cost_usd: 0.01 }))).toEqual({ output: { title: 'x' }, costUsd: 0.01 });
    expect(parseClaudeOutput(JSON.stringify({ is_error: false, result: '{"title":"y"}' })).output).toEqual({ title: 'y' });
    const expired = ['{"type":"thread.started"}', 'ERROR 401 Unauthorized: Provided authentication token is expired. token_expired', '{"type":"turn.failed","error":{"message":"The model is not supported"}}'].join('\n');
    expect(() => parseCodexOutput(expired, null)).toThrow('chưa đăng nhập');
    expect(() => parseCodexOutput('{"type":"turn.completed"}', null)).toThrow(HarnessError);
    expect(parseCodexOutput('{"type":"turn.completed"}', '{"title":"z"}').output).toEqual({ title: 'z' });
  });

  it.runIf(process.platform === 'win32')('passes the JSON schema and prompt intact through an npm-style .cmd shim', async () => {
    const script = join(directory, 'fake-claude.mjs');
    await writeFile(script, `
      import { readFileSync } from 'node:fs';
      const args = process.argv.slice(2); const stdin = readFileSync(0, 'utf8');
      const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
      process.stdout.write(JSON.stringify({ is_error: false, structured_output: { args, schema, stdin, cwd: process.cwd() }, total_cost_usd: 0.002 }));
    `);
    const shim = join(directory, 'with space', 'claude.cmd');
    await mkdir(join(shim, '..'), { recursive: true });
    await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
    const schema = { type: 'object', properties: { title: { type: 'string', description: 'A "quoted" & spaced value, 100% (not ^escaped) | <tag> \\ trailing\\' } } };
    const result = await executeHarness({ harness: 'claude-code', executable: shim, cwd: directory, prompt: 'Review "this" & that\nsecond line', schema, signal: new AbortController().signal, maxBudgetUsd: 0.1 });
    const output = result.output as { args: string[]; schema: unknown; stdin: string; cwd: string };
    expect(output.schema).toEqual(schema); expect(output.stdin).toBe('Review "this" & that\nsecond line');
    expect(output.args).toContain('--restricted'); expect(result.costUsd).toBe(0.002);
  });
});

const fixture = (item: Pick<HarnessInfo, 'id' | 'executable' | 'version' | 'auth' | 'authDetail'>): HarnessInfo => ({
  name: item.id === 'claude-code' ? 'Claude Code' : item.id === 'codex' ? 'Codex' : 'Cursor',
  status: harnessStatus(item.auth),
  loginCommand: loginCommand(item.id, item.executable || undefined, 'win32'),
  runnable: item.id !== 'cursor',
  ...item,
});

describe('runner integration', () => {
  let store: Store; let core: CoreService; let sources: Source[]; let detected: HarnessInfo[];
  let requests: (HarnessRequest & { files: Record<string, string> })[]; let reply: (request: HarnessRequest) => Promise<unknown>;
  beforeEach(async () => {
    store = new Store(':memory:'); requests = [];
    detected = [
      fixture({ id: 'claude-code', executable: 'claude.exe', version: '2.1.270 (Claude Code)', auth: 'logged_in', authDetail: 'Đăng nhập qua claude.ai' }),
      fixture({ id: 'codex', executable: 'codex.exe', version: 'codex-cli 0.154.0', auth: 'logged_in', authDetail: 'Logged in using ChatGPT' }),
      fixture({ id: 'cursor', executable: '', version: '', auth: 'missing', authDetail: 'Chưa cài Cursor trên máy này. Cài xong bấm Dò lại.' }),
    ];
    reply = async request => ({ title: 'Harness review', summary: 'Checked the note.', findings: [{ title: 'Answer located', severity: 'info', detail: 'Line two states the answer.', sourceIds: [sources[0].id], coverage: 'Full note', category: 'other', recommendation: null, checkerIds: [], locations: [{ sourceId: sources[0].id, startLine: 2, endLine: 2 }] }], limitations: [], review: { checks: [], recommendation: 'insufficient_evidence', draftFeedback: 'None.', upstreamFindingIds: [], conflicts: [] }, knowledgeProposals: [], cwd: request.cwd });
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => detected,
      execute: async request => {
        const files: Record<string, string> = {};
        for (const name of await readdir(join(request.cwd, 'sources'))) files[name] = await readFile(join(request.cwd, 'sources', name), 'utf8');
        requests.push({ ...request, files });
        return { output: await reply(request), costUsd: 0.003 };
      },
    });
    const note = join(directory, 'note.txt'); await writeFile(note, 'line one\nline two: the answer is 42');
    sources = await core.sources.import([note]);
  });
  afterEach(() => store.close());
  const idle = async () => { for (let i = 0; i < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); i++) await new Promise(resolve => setTimeout(resolve, 10)); };
  async function run(provider: 'claude-code' | 'codex', scopes: string[] = [provider]) {
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider }) as Worker;
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Find the answer in the note', sourceIds: sources.map(source => source.id), consent: true, providerScopes: scopes, budgetMicros: 500_000 }) as string;
    await idle(); return store.detail(taskId);
  }

  it('hands a verified source copy to the harness, validates its report and records no Orglet reservation', async () => {
    const detail = await run('claude-code');
    expect(detail.task.status).toBe('completed');
    const [request] = requests;
    expect(Object.values(request.files)).toEqual(['line one\nline two: the answer is 42']);
    expect(request.prompt).toContain('Find the answer in the note'); expect(request.prompt).toContain(sources[0].id);
    expect(request.maxBudgetUsd).toBe(0.5);
    expect(existsSync(request.cwd)).toBe(false);
    const report = detail.artifacts[0].report;
    expect(report.findings[0].locations).toEqual([{ sourceId: sources[0].id, startLine: 2, endLine: 2 }]);
    expect(report.limitations.join(' ')).toContain('Claude Code 2.1.270');
    expect(report).not.toHaveProperty('cwd');
    expect(detail.usage).toEqual({ chargedMicros: 0, reservedMicros: 0, uncertainCount: 0 });
    expect(detail.events.map(event => event.message).join(' ')).toContain('$0.0030');
  });

  it('inlines source text for Codex, which has no file tool, and rejects out-of-range citations', async () => {
    const codex = await run('codex');
    expect(codex.artifacts[0].report.limitations.join(' ')).toContain('không có tool đọc tệp');
    expect(requests.at(-1)!.prompt).toContain('line two: the answer is 42');
    expect(requests[0].prompt).not.toBeUndefined();
    reply = async () => ({ title: 'Bad', summary: 'x', findings: [{ title: 'x', severity: 'info', detail: 'x', sourceIds: [sources[0].id], coverage: 'x', category: 'other', recommendation: null, checkerIds: [], locations: [{ sourceId: sources[0].id, startLine: 9, endLine: 9 }] }], limitations: [], review: null, knowledgeProposals: [] });
    const failed = await run('codex');
    expect(failed.task.status).toBe('failed'); expect(failed.artifacts).toEqual([]);
  });

  it('requires consent for the harness and stops before copying sources when it is missing or logged out', async () => {
    await expect(run('codex', ['claude-code'])).rejects.toThrow('provider');
    detected = [{ ...detected[0], auth: 'logged_out', status: 'detected', authDetail: 'Đã thấy Claude Code trên máy, nhưng chưa đăng nhập nên chưa sẵn sàng chạy. Dán lệnh này vào terminal: claude auth login' }];
    const loggedOut = await run('claude-code');
    expect(loggedOut.task.status).toBe('failed'); expect(loggedOut.runs[0].error).toContain('claude auth login');
    expect(loggedOut.artifacts).toEqual([]);
    expect(loggedOut.runs[0].snapshot.worker.provider).toBe('claude-code');
    expect(loggedOut.runs[0].error).not.toMatch(/demo|Báo cáo mẫu/i);
    // Detection is cached; "Dò lại" in settings is the refresh path after installing or logging in.
    detected = []; await core.command('harnesses', { refresh: true });
    expect((await run('claude-code')).runs[0].error).toContain('Không tìm thấy Claude Code');
    expect(requests).toEqual([]);
  });

  it('fails a signed-out auth probe as an auth error and does not fall back to Demo', async () => {
    detected = [{ ...detected[0], auth: 'unknown', status: 'auth_error', authDetail: 'Claude Code có trên máy nhưng không đọc được trạng thái đăng nhập. Chạy claude auth login rồi bấm Dò lại. Orglet không chuyển sang Demo.' }];
    const failed = await run('claude-code');
    expect(failed.task.status).toBe('failed');
    expect(failed.artifacts).toEqual([]);
    expect(failed.runs[0].snapshot.worker.provider).toBe('claude-code');
    expect(failed.runs[0].error).toContain('không chuyển sang Demo');
    expect(failed.runs[0].error).toContain('claude auth login');
    expect(requests).toEqual([]);
  });

  it('kills a cancelled harness run without committing a report', async () => {
    reply = request => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
    const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'claude-code' }) as Worker;
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Cancel me', sourceIds: [], consent: true, providerScopes: ['claude-code'], budgetMicros: 500_000 }) as string;
    for (let i = 0; i < 100 && !requests.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    await core.command('cancel', { id: taskId }); await idle();
    expect(store.detail(taskId).task.status).toBe('cancelled'); expect(store.detail(taskId).artifacts).toEqual([]);
  });
});
