import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { IntegrationResult, WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Handing in folders, moves and deletions (COD-254), through core with a plain-Node stand-in for the broker's
 * contract: every step checks the snapshot hash, never replaces, and backs a deleted file up first. These fixtures
 * prove core's plan, journal, records and Runner path; the native broker's own suite proves the Windows semantics.
 */

const hashOf = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;
const present = (path: string) => lstat(path).then(() => true, () => false);

let directory: string;
let source: string;
let store: Store;
let run: Run;
let task: Task;
let grants: WorkspaceGrants;
let applied: string[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-handin-'));
  source = join(directory, 'inbox');
  await mkdir(source);
  await writeFile(join(source, 'IMG_0412.jpg'), 'photo bytes');
  await writeFile(join(source, 'contract-final.pdf'), 'contract v2');
  await writeFile(join(source, 'contract (1).pdf'), 'contract v1');
  await writeFile(join(source, 'contract-old.pdf'), 'contract v1');
  await writeFile(join(source, 'receipt 3.pdf'), 'receipt march');
  await writeFile(join(source, 'notes.txt'), 'meeting notes');
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.all<Skill>('skills')[0];
  task = { id: id(), workerId: worker.id, brief: 'Tidy up my inbox folder', consent: true, providerScopes: ['openai'],
    sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now() };
  store.put('tasks', task);
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] });
  run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null,
    snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id) } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  applied = [];
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

type ApplyOptions = Parameters<WorkspaceIntegration['apply']>[0];

/** The broker's contract in plain Node: hash-checked, never replacing, a backup before a deletion or an overwrite. */
async function broker(options: ApplyOptions): Promise<IntegrationResult> {
  options.authorize();
  const operation = options.operation ?? 'write';
  applied.push(`${operation} ${options.operation === 'move' ? `${options.from} → ` : ''}${options.path}`);
  const target = join(options.root, options.path);
  const result = (status: 'applied' | 'conflict', hash: string | null, extra: Partial<IntegrationResult> = {}) =>
    ({ status, hash, backupPath: '', created: false, ...extra }) as IntegrationResult;
  const conflict = (reason: 'changed' | 'missing' | 'exists' | 'not_empty', hash: string | null = null) =>
    ({ status: 'conflict', hash, reason, backupPath: '', created: false }) as IntegrationResult;
  if (options.operation === 'create_folder') {
    if (await present(target) && !(await lstat(target)).isDirectory()) return conflict('exists');
    await mkdir(target, { recursive: true });
    return result('applied', null);
  }
  if (options.operation === 'remove_folder') {
    if (!await present(target)) return conflict('missing');
    if ((await readdir(target)).length) return conflict('not_empty');
    await rmdir(target);
    return result('applied', null);
  }
  if (options.operation === 'move') {
    const from = join(options.root, options.from);
    if (!await present(from)) return conflict('missing');
    const current = hashOf(await readFile(from));
    if (current !== options.expectedHash) return conflict('changed', current);
    if (await present(target) && target.toLowerCase() !== from.toLowerCase()) return conflict('exists');
    await mkdir(dirname(target), { recursive: true });
    await rename(from, target);
    return result('applied', options.expectedHash);
  }
  const backupPath = join(directory, `backup-${id()}`);
  if (options.operation === 'delete') {
    if (!await present(target)) return conflict('missing');
    const current = hashOf(await readFile(target));
    if (current !== options.expectedHash) return conflict('changed', current);
    await copyFile(target, backupPath);
    await unlink(target);
    return result('applied', null, { backupPath });
  }
  if (operation === 'write' && 'bytes' in options) {
    if (options.expectedHash === null) {
      if (await present(target)) return conflict('exists');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, options.bytes, { flag: 'wx' });
      return result('applied', hashOf(options.bytes), { backupPath, created: true });
    }
    if (!await present(target)) return conflict('missing');
    const current = hashOf(await readFile(target));
    if (current !== options.expectedHash) return conflict('changed', current);
    await copyFile(target, backupPath);
    await writeFile(target, options.bytes);
    return result('applied', hashOf(options.bytes), { backupPath });
  }
  throw new Error(`Unexpected step ${operation}`);
}

