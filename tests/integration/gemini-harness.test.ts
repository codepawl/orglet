import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidates, detectHarnesses, probe } from '../../apps/desktop/src/core/harness/detect';
import { executeHarness, harnessArgs, HarnessLimitError, parseGeminiOutput, type HarnessRequest } from '../../apps/desktop/src/core/harness/exec';
import { escapeAtSigns, GEMINI_NO_MCP_SERVER, geminiLockdownSettings, unescapeAtSigns } from '../../apps/desktop/src/core/harness/gemini';
import { GeminiStreamParser } from '../../apps/desktop/src/core/harness/geminiStream';
import { harnessToolAdapter } from '../../apps/desktop/src/core/harness/tool-adapter';
import { readHarnessUsage, type UsageRuntime } from '../../apps/desktop/src/core/harness/usage';
import { fetchProviderList } from '../../apps/desktop/src/core/models/fetch';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';
import { harnessReady, loginCommands, SYSTEM_ACCOUNT_ID, type HarnessAccountSelection } from '../../apps/desktop/src/shared/harness';
import type { HarnessProgress } from '../../apps/desktop/src/shared/progress';

// COD-243: Gemini CLI as a local harness. The fake `gemini` below answers `--version`, records what reached it (the
// arguments, stdin, the working folder, the settings file there and the lockdown variables) and then plays back one of
// the stream shapes @google/gemini-cli 0.61.0 prints with `--output-format stream-json`.

const FAKE_GEMINI = `
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('0.61.0\\n'); process.exit(0); }
const mode = process.env.FAKE_GEMINI_MODE ?? 'answer';
const stdin = readFileSync(0, 'utf8');
const settingsPath = join(process.cwd(), '.gemini', 'settings.json');
const watched = ['GEMINI_CLI_HOME', 'GEMINI_CLI_TRUST_WORKSPACE', 'GEMINI_CLI_NO_RELAUNCH', 'NO_BROWSER', 'GEMINI_SANDBOX', 'GEMINI_SYSTEM_MD'];
const env = Object.fromEntries(watched.map(name => [name, process.env[name] ?? null]));
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
writeFileSync(process.env.FAKE_GEMINI_RECORD, JSON.stringify({ args, stdin, cwd: process.cwd(), settings, env }));
const emit = event => process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\\n');
if (mode === 'signed-out') {
  process.stderr.write('Please set an Auth method in your settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA\\n');
  process.exit(41);
}
emit({ type: 'init', session_id: 'session', model: 'gemini-2.5-pro' });
emit({ type: 'message', role: 'user', content: stdin });
if (mode === 'hang' || mode === 'native-tool') {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  writeFileSync(process.env.FAKE_GEMINI_PIDS, JSON.stringify([process.pid, descendant.pid]));
  if (mode === 'native-tool') emit({ type: 'tool_use', tool_name: 'run_shell_command', tool_id: 'call-1', parameters: { command: 'dir' } });
  setInterval(() => {}, 1000);
} else if (mode === 'quota') {
  emit({ type: 'result', status: 'error', error: { type: 'TerminalQuotaError', message: 'You have exhausted your daily quota on this model.' }, stats: { total_tokens: 0, input_tokens: 0, output_tokens: 0, cached: 0, input: 0, duration_ms: 0, tool_calls: 0, models: {} } });
  process.exit(1);
} else {
  const fenced = '\`\`\`json\\n' + process.env.FAKE_GEMINI_ANSWER + '\\n\`\`\`';
  for (let start = 0; start < fenced.length; start += 16) emit({ type: 'message', role: 'assistant', content: fenced.slice(start, start + 16), delta: true });
  emit({ type: 'result', status: 'success', stats: { total_tokens: 1280, input_tokens: 1200, output_tokens: 80, cached: 0, input: 1200, duration_ms: 5, tool_calls: 0, models: {} } });
}
`;

let directory: string;
let bin: string;
let executable: string;
let record: string;
let pids: string;
const fakeVariables = ['FAKE_GEMINI_MODE', 'FAKE_GEMINI_ANSWER', 'FAKE_GEMINI_RECORD', 'FAKE_GEMINI_PIDS', 'GEMINI_SANDBOX', 'GEMINI_SYSTEM_MD'];
const saved: Record<string, string | undefined> = {};

