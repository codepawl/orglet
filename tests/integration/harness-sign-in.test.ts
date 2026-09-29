import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Probe } from '../../apps/desktop/src/core/harness/detect';
import {
  codexSignIn, commandSignIn, signOutHarness, startSignIn,
  type HarnessSignInRuntime, type SignInEnd, type SignInProcess, type SignInProcesses, type SignInSession,
} from '../../apps/desktop/src/core/harness/sign-in';
import { missingHarness, signInPageAllowed, SYSTEM_ACCOUNT_ID, type HarnessCatalogId, type HarnessInfo } from '../../apps/desktop/src/shared/harness';

/** A child process that records what it was sent and lets the test answer on stdout or exit. */
class FakeProcess extends EventEmitter implements SignInProcess {
  pid = 4242;
  exitCode: number | null = null;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: Record<string, unknown>[] = [];
  stdinEnded = false;
  killed = false;
  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) this.written.push(JSON.parse(line) as Record<string, unknown>);
    });
    this.stdin.on('finish', () => { this.stdinEnded = true; });
  }
  kill() {
    this.killed = true;
    return true;
  }
  answer(message: object) {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }
  exit(code: number) {
    this.exitCode = code;
    this.emit('exit', code);
  }
  methods() {
    return this.written.map(message => message.method);
  }
}

type Started = { executable: string; args: string[]; env: NodeJS.ProcessEnv; child: FakeProcess };

