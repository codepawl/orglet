import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMAND_HELP, parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import { call, defaultUserData, exchange, resolveUserData } from '../../apps/desktop/src/cli/client';
import { formatAnswers, formatList } from '../../apps/desktop/src/cli/output';
import { cliEndpoint, CliRequest, type CliChat, type SendValue } from '../../apps/desktop/src/cli/protocol';
import { runCli } from '../../apps/desktop/src/cli/run';
import { CliFailure, CliOperations, latestAnsweredRevision, matchChat, turnAnswers, turnErrors } from '../../apps/desktop/src/main/cli-operations';
import { answerLine, CliServer, createCliToken, tokensMatch, writeCliToken } from '../../apps/desktop/src/main/cli-server';
import { batchPath, pathHasEntry, pathWithEntry, pathWithoutEntry, shimContent } from '../../apps/desktop/src/main/cli-path';
import type { Artifact, Run, Task, TaskDetail, Workspace } from '../../apps/desktop/src/shared/contracts';

const workerId = '11111111-1111-4111-8111-111111111111';
const writerId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const taskId = '44444444-4444-4444-8444-444444444444';

const chats: CliChat[] = [
  { kind: 'worker', id: workerId, name: 'Researcher' },
  { kind: 'worker', id: writerId, name: 'Writer' },
  { kind: 'team', id: teamId, name: 'Review crew' },
];

function run(id: string, name: string, revision: number, stage?: Run['stage'], error: string | null = null): Run {
  return { id, taskId, stage, status: error ? 'failed' : 'completed', startedAt: '2026-09-25T10:00:00.000Z', error, snapshot: { worker: { name }, inputRevision: revision } } as unknown as Run;
}

function artifact(id: string, runId: string, summary: string, createdAt: string, format: 'chat' | 'report' = 'chat'): Artifact {
  return { id, runId, hash: 'x', createdAt, report: { format, title: 'Title', summary, findings: [], limitations: [] } } as unknown as Artifact;
}

function detail(task: Partial<Task>, runs: Run[], artifacts: Artifact[]): TaskDetail {
  return { task: { id: taskId, status: 'completed', budgetMicros: 500_000, inputRevision: 0, ...task }, runs, artifacts } as unknown as TaskDetail;
}

describe('orglet arguments', () => {
  it('parses send with repeated files, flags and both option spellings', () => {
    expect(parseArguments(['send', 'Hello there', '--to=Researcher', '--file', 'a.txt', '--file=b.csv', '--no-wait', '--timeout', '30', '--json'])).toEqual({
      kind: 'send', message: 'Hello there', to: 'Researcher', files: ['a.txt', 'b.csv'], wait: false, timeoutSeconds: 30, json: true,
    });
    expect(parseArguments(['send', '--to', 'Writer', '--', '--not-an-option'])).toMatchObject({ kind: 'send', message: '--not-an-option', wait: true, timeoutSeconds: 600 });
  });

  it('parses run with a schedule name and files', () => {
    expect(parseArguments(['run', 'Invoice check', '--file', 'a.pdf', '--file=b.txt', '--json'])).toEqual({
      kind: 'run', schedule: 'Invoice check', files: ['a.pdf', 'b.txt'], json: true,
    });
    expect(parseArguments(['run', 'Morning'])).toEqual({ kind: 'run', schedule: 'Morning', files: [], json: false });
    expect(COMMAND_HELP.run).toContain('cannot create or change one');
  });

  it('reads help and version before anything else', () => {
    expect(parseArguments(['--help'])).toEqual({ kind: 'help' });
    expect(parseArguments(['-v'])).toEqual({ kind: 'version' });
    expect(parseArguments(['send', '--help'])).toEqual({ kind: 'help', topic: 'send' });
    expect(parseArguments(['help', 'read'])).toEqual({ kind: 'help', topic: 'read' });
    expect(COMMAND_HELP.send).toContain('--no-wait');
  });

  it('refuses mistakes as usage errors', () => {
    const mistakes = [[], ['frobnicate'], ['send', '--to', 'Researcher'], ['send', 'hi'], ['read'], ['status', '--to', 'x'], ['list', '--file', 'a'],
      ['run'], ['run', 'a', 'b'], ['run', 'a', '--no-wait'], ['run', 'a', '--to', 'x'],
      ['send', 'hi', 'there', '--to', 'x'], ['send', 'hi', '--to', 'x', '--timeout', '0'], ['send', 'hi', '--to'], ['status', '--bogus'], ['send', 'hi', '--to', 'a', '--to', 'b']];
    for (const mistake of mistakes) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    expect(() => parseArguments(['send', 'hi', '--to', 'x', ...Array.from({ length: 21 }, (_, index) => `--file=${index}`)])).toThrow(UsageError);
  });

  it('exits 2 on a usage error without touching the app', async () => {
    const errors: string[] = [];
    const code = await runCli(['send'], { stdout: () => undefined, stderr: text => errors.push(text) }, {});
    expect(code).toBe(2);
    expect(errors.join('\n')).toContain('orglet --help');
  });
});

