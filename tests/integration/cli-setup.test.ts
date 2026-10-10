import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { answerLine } from '../../apps/desktop/src/main/cli-server';
import { CliElevation, operationHash } from '../../apps/desktop/src/main/cli-elevation';
import { CliJournal, TERMINAL_JOURNAL_FILE } from '../../apps/desktop/src/main/cli-journal';
import { checkedBackupPath, checkedFolder } from '../../apps/desktop/src/main/cli-folders';
import type { CliDependencies, CliSetupApp } from '../../apps/desktop/src/main/cli-turns';
import { HELD_ACTIONS, SETUP_ACTIONS, type HeldBody } from '../../apps/desktop/src/cli/held-protocol';
import { runCli } from '../../apps/desktop/src/cli/run';
import { parseSetupArguments } from '../../apps/desktop/src/cli/held-setup';
import { BRIDGE_PARITY, COMMAND_PARITY, heldActionScope, NEVER_FROM_TERMINAL } from '../../apps/desktop/src/cli/parity';
import type { CliResponse } from '../../apps/desktop/src/cli/protocol';
import type { ElevationScope, TerminalNotice } from '../../apps/desktop/src/shared/terminal-access';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Stages C and D of docs/cli-held-actions-design.md: every grant and secret operation is locked without the right key,
 * works with a setup key and with a matching one-operation key, and refuses a key made for other arguments.
 */

const token = 'a'.repeat(64);
const SECRET = 'sk-test-SECRET-0123456789';
let directory: string;
let dataFolder: string;
let homeFolder: string;
let workFolder: string;
let store: Store;
let core: CoreService;
let clock = 1_000_000;
let coreCalls: [string, unknown][] = [];
let appCalls: [string, unknown[]][] = [];
let notices: TerminalNotice[] = [];
let failApp = false;
let workerName = '';
let ids = { server: '', custom: '', profile: '', source: '', task: '' };

const MUTATIONS = ['setToolCapabilities', 'grantWorkspace', 'setWorkspaceLevel', 'revokeWorkspace', 'revoke', 'setMcpServerEnabled', 'setMcpGrant', 'updateTask', 'updateSpace',
  'saveDecisionModelSetting', 'saveHarnessAccount', 'removeHarnessAccount', 'selectHarnessAccount', 'startHarnessSignIn', 'cancelHarnessSignIn', 'signOutHarness',
  'saveCustomConnection', 'deleteCustomConnection'];

function sequentialRandom(): (size: number) => Buffer {
  let counter = 3;
  return size => Buffer.from(Array.from({ length: size }, () => (counter += 41) % 256));
}

function recorded(name: string): (...args: unknown[]) => Promise<void> {
  return async (...args) => {
    appCalls.push([name, args]);
    if (failApp) throw new Error(`the store failed for ${SECRET}`);
  };
}

function fakeSetupApp(): CliSetupApp {
  return {
    dataFolder, homeFolder,
    connect: recorded('connect'), disconnect: recorded('disconnect'), forgetKey: recorded('forgetKey'),
    saveSearchKey: recorded('saveSearchKey'), removeSearchKey: recorded('removeSearchKey'),
    removeMcpServer: recorded('removeMcpServer'), signInMcpServer: recorded('signInMcpServer'),
    cancelMcpSignIn: (serverId: string) => { appCalls.push(['cancelMcpSignIn', [serverId]]); },
    setSwitch: recorded('setSwitch'), writeText: recorded('writeText'),
    account: { label: () => 'An Nguyen', signIn: recorded('signIn'), signOut: recorded('signOut'), cancelSignIn: () => { appCalls.push(['cancelSignIn', []]); }, reopenSignIn: recorded('reopenSignIn') },
    startSync: recorded('startSync'),
    browserProfiles: { list: async () => [{ id: ids.profile, name: 'Work' }], clear: recorded('clearProfile'), remove: recorded('removeProfile') },
  };
}

type Setup = { send: (body: Record<string, unknown>, key?: string) => Promise<CliResponse>; elevation: CliElevation; journal: CliJournal; operations: CliOperations };

