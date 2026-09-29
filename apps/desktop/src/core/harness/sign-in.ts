import { spawn } from 'node:child_process';
import {
  harnessLoginArgs,
  harnessLogoutArgs,
  harnessNames,
  harnessSignsInApp,
  type HarnessCatalogId,
  type HarnessSignIn,
} from '../../shared/harness';
import { cleanEnv, commandLine, harnessAccountEnv, probe, type Probe } from './detect';

/** How a sign-in ended. Only a failure carries words: the CLI's own last line, or why Orglet stopped waiting. */
export type SignInEnd = { outcome: 'signed_in' } | { outcome: 'cancelled' } | { outcome: 'failed'; message: string };

/** One sign-in on its way. It ends by itself once the browser part is done, or when cancelled. */
export type SignInSession = { finished: Promise<SignInEnd>; cancel(): void };

/** What Settings asks of a CLI: sign one account folder in without a terminal, or sign it out. */
export type HarnessSignInRuntime = {
  start(harness: HarnessCatalogId, executable: string, configDir: string | undefined): SignInSession;
  signOut(harness: HarnessCatalogId, executable: string, configDir: string | undefined): Promise<void>;
};

/** The parts of a child process a sign-in uses, so tests can hand in a fake one. */
export type SignInProcess = {
  pid?: number;
  exitCode: number | null;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(): boolean;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

export type SignInProcesses = {
  start(executable: string, args: string[], env: NodeJS.ProcessEnv): SignInProcess;
  stop(child: SignInProcess): void;
  /** Opens a sign-in page in the person's browser. Only Codex needs it: the other CLIs open their own. */
  openPage(url: string): void;
  timeoutMs?: number;
};

/** Long enough to sign in with a password manager and two-factor; after that the CLI's own login server is stopped. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const INITIALIZE_ID = 1;
const LOGIN_START_ID = 2;
const LOGIN_CANCEL_ID = 3;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const timedOut = (): SignInEnd => ({ outcome: 'failed', message: 'Hết thời gian chờ đăng nhập.' });
const stoppedEarly = (harness: HarnessCatalogId): SignInEnd => ({ outcome: 'failed', message: `${harnessNames[harness]} dừng trước khi đăng nhập xong.` });

/**
 * One line of CLI output fit to show: colour codes out, and addresses out too, since a login page's address carries
 * the flow's one-time values and the row has nowhere useful to send the person.
 */
function shownLine(line: string): string {
  const withoutColour = line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  const withoutAddresses = withoutColour.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return withoutAddresses.slice(0, 200);
}

/** Calls `onMessage` with every JSON line the stream writes; anything that is not JSON is skipped. */
function onJsonLines(stream: NodeJS.ReadableStream | null, onMessage: (message: Record<string, unknown>) => void) {
  let buffered = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      try {
        const message: unknown = JSON.parse(line);
        if (isRecord(message)) onMessage(message);
      } catch {
        // A log line on stdout; the protocol messages are the JSON ones.
      }
    }
  });
}

/** The session's promise with a single way to settle it, so the first ending wins and later ones are ignored. */
function sessionEnding(onEnd: () => void) {
  let settle: (end: SignInEnd) => void = () => {};
  let ended = false;
  const finished = new Promise<SignInEnd>(resolve => { settle = resolve; });
  const end = (result: SignInEnd) => {
    if (ended) return;
    ended = true;
    onEnd();
    settle(result);
  };
  return { finished, end, hasEnded: () => ended };
}

/**
 * Codex's ChatGPT sign-in through `codex app-server` (checked against codex-cli 0.157.0's generated protocol):
 * `account/login/start` with `type: chatgpt` answers a `loginId` and an `authUrl`, the app server listens for the
 * browser's return itself, and `account/login/completed` says how it went. Cancelling sends `account/login/cancel`.
 * The server stays up for the whole wait, since it is the one holding the login.
 */
