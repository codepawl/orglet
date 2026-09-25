import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, Store } from '../../apps/desktop/src/core/storage/database';
import { readCustomConnections } from '../../apps/desktop/src/core/storage/custom-connections';
import { resolveWorkerModel } from '../../apps/desktop/src/core/models/resolve';
import { fingerprint } from '../../apps/desktop/src/core/tools/sources';
import { mcpToolsOffered } from '../../apps/desktop/src/core/tools/catalog';
import { customProviderId, type CustomConnection } from '../../apps/desktop/src/shared/custom-connections';
import { CoreService } from '../../apps/desktop/src/core/service';
import { CliFailure, CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { commands, type Routine, type Run, type Skill, type Source, type Task, type Worker, type Workspace } from '../../apps/desktop/src/shared/contracts';
import { runningChatName } from '../../apps/desktop/src/renderer/runningList';
import type { Schedule } from '../../apps/desktop/src/shared/schedule';
import type { RoutineTrigger, WatchFolderView } from '../../apps/desktop/src/shared/routine-triggers';

/** Folder and CLI triggers for routines (COD-245), against a real temporary folder. */

const SETTLE_MS = 1_000;
const BATCH_MS = 2_000;
const schedule: Schedule = { timeZone: 'UTC', time: '09:00', frequency: 'daily', weekday: 1 };

let store: Store;
let core: CoreService;
let current: Date;
let directory: string;
let inbox: string;

function startCore(clock: () => Date = () => current, live = false): CoreService {
  const service = new CoreService(store, () => {}, async () => { throw new Error('No live provider'); }, undefined, clock);
  Object.assign(service.folderTriggers.timing, { settleMs: SETTLE_MS, batchMs: BATCH_MS, maxBatchWaitMs: 30_000, live });
  return service;
}

beforeEach(async () => {
  current = new Date('2026-01-05T01:00:00Z');
  directory = await mkdtemp(join(tmpdir(), 'orglet-triggers-'));
  inbox = join(directory, 'inbox');
  await mkdir(inbox);
  store = new Store(join(directory, 'state.sqlite'));
  core = startCore();
});

afterEach(async () => {
  // A watched folder cannot be removed on Windows while its watcher is open.
  core.folderTriggers.stop();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

/** What main does after its picker: the core resolves the folder and hands back an id and a name. */
async function grant(path = inbox): Promise<WatchFolderView> {
  return await core.grantWorkspace({ watch: true, permissions: ['read'], directory: path }) as WatchFolderView;
}

function task(brief = 'Summarise the new files') {
  return { workerId: store.workspace().workers[0].id, sourceIds: [] as string[], brief, consent: false, budgetMicros: 1000 };
}

async function saveRoutine(trigger: RoutineTrigger, overrides: Record<string, unknown> = {}): Promise<Routine> {
  const routine = await core.command('saveRoutine', { name: 'Inbox', enabled: true, schedule, trigger, task: task(), ...overrides }) as Routine;
  // The first tick after a save takes the folder's baseline.
  await core.tick();
  return routine;
}

async function watchInbox(overrides: Record<string, unknown> = {}): Promise<Routine> {
  const folder = await grant();
  return saveRoutine({ kind: 'folder', folderId: folder.folderId, folderName: 'anything' }, overrides);
}

async function advance(milliseconds: number) {
  current = new Date(current.getTime() + milliseconds);
  await core.tick();
}

/** One look sees the files, the next one after the settle time takes them, the one after the quiet time runs. */
async function settleAndRun() {
  await core.tick();
  await advance(SETTLE_MS);
  await advance(BATCH_MS);
}

async function idle() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const busy = store.all<Task>('tasks').some(item => core.runner.isActive(item.id) || core.teams.isActive(item.id));
    if (!busy) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Runs did not finish.');
}

function tasks(): Task[] {
  return store.all<Task>('tasks');
}

function sourceNames(item: Task): string[] {
  return item.sourceIds.map(sourceId => store.get<Source>('sources', sourceId).name).sort();
}

it('starts one run with a new file attached once it settles', async () => {
  const routine = await watchInbox();
  await writeFile(join(inbox, 'invoice.txt'), 'total 42');
  await core.tick();
  await advance(SETTLE_MS);
  expect(tasks()).toHaveLength(0);
  await advance(BATCH_MS);
  await idle();
  expect(tasks()).toHaveLength(1);
  const [started] = tasks();
  expect(started.routineId).toBe(routine.id);
  expect(sourceNames(started)).toEqual(['invoice.txt']);
  expect(store.get<Routine>('routines', routine.id).lastTaskId).toBe(started.id);
  await settleAndRun();
  await settleAndRun();
  expect(tasks()).toHaveLength(1);
});

it('batches a burst into one run and caps it at the source limit', async () => {
  await watchInbox();
  await writeFile(join(inbox, 'a.txt'), 'a');
  await writeFile(join(inbox, 'b.txt'), 'b');
  await core.tick();
  // A file that lands while the first ones settle joins the same batch.
  await writeFile(join(inbox, 'c.txt'), 'c');
  await settleAndRun();
  await advance(BATCH_MS);
  await idle();
  expect(tasks()).toHaveLength(1);
  expect(sourceNames(tasks()[0])).toEqual(['a.txt', 'b.txt', 'c.txt']);

  const names = Array.from({ length: 22 }, (_, index) => `batch-${String(index).padStart(2, '0')}.txt`);
  for (const name of names) await writeFile(join(inbox, name), name);
  await settleAndRun();
  await idle();
  expect(tasks()).toHaveLength(2);
  const batch = tasks().find(item => item.sourceIds.length === 20)!;
  expect(batch.excludedSources).toEqual([
    { name: 'batch-20.txt', reason: 'Đã chọn đủ 20 tệp.' },
    { name: 'batch-21.txt', reason: 'Đã chọn đủ 20 tệp.' },
  ]);
});

it('ignores temporary and partial files', async () => {
  await watchInbox();
  for (const name of ['~$report.docx', 'download.tmp', 'movie.crdownload', 'archive.part', '.hidden.txt']) {
    await writeFile(join(inbox, name), 'partial');
  }
  await settleAndRun();
  expect(tasks()).toHaveLength(0);
  await writeFile(join(inbox, 'report.txt'), 'finished');
  await settleAndRun();
  await idle();
  expect(tasks()).toHaveLength(1);
  expect(sourceNames(tasks()[0])).toEqual(['report.txt']);
});

it('leaves files that were already in the folder alone', async () => {
  await writeFile(join(inbox, 'old.txt'), 'here before the schedule');
  await watchInbox();
  await settleAndRun();
  await settleAndRun();
  expect(tasks()).toHaveLength(0);
});

it('does not run handled files again after a restart, nor files that arrived while closed', async () => {
  const routine = await watchInbox();
  await writeFile(join(inbox, 'first.txt'), 'first');
  await settleAndRun();
  await idle();
  expect(tasks()).toHaveLength(1);
  const handled = store.db.prepare('SELECT name FROM routine_arrivals WHERE routine_id=?').all(routine.id).map(row => String(row.name));
  expect(handled).toEqual(['first.txt']);

  core.folderTriggers.stop();
  store.close();
  await writeFile(join(inbox, 'while-closed.txt'), 'nobody was watching');
  store = new Store(join(directory, 'state.sqlite'));
  core = startCore();
  await core.tick();
  await settleAndRun();
  await settleAndRun();
  expect(tasks()).toHaveLength(1);
  expect(store.get<Routine>('routines', routine.id).lastTaskId).toBe(tasks()[0].id);
});

it('refuses a folder the picker never granted', async () => {
  const neverGranted = '55555555-5555-4555-8555-555555555555';
  await expect(core.command('saveRoutine', { name: 'Sneaky', enabled: true, schedule, trigger: { kind: 'folder', folderId: neverGranted, folderName: 'C:\\' }, task: task() }))
    .rejects.toThrow('chưa được cấp quyền');
  // The renderer can only name a granted folder: a path in the trigger is not part of the contract.
  const withPath = { name: 'Sneaky', enabled: true, schedule, trigger: { kind: 'folder', folderId: neverGranted, folderName: 'x', directory: inbox }, task: task() };
  expect(commands.saveRoutine.safeParse(withPath).success).toBe(false);
  // A watched folder is read-only; the picker cannot be asked for more.
  await expect(core.grantWorkspace({ watch: true, permissions: ['read', 'write'], directory: inbox })).rejects.toThrow();
  expect(store.all('routines')).toHaveLength(0);
});

it('does not fire while the schedule is off', async () => {
  const routine = await watchInbox({ enabled: false });
  await writeFile(join(inbox, 'ignored.txt'), 'off');
  await settleAndRun();
  expect(tasks()).toHaveLength(0);
  // Turning it on starts a new baseline: the file that came while it was off stays out.
  await core.command('saveRoutine', { id: routine.id, name: routine.name, enabled: true, schedule, trigger: routine.trigger, task: routine.task });
  await settleAndRun();
  expect(tasks()).toHaveLength(0);
});

it('lists unreadable and unsupported files as excluded, as the folder import does', async () => {
  await watchInbox();
  await writeFile(join(inbox, 'notes.txt'), 'readable');
  await writeFile(join(inbox, 'setup.exe'), 'MZ');
  await writeFile(join(inbox, 'broken.txt'), Buffer.from([0xff, 0x00, 0xfe]));
  await settleAndRun();
  await idle();
  expect(tasks()).toHaveLength(1);
  expect(sourceNames(tasks()[0])).toEqual(['notes.txt']);
  expect(tasks()[0].excludedSources).toEqual([
    { name: 'broken.txt', reason: 'Không đọc được, không đúng UTF-8 hoặc vượt giới hạn kích thước.' },
    { name: 'setup.exe', reason: 'Định dạng chưa được hỗ trợ.' },
  ]);
});

it('makes the trigger part of the approved setup, and keeps clock routines approved as they were', async () => {
  const clock = await core.command('saveRoutine', { name: 'Clock', enabled: true, schedule, task: task() }) as Routine;
  expect(clock.approvedConfig).toBe(core.routines.configuration(clock.task));
  const called = await saveRoutine({ kind: 'called' }, { name: 'Called' });
  expect(called.approvedConfig).not.toBe(clock.approvedConfig);
  // A trigger changed without saving, as a hand-edited or restored row would be, is not approved.
  store.update('routines', { ...store.get<Routine>('routines', called.id), trigger: { kind: 'schedule' } });
  await expect(core.runRoutine({ id: called.id, sourceIds: [] })).rejects.toThrow('đã đổi');
  expect(tasks()).toHaveLength(0);
});

it('never starts a called or folder routine on the clock', async () => {
  await saveRoutine({ kind: 'called' }, { name: 'Called' });
  await watchInbox();
  await advance(60 * 60 * 1000);
  current = new Date('2026-01-05T09:00:05Z');
  await core.tick();
  await advance(24 * 60 * 60 * 1000);
  expect(tasks()).toHaveLength(0);
  expect(store.all<Routine>('routines').every(routine => routine.pending === null)).toBe(true);
});

it('runs a schedule through the CLI run operation and refuses a disabled or unknown one', async () => {
  const request = async (command: string, args: unknown): Promise<unknown> => {
    if (command === 'importSources') return core.sources.import(args as string[]);
    if (command === 'runRoutine') return core.runRoutine(args);
    return core.command(command as never, args);
  };
  const operations = new CliOperations({ request, version: () => '0.0.0', open: () => {}, translate: message => message });
  await saveRoutine({ kind: 'called' }, { name: 'Invoice check' });
  const attachment = join(directory, 'invoice.txt');
  await writeFile(attachment, 'total 42');
  const started = await operations.runSchedule({ op: 'run', token: 'a'.repeat(64), schedule: 'invoice', files: [attachment] });
  await idle();
  expect(started.schedule.name).toBe('Invoice check');
  expect(tasks()).toHaveLength(1);
  expect(tasks()[0].id).toBe(started.taskId);
  expect(sourceNames(tasks()[0])).toEqual(['invoice.txt']);

  await saveRoutine({ kind: 'called' }, { name: 'Paused job', enabled: false });
  await expect(operations.runSchedule({ op: 'run', token: 'a'.repeat(64), schedule: 'Paused job', files: [] })).rejects.toBeInstanceOf(CliFailure);
  await expect(operations.runSchedule({ op: 'run', token: 'a'.repeat(64), schedule: 'Paused job', files: [] })).rejects.toThrow('đang tắt');
  const unknown = operations.runSchedule({ op: 'run', token: 'a'.repeat(64), schedule: 'Nothing like it', files: [] });
  await expect(unknown).rejects.toMatchObject({ code: 'not_found' });
  // Even past the CLI, the core refuses a disabled routine.
  const paused = store.all<Routine>('routines').find(routine => routine.name === 'Paused job')!;
  await expect(core.runRoutine({ id: paused.id, sourceIds: [] })).rejects.toThrow('đang tắt');
  expect(tasks()).toHaveLength(1);
});

it('picks a new file up through the real folder watcher', async () => {
  core.folderTriggers.stop();
  core = startCore(() => new Date(), true);
  Object.assign(core.folderTriggers.timing, { settleMs: 150, batchMs: 300 });
  const folder = await grant();
  await core.command('saveRoutine', { name: 'Live inbox', enabled: true, schedule, trigger: { kind: 'folder', folderId: folder.folderId, folderName: folder.name }, task: task() });
  await core.folderTriggers.sync();
  // macOS starts its FSEvents stream after fs.watch returns, and a file written before the stream is up never
  // raises an event (the app's own listing tick covers that; this test runs without the tick, to prove the
  // watcher path). Give the stream a moment to start there, and slow runners time to deliver the event.
  await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 1000 : 0));
  await writeFile(join(inbox, 'live.txt'), 'arrived');
  for (let attempt = 0; attempt < 300 && tasks().length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  await idle();
  expect(tasks()).toHaveLength(1);
  expect(sourceNames(tasks()[0])).toEqual(['live.txt']);
}, 30_000);

/** Opens the database file again as a new app start would, after the caller changed it with the store closed. */
function reopen() {
  core.folderTriggers.stop();
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
  core = startCore();
}

function tableNames(): string[] {
  return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name));
}