function runtime(integrate: WorkspaceIntegration['apply'] = broker) {
  return new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, id());
      await mkdir(copy);
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request, abort) => { abort.throwIfAborted(); return executeWorkspaceOperation(copy, request); },
  }, { apply: integrate });
}

const copyRecord = () => JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(run.id)!.data));
const listing = async (folder = source): Promise<string[]> => {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => entry.isDirectory()
    ? [`${entry.name}/`, ...(await listing(join(folder, entry.name))).map(path => `${entry.name}/${path}`)]
    : [entry.name]));
  return nested.flat().sort();
};

/** The tidy-up the COD-254 report asked for, as the tool calls a model makes. */
const tidyCalls = [
  { name: 'workspace_list', arguments: { path: '' } },
  { name: 'workspace_create_folder', arguments: { path: 'receipts' } },
  { name: 'workspace_create_folder', arguments: { path: 'contracts' } },
  { name: 'workspace_create_folder', arguments: { path: 'images' } },
  { name: 'workspace_create_folder', arguments: { path: 'notes' } },
  { name: 'workspace_move', arguments: { from: 'receipt 3.pdf', to: 'receipts/2026-03 receipt.pdf' } },
  { name: 'workspace_move', arguments: { from: 'contract-final.pdf', to: 'contracts/lease 2026.pdf' } },
  { name: 'workspace_move', arguments: { from: 'IMG_0412.jpg', to: 'images/office photo.jpg' } },
  { name: 'workspace_move', arguments: { from: 'notes.txt', to: 'notes/meeting notes.txt' } },
  { name: 'workspace_delete', arguments: { path: 'contract-old.pdf' } },
  { name: 'workspace_move', arguments: { from: 'contract (1).pdf', to: 'contracts/lease 2026 draft.pdf' } },
  { name: 'reply', arguments: { message: 'Sorted the inbox into four folders and removed the older duplicate contract.', title: null, knowledgeProposals: [] } },
];

function scripted(calls: { name: string; arguments: unknown }[], beforeReply?: () => Promise<void>): ModelAdapter {
  let step = 0;
  return { request: async (_messages, tools) => {
    const call = calls[step++];
    expect(tools.some(tool => tool.type === 'function' && tool.function.name === call.name), call.name).toBe(true);
    if (call.name === 'reply') await beforeReply?.();
    return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
  } };
}

async function runWith(adapter: ModelAdapter, integrate: WorkspaceIntegration['apply'] = broker) {
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime(integrate));
  await core.runner.run(task, run);
  return store.detail(task.id);
}

it('offers folder, move and delete only with edit access, never to a planner', () => {
  const names = (candidate: Run) => toolsFor(candidate, task).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
  expect(names(run)).toEqual(expect.arrayContaining(['workspace_create_folder', 'workspace_move', 'workspace_delete']));
  const readOnly = { ...run, snapshot: { ...run.snapshot, workspaceGrant: { ...run.snapshot.workspaceGrant!, permissions: ['read' as const] } } };
  expect(names(readOnly)).not.toEqual(expect.arrayContaining(['workspace_move']));
  expect(names({ ...run, stage: 'plan' })).not.toEqual(expect.arrayContaining(['workspace_create_folder', 'workspace_move', 'workspace_delete']));
});