describe('orglet name matching', () => {
  it('takes a case-insensitive exact name, then a unique prefix', () => {
    expect(matchChat('researcher', chats).id).toBe(workerId);
    expect(matchChat('  REVIEW crew ', chats).id).toBe(teamId);
    expect(matchChat('wri', chats).id).toBe(writerId);
  });

  it('lists candidates when a prefix is shared or nothing matches', () => {
    const more = [...chats, { kind: 'worker' as const, id: taskId, name: 'Reporter' }];
    expect(() => matchChat('re', more)).toThrow(/Researcher, Review crew, Reporter/);
    expect(() => matchChat('Nobody', chats)).toThrow(/Researcher, Writer, Review crew/);
    try { matchChat('re', more); } catch (error) { expect((error as CliFailure).code).toBe('ambiguous'); }
    try { matchChat('Nobody', chats); } catch (error) { expect((error as CliFailure).code).toBe('not_found'); }
  });

  it('calls two chats with the same exact name ambiguous', () => {
    const twins = [...chats, { kind: 'team' as const, id: taskId, name: 'researcher' }];
    expect(() => matchChat('Researcher', twins)).toThrow(CliFailure);
  });
});

describe('orglet answers from a chat', () => {
  const runs = [run('r0', 'Researcher', 0), run('r1', 'Researcher', 1, 'member'), run('r2', 'Writer', 1, 'synthesis'), run('r3', 'Writer', 1, 'member', 'Hết ngân sách.')];
  const artifacts = [
    artifact('a0', 'r0', 'Old answer', '2026-09-25T10:00:01.000Z'),
    artifact('a2', 'r2', 'Combined answer', '2026-09-25T10:00:05.000Z'),
    artifact('a1', 'r1', 'Member result', '2026-09-25T10:00:03.000Z', 'report'),
  ];

  it('takes every answer of one message, oldest first, with the author', () => {
    expect(turnAnswers(detail({ inputRevision: 1 }, runs, artifacts), 1)).toEqual([
      // Each answer carries its author's face colour: the mascot its name suggests (search blue, writer purple).
      { name: 'Researcher', stage: 'member', text: 'Title\n\nMember result', createdAt: '2026-09-25T10:00:03.000Z', color: '#4f7fe0' },
      { name: 'Writer', stage: 'synthesis', text: 'Combined answer', createdAt: '2026-09-25T10:00:05.000Z', color: '#a764c9' },
    ]);
    expect(turnAnswers(detail({}, runs, artifacts), 0).map(answer => answer.text)).toEqual(['Old answer']);
    expect(turnErrors(detail({}, runs, artifacts), 1)).toEqual(['Hết ngân sách.']);
  });

  it('reads the newest message that has an answer', () => {
    const running = detail({ inputRevision: 2, status: 'running' }, [...runs, run('r4', 'Researcher', 2)], artifacts);
    expect(latestAnsweredRevision(running)).toBe(1);
    expect(latestAnsweredRevision(detail({ inputRevision: 0 }, [], []))).toBe(0);
  });

  it('prints one answer bare and a crew under names', () => {
    const answers = [{ name: 'A', text: 'one', createdAt: '' }, { name: 'B', text: 'two', createdAt: '' }];
    expect(formatAnswers(answers.slice(0, 1), false)).toBe('one');
    expect(formatAnswers(answers, true)).toBe('A:\none\n\nB:\ntwo');
    expect(formatList({ orglets: [{ name: 'Researcher', provider: 'demo' }, { name: 'Writer', provider: 'openai', model: 'gpt-5' }], crews: [] })).toBe('Orglets\n  Researcher  demo\n  Writer      openai/gpt-5');
  });
});