/** Turns the current database back into an older schema: drops the tables newer versions add and their rows in `migrations`. */
function downgrade(version: number, tables: string[]) {
  for (const table of tables) store.db.exec(`DROP TABLE ${table}`);
  store.db.prepare('DELETE FROM migrations WHERE version > ?').run(version);
}

it('migrates a v15 database (0.4.0) and a v16 database (MCP) to the routine tables of v17', async () => {
  expect(SCHEMA_VERSION).toBe(17);
  const clock = await core.command('saveRoutine', { name: 'Kept', enabled: true, schedule, task: task() }) as Routine;

  downgrade(15, ['mcp_servers', 'routine_arrivals', 'routine_folders']);
  reopen();
  expect(tableNames()).toEqual(expect.arrayContaining(['mcp_servers', 'routine_folders', 'routine_arrivals']));
  expect(store.db.prepare('SELECT version FROM migrations WHERE version >= 16 ORDER BY version').all().map(row => Number(row.version))).toEqual([16, 17]);
  expect(store.get<Routine>('routines', clock.id).approvedConfig).toBe(clock.approvedConfig);

  downgrade(16, ['routine_arrivals', 'routine_folders']);
  store.db.exec(`INSERT INTO mcp_servers(id,data) VALUES('kept','{}')`);
  reopen();
  expect(tableNames()).toEqual(expect.arrayContaining(['routine_folders', 'routine_arrivals']));
  expect(Number(store.db.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version)).toBe(17);
  expect(store.db.prepare(`SELECT id FROM mcp_servers`).all().map(row => String(row.id))).toEqual(['kept']);
  // The row only proves the v16 table survived; it is not a real server, so the workspace would refuse to read it.
  store.db.exec(`DELETE FROM mcp_servers`);
  // Each upgrade keeps a copy of the older database next to it.
  const backups = (await readdir(directory)).filter(name => name.startsWith('state.sqlite.v'));
  expect(backups.some(name => name.startsWith('state.sqlite.v15-'))).toBe(true);
  expect(backups.some(name => name.startsWith('state.sqlite.v16-'))).toBe(true);
  // The migrated database watches folders like a new one.
  await watchInbox();
  await writeFile(join(inbox, 'after-upgrade.txt'), 'new');
  await settleAndRun();
  await idle();
  expect(tasks().filter(item => item.routineId)).toHaveLength(1);
});