function fakeProcesses(timeoutMs?: number) {
  const started: Started[] = [];
  const stopped: FakeProcess[] = [];
  const opened: string[] = [];
  const processes: SignInProcesses = {
    start: (executable, args, env) => {
      const child = new FakeProcess();
      started.push({ executable, args, env, child });
      return child;
    },
    stop: child => { stopped.push(child as FakeProcess); },
    openPage: url => { opened.push(url); },
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  return { processes, started, stopped, opened };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check: () => boolean) {
  for (let tries = 0; tries < 200 && !check(); tries += 1) await tick();
  expect(check()).toBe(true);
}

// The flow answered by codex-cli 0.157.0 against an empty CODEX_HOME on 2026-09-29, with the address shortened.
const AUTH_URL = 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x&state=abc';
const LOGIN_ID = '4dae5de2-5056-4548-9c9a-ebd4c01d3075';

async function codexStarted(fake: ReturnType<typeof fakeProcesses>, session: SignInSession) {
  const child = fake.started[0].child;
  await until(() => child.methods().includes('initialize'));
  child.answer({ id: 1, result: { userAgent: 'codex' } });
  await until(() => child.methods().includes('account/login/start'));
  child.answer({ id: 2, result: { type: 'chatgpt', loginId: LOGIN_ID, authUrl: AUTH_URL } });
  await until(() => fake.opened.length === 1);
  return { child, session };
}

describe('Codex sign-in through its app server', () => {
  it('asks for the ChatGPT flow, opens the page the server names, and ends signed in when the server says so', async () => {
    const fake = fakeProcesses();
    const session = codexSignIn('codex.exe', { CODEX_HOME: 'C:\\accounts\\codex\\work' }, fake.processes);
    const { child } = await codexStarted(fake, session);
    expect(fake.started[0]).toEqual(expect.objectContaining({ executable: 'codex.exe', args: ['app-server'], env: { CODEX_HOME: 'C:\\accounts\\codex\\work' } }));
    expect(child.methods()).toEqual(['initialize', 'initialized', 'account/login/start']);
    expect(child.written[2]).toEqual({ jsonrpc: '2.0', id: 2, method: 'account/login/start', params: { type: 'chatgpt' } });
    expect(fake.opened).toEqual([AUTH_URL]);

    // Another login's ending is not this one's.
    child.answer({ method: 'account/login/completed', params: { loginId: 'someone-else', success: true, error: null } });
    await tick();
    child.answer({ method: 'account/login/completed', params: { loginId: LOGIN_ID, success: true, error: null } });
    await expect(session.finished).resolves.toEqual({ outcome: 'signed_in' });
    await until(() => child.stdinEnded);
  });

  it('cancels its own login on the server and ends cancelled', async () => {
    const fake = fakeProcesses();
    const { child, session } = await codexStarted(fake, codexSignIn('codex.exe', {}, fake.processes));
    session.cancel();
    await expect(session.finished).resolves.toEqual({ outcome: 'cancelled' });
    expect(child.written.at(-1)).toEqual({ jsonrpc: '2.0', id: 3, method: 'account/login/cancel', params: { loginId: LOGIN_ID } });
    await until(() => child.stdinEnded);
    // The server's own late ending of the cancelled login changes nothing.
    child.answer({ method: 'account/login/completed', params: { loginId: LOGIN_ID, success: false, error: 'Login server error: Login was not completed' } });
    child.exit(0);
  });

  it('says why when the server refuses, the login fails, or the server stops early', async () => {
    const refused = fakeProcesses();
    const refusedSession = codexSignIn('codex.exe', {}, refused.processes);
    const refusedChild = refused.started[0].child;
    await until(() => refusedChild.methods().includes('initialize'));
    refusedChild.answer({ id: 1, result: {} });
    await until(() => refusedChild.methods().includes('account/login/start'));
    refusedChild.answer({ id: 2, error: { code: -32600, message: 'login is disabled by policy' } });
    await expect(refusedSession.finished).resolves.toEqual({ outcome: 'failed', message: 'login is disabled by policy' });
    expect(refused.opened).toEqual([]);

    const failed = fakeProcesses();
    const { child, session } = await codexStarted(failed, codexSignIn('codex.exe', {}, failed.processes));
    child.answer({ method: 'account/login/completed', params: { loginId: LOGIN_ID, success: false, error: 'Login server error: see https://auth.openai.com/x?code=1' } });
    await expect(session.finished).resolves.toEqual({ outcome: 'failed', message: 'Login server error: see' });

    const early = fakeProcesses();
    const earlySession = codexSignIn('codex.exe', {}, early.processes);
    early.started[0].child.exit(1);
    await expect(earlySession.finished).resolves.toEqual({ outcome: 'failed', message: 'Codex dừng trước khi đăng nhập xong.' });
  });

  it('stops waiting after the time limit and cancels the login it started', async () => {
    const fake = fakeProcesses(200);
    const { child, session } = await codexStarted(fake, codexSignIn('codex.exe', {}, fake.processes));
    await expect(session.finished).resolves.toEqual({ outcome: 'failed', message: 'Hết thời gian chờ đăng nhập.' });
    expect(child.written.at(-1)).toEqual(expect.objectContaining({ method: 'account/login/cancel' }));
  });
});

describe('Claude Code and Cursor Agent sign in with their own login command', () => {
  it('runs the CLI login in the account folder and ends signed in when it exits 0', async () => {
    const fake = fakeProcesses();
    const session = startSignIn('claude-code', 'claude.exe', { CLAUDE_CONFIG_DIR: 'C:\\accounts\\claude\\work' }, fake.processes);
    const { child, args, env } = fake.started[0];
    expect(args).toEqual(['auth', 'login']);
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: 'C:\\accounts\\claude\\work' });
    // Claude Code 2.1.283 prints these lines when it has no terminal, then waits for the browser.
    child.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\nPaste code here if prompted > ");
    await tick();
    expect(child.stdinEnded).toBe(false);
    child.stdout.write('Login successful.\n');
    child.exit(0);
    await expect(session.finished).resolves.toEqual({ outcome: 'signed_in' });
    expect(fake.opened).toEqual([]);

    const cursor = fakeProcesses();
    startSignIn('cursor', 'agent.cmd', { CURSOR_CONFIG_DIR: 'C:\\accounts\\cursor\\work' }, cursor.processes);
    expect(cursor.started[0].args).toEqual(['login']);
  });

  it('shows the CLI’s last line, without any address, when the login fails', async () => {
    const fake = fakeProcesses();
    const session = commandSignIn('claude-code', 'claude.exe', {}, fake.processes);
    const { child } = fake.started[0];
    child.stderr.write('\u001b[31mLogin failed: invalid_grant https://platform.claude.com/oauth/code/callback?code=secret\u001b[0m\n');
    await tick();
    child.exit(1);
    await expect(session.finished).resolves.toEqual({ outcome: 'failed', message: 'Login failed: invalid_grant' });

    const silent = fakeProcesses();
    const silentSession = commandSignIn('cursor', 'agent.cmd', {}, silent.processes);
    silent.started[0].child.exit(1);
    await expect(silentSession.finished).resolves.toEqual({ outcome: 'failed', message: 'Cursor Agent dừng trước khi đăng nhập xong.' });
  });

  it('stops the whole login on cancel and after the time limit', async () => {
    const fake = fakeProcesses();
    const session = commandSignIn('cursor', 'agent.cmd', {}, fake.processes);
    session.cancel();
    await expect(session.finished).resolves.toEqual({ outcome: 'cancelled' });
    expect(fake.stopped).toEqual([fake.started[0].child]);
    // The kill's own exit is not a second ending.
    fake.started[0].child.exit(1);

    const slow = fakeProcesses(30);
    const slowSession = commandSignIn('claude-code', 'claude.exe', {}, slow.processes);
    await expect(slowSession.finished).resolves.toEqual({ outcome: 'failed', message: 'Hết thời gian chờ đăng nhập.' });
    expect(slow.stopped).toHaveLength(1);
  });

  it('never starts one for Gemini CLI, which signs in from its own window', () => {
    const fake = fakeProcesses();
    expect(() => startSignIn('gemini', 'gemini.cmd', {}, fake.processes)).toThrow('Gemini CLI đăng nhập trong cửa sổ của nó.');
    expect(fake.started).toEqual([]);
  });
});