describe('orglet request checks', () => {
  const token = createCliToken();
  const translate = (message: string) => message;

  it('compares tokens in constant time and refuses anything else', () => {
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, token.slice(1))).toBe(false);
    expect(tokensMatch(token, createCliToken())).toBe(false);
    expect(tokensMatch(token, undefined)).toBe(false);
    expect(tokensMatch(token, 42)).toBe(false);
  });

  it('allows only status, list, send, read, open and run', () => {
    expect(CliRequest.safeParse({ op: 'status', token }).success).toBe(true);
    expect(CliRequest.safeParse({ op: 'run', token, schedule: 'Morning', files: [] }).success).toBe(true);
    // run starts a schedule that exists; it cannot carry a new setup or a trigger.
    expect(CliRequest.safeParse({ op: 'run', token, schedule: 'Morning', files: [], enabled: true }).success).toBe(false);
    expect(CliRequest.safeParse({ op: 'run', token, schedule: 'Morning', files: [], trigger: { kind: 'called' } }).success).toBe(false);
    for (const op of ['saveRoutine', 'runRoutine', 'catchUpRoutine']) expect(CliRequest.safeParse({ op, token }).success, op).toBe(false);
    for (const op of ['grantWorkspace', 'connect', 'settings', 'deleteTask', 'archiveTask', 'backupExport', 'eraseData']) {
      expect(CliRequest.safeParse({ op, token }).success, op).toBe(false);
    }
    // Extra fields such as a folder or a key are not passed through either.
    expect(CliRequest.safeParse({ op: 'read', token, to: 'x', directory: 'C:\\' }).success).toBe(false);
  });

  it('refuses a disallowed operation and a bad token before the handler runs', async () => {
    const handled: unknown[] = [];
    const options = { token, translate, handle: async (request: unknown) => { handled.push(request); return 'ran'; } };
    const signal = new AbortController().signal;
    expect(await answerLine(JSON.stringify({ op: 'eraseData', token, scope: 'everything' }), options, signal)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await answerLine(JSON.stringify({ op: 'status', token: createCliToken() }), options, signal)).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(await answerLine(JSON.stringify({ op: 'status' }), options, signal)).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(await answerLine('not json', options, signal)).toMatchObject({ ok: false, code: 'invalid' });
    expect(handled).toEqual([]);
    expect(await answerLine(JSON.stringify({ op: 'status', token }), options, signal)).toEqual({ ok: true, value: 'ran' });
  });

  it('finds the data folder and the pipe the way main does', () => {
    expect(resolveUserData({ ORGLET_USER_DATA: 'X', ORGLET_DATA_DIR: 'Y' }, 'win32', 'H')).toBe('X');
    expect(resolveUserData({ ORGLET_DATA_DIR: 'Y' }, 'win32', 'H')).toBe('Y');
    expect(defaultUserData('darwin', {}, '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'Orglet'));
    const pipe = cliEndpoint('C:\\Users\\A\\AppData\\Roaming\\Orglet', 'win32');
    expect(pipe).toMatch(/^\\\\\.\\pipe\\orglet-cli-[a-f0-9]{16}$/);
    expect(cliEndpoint('c:\\users\\a\\appdata\\roaming\\orglet\\', 'win32')).toBe(pipe);
    expect(cliEndpoint('/Users/a/Library/Application Support/Orglet', 'darwin')).toBe(join('/Users/a/Library/Application Support/Orglet', 'cli.sock'));
  });
});