async function harness(): Promise<Setup> {
  const [worker] = store.all<Worker>('workers');
  workerName = worker.name;
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Hello there', sourceIds: [], excludedSources: [], consent: true, providerScopes: [], budgetMicros: 500_000 }) as string;
  for (let tries = 0; tries < 300 && (core.teams.isActive(taskId) || core.runner.isActive(taskId)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
  await core.command('createSpace', { name: 'Studio', orgletIds: [worker.id], categories: [] });
  ids = { server: randomUUID(), custom: randomUUID(), profile: randomUUID(), source: randomUUID(), task: taskId };
  const elevation = new CliElevation({ isEnabled: async () => true, now: () => clock, randomBytes: sequentialRandom() });
  const journal = new CliJournal(directory, () => new Date(clock), notice => notices.push(notice));
  const request: CliDependencies['request'] = async (command, args) => {
    if (MUTATIONS.includes(command)) {
      coreCalls.push([command, args]);
      return command === 'grantWorkspace' ? { id: randomUUID(), taskId, revision: 1, permissions: ['read'], name: 'notes', revoked: false } : undefined;
    }
    if (command === 'backupExport') return 'BACKUP-JSON';
    if (command === 'workspaceAccess') return null;
    if (command === 'harnesses') return [{ id: 'codex', accounts: [{ id: 'acc-1', label: 'Work' }] }];
    if (command === 'workspace') {
      const workspace = await core.command('workspace', {}) as Record<string, unknown>;
      return { ...workspace, mcpServers: [{ id: ids.server, name: 'Notes', enabled: true }], customConnections: [{ id: ids.custom, name: 'Local', baseUrl: 'http://localhost:1234/v1' }] };
    }
    return core.command(command as never, args as never);
  };
  const dependencies: CliDependencies = { version: () => 'test', open: () => undefined, translate: text => text, request, terminalAccess: { elevation, journal }, setup: fakeSetupApp() };
  const operations = new CliOperations(dependencies);
  const options = { token, translate: (text: string) => text, elevation, handle: (parsed: never, signal: AbortSignal, progress: never, grant: never) => operations.run(parsed, signal, progress, grant) };
  const send = (body: Record<string, unknown>, key?: string) => answerLine(JSON.stringify({ token, ...body, ...(key ? { elevation: key } : {}) }), options as never, new AbortController().signal);
  return { send, elevation, journal, operations };
}

async function pair(elevation: CliElevation, scope: ElevationScope, operation?: HeldBody): Promise<string> {
  const started = await elevation.startPairing(scope, operation ? { hash: operationHash(operation), words: 'x' } : undefined);
  return elevation.finishPairing(started.pairingId, elevation.state().pairing!.code).key;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-cli-setup-'));
  dataFolder = join(directory, 'data');
  homeFolder = join(directory, 'home');
  workFolder = join(homeFolder, 'work', 'notes');
  await mkdir(dataFolder, { recursive: true });
  await mkdir(workFolder, { recursive: true });
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No model here.'); });
  coreCalls = [];
  appCalls = [];
  notices = [];
  failApp = false;
});
afterEach(async () => {
  await core.runner.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

/** One body per operation of stages C and D, with the core command or main function it must end in. */
function operationsTable(): { name: string; body: HeldBody; core?: string; app?: string }[] {
  const chat = { to: workerName };
  return [
    { name: 'tools', body: { action: 'tools', ...chat, capabilities: ['skill.read', 'app.propose'] }, core: 'setToolCapabilities' },
    { name: 'folder', body: { action: 'folder', ...chat, path: workFolder, permissions: ['read', 'write'] }, core: 'grantWorkspace' },
    { name: 'schedule watch', body: { action: 'schedule-folder', kind: 'watch', path: workFolder, permissions: ['read'] }, core: 'grantWorkspace' },
    { name: 'schedule work', body: { action: 'schedule-folder', kind: 'work', path: workFolder, permissions: ['read', 'write'] }, core: 'grantWorkspace' },
    { name: 'folder-level', body: { action: 'folder-level', ...chat, permissions: ['read'] }, core: 'setWorkspaceLevel' },
    { name: 'folder-revoke', body: { action: 'folder-revoke', ...chat }, core: 'revokeWorkspace' },
    { name: 'file-revoke', body: { action: 'file-revoke', sourceId: randomUUID() }, core: 'revoke' },
    { name: 'mcp-enable', body: { action: 'mcp-enable', server: 'Notes', enabled: false }, core: 'setMcpServerEnabled' },
    { name: 'mcp-grant', body: { action: 'mcp-grant', ...chat, server: 'Notes', allowed: true }, core: 'setMcpGrant' },
    { name: 'mcp-remove', body: { action: 'mcp-remove', server: 'Notes' }, app: 'removeMcpServer' },
    { name: 'mcp-sign-in', body: { action: 'mcp-sign-in', server: 'Notes' }, app: 'signInMcpServer' },
    { name: 'mcp sign-in cancel', body: { action: 'mcp-sign-in', server: 'Notes', cancel: true }, app: 'cancelMcpSignIn' },
    { name: 'limit', body: { action: 'limit', ...chat, budgetMicros: 2_000_000 }, core: 'updateTask' },
    { name: 'space-tools', body: { action: 'space-tools', space: 'Studio', capabilities: ['network.web'] }, core: 'updateSpace' },
    { name: 'decision-model', body: { action: 'decision-model', entries: [{ connection: 'openai', model: 'gpt-5-mini' }] }, core: 'saveDecisionModelSetting' },
    { name: 'switch', body: { action: 'switch', what: 'analytics', enabled: false }, app: 'setSwitch' },
    { name: 'backup', body: { action: 'backup', path: join(directory, 'home', 'backup.json') }, app: 'writeText' },
    { name: 'sync', body: { action: 'sync', confirm: 'an nguyen' }, app: 'startSync' },
    { name: 'browser-profile clear', body: { action: 'browser-profile', change: 'clear', profile: 'Work', confirm: 'Work' }, app: 'clearProfile' },
    { name: 'browser-profile delete', body: { action: 'browser-profile', change: 'delete', profile: 'Work', confirm: 'Work' }, app: 'removeProfile' },
    { name: 'harness add', body: { action: 'harness', change: 'add', harness: 'codex', label: 'Spare' }, core: 'saveHarnessAccount' },
    { name: 'harness remove', body: { action: 'harness', change: 'remove', harness: 'codex', account: 'Work' }, core: 'removeHarnessAccount' },
    { name: 'harness select', body: { action: 'harness', change: 'select', harness: 'codex', account: 'Work' }, core: 'selectHarnessAccount' },
    { name: 'harness sign-in', body: { action: 'harness', change: 'sign-in', harness: 'codex', account: 'Work' }, core: 'startHarnessSignIn' },
    { name: 'harness cancel', body: { action: 'harness', change: 'cancel', harness: 'codex' }, core: 'cancelHarnessSignIn' },
    { name: 'harness sign-out', body: { action: 'harness', change: 'sign-out', harness: 'codex', account: 'Work' }, core: 'signOutHarness' },
    { name: 'account sign-in', body: { action: 'account', change: 'sign-in' }, app: 'signIn' },
    { name: 'account sign-out', body: { action: 'account', change: 'sign-out' }, app: 'signOut' },
    { name: 'account cancel', body: { action: 'account', change: 'cancel' }, app: 'cancelSignIn' },
    { name: 'account reopen', body: { action: 'account', change: 'reopen' }, app: 'reopenSignIn' },
    { name: 'custom save', body: { action: 'custom-connection', change: 'save', name: 'Local', baseUrl: 'http://localhost:1234/v1' }, core: 'saveCustomConnection' },
    { name: 'custom delete', body: { action: 'custom-connection', change: 'delete', name: 'Local' }, core: 'deleteCustomConnection' },
    { name: 'disconnect', body: { action: 'disconnect', provider: 'openai' }, app: 'disconnect' },
    { name: 'search-key-remove', body: { action: 'search-key-remove', provider: 'exa' }, app: 'removeSearchKey' },
    { name: 'connect', body: { action: 'connect', provider: 'openai', secret: SECRET }, app: 'connect' },
    { name: 'search-key', body: { action: 'search-key', provider: 'exa', secret: SECRET }, app: 'saveSearchKey' },
  ];
}

function expectDone(row: { core?: string; app?: string }): void {
  if (row.core) expect(coreCalls.map(([command]) => command), 'core command').toContain(row.core);
  if (row.app) expect(appCalls.map(([name]) => name), 'main function').toContain(row.app);
}

describe('every stage C and D operation', () => {
  it('covers every setup action of the protocol', async () => {
    await harness();
    const covered = new Set(operationsTable().map(row => row.body.action));
    expect([...SETUP_ACTIONS].filter(action => !covered.has(action as never))).toEqual([]);
  });

  it('is `locked` without a key and with a decisions key, and nothing runs', async () => {
    const { send, elevation } = await harness();
    const decisions = await pair(elevation, 'decisions');
    for (const row of operationsTable()) {
      expect(await send({ op: 'held', request: row.body }), row.name).toMatchObject({ ok: false, code: 'locked' });
      expect(await send({ op: 'held', request: row.body }, decisions), row.name).toMatchObject({ ok: false, code: 'locked' });
    }
    expect(coreCalls).toEqual([]);
    expect(appCalls).toEqual([]);
  });

  it('is done with a setup key', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'setup');
    for (const row of operationsTable()) {
      coreCalls = [];
      appCalls = [];
      expect(await send({ op: 'held', request: row.body }, key), row.name).toMatchObject({ ok: true });
      expectDone(row);
    }
  });

  it('is done with a matching one key, once, and refused with a one key made for other arguments', async () => {
    const { send, elevation } = await harness();
    for (const row of operationsTable()) {
      coreCalls = [];
      appCalls = [];
      const other = await pair(elevation, 'one', { action: 'install-update' });
      expect(await send({ op: 'held', request: row.body }, other), row.name).toMatchObject({ ok: false, code: 'locked' });
      expect(coreCalls).toEqual([]);
      expect(appCalls).toEqual([]);
      const matching = await pair(elevation, 'one', row.body);
      expect(await send({ op: 'held', request: row.body }, matching), row.name).toMatchObject({ ok: true });
      expectDone(row);
      expect(await send({ op: 'held', request: row.body }, matching), row.name).toMatchObject({ ok: false, code: 'locked' });
    }
  });

  it('gives every setup action the setup scope', () => {
    for (const action of SETUP_ACTIONS) expect(heldActionScope(action as keyof typeof HELD_ACTIONS), action).toBe('setup');
  });

  it('refuses a one key made for a folder when the path differs by a character', async () => {
    const { send, elevation } = await harness();
    const asked: HeldBody = { action: 'folder', to: workerName, path: workFolder, permissions: ['read'] };
    const key = await pair(elevation, 'one', asked);
    expect(await send({ op: 'held', request: { ...asked, path: `${workFolder}x` } }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(await send({ op: 'held', request: { ...asked, permissions: ['read', 'write'] } }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(coreCalls).toEqual([]);
  });
});

describe('the folder a terminal names', () => {
  it('refuses a path that is not there, is relative, is a file, a drive root, the home folder, or the data folder and what holds it', async () => {
    const places = { dataFolder, homeFolder };
    const file = join(workFolder, 'a.txt');
    await writeFile(file, 'x');
    await expect(checkedFolder(join(workFolder, 'missing'), places)).rejects.toThrow('không tồn tại');
    await expect(checkedFolder('notes', places)).rejects.toThrow('đầy đủ');
    await expect(checkedFolder(file, places)).rejects.toThrow('không phải thư mục');
    const root = join(workFolder).split(/[\\/]/)[0] + (process.platform === 'win32' ? '\\' : '/');
    await expect(checkedFolder(root, places)).rejects.toThrow('ổ đĩa');
    await expect(checkedFolder(homeFolder, places)).rejects.toThrow('thư mục cá nhân');
    await expect(checkedFolder(dataFolder, places)).rejects.toThrow('thư mục dữ liệu');
    await mkdir(join(dataFolder, 'inside'), { recursive: true });
    await expect(checkedFolder(join(dataFolder, 'inside'), places)).rejects.toThrow('thư mục dữ liệu');
    await expect(checkedFolder(directory, places)).rejects.toThrow('thư mục dữ liệu');
    await expect(checkedFolder(workFolder, places)).resolves.toBeTruthy();
  });

  it('refuses a folder grant for the data folder through the pipe and calls nothing', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'setup');
    const response = await send({ op: 'held', request: { action: 'folder', to: workerName, path: dataFolder, permissions: ['read'] } }, key);
    expect(response).toMatchObject({ ok: false });
    expect(coreCalls).toEqual([]);
    const rows = await readFile(join(directory, TERMINAL_JOURNAL_FILE), 'utf8');
    expect(rows).toContain('"outcome":"failed"');
  });

  it('writes a backup only to a new file in a folder that exists outside the data folder', async () => {
    const places = { dataFolder, homeFolder };
    await expect(checkedBackupPath(join(homeFolder, 'no', 'such', 'b.json'), places)).rejects.toThrow('không tồn tại');
    await expect(checkedBackupPath(join(dataFolder, 'b.json'), places)).rejects.toThrow('thư mục dữ liệu');
    await expect(checkedBackupPath(workFolder, places)).rejects.toThrow('thư mục');
    await expect(checkedBackupPath(join(homeFolder, 'b.json'), places)).resolves.toContain('b.json');
  });
});

describe('names typed back', () => {
  it('refuses a sync and a browser profile change whose typed name is not the real one', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'setup');
    expect(await send({ op: 'held', request: { action: 'sync', confirm: 'someone else' } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'browser-profile', change: 'delete', profile: 'Work', confirm: 'wrong' } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'browser-profile', change: 'delete', profile: 'Nope', confirm: 'Nope' } }, key)).toMatchObject({ ok: false });
    expect(appCalls).toEqual([]);
    expect(await send({ op: 'held', request: { action: 'browser-profile', change: 'delete', profile: 'work', confirm: 'Work' } }, key)).toMatchObject({ ok: true });
    expect(appCalls.map(([name]) => name)).toEqual(['removeProfile']);
  });
});