it('hands in an inbox tidy-up through Runner: folders, moves, renames and the duplicate deleted with a backup', async () => {
  const detail = await runWith(scripted(tidyCalls));
  expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
  expect(await listing()).toEqual([
    'contracts/', 'contracts/lease 2026 draft.pdf', 'contracts/lease 2026.pdf',
    'images/', 'images/office photo.jpg',
    'notes/', 'notes/meeting notes.txt',
    'receipts/', 'receipts/2026-03 receipt.pdf',
  ]);
  expect(await readFile(join(source, 'contracts', 'lease 2026.pdf'), 'utf8')).toBe('contract v2');
  expect(applied).toEqual([
    'create_folder contracts', 'create_folder images', 'create_folder notes', 'create_folder receipts',
    'move contract (1).pdf → contracts/lease 2026 draft.pdf', 'move contract-final.pdf → contracts/lease 2026.pdf',
    'move IMG_0412.jpg → images/office photo.jpg', 'move notes.txt → notes/meeting notes.txt',
    'move receipt 3.pdf → receipts/2026-03 receipt.pdf', 'delete contract-old.pdf',
  ]);
  const copy = copyRecord();
  expect(copy.state).toBe('integrated');
  expect(copy.changes.every((change: { status: string }) => change.status === 'applied')).toBe(true);
  const deleted = copy.changes.find((change: { kind: string }) => change.kind === 'delete');
  expect(await readFile(deleted.backupPath, 'utf8')).toBe('contract v1');
  // Nothing left an unknown outcome, and the chat keeps what the run changed for the line under the answer.
  expect(store.db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE state!='completed'").get()!.count).toBe(0);
  expect(new WorkspaceRecovery(store).view(task.id).copies[0].diff).toEqual({ files: 6, additions: 0, deletions: 0, moved: 5, removed: 1, folders: 4, lines: false });
  expect(detail.events.map(event => event.message)).toEqual(expect.arrayContaining([
    'Workspace create_folder: receipts', 'Workspace move: receipt 3.pdf → receipts/2026-03 receipt.pdf', 'Workspace delete: contract-old.pdf',
    'Đã tạo thư mục: receipts', 'Đã chuyển tệp: receipt 3.pdf → receipts/2026-03 receipt.pdf', 'Đã xóa tệp và giữ bản gốc riêng: contract-old.pdf',
  ]));
  expect(detail.artifacts).toHaveLength(1);
});

it.each(['codex', 'claude-code', 'cursor'] as const)('routes folder, move and delete requests from the %s tool bridge through core', async provider => {
  run = { ...run, snapshot: { ...run.snapshot, worker: { ...run.snapshot.worker, provider } } };
  task = { ...task, providerScopes: [provider] };
  store.update('runs', run);
  store.update('tasks', task);
  const calls = [
    { name: 'workspace_create_folder', arguments: { path: 'contracts' } },
    { name: 'workspace_move', arguments: { from: 'contract-final.pdf', to: 'contracts/lease 2026.pdf' } },
    { name: 'workspace_delete', arguments: { path: 'contract-old.pdf' } },
    { name: 'reply', arguments: { message: 'Filed the lease and removed the old copy.', title: null, knowledgeProposals: [] } },
  ];
  let step = 0;
  const core = new CoreService(store, () => {}, async () => { throw new Error('Must not call the API adapter'); }, undefined, undefined, {
    detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
    execute: async request => {
      expect(request.coreToolsOnly).toBe(true);
      const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
      const offered = context.tools.map((tool: { function: { name: string } }) => tool.function.name);
      expect(offered).toEqual(expect.arrayContaining(['workspace_create_folder', 'workspace_move', 'workspace_delete']));
      return { output: { call: calls[step++] }, costUsd: null };
    },
  }, undefined, undefined, runtime());
  await core.runner.run(task, run);
  const detail = store.detail(task.id);
  expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
  expect(applied).toEqual(['create_folder contracts', 'move contract-final.pdf → contracts/lease 2026.pdf', 'delete contract-old.pdf']);
  expect(await readFile(join(source, 'contracts', 'lease 2026.pdf'), 'utf8')).toBe('contract v2');
  expect(await present(join(source, 'contract-old.pdf'))).toBe(false);
});

it('writes a file into a folder the run created, and hands in the folder before the file', async () => {
  const worker = runtime();
  await worker.execute(run, id(), { operation: 'create_folder', path: 'drafts/2026' }, signal());
  await worker.execute(run, id(), { operation: 'write', path: 'drafts/2026/plan.md', expectedHash: null, content: '# Plan' }, signal());
  await worker.execute(run, id(), { operation: 'write', path: 'loose/new.md', expectedHash: null, content: 'new' }, signal());
  expect(await present(join(source, 'drafts'))).toBe(false);
  await worker.finish(run, signal());
  expect(applied).toEqual(['create_folder drafts', 'create_folder loose', 'create_folder drafts/2026', 'write drafts/2026/plan.md', 'write loose/new.md']);
  expect(await readFile(join(source, 'drafts', '2026', 'plan.md'), 'utf8')).toBe('# Plan');
});

describe('a person who changed their folder meanwhile keeps what they did (COD-254)', () => {
  async function tidyWith(personEdit: () => Promise<void>) {
    const detail = await runWith(scripted(tidyCalls, personEdit));
    const copy = copyRecord();
    return { detail, copy, changes: copy.changes as { kind: string; path: string; from?: string; status: string; conflict?: string }[] };
  }

  it('stops at a file the person edited, moves nothing over it, and keeps the steps already taken', async () => {
    const { detail, copy, changes } = await tidyWith(() => writeFile(join(source, 'IMG_0412.jpg'), 'edited photo'));
    expect(detail.task.status).toBe('failed');
    expect(detail.runs[0].error).toBe('Workspace có xung đột; các tệp đã tích hợp được giữ lại.');
    expect(detail.artifacts).toHaveLength(0);
    expect(copy.state).toBe('conflict');
    expect(changes.find(change => change.from === 'IMG_0412.jpg')).toMatchObject({ status: 'conflict', conflict: 'changed' });
    expect(await readFile(join(source, 'IMG_0412.jpg'), 'utf8')).toBe('edited photo');
    // The folders and the moves before it went through; everything after it is still pending, and nothing was lost.
    expect(changes.filter(change => change.status === 'applied').map(change => change.kind)).toEqual(['folder', 'folder', 'folder', 'folder', 'move', 'move']);
    expect(changes.filter(change => change.status === 'pending').map(change => change.kind)).toEqual(['move', 'move', 'delete']);
    expect(await readFile(join(source, 'contract-old.pdf'), 'utf8')).toBe('contract v1');
    expect(await readFile(join(source, 'notes.txt'), 'utf8')).toBe('meeting notes');
    const view = new WorkspaceRecovery(store).view(task.id);
    expect(view.copies[0].changes.find(change => change.from === 'IMG_0412.jpg')).toEqual({
      kind: 'move', path: 'images/office photo.jpg', from: 'IMG_0412.jpg', status: 'conflict', conflict: 'changed',
    });
    expect(JSON.stringify(view)).not.toContain('backup-');
  });

  it('stops at a file the person removed that the run deletes', async () => {
    const { changes } = await tidyWith(() => unlink(join(source, 'contract-old.pdf')));
    expect(changes.find(change => change.kind === 'delete')).toMatchObject({ status: 'conflict', conflict: 'missing' });
  });

  it('stops at a file the person removed that the run moves', async () => {
    const { changes } = await tidyWith(() => unlink(join(source, 'receipt 3.pdf')));
    expect(changes.find(change => change.from === 'receipt 3.pdf')).toMatchObject({ status: 'conflict', conflict: 'missing' });
  });

  it('never moves over a file the person put at the new path', async () => {
    const { changes } = await tidyWith(async () => {
      await mkdir(join(source, 'contracts'));
      await writeFile(join(source, 'contracts', 'lease 2026.pdf'), 'their own lease');
    });
    expect(changes.find(change => change.path === 'contracts/lease 2026.pdf')).toMatchObject({ status: 'conflict', conflict: 'exists' });
    expect(await readFile(join(source, 'contracts', 'lease 2026.pdf'), 'utf8')).toBe('their own lease');
    expect(await readFile(join(source, 'contract-final.pdf'), 'utf8')).toBe('contract v2');
  });

  it('keeps a folder the person put a file in, after moving the run\'s files out of it', async () => {
    await mkdir(join(source, 'old'));
    await writeFile(join(source, 'old', 'keep.txt'), 'archived');
    const detail = await runWith(scripted([
      { name: 'workspace_move', arguments: { from: 'old/keep.txt', to: 'archive/keep.txt' } },
      { name: 'workspace_delete', arguments: { path: 'old' } },
      { name: 'reply', arguments: { message: 'Moved the old folder into archive.', title: null, knowledgeProposals: [] } },
    ], () => writeFile(join(source, 'old', 'new-from-person.txt'), 'theirs')));
    expect(detail.task.status).toBe('failed');
    const changes = copyRecord().changes;
    expect(changes.map((change: { kind: string; status: string }) => `${change.kind} ${change.status}`)).toEqual(['folder applied', 'move applied', 'remove_folder conflict']);
    expect(changes[2].conflict).toBe('not_empty');
    expect(await readFile(join(source, 'old', 'new-from-person.txt'), 'utf8')).toBe('theirs');
    expect(await readFile(join(source, 'archive', 'keep.txt'), 'utf8')).toBe('archived');
  });
});

it('answers a move onto a taken path or a delete of a full folder as a result the worker can correct', async () => {
  await mkdir(join(source, 'full'));
  await writeFile(join(source, 'full', 'x.txt'), 'x');
  const detail = await runWith(scripted([
    { name: 'workspace_move', arguments: { from: 'notes.txt', to: 'contract-old.pdf' } },
    { name: 'workspace_delete', arguments: { path: 'full' } },
    { name: 'workspace_move', arguments: { from: 'notes.txt', to: 'meeting.txt' } },
    { name: 'reply', arguments: { message: 'Renamed the notes.', title: null, knowledgeProposals: [] } },
  ]));
  expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
  const outputs = store.db.prepare("SELECT name,state,output FROM tool_calls WHERE name LIKE 'workspace_%' ORDER BY rowid").all()
    .map(row => ({ name: row.name, state: row.state, output: JSON.parse(String(row.output)) }));
  expect(outputs.map(row => row.state)).toEqual(['completed', 'completed', 'completed']);
  expect(outputs[0].output).toMatchObject({ refused: true, error: 'Something already exists at contract-old.pdf' });
  expect(outputs[1].output).toMatchObject({ refused: true, error: 'The folder is not empty: full' });
  expect(detail.events.map(event => event.message)).toEqual(expect.arrayContaining(['Không chuyển được: notes.txt → contract-old.pdf', 'Không xóa được: full']));
  expect(await readFile(join(source, 'meeting.txt'), 'utf8')).toBe('meeting notes');
  expect(await readFile(join(source, 'contract-old.pdf'), 'utf8')).toBe('contract v1');
});

it('counts a move or a deletion as a file change, so a command that failed before it no longer blocks the hand-in', async () => {
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
  run.snapshot.workspaceGrant = grants.snapshot(task.id);
  store.update('runs', run);
  let exitCode = 1;
  const worker = new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, id());
      await mkdir(copy);
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request) => executeWorkspaceOperation(copy, request),
  }, { apply: broker }, undefined, { runCommand: async () => ({ termination: 'exited', exitCode, stdout: '', stderr: '' }) });
  try {
    await worker.processTool(run, id(), 'workspace_start_process', { program: 'node', arguments: ['check.cjs'], timeoutMs: 5000 }, signal(), signal());
    await worker.execute(run, id(), { operation: 'move', from: 'notes.txt', to: 'meeting.txt' }, signal());
    exitCode = 0;
    await worker.processTool(run, id(), 'workspace_start_process', { program: 'node', arguments: ['other.cjs'], timeoutMs: 5000 }, signal(), signal());
    expect(await worker.finish(run, signal())).toEqual(['Lệnh chạy trước lần sửa tệp cuối đã thất bại và chưa được chạy lại: node check.cjs (mã thoát 1).']);
    expect(await readFile(join(source, 'meeting.txt'), 'utf8')).toBe('meeting notes');
  } finally { await worker.stopRun(run.id); }
});