it('combines a custom connection price with the trigger in the approval, and leaves clock approvals as main computed them', async () => {
  const connection = await core.command('saveCustomConnection', { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', price: { inputMicrosPerMillion: 400_000, outputMicrosPerMillion: 1_600_000 } }) as CustomConnection;
  const provider = customProviderId(connection.id);
  const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider, modelId: 'qwen3-8b-instruct' }) as Worker;
  const paidTask = { ...task(), workerId: worker.id, consent: true, providerScopes: [provider] };

  // The formula main (COD-242) uses for every routine, written out: a clock routine must keep exactly this.
  const mainFingerprint = () => {
    const current = store.get<Worker>('workers', worker.id);
    const resolved = resolveWorkerModel(current, undefined, readCustomConnections(store));
    const models = [{ provider: current.provider, modelId: current.modelId ?? null, model: resolved.id ?? null, pricingVersion: resolved.pricingVersion }];
    return fingerprint(JSON.stringify({ team: undefined, workers: [current], skills: [store.get<Skill>('skills', current.skillId)], models }));
  };
  const clock = await core.command('saveRoutine', { name: 'Clock', enabled: true, schedule, task: paidTask }) as Routine;
  expect(clock.approvedConfig).toBe(mainFingerprint());
  const called = await saveRoutine({ kind: 'called' }, { name: 'Called', task: paidTask });
  const folder = await watchInbox({ name: 'Folder', task: paidTask });
  expect(new Set([clock.approvedConfig, called.approvedConfig, folder.approvedConfig]).size).toBe(3);

  // A new price is a new setup: every trigger needs saving again, the clock one included, as on main.
  await core.command('saveCustomConnection', { id: connection.id, name: connection.name, baseUrl: connection.baseUrl, price: { inputMicrosPerMillion: 500_000, outputMicrosPerMillion: 2_000_000 } });
  for (const routine of [clock, called, folder]) {
    expect(core.routines.configuration(routine.task, routine.trigger), routine.name).not.toBe(routine.approvedConfig);
  }
  await expect(core.runRoutine({ id: called.id, sourceIds: [] })).rejects.toThrow('đã đổi');
  expect(mainFingerprint()).not.toBe(clock.approvedConfig);
  expect(core.routines.configuration(clock.task)).toBe(mainFingerprint());
  expect(tasks()).toHaveLength(0);
});