/** A `gemini` on PATH the way npm installs it: a .cmd shim on Windows, a small script elsewhere. */
async function writeFakeGemini(folder: string): Promise<string> {
  const script = join(folder, 'fake-gemini.mjs');
  await writeFile(script, FAKE_GEMINI);
  if (process.platform === 'win32') {
    const shim = join(folder, 'gemini.cmd');
    await writeFile(shim, `@"${process.execPath}" "${script}" %*\r\n`);
    return shim;
  }
  const shim = join(folder, 'gemini');
  await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return shim;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet gemini test '));
  bin = join(directory, 'npm bin');
  await mkdir(bin, { recursive: true });
  executable = await writeFakeGemini(bin);
  record = join(directory, 'record.json');
  pids = join(directory, 'pids.json');
  for (const name of fakeVariables) saved[name] = process.env[name];
  process.env.FAKE_GEMINI_RECORD = record;
  process.env.FAKE_GEMINI_PIDS = pids;
});

afterEach(async () => {
  for (const name of fakeVariables) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Recorded = { args: string[]; stdin: string; cwd: string; settings: unknown; env: Record<string, string | null> };
const recorded = async (): Promise<Recorded> => JSON.parse(await readFile(record, 'utf8'));

/** A fresh private folder, as the runner makes for every call. */
const privateFolder = () => mkdtemp(join(directory, 'call-'));

const request = async (overrides: Partial<HarnessRequest> = {}): Promise<HarnessRequest> => ({
  harness: 'gemini', executable, cwd: await privateFolder(), prompt: 'Hỏi @Tí về note.txt', schema: { type: 'object' },
  signal: new AbortController().signal, maxBudgetUsd: 1, ...overrides,
});

/** The environment detection reads: a home folder, an empty PATH but for the fake, and no Gemini sign-in variables. */
function detectionEnvironment(home: string): NodeJS.ProcessEnv {
  return { USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), PATH: bin };
}

async function writeSignIn(home: string, files: Record<string, string>) {
  await mkdir(join(home, '.gemini'), { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(home, '.gemini', name), text);
}

const detectGemini = async (env: NodeJS.ProcessEnv, selection?: HarnessAccountSelection) => {
  const system = { accountId: SYSTEM_ACCOUNT_ID, accounts: [] };
  const accounts = { 'claude-code': system, codex: system, cursor: system, gemini: selection ?? system };
  const [gemini] = await detectHarnesses(env, process.platform, probe, accounts, ['gemini']);
  return gemini;
};

describe('detection', () => {
  it('finds gemini on PATH and in the npm folder, and reports a signed-out install as detected, never ready', async () => {
    const home = join(directory, 'home');
    const npm = join(home, 'AppData', 'Roaming', 'npm');
    await mkdir(npm, { recursive: true });
    await writeFile(join(npm, 'gemini.cmd'), '');
    expect(await candidates('gemini', detectionEnvironment(home), 'win32')).toEqual([join(bin, 'gemini.cmd'), join(npm, 'gemini.cmd')].filter(path => existsSync(path)));

    const gemini = await detectGemini(detectionEnvironment(home));
    expect(gemini).toEqual(expect.objectContaining({
      id: 'gemini', name: 'Gemini CLI', executable, version: '0.61.0', auth: 'logged_out', status: 'detected', runnable: true,
      installCommand: 'npm install -g @google/gemini-cli',
    }));
    expect(gemini.authDetail).toBe('Đã thấy Gemini CLI trên máy nhưng chưa đăng nhập. Lấy lệnh đăng nhập ở Cài đặt → Harness trên máy.');
    expect(harnessReady(gemini)).toBe(false);
    // Gemini CLI has no login subcommand: started bare it asks how to sign in.
    expect(gemini.loginCommands).toEqual(loginCommands('gemini', executable, process.platform));
    if (process.platform === 'win32') expect(gemini.loginCommand).toBe(`& "${executable}"`);
  });

  it('reads a Google sign-in from its own files, comments in the settings file included', async () => {
    const home = join(directory, 'home');
    await writeSignIn(home, {
      'settings.json': '// written by gemini\n{ "security": { "auth": { "selectedType": "oauth-personal" } } }',
      'oauth_creds.json': JSON.stringify({ refresh_token: 'fixture-refresh', token_type: 'Bearer' }),
      'google_accounts.json': JSON.stringify({ active: 'an@example.com', old: [] }),
    });
    const gemini = await detectGemini(detectionEnvironment(home));
    expect(gemini).toEqual(expect.objectContaining({ auth: 'logged_in', status: 'signed_in', authDetail: 'Đăng nhập Google · an@example.com' }));
    expect(harnessReady(gemini)).toBe(true);
  });

  it('treats Google chosen but no cached credentials as signed out, an API key as signed in, and an unreadable folder as an auth error', async () => {
    const home = join(directory, 'home');
    await writeSignIn(home, { 'settings.json': JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }) });
    expect((await detectGemini(detectionEnvironment(home))).status).toBe('detected');

    const keyHome = join(directory, 'key-home');
    const withKey = await detectGemini({ ...detectionEnvironment(keyHome), GEMINI_API_KEY: 'fixture-key' });
    expect(withKey).toEqual(expect.objectContaining({ auth: 'logged_in', authDetail: 'Đăng nhập qua gemini-api-key' }));

    const brokenHome = join(directory, 'broken-home');
    await mkdir(join(brokenHome, '.gemini', 'settings.json'), { recursive: true });
    const broken = await detectGemini(detectionEnvironment(brokenHome));
    expect(broken).toEqual(expect.objectContaining({ auth: 'unknown', status: 'auth_error' }));
    expect(broken.authDetail).toContain('không chuyển sang Demo');
  });

  it('reads and signs in an added account through GEMINI_CLI_HOME', async () => {
    const home = join(directory, 'home');
    const folder = join(directory, 'accounts', 'gemini', 'work');
    await writeSignIn(folder, {
      'settings.json': JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
      'oauth_creds.json': JSON.stringify({ access_token: 'fixture-access' }),
      'google_accounts.json': JSON.stringify({ active: 'work@example.com' }),
    });
    const gemini = await detectGemini(detectionEnvironment(home), { accountId: 'work', accounts: [{ id: 'work', label: 'Công ty' }], configDir: folder });
    expect(gemini).toEqual(expect.objectContaining({ accountId: 'work', configDir: folder, auth: 'logged_in', authDetail: 'Đăng nhập Google · work@example.com' }));
    if (process.platform === 'win32') expect(gemini.loginCommand).toBe(`$env:GEMINI_CLI_HOME = "${folder}"; & "${executable}"`);
  });
});