export function codexSignIn(executable: string, env: NodeJS.ProcessEnv, processes: SignInProcesses): SignInSession {
  const child = processes.start(executable, ['app-server'], env);
  let loginId: string | undefined;
  const send = (message: object) => child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const session = sessionEnding(() => {
    clearTimeout(timer);
    // Closing stdin ends the app server; the stop is only for one that hangs.
    child.stdin?.end();
    setTimeout(() => { if (child.exitCode === null) processes.stop(child); }, 2_000).unref?.();
  });
  const timer = setTimeout(() => {
    if (loginId) send({ id: LOGIN_CANCEL_ID, method: 'account/login/cancel', params: { loginId } });
    session.end(timedOut());
  }, processes.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
  onJsonLines(child.stdout, message => {
    if (message.id === INITIALIZE_ID) {
      send({ method: 'initialized' });
      send({ id: LOGIN_START_ID, method: 'account/login/start', params: { type: 'chatgpt' } });
      return;
    }
    if (message.id === LOGIN_START_ID) {
      loginStarted(message);
      return;
    }
    if (message.method === 'account/login/completed') loginCompleted(message.params);
  });
  function loginStarted(message: Record<string, unknown>) {
    const result = isRecord(message.result) ? message.result : undefined;
    const started = result?.type === 'chatgpt' ? { id: text(result.loginId), page: text(result.authUrl) } : undefined;
    if (!started?.id || !started.page) {
      const reason = isRecord(message.error) ? text(message.error.message) : undefined;
      session.end({ outcome: 'failed', message: reason ? shownLine(reason) : 'Codex không mở được trang đăng nhập.' });
      return;
    }
    loginId = started.id;
    processes.openPage(started.page);
  }
  function loginCompleted(params: unknown) {
    if (!isRecord(params) || params.loginId !== loginId) return;
    if (params.success === true) {
      session.end({ outcome: 'signed_in' });
      return;
    }
    const reason = text(params.error);
    session.end({ outcome: 'failed', message: reason ? shownLine(reason) : 'Codex báo chưa đăng nhập xong.' });
  }
  child.on('exit', () => session.end(stoppedEarly('codex')));
  child.on('error', () => session.end(stoppedEarly('codex')));
  send({ id: INITIALIZE_ID, method: 'initialize', params: { clientInfo: { name: 'orglet', title: 'Orglet', version: '0' } } });
  return {
    finished: session.finished,
    cancel: () => {
      if (session.hasEnded()) return;
      if (loginId) send({ id: LOGIN_CANCEL_ID, method: 'account/login/cancel', params: { loginId } });
      session.end({ outcome: 'cancelled' });
    },
  };
}

/**
 * A CLI whose login command finishes on its own once the browser is done: `claude auth login` listens on 127.0.0.1
 * for the browser's return (Claude Code 2.1.283), and `agent login` polls Cursor until the page reports back. Both
 * open the browser themselves. Stdin stays open and empty: Claude Code also offers to take a pasted code there, and
 * closing it is not how either one is told to stop. Exit code 0 is a completed sign-in.
 */
export function commandSignIn(harness: HarnessCatalogId, executable: string, env: NodeJS.ProcessEnv, processes: SignInProcesses): SignInSession {
  const child = processes.start(executable, [...harnessLoginArgs[harness]], env);
  let lastLine = '';
  const remember = (chunk: Buffer | string) => {
    const lines = String(chunk).split(/\r?\n/).map(shownLine).filter(Boolean);
    if (lines.length) lastLine = lines[lines.length - 1];
  };
  child.stdout?.on('data', remember);
  child.stderr?.on('data', remember);
  const session = sessionEnding(() => clearTimeout(timer));
  const stopAndEnd = (result: SignInEnd) => {
    if (session.hasEnded()) return;
    processes.stop(child);
    session.end(result);
  };
  const timer = setTimeout(() => stopAndEnd(timedOut()), processes.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
  child.on('exit', code => {
    if (code === 0) session.end({ outcome: 'signed_in' });
    else session.end(lastLine ? { outcome: 'failed', message: lastLine } : stoppedEarly(harness));
  });
  child.on('error', () => session.end(stoppedEarly(harness)));
  return { finished: session.finished, cancel: () => stopAndEnd({ outcome: 'cancelled' }) };
}

/** Starts the right kind of sign-in for one harness, in the account folder `env` points at. */
export function startSignIn(harness: HarnessCatalogId, executable: string, env: NodeJS.ProcessEnv, processes: SignInProcesses): SignInSession {
  if (!harnessSignsInApp[harness]) throw new Error(`${harnessNames[harness]} đăng nhập trong cửa sổ của nó. Dùng lệnh đăng nhập bên dưới.`);
  if (harness === 'codex') return codexSignIn(executable, env, processes);
  return commandSignIn(harness, executable, env, processes);
}

/** Runs the CLI's own sign-out in one account folder. Orglet never deletes a credential file itself. */
export async function signOutHarness(harness: HarnessCatalogId, executable: string, configDir: string | undefined, run: Probe): Promise<void> {
  const name = harnessNames[harness];
  const args = harnessLogoutArgs[harness];
  if (!args) throw new Error(`${name} chỉ đăng xuất được trong cửa sổ của nó, bằng /logout.`);
  const result = await run(executable, [...args], harnessAccountEnv(harness, configDir));
  if (result.code === 0) return;
  const reason = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map(shownLine).find(Boolean);
  throw new Error(reason ? `Không đăng xuất được ${name}: ${reason}` : `Không đăng xuất được ${name}.`);
}

/** A sign-in process spawned without a window, reading only the account's variables on top of the clean environment. */
function startLocalProcess(executable: string, args: string[], env: NodeJS.ProcessEnv): SignInProcess {
  const command = commandLine(executable, args);
  return spawn(command.file, command.args, {
    windowsHide: true,
    windowsVerbatimArguments: command.verbatim,
    env: { ...cleanEnv(process.env), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Stops a sign-in with everything it started. On Windows the Cursor Agent launcher is cmd.exe starting PowerShell
 * starting node, so killing the first process would leave the login polling on.
 */
function stopLocalProcess(child: SignInProcess) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
    return;
  }
  child.kill();
}

/** Sign-in and sign-out through the CLIs on this machine; `openPage` is main's browser opener. */
export const localSignInRuntime = (openPage: (url: string) => void): HarnessSignInRuntime => {
  const processes: SignInProcesses = { start: startLocalProcess, stop: stopLocalProcess, openPage };
  return {
    start: (harness, executable, configDir) => startSignIn(harness, executable, harnessAccountEnv(harness, configDir), processes),
    signOut: (harness, executable, configDir) => signOutHarness(harness, executable, configDir, probe),
  };
};

/**
 * The sign-ins Settings started, at most one per harness, and the last failure of each so the row can say why. A
 * sign-in belongs to the account that was selected when it started; picking or removing an account cancels it.
 */
export class HarnessSignIns {
  private running = new Map<HarnessCatalogId, { accountId: string; session: SignInSession }>();
  private failures = new Map<HarnessCatalogId, { accountId: string; message: string }>();

  constructor(private onEnd: (harness: HarnessCatalogId, end: SignInEnd) => void) {}

  isRunning(harness: HarnessCatalogId) {
    return this.running.has(harness);
  }

  begin(harness: HarnessCatalogId, accountId: string, session: SignInSession) {
    this.failures.delete(harness);
    this.running.set(harness, { accountId, session });
    void session.finished.then(end => {
      // A cancelled sign-in was already taken off the list; its late ending says nothing new.
      if (this.running.get(harness)?.session !== session) return;
      this.running.delete(harness);
      if (end.outcome === 'failed') this.failures.set(harness, { accountId, message: end.message });
      this.onEnd(harness, end);
    });
  }

  cancel(harness: HarnessCatalogId) {
    this.failures.delete(harness);
    const current = this.running.get(harness);
    if (!current) return;
    this.running.delete(harness);
    current.session.cancel();
  }

  cancelAll() {
    for (const harness of [...this.running.keys()]) this.cancel(harness);
  }

  /** What the row of this account shows: waiting, the last failure, or nothing. */
  view(harness: HarnessCatalogId, accountId: string): HarnessSignIn | undefined {
    const current = this.running.get(harness);
    if (current?.accountId === accountId) return { accountId, state: 'waiting' };
    const failure = this.failures.get(harness);
    if (failure?.accountId === accountId) return { accountId, state: 'failed', message: failure.message };
    return undefined;
  }
}