it('gives a folder-triggered run no MCP tools, like every scheduled run', async () => {
  const routine = await watchInbox();
  await writeFile(join(inbox, 'for-mcp.txt'), 'content');
  await settleAndRun();
  await idle();
  const [started] = tasks();
  expect(started.routineId).toBe(routine.id);
  // A run of an MCP-enabled orglet, with tools frozen in its snapshot, is still offered none on a routine's task.
  const run = { stage: undefined, snapshot: { worker: { provider: 'openai', mcpServerIds: ['server'] }, mcpTools: [{ serverId: 'server', name: 'search' }] } } as unknown as Run;
  expect(mcpToolsOffered(run, started)).toBe(false);
  expect(mcpToolsOffered(run, { ...started, routineId: undefined })).toBe(true);
});

it('shows folder-triggered and CLI-called runs in the Running view like any other turn', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  core.folderTriggers.stop();
  // A model call that stays open until the test lets it go, so the runs are still working when the view is read.
  core = new CoreService(store, () => {}, async () => ({ async request() {
    requests++;
    await held;
    return { calls: [{ id: `answer-${requests}`, name: 'submit_report', arguments: JSON.stringify({ title: 'Done', summary: 'Done', findings: [], limitations: [] }) }], usage: { input: 10, output: 10 } };
  } }), undefined, () => current);
  Object.assign(core.folderTriggers.timing, { settleMs: SETTLE_MS, batchMs: BATCH_MS, maxBatchWaitMs: 30_000, live: false });
  const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
  const paidTask = { ...task('Total the new invoices'), workerId: worker.id, consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 };
  const folder = await watchInbox({ name: 'Invoices', task: paidTask });
  const called = await saveRoutine({ kind: 'called' }, { name: 'Receipts', task: { ...paidTask, brief: 'Check the receipts I send\nwith totals' } });

  await writeFile(join(inbox, 'invoice.txt'), 'total 42');
  await settleAndRun();
  const calledTaskId = await core.runRoutine({ id: called.id, sourceIds: [] });
  for (let attempt = 0; attempt < 200 && requests === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 10));

  const workspace = await core.command('workspace', {}) as Workspace;
  const folderTask = workspace.tasks.find(item => item.routineId === folder.id)!;
  const byTask = (taskId: string) => (workspace.running ?? []).filter(item => item.taskId === taskId);
  for (const [taskId, name] of [[folderTask.id, 'Total the new invoices'], [calledTaskId, 'Check the receipts I send']] as const) {
    const items = byTask(taskId);
    expect(items.length, name).toBeGreaterThan(0);
    expect(items.every(item => item.worker.id === worker.id && ['running', 'queued'].includes(item.state)), name).toBe(true);
    // The row is named after the routine's brief, the same as a chat's first line.
    expect(runningChatName(items[0], workspace.tasks, workspace.teams)).toBe(name);
  }

  release();
  await idle();
  const after = await core.command('workspace', {}) as Workspace;
  expect((after.running ?? []).filter(item => [folderTask.id, calledTaskId].includes(item.taskId) && ['running', 'queued'].includes(item.state))).toEqual([]);
});