describe('lockdown', () => {
  it('builds headless arguments with no yolo, no sandbox and every MCP server blocked', () => {
    expect(harnessArgs({ harness: 'gemini', cwd: directory, schema: {}, maxBudgetUsd: 1 })).toEqual([
      '--output-format', 'stream-json', '--approval-mode', 'default', '--skip-trust', '--extensions', 'none', '--allowed-mcp-server-names', GEMINI_NO_MCP_SERVER,
    ]);
    const withModel = harnessArgs({ harness: 'gemini', cwd: directory, schema: {}, maxBudgetUsd: 1, model: 'flash' });
    expect(withModel.slice(-2)).toEqual(['-m', 'flash']);
    expect(withModel.join(' ')).not.toMatch(/yolo|-y\b|auto_edit|--sandbox|-s\b|--include-directories|--allowed-tools/);
  });

  it('runs in the private folder with the lockdown settings, the lockdown variables and every at sign escaped', async () => {
    process.env.FAKE_GEMINI_ANSWER = JSON.stringify({ message: 'Xin chào @Tí', title: null, report: null });
    process.env.GEMINI_SANDBOX = 'docker';
    process.env.GEMINI_SYSTEM_MD = 'C:\\somewhere\\system.md';
    const progress: HarnessProgress[] = [];
    const call = await request({ onProgress: update => progress.push(update), configDir: join(directory, 'account') });
    const result = await executeHarness(call);

    const seen = await recorded();
    // macOS reports the temp folder through its /private/var target; compare the folders, not the spellings.
    expect(realpathSync(seen.cwd).toLowerCase()).toBe(realpathSync(call.cwd).toLowerCase());
    expect(seen.args).toEqual(harnessArgs(call));
    expect(seen.settings).toEqual(geminiLockdownSettings);
    expect(seen.settings).toEqual(expect.objectContaining({ tools: expect.objectContaining({ core: [] }), skills: { enabled: false }, hooksConfig: { enabled: false } }));
    expect(seen.env).toEqual({
      GEMINI_CLI_HOME: join(directory, 'account'), GEMINI_CLI_TRUST_WORKSPACE: 'true', GEMINI_CLI_NO_RELAUNCH: 'true', NO_BROWSER: 'true',
      GEMINI_SANDBOX: null, GEMINI_SYSTEM_MD: null,
    });
    // No at sign reaches the CLI unescaped, so none can name a file for it to attach.
    expect(seen.stdin).toContain('Hỏi \\@Tí về note.txt');
    expect(seen.stdin.replaceAll('\\@', '')).not.toContain('@');
    expect(seen.stdin).toContain('Return only one JSON object that matches this schema');

    expect(result).toEqual({ output: { message: 'Xin chào @Tí', title: null, report: null }, costUsd: null, tokens: { input: 1200, output: 80 } });
    expect(progress.at(-1)).toEqual(expect.objectContaining({ writing: true, answer: 'Xin chào @Tí' }));
    // The lockdown file is Orglet's own: a folder that already has one is refused.
    await expect(executeHarness({ ...call, signal: new AbortController().signal })).rejects.toThrow();
  });

  it('stops the run and its process as soon as the CLI asks for a tool of its own', async () => {
    process.env.FAKE_GEMINI_MODE = 'native-tool';
    await expect(executeHarness(await request())).rejects.toThrow('Gemini CLI đòi dùng tool riêng của nó (run_shell_command)');
    const [cli] = JSON.parse(await readFile(pids, 'utf8')) as number[];
    expect(() => process.kill(cli, 0)).toThrow();
  });
});