describe('a secret', () => {
  it('is saved by the credential function, and is in no answer, no journal row and no thrown message', async () => {
    const { send, elevation, journal } = await harness();
    const key = await pair(elevation, 'setup');
    const answers: string[] = [];
    for (const body of [{ action: 'connect', provider: 'openai', secret: SECRET }, { action: 'search-key', provider: 'exa', secret: SECRET }]) {
      answers.push(JSON.stringify(await send({ op: 'held', request: body }, key)));
    }
    expect(appCalls.map(([name, args]) => [name, args[1]])).toEqual([['connect', SECRET], ['saveSearchKey', SECRET]]);
    failApp = true;
    for (const body of [{ action: 'connect', provider: 'openai', secret: SECRET }, { action: 'search-key', provider: 'exa', secret: SECRET }]) {
      const failed = await send({ op: 'held', request: body }, key);
      expect(failed).toMatchObject({ ok: false, error: 'Không lưu được khóa.' });
      answers.push(JSON.stringify(failed));
    }
    expect(answers.join('\n')).not.toContain(SECRET);
    expect(await readFile(join(directory, TERMINAL_JOURNAL_FILE), 'utf8')).not.toContain(SECRET);
    expect(JSON.stringify(await journal.list())).not.toContain(SECRET);
    expect(JSON.stringify(notices)).not.toContain(SECRET);
    expect(JSON.stringify(elevation.state())).not.toContain(SECRET);
  });

  it('is left out of the hash a one pairing is bound to, and a pairing that carries one is refused', async () => {
    const { send, elevation } = await harness();
    const without: HeldBody = { action: 'connect', provider: 'openai' };
    expect(operationHash({ ...without, secret: SECRET })).toBe(operationHash(without));
    expect(operationHash({ ...without, secret: 'another-key-entirely' })).toBe(operationHash(without));
    const refused = await send({ op: 'pair-start', scope: 'one', operation: { ...without, secret: SECRET } });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(elevation.state().pairing).toBeUndefined();
    const started = await send({ op: 'pair-start', scope: 'one', operation: without }) as { ok: true; value: { pairingId: string } };
    expect(started.ok).toBe(true);
    const shown = JSON.stringify(elevation.state());
    expect(shown).toContain('openai');
    expect(shown).not.toContain(SECRET);
  });

  it('is typed after the pairing: the key made for the operation without it saves the key once', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'one', { action: 'connect', provider: 'openai' });
    expect(await send({ op: 'held', request: { action: 'connect', provider: 'openai', secret: SECRET } }, key)).toMatchObject({ ok: true });
    expect(await send({ op: 'held', request: { action: 'connect', provider: 'openai', secret: SECRET } }, key)).toMatchObject({ ok: false, code: 'locked' });
    expect(appCalls).toHaveLength(1);
  });

  it('refuses a connect that arrives without a key, except for Ollama', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'setup');
    expect(await send({ op: 'held', request: { action: 'connect', provider: 'openai' } }, key)).toMatchObject({ ok: false });
    expect(await send({ op: 'held', request: { action: 'connect', provider: 'ollama' } }, key)).toMatchObject({ ok: true });
    expect(appCalls.map(([name, args]) => [name, args[1]])).toEqual([['connect', undefined]]);
  });

  it('reads a custom connection by its name', async () => {
    const { send, elevation } = await harness();
    const key = await pair(elevation, 'setup');
    expect(await send({ op: 'held', request: { action: 'connect', provider: 'local', secret: SECRET } }, key)).toMatchObject({ ok: true });
    expect(appCalls[0][1][0]).toBe(`custom:${ids.custom}`);
  });

  it('is never an argument: the command takes its key from the prompt only', () => {
    const parsed = parseSetupArguments(['connect', 'openai']);
    expect(parsed.secretPrompt).toBeTruthy();
    expect(JSON.stringify(parsed.body)).not.toContain('secret');
    expect(() => parseSetupArguments(['connect', 'openai', '--key', SECRET])).toThrow();
  });
});