describe('signing out', () => {
  it('runs each CLI’s own sign-out in the account folder and reports a refusal', async () => {
    const calls: { executable: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    let answer = { code: 0, stdout: 'Successfully logged out from your Anthropic account.\n', stderr: '' };
    const run: Probe = async (executable, args, env) => {
      calls.push({ executable, args, env });
      return answer;
    };
    await signOutHarness('claude-code', 'claude.exe', 'C:\\accounts\\claude\\work', run);
    await signOutHarness('codex', 'codex.exe', undefined, run);
    await signOutHarness('cursor', 'agent.cmd', 'C:\\accounts\\cursor\\work', run);
    expect(calls).toEqual([
      { executable: 'claude.exe', args: ['auth', 'logout'], env: { CLAUDE_CONFIG_DIR: 'C:\\accounts\\claude\\work' } },
      { executable: 'codex.exe', args: ['logout'], env: {} },
      { executable: 'agent.cmd', args: ['logout'], env: { CURSOR_CONFIG_DIR: 'C:\\accounts\\cursor\\work' } },
    ]);

    answer = { code: 1, stdout: '', stderr: 'Error: keychain locked\n' };
    await expect(signOutHarness('codex', 'codex.exe', undefined, run)).rejects.toThrow('Không đăng xuất được Codex: Error: keychain locked');
    await expect(signOutHarness('gemini', 'gemini.cmd', undefined, run)).rejects.toThrow('/logout');
    expect(calls).toHaveLength(4);
  });
});

describe('the page main opens', () => {
  it('opens only an OpenAI sign-in page over https', () => {
    expect(signInPageAllowed(AUTH_URL)).toBe(true);
    expect(signInPageAllowed('http://auth.openai.com/oauth/authorize')).toBe(false);
    expect(signInPageAllowed('https://auth.openai.com.example.com/oauth')).toBe(false);
    expect(signInPageAllowed('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(signInPageAllowed('not an address')).toBe(false);
  });
});

/** A sign-in the test ends by hand, as the browser would. */
function controlledRuntime() {
  const starts: { harness: HarnessCatalogId; executable: string; configDir?: string; end: (result: SignInEnd) => void; cancelled: boolean }[] = [];
  const signOuts: { harness: HarnessCatalogId; configDir?: string }[] = [];
  const runtime: HarnessSignInRuntime = {
    start: (harness, executable, configDir) => {
      let end: (result: SignInEnd) => void = () => {};
      const finished = new Promise<SignInEnd>(resolve => { end = resolve; });
      const entry = { harness, executable, ...(configDir ? { configDir } : {}), end, cancelled: false };
      starts.push(entry);
      return { finished, cancel: () => { entry.cancelled = true; end({ outcome: 'cancelled' }); } };
    },
    signOut: async (harness, _executable, configDir) => { signOuts.push({ harness, ...(configDir ? { configDir } : {}) }); },
  };
  return { runtime, starts, signOuts };
}

describe('sign-in from Settings', () => {
  let directory: string;
  let store: Store;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-harness-sign-in-'));
    store = new Store(':memory:');
  });
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function coreWith(signIn: HarnessSignInRuntime) {
    const accountRoot = join(directory, 'harness-accounts');
    const signedIn = new Set<string>();
    const detections: (readonly HarnessCatalogId[] | 'all')[] = [];
    let notified = 0;
    let core: CoreService | undefined;
    const rows = (): HarnessInfo[] => (['claude-code', 'codex', 'gemini'] as const).map(id => {
      const selection = core?.harnessAccounts.selection(id);
      const on = signedIn.has(`${id}:${selection?.accountId ?? SYSTEM_ACCOUNT_ID}`);
      return { ...missingHarness(id, 'win32', selection), executable: `${id}.exe`, auth: on ? 'logged_in' as const : 'logged_out' as const, status: on ? 'signed_in' as const : 'detected' as const };
    });
    core = new CoreService(store, () => { notified += 1; }, async () => { throw new Error('unused'); }, undefined, undefined, {
      detect: async (_accounts, only) => { detections.push(only ?? 'all'); return rows(); },
      accountRoot,
      signIn,
      execute: async () => { throw new Error('unused'); },
    });
    return { core, signedIn, detections, accountRoot, notified: () => notified };
  }
  const codexRow = (rows: HarnessInfo[]) => rows.find(row => row.id === 'codex')!;

  it('signs the selected account in, shows it waiting, and detects that harness again once the browser is done', async () => {
    const control = controlledRuntime();
    const { core, signedIn, detections, accountRoot, notified } = coreWith(control.runtime);
    await core.command('harnesses', { refresh: true });
    await core.command('saveHarnessAccount', { harness: 'codex', label: 'Work' });
    const [work] = core.harnessAccounts.selection('codex').accounts;

    const waiting = await core.command('startHarnessSignIn', { harness: 'codex', id: work.id }) as HarnessInfo[];
    expect(codexRow(waiting).signIn).toEqual({ accountId: work.id, state: 'waiting' });
    expect(control.starts).toEqual([expect.objectContaining({ harness: 'codex', executable: 'codex.exe', configDir: join(accountRoot, 'codex', work.id) })]);
    // A second click while it waits starts nothing new.
    await core.command('startHarnessSignIn', { harness: 'codex', id: work.id });
    expect(control.starts).toHaveLength(1);
    expect((await core.command('harnesses', { refresh: false }) as HarnessInfo[]).find(row => row.id === 'claude-code')?.signIn).toBeUndefined();

    const detectedBefore = detections.length;
    const notifiedBefore = notified();
    signedIn.add(`codex:${work.id}`);
    control.starts[0].end({ outcome: 'signed_in' });
    await until(() => notified() > notifiedBefore);
    expect(detections.slice(detectedBefore)).toEqual([['codex']]);
    const after = codexRow(await core.command('harnesses', { refresh: false }) as HarnessInfo[]);
    expect(after.status).toBe('signed_in');
    expect(after.signIn).toBeUndefined();
  });

  it('keeps the CLI’s reason after a failed sign-in, and clears it on the next try', async () => {
    const control = controlledRuntime();
    const { core, notified } = coreWith(control.runtime);
    await core.command('harnesses', { refresh: true });
    await core.command('startHarnessSignIn', { harness: 'codex', id: SYSTEM_ACCOUNT_ID });
    expect(control.starts[0].configDir).toBeUndefined();
    const notifiedBefore = notified();
    control.starts[0].end({ outcome: 'failed', message: 'Login server error: Login was not completed' });
    await until(() => notified() > notifiedBefore);
    const failed = codexRow(await core.command('harnesses', { refresh: false }) as HarnessInfo[]);
    expect(failed.signIn).toEqual({ accountId: SYSTEM_ACCOUNT_ID, state: 'failed', message: 'Login server error: Login was not completed' });

    const again = await core.command('startHarnessSignIn', { harness: 'codex', id: SYSTEM_ACCOUNT_ID }) as HarnessInfo[];
    expect(codexRow(again).signIn).toEqual({ accountId: SYSTEM_ACCOUNT_ID, state: 'waiting' });
  });

  it('cancels a waiting sign-in on Cancel, on picking another account, and on removing its account', async () => {
    const control = controlledRuntime();
    const { core } = coreWith(control.runtime);
    await core.command('harnesses', { refresh: true });
    await core.command('startHarnessSignIn', { harness: 'codex', id: SYSTEM_ACCOUNT_ID });
    const cancelled = await core.command('cancelHarnessSignIn', { harness: 'codex' }) as HarnessInfo[];
    expect(control.starts[0].cancelled).toBe(true);
    expect(codexRow(cancelled).signIn).toBeUndefined();

    await core.command('saveHarnessAccount', { harness: 'codex', label: 'Work' });
    const [work] = core.harnessAccounts.selection('codex').accounts;
    await core.command('startHarnessSignIn', { harness: 'codex', id: work.id });
    await core.command('selectHarnessAccount', { harness: 'codex', id: SYSTEM_ACCOUNT_ID });
    expect(control.starts[1].cancelled).toBe(true);

    await core.command('selectHarnessAccount', { harness: 'codex', id: work.id });
    await core.command('startHarnessSignIn', { harness: 'codex', id: work.id });
    await core.command('removeHarnessAccount', { harness: 'codex', id: work.id });
    expect(control.starts[2].cancelled).toBe(true);
  });

  it('signs in only the account on screen, and never Gemini CLI', async () => {
    const control = controlledRuntime();
    const { core } = coreWith(control.runtime);
    await core.command('harnesses', { refresh: true });
    await core.command('saveHarnessAccount', { harness: 'codex', label: 'Work' });
    await expect(core.command('startHarnessSignIn', { harness: 'codex', id: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Tài khoản này không còn được chọn.');
    await expect(core.command('startHarnessSignIn', { harness: 'gemini', id: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Gemini CLI chưa đăng nhập được từ Orglet.');
    await expect(core.command('signOutHarness', { harness: 'gemini', id: SYSTEM_ACCOUNT_ID })).rejects.toThrow('/logout');
    expect(control.starts).toEqual([]);
    expect(control.signOuts).toEqual([]);
  });

  it('signs the selected account out with the CLI, then detects it again', async () => {
    const control = controlledRuntime();
    const { core, signedIn, detections, accountRoot } = coreWith(control.runtime);
    await core.command('saveHarnessAccount', { harness: 'claude-code', label: 'Work' });
    const [work] = core.harnessAccounts.selection('claude-code').accounts;
    signedIn.add(`claude-code:${work.id}`);
    await core.command('harnesses', { refresh: true });
    const detectedBefore = detections.length;
    const rows = await core.command('signOutHarness', { harness: 'claude-code', id: work.id }) as HarnessInfo[];
    expect(control.signOuts).toEqual([{ harness: 'claude-code', configDir: join(accountRoot, 'claude-code', work.id) }]);
    expect(detections.slice(detectedBefore)).toEqual([['claude-code']]);
    // The fake CLI still reports whatever the test says; the point is that it was asked, not trusted.
    expect(rows.find(row => row.id === 'claude-code')?.accountId).toBe(work.id);
  });

  it('offers nothing when the runtime cannot sign in', async () => {
    const core = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness('codex', 'win32'), executable: 'codex.exe', auth: 'logged_out', status: 'detected' }],
      execute: async () => { throw new Error('unused'); },
    });
    await expect(core.command('startHarnessSignIn', { harness: 'codex', id: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Codex chưa đăng nhập được từ Orglet.');
  });
});