describe('outcomes', () => {
  it('fails a signed-out run with the Settings hint and no Demo fallback', async () => {
    process.env.FAKE_GEMINI_MODE = 'signed-out';
    const failure = executeHarness(await request());
    await expect(failure).rejects.toThrow('Gemini CLI chưa đăng nhập hoặc phiên đã hết hạn. Mở Cài đặt → Harness trên máy');
    await expect(failure).rejects.toThrow('Orglet không chuyển sang Demo.');
  });

  it('marks a used-up plan as a plan limit, so the chat can offer another account', async () => {
    process.env.FAKE_GEMINI_MODE = 'quota';
    const failure = await executeHarness(await request()).catch(error => error);
    expect(failure).toBeInstanceOf(HarnessLimitError);
    expect((failure as HarnessLimitError).limit.kind).toBe('quota');
  });

  it.runIf(process.platform === 'win32')('kills the CLI and its descendant when the run is cancelled', async () => {
    process.env.FAKE_GEMINI_MODE = 'hang';
    const controller = new AbortController();
    const outcome = executeHarness(await request({ signal: controller.signal })).catch(error => error);
    for (let attempt = 0; attempt < 300 && !existsSync(pids); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(existsSync(pids)).toBe(true);
    const started = JSON.parse(await readFile(pids, 'utf8')) as number[];
    controller.abort(new Error('Fixture cancellation'));
    expect(await outcome).toMatchObject({ message: 'Fixture cancellation' });
    for (const pid of started) expect(() => process.kill(pid, 0)).toThrow();
  });

  it('leaves usage unknown when the CLI reports no token counts, and names each failure shape', () => {
    const answer = { text: '{"message":"ok"}', result: { status: 'success' }, errors: [] };
    expect(parseGeminiOutput(answer)).toEqual({ output: { message: 'ok' }, costUsd: null });
    expect(() => parseGeminiOutput({ text: '', result: { status: 'error', error: { type: 'FatalAuthenticationError', message: 'Manual authorization is required' } }, errors: [] })).toThrow('Gemini CLI chưa đăng nhập');
    expect(() => parseGeminiOutput({ text: '', result: { status: 'error', error: { type: 'RetryableQuotaError', message: 'slow down' } }, errors: [] })).toThrow(HarnessLimitError);
    expect(() => parseGeminiOutput({ text: '', result: { status: 'error', error: { type: 'Error', message: 'model not found' } }, errors: [] })).toThrow('Gemini CLI báo lỗi: model not found');
    expect(() => parseGeminiOutput({ text: 'not json', result: { status: 'success' }, errors: [] })).toThrow('Gemini CLI không trả về báo cáo đúng schema.');
  });

  it('streams the message field and hands a tool request to the run', () => {
    const answers: string[] = [];
    const tools: string[] = [];
    const parser = new GeminiStreamParser(update => answers.push(update.answer), name => tools.push(name));
    parser.push('{"type":"init","model":"gemini-2.5-pro"}\n{"type":"message","role":"assistant","content":"{\\"message\\":\\"Xin","delta":true}\n');
    parser.push('{"type":"message","role":"assistant","content":" chào\\"}","delta":true}\n{"type":"tool_use","tool_name":"read_file"}\n{"type":"result","status":"success"}');
    expect(answers).toEqual(['Xin', 'Xin chào']);
    expect(tools).toEqual(['read_file']);
    expect(parser.finish()).toEqual({ text: '{"message":"Xin chào"}', result: { type: 'result', status: 'success' }, errors: [] });
  });

  it('escapes at signs for the CLI and restores the ones the model copied into its JSON', () => {
    expect(escapeAtSigns('a@b @c')).toBe('a\\@b \\@c');
    expect(JSON.parse(unescapeAtSigns('{"message":"hi \\@Tí","path":"C:\\\\@home"}'))).toEqual({ message: 'hi @Tí', path: 'C:\\@home' });
  });
});

describe('tool loop, model list and usage', () => {
  it('returns one Orglet tool call through the structured loop without running it', async () => {
    process.env.FAKE_GEMINI_ANSWER = JSON.stringify({ call: { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } } });
    const results: unknown[] = [];
    const adapter = harnessToolAdapter({
      execute: async call => executeHarness({ ...call, cwd: await privateFolder() }),
      request: { harness: 'gemini', executable, cwd: directory, maxBudgetUsd: 0 },
      onResult: result => results.push(result),
    });
    const tools = [toolDefinitions.workspace_read.model];
    const response = await adapter.request([{ role: 'user', content: 'Đọc note.txt giúp @Tí' }], tools, new AbortController().signal, () => {});
    expect(response.calls).toHaveLength(1);
    expect(response.calls[0].name).toBe('workspace_read');
    expect(JSON.parse(response.calls[0].arguments)).toEqual({ path: 'note.txt', offset: 0 });
    expect(results).toEqual([expect.objectContaining({ costUsd: null, tokens: { input: 1200, output: 80 } })]);
    const seen = await recorded();
    expect(seen.stdin).toContain('Orglet executes the selected call');
    expect(seen.stdin).toContain('workspace_read');
    expect(seen.settings).toEqual(geminiLockdownSettings);
  });

  it('suggests the CLI\'s own model aliases and never probes for a list', async () => {
    const list = await fetchProviderList('gemini', { readKey: async () => null, harnesses: async () => { throw new Error('no probe'); }, now: () => new Date('2026-09-25T00:00:00Z') });
    expect(list).toEqual(expect.objectContaining({ source: 'alias' }));
    expect(list.models.map(model => model.id)).toEqual(['auto', 'pro', 'flash', 'flash-lite']);
  });

  it('names the signed-in Google account but no plan allowance, and reports a signed-out folder', async () => {
    const folder = join(directory, 'accounts', 'gemini', 'one');
    const runtime = (home: string): UsageRuntime => ({
      run: async () => ({ code: 1, stdout: '', stderr: '' }),
      appServer: async () => [],
      fetch: async () => { throw new Error('no network'); },
      readText: path => readFile(path, 'utf8'),
      home,
      now: () => new Date('2026-09-25T00:00:00Z'),
      env: {},
    });
    expect(await readHarnessUsage('gemini', executable, folder, runtime(directory))).toEqual({ windows: [], unavailable: 'signed_out' });
    await writeSignIn(folder, {
      'settings.json': JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
      'oauth_creds.json': JSON.stringify({ refresh_token: 'fixture-refresh' }),
      'google_accounts.json': JSON.stringify({ active: 'an@example.com' }),
    });
    expect(await readHarnessUsage('gemini', executable, folder, runtime(directory))).toEqual({ email: 'an@example.com', windows: [], unavailable: 'unsupported' });
  });
});