describe('orglet PATH shim', () => {
  it('adds the bin folder once and removes it however it was spelled', () => {
    const bin = 'C:\\Users\\A\\AppData\\Local\\Orglet\\bin';
    expect(pathWithEntry('C:\\Tools;;%USERPROFILE%\\go\\bin', bin)).toBe(`C:\\Tools;%USERPROFILE%\\go\\bin;${bin}`);
    expect(pathWithEntry(`C:\\Tools;${bin.toLowerCase()}\\`, bin)).toBe(`C:\\Tools;${bin.toLowerCase()}\\`);
    expect(pathWithoutEntry(`C:\\Tools;${bin.toUpperCase()}\\;D:\\x`, bin)).toBe('C:\\Tools;D:\\x');
    expect(pathHasEntry(`C:\\Tools;${bin}`, bin)).toBe(true);
    expect(pathWithEntry('', bin)).toBe(bin);
  });

  it('writes the shim with folder variables and escaped percent signs', () => {
    const environment = { LOCALAPPDATA: 'C:\\Users\\Ân\\AppData\\Local', APPDATA: 'C:\\Users\\Ân\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Ân' };
    expect(batchPath('C:\\Users\\Ân\\AppData\\Local\\orglet\\app-0.2.11\\Orglet.exe', environment)).toBe('%LOCALAPPDATA%\\orglet\\app-0.2.11\\Orglet.exe');
    expect(batchPath('D:\\100%\\x', environment)).toBe('D:\\100%%\\x');
    const shim = shimContent({ executable: 'C:\\Users\\Ân\\AppData\\Local\\orglet\\app-0.2.11\\Orglet.exe', cliScript: 'C:\\Users\\Ân\\AppData\\Local\\orglet\\app-0.2.11\\resources\\orglet-cli.cjs', userData: 'C:\\Users\\Ân\\AppData\\Roaming\\Orglet' }, environment);
    expect(shim).toContain('set "ORGLET_USER_DATA=%APPDATA%\\Orglet"');
    expect(shim).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(shim).toContain('"%LOCALAPPDATA%\\orglet\\app-0.2.11\\Orglet.exe" "%LOCALAPPDATA%\\orglet\\app-0.2.11\\resources\\orglet-cli.cjs" %*');
    expect(shim).toMatch(/\r\n/);
    expect(shim).not.toContain('Ân');
  });
});

