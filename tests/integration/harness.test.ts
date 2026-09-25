import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { candidates, detectHarnesses, harnessAccountEnv, type Probe } from '../../apps/desktop/src/core/harness/detect';
import { HarnessAccounts } from '../../apps/desktop/src/core/harness/accounts';
import { executeHarness, harnessArgs, HarnessError, HarnessLimitError, HarnessTerminationError, killTree, stopHarnessProcess, stderrTail, parseClaudeOutput, parseCodexOutput, parseCursorOutput, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { harnessNames, harnessReady, harnessStatus, loginCommand, loginCommands, missingHarness, SYSTEM_ACCOUNT_ID, type HarnessInfo } from '../../apps/desktop/src/shared/harness';
import type { Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-harness-test-')); });
// A process that was just killed can hold its folder open for a moment on Windows, so the cleanup retries.
afterEach(async () => { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
const touch = async (path: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, ''); };

describe('detection', () => {
  it('finds PATH, desktop-bundled (including MSIX package), Codex app and Cursor Agent installs, newest bundle first', async () => {
    const home = join(directory, 'home'); const local = join(home, 'AppData', 'Local'); const roaming = join(home, 'AppData', 'Roaming');
    const bin = join(directory, 'bin');
    await touch(join(bin, 'codex.cmd'));
    await touch(join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.9', 'claude.exe'));
    await touch(join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.10', 'claude.exe'));
    await touch(join(local, 'OpenAI', 'Codex', 'bin', 'bffc', 'codex.exe'));
    await touch(join(home, '.cursor', 'bin', 'agent.exe'));
    const env = { USERPROFILE: home, LOCALAPPDATA: local, APPDATA: roaming, PATH: bin };
    expect(await candidates('claude-code', env, 'win32')).toEqual([
      join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.10', 'claude.exe'),
      join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.9', 'claude.exe'),
    ]);
    // The app's executable outranks the npm shim on PATH: a shim can only start through cmd.exe (COD-170).
    expect(await candidates('codex', env, 'win32')).toEqual([join(local, 'OpenAI', 'Codex', 'bin', 'bffc', 'codex.exe'), join(bin, 'codex.cmd')]);
    expect(await candidates('cursor', env, 'win32')).toEqual([join(home, '.cursor', 'bin', 'agent.exe')]);

    const calls: string[] = [];
    const probe: Probe = async (executable, args) => {
      calls.push(`${executable} ${args.join(' ')}`);
      if (executable.endsWith('codex.cmd')) return { code: 1, stdout: '', stderr: 'broken shim' };
      if (args[0] === '--version') {
        if (executable.includes('agent')) return { code: 0, stdout: '2026.1.0\n', stderr: '' };
        return { code: 0, stdout: executable.includes('claude') ? '2.1.10 (Claude Code)\n' : 'codex-cli 0.154.0\n', stderr: '' };
      }
      if (args.join(' ') === 'auth status') return { code: 0, stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: JSON.stringify({ loggedIn: true, email: 'dev@example.com' }), stderr: '' };
      return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    };
    const found = await detectHarnesses(env, 'win32', probe);
    expect(found.map(item => item.id)).toEqual(['claude-code', 'codex', 'cursor', 'gemini']);
    expect(found[0]).toEqual(expect.objectContaining({
      id: 'claude-code', version: '2.1.10', auth: 'logged_out', status: 'detected',
      executable: expect.stringContaining('2.1.10'), runnable: true,
      loginCommand: expect.stringContaining('auth login'),
    }));
    expect(found[1]).toEqual(expect.objectContaining({
      id: 'codex', version: '0.154.0', auth: 'logged_in', status: 'signed_in',
      executable: expect.stringContaining('bffc'), runnable: true,
    }));
    expect(found[2]).toEqual(expect.objectContaining({
      id: 'cursor', version: '2026.1.0', auth: 'logged_in', status: 'signed_in',
      executable: expect.stringContaining('agent.exe'), runnable: true,
    }));
    expect(found[0].authDetail).toContain('chưa đăng nhập. Lấy lệnh đăng nhập ở Cài đặt');
    expect(found[0].loginCommand).toMatch(/^& "/);
    // Probing is limited to version and the CLI's own login status command.
    expect(calls.every(call => /(--version|auth status|login status|status(?: --format json)?)$/.test(call))).toBe(true);
  });

  it('names a login path the person can open: the MSIX package copy over %APPDATA%, and their own install over the app build (COD-224)', async () => {
    const home = join(directory, 'home'); const local = join(home, 'AppData', 'Local'); const roaming = join(home, 'AppData', 'Roaming');
    const packaged = join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.280', 'claude.exe');
    const viewOnly = join(roaming, 'Claude', 'claude-code', '2.1.280', 'claude.exe');
    const npmClaude = join(roaming, 'npm', 'claude.cmd');
    const codexApp = join(local, 'OpenAI', 'Codex', 'bin', 'bffc', 'codex.exe');
    const npmCodex = join(roaming, 'npm', 'codex.cmd');
    for (const path of [packaged, viewOnly, npmClaude, codexApp, npmCodex]) await touch(path);
    const env = { USERPROFILE: home, LOCALAPPDATA: local, APPDATA: roaming, PATH: '' };
    expect(await candidates('claude-code', env, 'win32')).toEqual([packaged, viewOnly, npmClaude]);

    const probe: Probe = async (executable, args) => {
      if (args[0] === '--version') {
        // The npm Codex shim is broken, so its login command stays on the app's build.
        if (executable === npmCodex) return { code: 1, stdout: '', stderr: 'broken shim' };
        return { code: 0, stdout: executable.includes('claude') ? '2.1.280 (Claude Code)\n' : 'codex-cli 0.155.0\n', stderr: '' };
      }
      if (args.join(' ') === 'auth status') return { code: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: '' };
      return { code: 0, stdout: 'Not logged in\n', stderr: '' };
    };
    const accounts = new HarnessAccounts(new Store(':memory:'), join(directory, 'accounts'));
    await accounts.add('claude-code', 'Work');
    const [claude, codex] = await detectHarnesses(env, 'win32', probe, accounts.map());
    // Runs keep the app's build, which starts without a shell (COD-170).
    expect(claude.executable).toBe(packaged);
    expect(claude.loginCommand).toContain(`& "${npmClaude}" auth login`);
    expect(claude.loginCommand).toMatch(/^\$env:CLAUDE_CONFIG_DIR = /);
    expect(codex.executable).toBe(codexApp);
    expect(codex.loginCommand).toBe(`& "${codexApp}" login`);
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
        id: 'cursor', auth: 'unknown', status: 'auth_error', runnable: true,
        executable: agent, loginCommand: `& "${agent}" login`,
      }),
      expect.objectContaining({ id: 'gemini', status: 'not_installed', auth: 'missing' }),
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
    const cursorSignedIn = { auth: 'logged_in' as const, runnable: true };
    expect(harnessReady(loggedOut)).toBe(false);
    expect(harnessReady(unread)).toBe(false);
    expect(harnessReady(signedIn)).toBe(true);
    expect(harnessReady(cursorSignedIn)).toBe(true);
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
    // A chat without a cap for Claude Code runs on the person's plan, so the flag is left out entirely (COD-253).
    const uncapped = harnessArgs({ harness: 'claude-code', cwd: directory, schema: { type: 'object' } });
    expect(uncapped).not.toContain('--max-budget-usd');
    const codex = harnessArgs({ harness: 'codex', cwd: directory, schema: {}, maxBudgetUsd: 1 });
    expect(codex[codex.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(codex).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', 'apps', 'browser_use', 'computer_use', 'shell_tool', 'unified_exec']));
    // Without this the CLI emits no reasoning items, and a run shows nothing until it finishes.
    expect(codex[codex.indexOf('-c') + 1]).toBe('model_reasoning_summary=detailed');
    const overrides = codex.flatMap((argument, index) => argument === '-c' ? [codex[index + 1]] : []);
    expect(overrides).toEqual(expect.arrayContaining(['web_search="disabled"', 'project_doc_max_bytes=0', 'tools.view_image=false']));
    expect(codex.join(' ')).not.toMatch(/danger|workspace-write|approve-for-me/);
    const cursor = harnessArgs({ harness: 'cursor', cwd: directory, schema: { type: 'object' }, maxBudgetUsd: 1 });
    expect(cursor).toEqual(expect.arrayContaining(['-p', '--mode=ask', '--sandbox', 'enabled', '--trust', '--workspace', directory, '--output-format', 'json']));
    expect(cursor.join(' ')).not.toMatch(/force|yolo|approve-mcps/);
    expect(harnessArgs({ harness: 'claude-code', cwd: directory, schema: { type: 'object' }, maxBudgetUsd: 0.25, model: 'haiku' })).toEqual(expect.arrayContaining(['--model', 'haiku']));
    expect(harnessArgs({ harness: 'codex', cwd: directory, schema: {}, maxBudgetUsd: 1, model: 'gpt-5' })).toEqual(expect.arrayContaining(['-m', 'gpt-5']));
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
    expect(parseCursorOutput(JSON.stringify({ result: '{"title":"c"}' })).output).toEqual({ title: 'c' });
    expect(() => parseCursorOutput(JSON.stringify({ error: 'Please run agent login' }))).toThrow('Harness trên máy');
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

it.runIf(process.platform === 'win32')('waits for a cancelled CLI and its descendant to exit before returning', async () => {
  const script = join(directory, 'cancel-fixture.cjs');
  const pidFile = join(directory, 'pids.json');
  await writeFile(script, `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
    writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, descendant.pid]));
    process.stdin.resume();
    setInterval(() => {}, 1000);
  `);
  const shim = join(directory, 'cancel-fixture.cmd');
  await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
  const controller = new AbortController();
  const execution = executeHarness({ harness: 'claude-code', executable: shim, cwd: directory,
    prompt: 'fixture', schema: {}, signal: controller.signal, maxBudgetUsd: 1 });
  const outcome = execution.catch(error => error);
  try {
    for (let attempt = 0; attempt < 200 && !existsSync(pidFile); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(existsSync(pidFile)).toBe(true);
    const pids: number[] = JSON.parse(await readFile(pidFile, 'utf8'));
    controller.abort(new Error('Fixture cancellation'));
    expect(await outcome).toMatchObject({ message: 'Fixture cancellation' });
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    controller.abort();
    await outcome;
  }
});

it.runIf(process.platform === 'win32')('bounds stderr output and waits for the offending process to stop', async () => {
  const script = join(directory, 'stderr-fixture.cjs');
  const pidFile = join(directory, 'stderr-pid.json');
  await writeFile(script, `
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify(process.pid));
    process.stdin.resume();
    const chunk = Buffer.alloc(1024 * 1024, 120);
    function flood() {
      if (process.stderr.write(chunk)) setImmediate(flood);
      else process.stderr.once('drain', flood);
    }
    flood();
  `);
  const shim = join(directory, 'stderr-fixture.cmd');
  await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
  await expect(executeHarness({ harness: 'claude-code', executable: shim, cwd: directory,
    prompt: 'fixture', schema: {}, signal: new AbortController().signal, maxBudgetUsd: 1 }))
    .rejects.toThrow('Output của harness vượt giới hạn.');
  const pid = JSON.parse(await readFile(pidFile, 'utf8')) as number;
  expect(() => process.kill(pid, 0)).toThrow();
});

const fixture = (item: Pick<HarnessInfo, 'id' | 'executable' | 'version' | 'auth' | 'authDetail'>): HarnessInfo => ({
  name: harnessNames[item.id],
  status: harnessStatus(item.auth),
  accountId: SYSTEM_ACCOUNT_ID,
  accounts: [],
  loginCommand: loginCommand(item.id, item.executable || undefined, 'win32'),
  loginCommands: loginCommands(item.id, item.executable || undefined, 'win32'),
  runnable: true,
  ...item,
});

it('takes a real executable over a shell shim, wherever each was found', async () => {
  const home = join(directory, 'home');
  const npm = join(home, 'AppData', 'Roaming', 'npm');
  const local = join(home, 'AppData', 'Local');
  // What this machine has: npm's shim first on PATH, the desktop build's executable further down the search.
  await touch(join(npm, 'claude.cmd'));
  await touch(join(local, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.9', 'claude.exe'));
  const paths = await candidates('claude-code', { USERPROFILE: home, LOCALAPPDATA: local, APPDATA: join(home, 'AppData', 'Roaming'), PATH: npm }, 'win32');
  // A .cmd can only run through cmd.exe, whose 8191-character line cannot carry the report schema.
  expect(paths[0].endsWith('claude.exe')).toBe(true);
  expect(paths.at(-1)!.endsWith('claude.cmd')).toBe(true);
});

describe('accounts', () => {
  const signedIn: Probe = (_executable, args) => Promise.resolve(
    args[0] === '--version' ? { code: 0, stdout: '2.1.10 (Claude Code)', stderr: '' }
      : { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' });

  it('keeps one credential folder per account and falls back to the system account', async () => {
    const store = new Store(':memory:');
    const accounts = new HarnessAccounts(store, join(directory, 'harness-accounts'));
    expect(accounts.selection('claude-code')).toEqual({ accountId: SYSTEM_ACCOUNT_ID, accounts: [] });

    const work = await accounts.add('claude-code', 'Công ty');
    const folder = join(directory, 'harness-accounts', 'claude-code', work.id);
    expect(existsSync(folder)).toBe(true);
    // Adding selects it, so the login command shown next signs into the new account.
    expect(accounts.selection('claude-code')).toEqual({ accountId: work.id, accounts: [work], configDir: folder });
    // Accounts are per harness: adding one to Claude Code leaves Codex on its own sign-in.
    expect(accounts.selection('codex').accountId).toBe(SYSTEM_ACCOUNT_ID);

    accounts.rename('claude-code', work.id, 'Cá nhân');
    expect(accounts.selection('claude-code').accounts[0].label).toBe('Cá nhân');

    accounts.select('claude-code', SYSTEM_ACCOUNT_ID);
    expect(accounts.selection('claude-code').configDir).toBeUndefined();
    expect(accounts.selection('claude-code').accounts).toHaveLength(1);

    accounts.select('claude-code', work.id);
    await accounts.remove('claude-code', work.id);
    expect(existsSync(folder)).toBe(false);
    expect(accounts.selection('claude-code')).toEqual({ accountId: SYSTEM_ACCOUNT_ID, accounts: [] });
    expect(() => accounts.select('claude-code', work.id)).toThrow('Không còn tài khoản này.');
  });

  it('probes and signs in through the selected account folder', async () => {
    const folder = join(directory, 'claude-work');
    const probed: NodeJS.ProcessEnv[] = [];
    const record: Probe = (executable, args, overrides) => { probed.push(overrides ?? {}); return signedIn(executable, args); };
    const executable = join(directory, 'bin', 'claude.exe');
    await touch(executable);
    const [claude] = await detectHarnesses({ PATH: join(directory, 'bin') }, 'win32', record, {
      'claude-code': { accountId: 'work', accounts: [{ id: 'work', label: 'Công ty' }], configDir: folder },
      codex: { accountId: SYSTEM_ACCOUNT_ID, accounts: [] },
      cursor: { accountId: SYSTEM_ACCOUNT_ID, accounts: [] },
      gemini: { accountId: SYSTEM_ACCOUNT_ID, accounts: [] },
    });
    expect(probed.every(overrides => overrides.CLAUDE_CONFIG_DIR === folder)).toBe(true);
    expect(claude).toEqual(expect.objectContaining({ accountId: 'work', configDir: folder, auth: 'logged_in' }));
    expect(claude.accounts).toEqual([{ id: 'work', label: 'Công ty' }]);
    // The command the user pastes points the CLI at the same folder, so the sign-in lands in this account.
    expect(claude.loginCommand).toBe(`$env:CLAUDE_CONFIG_DIR = "${folder}"; & "${executable}" auth login`);
  });

  it('names the folder variable each CLI reads', () => {
    expect(harnessAccountEnv('claude-code', '/a')).toEqual({ CLAUDE_CONFIG_DIR: '/a' });
    expect(harnessAccountEnv('codex', '/b')).toEqual({ CODEX_HOME: '/b' });
    expect(harnessAccountEnv('cursor', '/c')).toEqual({ CURSOR_CONFIG_DIR: '/c' });
    expect(harnessAccountEnv('gemini', '/d')).toEqual({ GEMINI_CLI_HOME: '/d' });
    // The system account runs the CLI exactly as installed.
    expect(harnessAccountEnv('claude-code', undefined)).toEqual({});
  });

  it.runIf(process.platform === 'win32')('runs the CLI inside the account folder', async () => {
    const script = join(directory, 'fake-claude-account.mjs');
    await writeFile(script, `
      process.stdout.write(JSON.stringify({ is_error: false, structured_output: { configDir: process.env.CLAUDE_CONFIG_DIR ?? null }, total_cost_usd: 0 }));
    `);
    const shim = join(directory, 'claude-account.cmd');
    await writeFile(shim, `@"${process.execPath}" "${script}" %*

`);
    const folder = join(directory, 'account-folder');
    const request = { harness: 'claude-code', executable: shim, cwd: directory, prompt: 'x', schema: {}, signal: new AbortController().signal, maxBudgetUsd: 0.1 } as const;
    const withAccount = await executeHarness({ ...request, configDir: folder });
    expect((withAccount.output as { configDir: string }).configDir).toBe(folder);
    const withoutAccount = await executeHarness(request);
    expect((withoutAccount.output as { configDir: string | null }).configDir).toBe(process.env.CLAUDE_CONFIG_DIR ?? null);
  });
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
      fixture({ id: 'gemini', executable: 'gemini.cmd', version: '0.61.0', auth: 'logged_in', authDetail: 'Đăng nhập Google · an@example.com' }),
    ];
    reply = async request => ({ title: 'Harness review', summary: 'Checked the note.', findings: [{ title: 'Answer located', severity: 'info', detail: 'Line two states the answer.', sourceIds: [sources[0].id], coverage: 'Full note', category: 'other', recommendation: null, checkerIds: [], locations: [{ sourceId: sources[0].id, startLine: 2, endLine: 2 }] }], limitations: [], review: { checks: [], recommendation: 'insufficient_evidence', draftFeedback: 'None.', upstreamFindingIds: [], conflicts: [] }, knowledgeProposals: [], cwd: request.cwd });
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, undefined, {
      detect: async () => detected,
      execute: async request => {
        const files: Record<string, string> = {};
        for (const name of await readdir(join(request.cwd, 'sources'))) files[name] = await readFile(join(request.cwd, 'sources', name), 'utf8');
        requests.push({ ...request, files });
        const output = await reply(request);
        return { output: request.harness === 'codex' ? { payload: JSON.stringify(output) } : output, costUsd: 0.003 };
      },
    });
    const note = join(directory, 'note.txt'); await writeFile(note, 'line one\nline two: the answer is 42');
    sources = await core.sources.import([note]);
  });
  afterEach(() => store.close());
  const idle = async () => { for (let i = 0; i < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); i++) await new Promise(resolve => setTimeout(resolve, 10)); };
  async function run(provider: 'claude-code' | 'codex' | 'gemini', scopes: string[] = [provider]) {
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
    // The seeded orglet has no limit of its own, so Claude Code runs on the person's plan without a cap (COD-253).
    expect(request.maxBudgetUsd).toBeUndefined();
    expect(existsSync(request.cwd)).toBe(false);
    const report = detail.artifacts[0].report;
    expect(report.findings[0].locations).toEqual([{ sourceId: sources[0].id, startLine: 2, endLine: 2 }]);
    expect(report.limitations.join(' ')).toContain('Claude Code 2.1.270');
    expect(report).not.toHaveProperty('cwd');
    expect(detail.usage).toEqual({ chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 });
    expect(detail.events.map(event => event.message).join(' ')).toContain('$0.0030');
  });

  it('marks a run whose harness account ran out of plan usage, so the chat can offer another account (COD-225)', async () => {
    reply = async () => { throw new HarnessLimitError('Claude Code', { kind: 'quota', resetsAt: null }); };
    const outOfPlan = await run('claude-code');
    expect(outOfPlan.runs.at(-1)).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'plan_limit' }));
    expect(outOfPlan.runs.at(-1)?.error).toContain('Claude Code đã hết lượt dùng của gói');
    // A rate limit passes in minutes; switching accounts is not the answer to it.
    reply = async () => { throw new HarnessLimitError('Claude Code', { kind: 'rate', resetsAt: null }); };
    const busy = await run('claude-code');
    expect(busy.runs.at(-1)?.errorCode).toBeUndefined();
  });

  it('keeps media on the person\'s screen: no copy for the harness, and the prompt says it is unreadable', async () => {
    const image = join(directory, 'photo.png'); await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    sources = [...sources, ...(await core.sources.import([image]))];
    const detail = await run('claude-code');
    expect(detail.task.status).toBe('completed');
    const [request] = requests;
    expect(Object.keys(request.files)).toEqual(['01-note.txt']);
    expect(request.prompt).toContain('Attached but not readable by you');
    expect(request.prompt).toContain('photo.png');
  });

  it('runs the worker through the account folder chosen in Settings', async () => {
    const folder = join(directory, 'claude-work');
    detected = detected.map(item => item.id === 'claude-code' ? { ...item, accountId: 'work', accounts: [{ id: 'work', label: 'Công ty' }], configDir: folder } : item);
    await run('claude-code');
    expect(requests[0].configDir).toBe(folder);
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

  it('inlines source text for Gemini CLI, which runs with no tools of its own', async () => {
    const gemini = await run('gemini');
    expect(gemini.task.status).toBe('completed');
    const [request] = requests;
    expect(request.harness).toBe('gemini');
    expect(request.prompt).toContain('line two: the answer is 42');
    expect(request.prompt).toContain('You have no file or command tools.');
    // Gemini has no strict-schema envelope: the prompt asks for the answer object itself.
    expect(request.prompt).not.toContain('one payload string');
    expect(gemini.artifacts[0].report.limitations.join(' ')).toContain('Gemini CLI không có tool đọc tệp');
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

it.runIf(process.platform === 'win32')('counts a process that is no longer running as stopped', async () => {
  // taskkill fails with "not found" when the process exited before the kill, which a busy machine makes likely (COD-204).
  // The pid is one Windows never hands out.
  await expect(killTree(2_147_483_644)).resolves.toBeUndefined();
});

it('reports uncertain termination when the kill command fails or the process never closes', async () => {
  await expect(stopHarnessProcess(123, Promise.resolve(), async () => { throw new Error('Access denied'); }))
    .rejects.toBeInstanceOf(HarnessTerminationError);
  await expect(stopHarnessProcess(123, new Promise<void>(() => {}), async () => {}, 5))
    .rejects.toBeInstanceOf(HarnessTerminationError);
});

it.runIf(process.platform === 'win32')('keeps what the CLI printed to stderr when it exits without a result', async () => {
  const script = join(directory, 'exit-fixture.cjs');
  await writeFile(script, `
    process.stdin.resume();
    process.stdin.on('end', () => {
      const escape = String.fromCharCode(27);
      process.stderr.write(escape + '[31mError: The command line is too long.' + escape + '[0m' + String.fromCharCode(10));
      process.exit(1);
    });
  `);
  const shim = join(directory, 'exit-fixture.cmd');
  await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
  await expect(executeHarness({ harness: 'claude-code', executable: shim, cwd: directory,
    prompt: 'fixture', schema: {}, signal: new AbortController().signal, maxBudgetUsd: 1 }))
    .rejects.toThrow('Claude Code thoát với mã 1: Error: The command line is too long.');
});

it('names a harness executable that disappeared since detection instead of a bare exit code', async () => {
  const gone = join(directory, 'replaced', 'claude.exe');
  await expect(executeHarness({ harness: 'claude-code', executable: gone, cwd: directory,
    prompt: 'fixture', schema: {}, signal: new AbortController().signal, maxBudgetUsd: 1 }))
    .rejects.toThrow(`Không còn thấy Claude Code ở ${gone}`);
});

it('keeps only the bounded end of a long stderr, without colour codes', () => {
  const noisy = `${'\u001b[33mwarning\u001b[0m '.repeat(400)}Fatal: the real cause`;
  const tail = stderrTail(noisy);
  expect(tail.endsWith('Fatal: the real cause')).toBe(true);
  expect(tail).not.toContain('\u001b');
  expect(tail.length).toBeLessThanOrEqual(601);
  expect(stderrTail('  \n ')).toBe('');
});