it('lets a crew member create the parents of its own files, and refuses moving or removing what it does not own', async () => {
  run.snapshot.team = { id: id(), name: 'Crew', revision: 1, memberIds: [run.snapshot.worker.id], synthesizerId: run.snapshot.worker.id,
    workflow: 'parallel', instructions: '', monthlyBudgetMicros: 5_000_000 };
  run.snapshot.assignment = { workerId: run.snapshot.worker.id, brief: 'File the receipt', writeResources: ['receipts/march'] };
  store.update('runs', run);
  const worker = runtime();
  await worker.execute(run, id(), { operation: 'create_folder', path: 'receipts' }, signal());
  await worker.execute(run, id(), { operation: 'create_folder', path: 'receipts/march' }, signal());
  await expect(worker.execute(run, id(), { operation: 'move', from: 'receipt 3.pdf', to: 'receipts/march/receipt.pdf' }, signal())).rejects.toThrow('phạm vi được giao');
  await expect(worker.execute(run, id(), { operation: 'delete', path: 'receipts' }, signal())).rejects.toThrow('phạm vi được giao');
  await expect(worker.execute(run, id(), { operation: 'create_folder', path: 'contracts' }, signal())).rejects.toThrow('phạm vi được giao');
  await worker.finish(run, signal());
  expect(applied).toEqual(['create_folder receipts', 'create_folder receipts/march']);
});