describe('orglet round trip through the real server', () => {
  let folder: string | undefined;
  let server: CliServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (folder) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  /** A core that knows one Demo orglet and answers a new chat after two reads. */
  function fakeCore() {
    const calls: { command: string; args: unknown }[] = [];
    let reads = 0;
    const workspace = { workers: [{ id: workerId, name: 'Researcher', provider: 'demo' }], teams: [], tasks: [] } as unknown as Workspace;
    const request = async (command: string, args: unknown) => {
      calls.push({ command, args });
      if (command === 'workspace') return workspace;
      if (command === 'createTask') return taskId;
      if (command === 'task') {
        reads += 1;
        if (reads < 3) return detail({ status: 'running' }, [run('r0', 'Researcher', 0)], []);
        return detail({ status: 'completed' }, [run('r0', 'Researcher', 0)], [artifact('a0', 'r0', 'Hello from Demo', '2026-09-25T10:00:01.000Z')]);
      }
      throw new Error(`Unexpected command ${command}`);
    };
    return { calls, request };
  }

  async function startServer() {
    folder = mkdtempSync(join(tmpdir(), 'orglet-cli-'));
    const token = createCliToken();
    await writeCliToken(folder, token);
    const core = fakeCore();
    const opened: (CliChat | undefined)[] = [];
    const operations = new CliOperations({ request: core.request, version: () => '9.9.9', open: chat => opened.push(chat), translate: message => `EN:${message}`, pollMilliseconds: 5 });
    server = new CliServer({ endpoint: cliEndpoint(folder), token, handle: (request, signal) => operations.run(request, signal), translate: message => `EN:${message}` });
    await server.start();
    return { folder, token, core, opened };
  }

  it('sends like the composer, waits for the turn and prints the answer', async () => {
    const started = await startServer();
    const response = await call(started.folder, { op: 'send', to: 'res', message: 'hello', files: [], wait: true, timeoutSeconds: 10 });
    expect(response.ok).toBe(true);
    const value = (response as { value: SendValue }).value;
    expect(value).toMatchObject({ chat: { name: 'Researcher' }, taskId, waited: true, finished: true, status: 'completed', errors: [] });
    expect(value.answers.map(answer => answer.text)).toEqual(['Hello from Demo']);
    const created = started.core.calls.find(item => item.command === 'createTask');
    expect(created?.args).toEqual({ workerId, brief: 'hello', sourceIds: [], excludedSources: [], consent: true, providerScopes: [], budgetMicros: 500_000 });
    expect(started.core.calls.some(item => item.command === 'importSources')).toBe(false);
  });

  it('runs the CLI end to end, translates failures and refuses a bad token', async () => {
    const started = await startServer();
    const printed: string[] = [];
    const errors: string[] = [];
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => errors.push(text) };
    const environment = { ORGLET_USER_DATA: started.folder };
    expect(await runCli(['status'], output, environment)).toBe(0);
    expect(printed.pop()).toBe('Orglet 9.9.9 is running.\n1 orglet, 0 crews.');
    expect(await runCli(['open', '--to', 'researcher'], output, environment)).toBe(0);
    expect(started.opened).toEqual([{ kind: 'worker', id: workerId, name: 'Researcher', color: '#4f7fe0' }]);
    expect(await runCli(['read', '--to', 'Nobody', '--json'], output, environment)).toBe(1);
    expect(JSON.parse(printed.pop()!)).toMatchObject({ ok: false, code: 'not_found', error: 'EN:Không có Tí hay hội nào tên "Nobody". Có: Researcher.' });
    const refused = await exchange(cliEndpoint(started.folder), { op: 'status', token: createCliToken() });
    expect(refused).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('shows the waiting face on standard error while send waits, and stops waiting on Ctrl+C', async () => {
    const started = await startServer();
    const environment = { ORGLET_USER_DATA: started.folder };
    const printed: string[] = [];
    const errors: string[] = [];
    const drawn: string[] = [];
    const statusTerminal = { write: (text: string) => drawn.push(text), mode: 'truecolor' as const, columns: () => 80 };
    const output = { stdout: (text: string) => printed.push(text), stderr: (text: string) => errors.push(text), statusTerminal };
    expect(await runCli(['send', 'hello', '--to', 'res'], output, environment)).toBe(0);
    // Standard output stays plain; the face went to standard error, was taken away and gave the cursor back.
    expect(printed).toEqual(['Hello from Demo']);
    expect(drawn[0]).toBe('\x1b[?25l');
    expect(drawn.join('')).toContain('Researcher is working');
    expect(drawn.join('')).toContain('\x1b[48;2;79;127;224m');
    expect(drawn[drawn.length - 1]).toBe('\x1b[?25h');

    const controller = new AbortController();
    let released = false;
    const catchInterrupt = () => {
      controller.abort();
      return () => {
        released = true;
      };
    };
    const interrupted = { ...output, statusTerminal: { ...statusTerminal, catchInterrupt } };
    expect(await runCli(['send', 'again', '--to', 'res'], interrupted, environment, undefined, { signal: controller.signal })).toBe(1);
    expect(errors.pop()).toBe('Stopped waiting. res keeps working in the app. Read the answer later with: orglet read --to "res"');
    expect(released).toBe(true);
  });

  it('exits 3 when nothing listens and there is no app to start', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-cli-'));
    const errors: string[] = [];
    const code = await runCli(['status'], { stdout: () => undefined, stderr: text => errors.push(text) }, { ORGLET_USER_DATA: folder });
    expect(code).toBe(3);
    expect(errors.join('\n')).toContain('not reachable');
  });

  it('refuses more connections than allowed and a line over the limit', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-cli-'));
    const token = createCliToken();
    const handle = () => new Promise(() => undefined);
    // The default line limit here: a status request with its 64-character token is longer than 64 bytes, so a small
    // limit would refuse the hanging request as too large and close it before the second one arrives.
    server = new CliServer({ endpoint: cliEndpoint(folder), token, handle, translate: message => message, maxConnections: 1 });
    await server.start();
    const hanging = exchange(cliEndpoint(folder), { op: 'status', token });
    hanging.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await exchange(cliEndpoint(folder), { op: 'status', token })).toMatchObject({ ok: false, code: 'busy' });
    await server.close();
    server = new CliServer({ endpoint: cliEndpoint(folder), token, handle: async () => 'ok', translate: message => message, maxLineBytes: 64 });
    await server.start();
    expect(await exchange(cliEndpoint(folder), { op: 'send', token, to: 'x', message: 'y'.repeat(200) })).toMatchObject({ ok: false, code: 'too_large' });
  });
});