describe('notices and Undo', () => {
  it('raises a notice for each grant and offers Undo where the core can take it back', async () => {
    const { send, elevation, journal, operations } = await harness();
    const key = await pair(elevation, 'setup');
    await send({ op: 'held', request: { action: 'folder', to: workerName, path: workFolder, permissions: ['read'] } }, key);
    await send({ op: 'held', request: { action: 'mcp-enable', server: 'Notes', enabled: false } }, key);
    await send({ op: 'held', request: { action: 'switch', what: 'analytics', enabled: false } }, key);
    expect(notices).toHaveLength(3);
    const rows = await journal.list();
    expect(rows.map(row => row.undoable)).toEqual([false, true, true]);
    expect(JSON.stringify(rows)).not.toContain('"undo"');
    coreCalls = [];
    await operations.undoGrant(rows[2].id);
    await operations.undoGrant(rows[1].id);
    expect(coreCalls).toEqual([
      ['revokeWorkspace', { taskId: ids.task }],
      ['setMcpServerEnabled', { id: ids.server, enabled: true }],
    ]);
    await expect(operations.undoGrant(rows[1].id)).rejects.toThrow('hoàn tác');
    await expect(operations.undoGrant(rows[0].id)).rejects.toThrow('hoàn tác');
    expect((await journal.list()).filter(row => row.undoneAt).length).toBe(2);
  });

  it('runs only the fixed shapes: a journal line with another recipe is dropped and cannot be undone', async () => {
    const { journal, operations } = await harness();
    const id = randomUUID();
    const forged = { id, at: new Date(clock).toISOString(), scope: 'setup', operation: 'forged', outcome: 'done', undoable: true, undo: { kind: 'run-command', command: 'eraseData' } };
    await writeFile(join(directory, TERMINAL_JOURNAL_FILE), `${JSON.stringify(forged)}\n`);
    expect(await journal.list()).toEqual([]);
    await expect(operations.undoGrant(id)).rejects.toThrow('hoàn tác');
    expect(coreCalls).toEqual([]);
  });

  it('never runs a recipe read from the file: a forged row of an allowed shape shows no Undo and undoes nothing', async () => {
    const { journal, operations } = await harness();
    const id = randomUUID();
    const forged = { id, at: new Date(clock).toISOString(), scope: 'setup', operation: 'forged', outcome: 'done', undoable: true, undo: { kind: 'restore-mcp-enabled', serverId: randomUUID(), enabled: true } };
    await writeFile(join(directory, TERMINAL_JOURNAL_FILE), `${JSON.stringify(forged)}
`);
    expect((await journal.list()).map(row => row.undoable)).toEqual([false]);
    await expect(operations.undoGrant(id)).rejects.toThrow('hoàn tác');
    expect(coreCalls).toEqual([]);
  });

  it('names an Undo by the row only: the pipe has no operation for it', async () => {
    const { send } = await harness();
    expect(await send({ op: 'held', request: { action: 'undo', id: randomUUID() } })).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('the pairing for setup', () => {
  it('opens for setup and for a setup operation, and the dialog says the operation in words', async () => {
    const { send, elevation } = await harness();
    expect(await send({ op: 'pair-start', scope: 'setup' })).toMatchObject({ ok: true });
    elevation.cancelPairing();
    const body: HeldBody = { action: 'folder', to: workerName, path: workFolder, permissions: ['read', 'write'] };
    expect(await send({ op: 'pair-start', scope: 'one', operation: body })).toMatchObject({ ok: true });
    const shown = elevation.state().pairing!;
    expect(shown.operation).toContain(workFolder);
    expect(shown.operation).toContain('đọc và sửa');
  });
});

describe('what stays in the desktop', () => {
  it('keeps every key of the never list off the elevated answer', () => {
    const table = { ...COMMAND_PARITY, ...BRIDGE_PARITY } as Record<string, { status: string }>;
    for (const key of NEVER_FROM_TERMINAL) {
      expect(table[key], key).toBeDefined();
      expect(['held', 'window-only'], key).toContain(table[key].status);
    }
    const reachableByAction = Object.values(HELD_ACTIONS).flatMap(action => action.keys);
    for (const key of NEVER_FROM_TERMINAL) expect(reachableByAction, key).not.toContain(key);
  });
});

describe('the grant, connect and disconnect commands', () => {
  it('exit with 2 before sending anything when there is no terminal', async () => {
    const lines: string[] = [];
    const output = { stdout: (text: string) => lines.push(text), stderr: (text: string) => lines.push(text) };
    for (const argumentList of [['grant', 'tools', '--to', 'Researcher', 'skill.read'], ['grant', 'folder', '--to', 'Researcher', workFolder], ['connect', 'openai'], ['disconnect', 'openai'], ['grant', 'analytics', 'off']]) {
      expect(await runCli(argumentList, output, { ORGLET_USER_DATA: directory }), argumentList.join(' ')).toBe(2);
    }
    expect(lines.join('\n')).toContain('terminal');
  });

  it('turn what is typed into one body, and say usage mistakes as usage errors', () => {
    expect(parseSetupArguments(['grant', 'folder', '--to', 'Researcher', 'D:\\notes', '--edit']).body).toEqual({ action: 'folder', to: 'Researcher', path: 'D:\\notes', permissions: ['read', 'write'] });
    expect(parseSetupArguments(['grant', 'limit', '--chat', 'ab12', '2.5']).body).toEqual({ action: 'limit', chat: 'ab12', budgetMicros: 2_500_000 });
    expect(parseSetupArguments(['grant', 'mcp', '--to', 'R', 'Notes', 'search', 'deny']).body).toEqual({ action: 'mcp-grant', to: 'R', server: 'Notes', tool: 'search', allowed: false });
    expect(parseSetupArguments(['grant', 'sync', '--confirm', 'An', 'replace']).body).toEqual({ action: 'sync', confirm: 'An', choice: 'replace' });
    expect(parseSetupArguments(['connect', 'search', 'exa'])).toMatchObject({ body: { action: 'search-key', provider: 'exa' } });
    expect(() => parseSetupArguments(['grant', 'folder', 'D:\\notes'])).toThrow();
    expect(() => parseSetupArguments(['grant', 'folder', '--to', 'A', '--chat', 'b', 'D:\\notes'])).toThrow();
    expect(() => parseSetupArguments(['grant', 'nonsense'])).toThrow();
  });
});