describe('restoring a file the hand-in deleted (COD-254)', () => {
  async function deleteDuplicate() {
    const worker = runtime();
    await worker.execute(run, id(), { operation: 'delete', path: 'contract-old.pdf' }, signal());
    await worker.finish(run, signal());
    expect(await present(join(source, 'contract-old.pdf'))).toBe(false);
    return worker;
  }
  const input = () => ({ taskId: task.id, runId: run.id, path: 'contract-old.pdf' });

  it('puts the original bytes back once, and says so in Details', async () => {
    const worker = await deleteDuplicate();
    await worker.restore(input(), () => false);
    expect(await readFile(join(source, 'contract-old.pdf'), 'utf8')).toBe('contract v1');
    await worker.restore(input(), () => false);
    expect(applied.filter(step => step === 'write contract-old.pdf')).toHaveLength(1);
    expect(new WorkspaceRecovery(store).view(task.id).copies[0].changes).toEqual([
      { kind: 'delete', path: 'contract-old.pdf', status: 'applied', restored: true },
    ]);
    expect(store.detail(task.id).events.map(event => event.message)).toContain('Đã khôi phục tệp đã xóa: contract-old.pdf');
  });

  it('never overwrites something now at that path, and can try again once it is gone', async () => {
    const worker = await deleteDuplicate();
    await writeFile(join(source, 'contract-old.pdf'), 'a new file with the same name');
    await expect(worker.restore(input(), () => false)).rejects.toThrow('không ghi đè');
    expect(await readFile(join(source, 'contract-old.pdf'), 'utf8')).toBe('a new file with the same name');
    await unlink(join(source, 'contract-old.pdf'));
    await worker.restore(input(), () => false);
    expect(await readFile(join(source, 'contract-old.pdf'), 'utf8')).toBe('contract v1');
  });

  it('refuses while the chat runs, without edit access, for another chat or a path that was not deleted', async () => {
    const worker = await deleteDuplicate();
    await expect(worker.restore(input(), () => true)).rejects.toThrow('Dừng công việc');
    await expect(worker.restore({ ...input(), path: 'notes.txt' }, () => false)).rejects.toThrow('Không có tệp đã xóa');
    const other: Task = { ...task, id: id() };
    store.put('tasks', other);
    await expect(worker.restore({ ...input(), taskId: other.id }, () => false)).rejects.toThrow('không thuộc cuộc trò chuyện');
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read'] });
    await expect(worker.restore(input(), () => false)).rejects.toThrow('Cần quyền sửa');
    expect(await present(join(source, 'contract-old.pdf'))).toBe(false);
  });
});
