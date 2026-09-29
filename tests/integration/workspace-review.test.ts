import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { countChanges, selectSteps, type IntegrationStep } from '../../apps/desktop/src/core/tools/workspace-plan';
import { OTHER_FOLDER } from '../../apps/desktop/src/core/storage/workspace-grants';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import { commands, type Run, type Skill, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';
import { removalStopsWork, type ToolCapability } from '../../apps/desktop/src/shared/tool-policy';
import { groupRecoveryAttempts } from '../../apps/desktop/src/shared/recovery-attempts';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { DiffBody, standaloneFolders } from '../../apps/desktop/src/renderer/components/DiffViewer';
import { PermissionControls } from '../../apps/desktop/src/renderer/components/PermissionControls';
import type { WorkspaceDiff } from '../../apps/desktop/src/shared/workspace-diff';

/*
 * COD-279: a solo chat's run holds its changes for the person to review. The answer is saved, the folder is not
 * touched, and only the person's Apply (all or the ticked files) or Discard settles them. A new message goes on in the
 * held copy, so one review covers both turns.
 */

let directory: string;
let source: string;
let store: Store;
let task: Task;
let run: Run;
let grants: WorkspaceGrants;
let integrated: string[];
let worker: Worker;
let skill: Skill;

const ANSWER = 'Updated note.txt.';
const REVIEW_OFF: ToolCapability[] = ['source.read', 'skill.read', 'app.propose', 'workspace.apply'];
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-review-'));
  source = join(directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'note.txt'), 'original');
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  integrated = [];
  worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  skill = store.all<Skill>('skills')[0];
  task = { id: id(), workerId: worker.id, brief: 'Update note.txt', consent: true, providerScopes: ['openai'],
    sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now() };
  store.put('tasks', task);
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] });
  run = newRun();
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

function newRun(overrides: Partial<Run> = {}, snapshot: Partial<Run['snapshot']> = {}): Run {
  const created: Run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null,
    snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id), ...snapshot }, ...overrides };
  store.put('runs', created, { column: 'task_id', value: task.id });
  return created;
}

/** A working-copy runtime whose broker writes into the person's folder and refuses a file that is not what the plan expects. */
function runtime() {
  const integrate: WorkspaceIntegration['apply'] = async request => {
    request.authorize();
    if (request.operation === 'create_folder') {
      await mkdir(join(source, request.path), { recursive: true });
      integrated.push(request.path);
      return { status: 'applied', hash: null, backupPath: '', created: true };
    }
    if (request.operation !== undefined && request.operation !== 'write') throw new Error(`Unexpected ${request.operation} step`);
    const target = join(source, request.path);
    const current = await readFile(target).catch(() => null);
    if ((current ? sha(current) : null) !== request.expectedHash) {
      return { status: 'conflict', hash: current ? sha(current) : null, reason: current ? 'changed' : 'missing', backupPath: '', created: false };
    }
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, request.bytes);
    integrated.push(request.path);
    return { status: 'applied', hash: sha(request.bytes), backupPath: 'none', created: current === null };
  };
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

type Call = { name: string; arguments: Record<string, unknown> };
/** A model that makes these calls in order; `during` runs before the call at that step is returned. */
function model(calls: Call[], during: Record<number, () => Promise<void> | void> = {}): ModelAdapter {
  let step = 0;
  return { request: async () => {
    await during[step]?.();
    const call = calls[step++];
    return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
  } };
}

const write = (path: string, content: string, expectedHash: string | null): Call =>
  ({ name: 'workspace_write', arguments: { path, expectedHash, content } });
const reply = (message: string): Call => ({ name: 'reply', arguments: { message, title: null, knowledgeProposals: [] } });

const core = (adapter: ModelAdapter = model([write('note.txt', 'edited', sha('original')), reply(ANSWER)])) =>
  new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime());

const copyOf = (runId: string) => JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(runId)!.data));
const folderNote = () => readFile(join(source, 'note.txt'), 'utf8');

async function heldRun() {
  const service = core();
  await service.runner.run(task, run);
  return service;
}

describe('a solo run with review on (the default)', () => {
  it('saves the answer and holds the changes, touching nothing in the folder', async () => {
    await heldRun();
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('completed');
    expect(detail.artifacts.map(artifact => artifact.report.summary)).toEqual([ANSWER]);
    expect(detail.artifacts[0].report.limitations).toEqual([]);
    expect(integrated).toEqual([]);
    expect(await folderNote()).toBe('original');
    const copy = copyOf(run.id);
    expect(copy.state).toBe('ready');
    expect(copy.review).toMatchObject({ state: 'pending', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(copy.diff).toMatchObject({ files: 1 });
    expect(detail.events.map(event => event.message)).toContain('Thay đổi đang chờ bạn xem trước khi vào thư mục.');
    // Details names the attempt as waiting, and it does not ask for a decision there: the chat does.
    const view = new WorkspaceRecovery(store).view(task.id);
    expect(view.copies[0].review).toMatchObject({ state: 'pending' });
    const attempts = groupRecoveryAttempts(view, detail.runs);
    expect(attempts.shown[0]).toMatchObject({ state: 'review', needsDecision: false, blocking: false });
  });

  it('applies the held changes through the broker once, and records who applied them', async () => {
    const service = await heldRun();
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(integrated).toEqual(['note.txt']);
    expect(await folderNote()).toBe('edited');
    expect(copyOf(run.id)).toMatchObject({ state: 'integrated', review: { state: 'applied', applied: 1, skipped: 0 } });
    expect(store.detail(task.id).events.map(event => event.message)).toContain('Người dùng đã xem và áp dụng 1 thay đổi.');
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ bạn xem');
    await expect(service.command('discardWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ bạn xem');
  });

  it('discards the held changes: the folder is untouched and nothing is left to apply', async () => {
    const service = await heldRun();
    await service.command('discardWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(integrated).toEqual([]);
    expect(await folderNote()).toBe('original');
    expect(copyOf(run.id)).toMatchObject({ state: 'ready', review: { state: 'discarded', decidedAt: expect.any(String) } });
    expect(store.detail(task.id).events.map(event => event.message)).toContain('Người dùng đã bỏ thay đổi; thư mục không bị sửa.');
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ bạn xem');
    // A new message starts from the folder as it is: the dropped copy is not carried on.
    const next = newRun();
    await core(model([{ name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } }, reply('It says original.')])).runner.run(store.get<Task>('tasks', task.id), next);
    expect(copyOf(next.id).carriedFrom).toBeUndefined();
  });

  it('keeps the held changes across a restart', async () => {
    await heldRun();
    store.close();
    store = new Store(join(directory, 'state.sqlite'));
    grants = new WorkspaceGrants(store);
    const restarted = core();
    expect(copyOf(run.id).review.state).toBe('pending');
    await restarted.command('applyWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(await folderNote()).toBe('edited');
  });

  it('applies only the files left ticked and says how many were skipped', async () => {
    const service = core(model([write('a.txt', 'a', null), write('b.txt', 'b', null), reply('Added two files.')]));
    await service.runner.run(task, run);
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id, paths: ['a.txt'] });
    expect(integrated).toEqual(['a.txt']);
    await expect(readFile(join(source, 'b.txt'))).rejects.toThrow();
    expect(copyOf(run.id).review).toMatchObject({ state: 'applied', applied: 1, skipped: 1 });
    expect(store.detail(task.id).events.map(event => event.message)).toContain('Người dùng đã xem và áp dụng 1 thay đổi, bỏ qua 1.');
  });

  it('leaves out a new folder whose only file was unticked, even when the folder is sent, and counts files not steps', async () => {
    // COD-291: the viewer sent every listed folder, so unticking docs/usage.md still made an empty docs/ and the
    // events said "applied 3 changes and skipped 1" for Apply 2 of 3.
    const service = core(model([
      write('CHANGELOG.md', '# Changelog\n', null),
      write('note.txt', 'edited', sha('original')),
      write('docs/usage.md', '# Usage\n', null),
      reply('Added a changelog and usage notes.'),
    ]));
    await service.runner.run(task, run);
    expect(copyOf(run.id).changes.map((change: { kind: string; path: string }) => `${change.kind}:${change.path}`)).toContain('folder:docs');
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id, paths: ['CHANGELOG.md', 'note.txt', 'docs'] });
    expect(integrated.sort()).toEqual(['CHANGELOG.md', 'note.txt']);
    await expect(stat(join(source, 'docs'))).rejects.toThrow();
    expect(copyOf(run.id).review).toMatchObject({ state: 'applied', applied: 2, skipped: 1 });
    expect(store.detail(task.id).events.map(event => event.message)).toContain('Người dùng đã xem và áp dụng 2 thay đổi, bỏ qua 1.');
  });

  it('makes the new folder a kept file needs, and counts it with its file', async () => {
    const service = core(model([write('note.txt', 'edited', sha('original')), write('docs/usage.md', '# Usage\n', null), reply('Added usage notes.')]));
    await service.runner.run(task, run);
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id, paths: ['docs/usage.md'] });
    expect(integrated).toEqual(['docs', 'docs/usage.md']);
    expect(copyOf(run.id).review).toMatchObject({ applied: 1, skipped: 1 });
  });

  it('decides an empty folder the orglet made on purpose by its own tick', async () => {
    const createFolder = (path: string): Call => ({ name: 'workspace_create_folder', arguments: { path } });
    const service = core(model([createFolder('logs'), write('a.txt', 'a', null), reply('Made logs/ and a.txt.')]));
    await service.runner.run(task, run);
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id, paths: ['a.txt'] });
    await expect(stat(join(source, 'logs'))).rejects.toThrow();
    expect(copyOf(run.id).review).toMatchObject({ applied: 1, skipped: 1 });
    expect(integrated).toEqual(['a.txt']);
  });

  it('stops at a file the person changed meanwhile, and the attempt can then be kept in Details', async () => {
    const service = await heldRun();
    await writeFile(join(source, 'note.txt'), 'the person edited this');
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('Workspace có xung đột');
    expect(await folderNote()).toBe('the person edited this');
    const copy = copyOf(run.id);
    expect(copy).toMatchObject({ state: 'conflict', review: { state: 'applied' } });
    expect(copy.changes[0]).toMatchObject({ status: 'conflict', conflict: 'changed' });
    // A completed run's stopped apply is settled like any conflicting hand-in: it blocks writes until kept.
    const view = new WorkspaceRecovery(store).view(task.id);
    const attempt = groupRecoveryAttempts(view, store.detail(task.id).runs).blocking!;
    expect(attempt).toMatchObject({ runId: run.id, needsDecision: true, state: 'conflict' });
    await service.command('retireWorkspaceAttempt', { taskId: task.id, runId: run.id, reviewToken: attempt.reviewToken, keepCurrentFiles: true });
    expect(new WorkspaceRecovery(store).view(task.id).attempts[0].retired).toBe(true);
  });

  it.each([
    ['revoked', () => grants.revoke(task.id)],
    ['narrowed to read', () => grants.grant({ taskId: task.id, directory: source, permissions: ['read'] })],
  ])('refuses to apply after the folder was %s, and still lets the person discard', async (_label, change) => {
    const service = await heldRun();
    await change();
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('Quyền sửa thư mục đã bị thu hồi hoặc thay đổi');
    expect(integrated).toEqual([]);
    await service.command('discardWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(copyOf(run.id).review.state).toBe('discarded');
  });

  it('refuses to apply a copy that changed after it was held', async () => {
    const service = await heldRun();
    await writeFile(join(copyOf(run.id).directory, 'late.txt'), 'written after the run');
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('Bản làm việc đã thay đổi so với lúc chờ bạn xem');
    expect(integrated).toEqual([]);
    expect(copyOf(run.id).review.state).toBe('pending');
  });

  it('goes on in the held copy when the person sends another message, so one review covers both turns', async () => {
    const service = await heldRun();
    const brief = 'Also add a changelog';
    store.update('tasks', { ...store.get<Task>('tasks', task.id), inputRevision: 1, brief, currentInput: { brief, sourceIds: [] }, status: 'queued' });
    const next = newRun({}, { inputRevision: 1, input: { brief, sourceIds: [] } });
    let seen = '';
    const followUp = model([
      { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } },
      write('CHANGELOG.md', '- note\n', null),
      reply('Added CHANGELOG.md.'),
    ], { 1: () => { seen = String(store.db.prepare("SELECT output FROM tool_calls WHERE run_id=? AND name='workspace_read'").get(next.id)?.output ?? ''); } });
    await core(followUp).runner.run(store.get<Task>('tasks', task.id), next);
    // The orglet read its own edit from the last turn, not the folder's original.
    expect(JSON.parse(seen).content).toBe('edited');
    expect(copyOf(run.id)).toMatchObject({ carriedTo: next.id, review: { state: 'carried' } });
    expect(copyOf(next.id)).toMatchObject({ carriedFrom: run.id, review: { state: 'pending' }, diff: { files: 2 } });
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ bạn xem');
    await expect(service.command('workspaceDiff', { taskId: task.id, runId: run.id })).rejects.toThrow('đã chuyển sang lượt sau');
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: next.id });
    expect(await folderNote()).toBe('edited');
    expect(await readFile(join(source, 'CHANGELOG.md'), 'utf8')).toBe('- note\n');
  });

  it('passes the held copy on again when the follow-up stops without finishing', async () => {
    await heldRun();
    const failed = newRun();
    // The failing run first writes, which carries the held changes over to it, then its provider goes down.
    const firstStep = model([write('draft.txt', 'half done', null)]);
    let step = 0;
    const flaky: ModelAdapter = { request: async (...args) => {
      if (step++ === 0) return firstStep.request(...args);
      throw new Error('provider down');
    } };
    await core(flaky).runner.run(store.get<Task>('tasks', task.id), failed);
    expect(store.get<Run>('runs', failed.id).status).toBe('failed');
    expect(copyOf(failed.id)).toMatchObject({ carriedFrom: run.id });
    const retry = newRun();
    await core(model([{ name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } }, reply('Done now.')])).runner.run(store.get<Task>('tasks', task.id), retry);
    expect(copyOf(retry.id)).toMatchObject({ carriedFrom: failed.id, review: { state: 'pending' }, diff: { files: 2 } });
    expect(copyOf(failed.id).carriedTo).toBe(retry.id);
  });
});

describe('what hands in at once', () => {
  it('a chat with review turned off', async () => {
    task = { ...task, toolCapabilities: REVIEW_OFF };
    store.put('tasks', task);
    run = newRun({}, { toolCapabilities: REVIEW_OFF });
    await core().runner.run(task, run);
    expect(integrated).toEqual(['note.txt']);
    expect(copyOf(run.id).review).toBeUndefined();
  });

  it('a group reply, whose turn goes on to the next orglet', async () => {
    run = newRun({ stage: 'group' });
    await core().runner.run(task, run, { keepTaskOpen: true });
    expect(integrated).toEqual(['note.txt']);
    expect(copyOf(run.id).review).toBeUndefined();
  });

  it("a schedule's run whose schedule turned review off (COD-294)", async () => {
    task = { ...task, routineId: id(), toolCapabilities: REVIEW_OFF };
    store.put('tasks', task);
    run = newRun({}, { toolCapabilities: REVIEW_OFF });
    await core().runner.run(task, run);
    expect(integrated).toEqual(['note.txt']);
  });

  it("but not a schedule's run with review on, which waits in its own chat (COD-294)", async () => {
    task = { ...task, routineId: id() };
    store.put('tasks', task);
    await core().runner.run(task, run);
    expect(integrated).toEqual([]);
    expect(copyOf(run.id).review.state).toBe('pending');
  });

  it('turning review on during a run stops nothing and holds that run\'s hand-in', async () => {
    task = { ...task, toolCapabilities: REVIEW_OFF };
    store.put('tasks', task);
    run = newRun({}, { toolCapabilities: REVIEW_OFF });
    let service!: CoreService;
    const adapter = model([write('note.txt', 'edited', sha('original')), reply(ANSWER)], {
      // Everything the chat's runs had stays, bar `workspace.apply`, so only turning review on is being tested.
      1: async () => { await service.command('setToolCapabilities', { taskId: task.id, capabilities: ['source.read', 'dataset.check', 'skill.read', 'app.propose'] }); },
    });
    service = core(adapter);
    await service.runner.run(store.get<Task>('tasks', task.id), run);
    expect(store.get<Run>('runs', run.id).status).toBe('completed');
    expect(integrated).toEqual([]);
    expect(copyOf(run.id).review.state).toBe('pending');
    expect(removalStopsWork('workspace.apply')).toBe(false);
    expect(removalStopsWork('network.web')).toBe(true);
  });
});

it('offers no tool that applies or discards, and the commands take only the chat, the run and the ticked paths', async () => {
  await heldRun();
  const offered = toolsFor(store.get<Run>('runs', run.id), store.get<Task>('tasks', task.id)).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
  expect(offered.filter(name => /review|apply|discard/i.test(name))).toEqual([]);
  expect(() => commands.applyWorkspaceReview.parse({ taskId: task.id, runId: run.id, force: true })).toThrow();
  expect(() => commands.applyWorkspaceReview.parse({ taskId: task.id, runId: run.id, paths: ['../outside.txt'] })).toThrow();
  expect(() => commands.discardWorkspaceReview.parse({ taskId: task.id, runId: run.id, paths: ['a.txt'] })).toThrow();
});

describe('picking files to apply', () => {
  const steps: IntegrationStep[] = [
    { kind: 'folder', path: 'docs' },
    { kind: 'move', from: 'old.txt', path: 'docs/new.txt', hash: 'a'.repeat(64), bytes: 1 },
    { kind: 'write', path: 'readme.md', hash: 'b'.repeat(64), bytes: 1, expectedHash: null },
    { kind: 'delete', path: 'trash/one.txt', expectedHash: 'c'.repeat(64), bytes: 1 },
    { kind: 'delete', path: 'trash/two.txt', expectedHash: 'd'.repeat(64), bytes: 1 },
    { kind: 'remove_folder', path: 'trash' },
  ];
  const kinds = (picked: IntegrationStep[]) => picked.map(step => `${step.kind}:${step.path}`);

  it('keeps a move by either of its paths, and the new folder it needs', () => {
    expect(kinds(selectSteps(steps, ['old.txt']).kept)).toEqual(['folder:docs', 'move:docs/new.txt']);
    expect(kinds(selectSteps(steps, ['DOCS/NEW.TXT']).kept)).toEqual(['folder:docs', 'move:docs/new.txt']);
  });

  it('removes a folder only when nothing inside it is left behind', () => {
    expect(kinds(selectSteps(steps, ['trash/one.txt', 'trash']).kept)).toEqual(['delete:trash/one.txt']);
    expect(kinds(selectSteps(steps, ['trash/one.txt', 'trash/two.txt', 'trash']).kept))
      .toEqual(['delete:trash/one.txt', 'delete:trash/two.txt', 'remove_folder:trash']);
    expect(selectSteps(steps, ['readme.md']).skipped).toHaveLength(5);
  });

  it('lets a folder follow what is inside it, whatever tick was sent for it (COD-291)', () => {
    // A ticked folder whose contents were all left out stays as it is; so does a removal with something left inside.
    expect(kinds(selectSteps(steps, ['readme.md', 'docs', 'trash']).kept)).toEqual(['write:readme.md']);
    // A removal goes once everything inside it goes, even with no tick of its own.
    expect(kinds(selectSteps(steps, ['trash/one.txt', 'trash/two.txt']).kept)).toContain('remove_folder:trash');
    const nested: IntegrationStep[] = [
      { kind: 'folder', path: 'docs' },
      { kind: 'folder', path: 'docs/guides' },
      { kind: 'write', path: 'docs/guides/start.md', hash: 'e'.repeat(64), bytes: 1, expectedHash: null },
    ];
    expect(kinds(selectSteps(nested, ['docs/guides/start.md']).kept)).toEqual(['folder:docs', 'folder:docs/guides', 'write:docs/guides/start.md']);
    expect(selectSteps(nested, ['docs', 'docs/guides']).kept).toEqual([]);
  });

  it('decides a folder with nothing else inside it by its own tick, and counts changes as the viewer lists them', () => {
    const empty: IntegrationStep[] = [
      { kind: 'folder', path: 'logs' },
      { kind: 'folder', path: 'logs/today' },
      { kind: 'write', path: 'a.txt', hash: 'f'.repeat(64), bytes: 1, expectedHash: null },
      { kind: 'remove_folder', path: 'old' },
    ];
    expect(kinds(selectSteps(empty, ['a.txt']).kept)).toEqual(['write:a.txt']);
    // logs holds logs/today, so it follows that folder's tick; old was removed empty and goes when ticked.
    expect(kinds(selectSteps(empty, ['a.txt', 'logs/today', 'old']).kept)).toEqual(['folder:logs', 'folder:logs/today', 'write:a.txt', 'remove_folder:old']);
    expect(kinds(selectSteps(empty, ['logs']).kept)).toEqual([]);
    const { kept, skipped } = selectSteps(steps, ['old.txt', 'readme.md']);
    // docs/ follows the moved file, so the move counts once; the trash folder follows its two files.
    expect(countChanges(steps, kept)).toBe(2);
    expect(countChanges(steps, skipped)).toBe(2);
    expect(countChanges(empty, empty)).toBe(3);
  });
});

describe('changing the folder level (COD-291)', () => {
  it('keeps the folder without the picker, so old diffs keep opening and held changes can still be applied', async () => {
    const service = await heldRun();
    const before = grants.view(task.id)!;
    await service.command('setWorkspaceLevel', { taskId: task.id, permissions: ['read', 'write', 'execute'] });
    // Widening keeps the grant as it was.
    expect(grants.view(task.id)).toMatchObject({ id: before.id, revision: before.revision, permissions: ['read', 'write', 'execute'], name: 'source' });
    const diff = await service.command('workspaceDiff', { taskId: task.id, runId: run.id }) as WorkspaceDiff;
    expect(diff.files.map(file => file.path)).toEqual(['note.txt']);
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(await folderNote()).toBe('edited');
    await service.command('setWorkspaceLevel', { taskId: task.id, permissions: ['read'] });
    // Narrowing keeps the folder's id and takes a new revision, so a run that froze the wider grant is stopped.
    expect(grants.view(task.id)).toMatchObject({ id: before.id, revision: before.revision + 1, permissions: ['read'] });
    // History: the diff of an applied run still opens at a read-only level.
    await expect(service.command('workspaceDiff', { taskId: task.id, runId: run.id })).resolves.toMatchObject({ runId: run.id });
  });

  it('opens held changes after a narrowing but applies them only under the grant they were made with', async () => {
    const service = await heldRun();
    await service.command('setWorkspaceLevel', { taskId: task.id, permissions: ['read'] });
    await expect(service.command('workspaceDiff', { taskId: task.id, runId: run.id })).resolves.toMatchObject({ runId: run.id });
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('Quyền sửa thư mục đã bị thu hồi hoặc thay đổi');
  });

  it('says plainly why an old diff cannot open once the folder was removed or swapped', async () => {
    const service = await heldRun();
    grants.revoke(task.id);
    await expect(service.command('workspaceDiff', { taskId: task.id, runId: run.id })).rejects.toThrow(OTHER_FOLDER);
    const other = join(directory, 'other');
    await mkdir(other);
    await grants.grant({ taskId: task.id, directory: other, permissions: ['read', 'write'] });
    await expect(service.command('workspaceDiff', { taskId: task.id, runId: run.id })).rejects.toThrow(OTHER_FOLDER);
    await expect(service.command('setWorkspaceLevel', { taskId: task.id, permissions: ['read'] })).resolves.toBeUndefined();
    expect(grants.view(task.id)).toMatchObject({ name: 'other', permissions: ['read'] });
  });

  it('refuses a level change for a chat with no folder, and changes the level of a folder waiting for a first message', async () => {
    const service = core();
    grants.revoke(task.id);
    await expect(service.command('setWorkspaceLevel', { taskId: task.id, permissions: ['read'] })).rejects.toThrow('chưa có thư mục làm việc');
    await service.grantWorkspace({ workerId: worker.id, permissions: ['read'], directory: source });
    await service.command('setWorkspaceLevel', { workerId: worker.id, permissions: ['read', 'write'] });
    expect(grants.pending({ workerId: worker.id })).toMatchObject({ name: 'source', permissions: ['read', 'write'] });
    // The command carries no path: a folder can only come from main's picker.
    expect(() => commands.setWorkspaceLevel.parse({ taskId: task.id, permissions: ['read'], directory: source })).toThrow();
  });
});

describe('on screen', () => {
  function renderThread() {
    const detail = store.detail(task.id);
    return renderToStaticMarkup(createElement(TaskThread, {
      detail, recovery: new WorkspaceRecovery(store).view(task.id), workspace: { workers: [worker], skills: [skill], tasks: [detail.task] },
      action: () => {}, showSources: () => {}, openMessage: () => {}, proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
      proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
    }));
  }

  it('says the changes are not in the folder yet under the answer, then what became of them', async () => {
    const service = await heldRun();
    const held = renderThread();
    expect(held).toContain(ANSWER);
    expect(held).toMatch(/class="activity-summary changed-files changed-files-review"[^>]*>.*Changed 1 file.*Not in your folder yet.*Review/s);
    await service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(renderThread()).toMatch(/Changed 1 file.*· Applied</s);
  });

  it('never says applied while an apply is stopped at a conflict', async () => {
    const service = await heldRun();
    await writeFile(join(source, 'note.txt'), 'the person edited this');
    await expect(service.command('applyWorkspaceReview', { taskId: task.id, runId: run.id })).rejects.toThrow('Workspace có xung đột');
    const html = renderThread();
    expect(html).toContain('Stopped at a conflict, see Details');
    expect(html).not.toMatch(/· Applied</);
  });

  it('says Applied when the changes handed in at once, with review off (COD-291)', async () => {
    task = { ...task, toolCapabilities: REVIEW_OFF };
    store.put('tasks', task);
    run = newRun({}, { toolCapabilities: REVIEW_OFF });
    await core().runner.run(task, run);
    const line = renderThread().replace(/<[^>]+>/g, '');
    expect(line).toContain('Changed 1 file · Applied');
    expect(line).not.toContain('Not in your folder yet');
  });

  it('dims a new folder with the files it follows and ticks an empty one on its own in the viewer', () => {
    const file = (path: string) => ({ path, status: 'added' as const, binary: false, additions: 1, deletions: 0, truncated: false, hunks: [] });
    const diff: WorkspaceDiff = { runId: run.id, additions: 2, deletions: 0, truncated: false,
      files: [file('CHANGELOG.md'), file('docs/usage.md')], folders: [{ path: 'docs', status: 'added' }, { path: 'logs', status: 'added' }] };
    expect(standaloneFolders(diff).map(folder => folder.path)).toEqual(['logs']);
    const html = renderToStaticMarkup(createElement(DiffBody, { diff, selection: { isTicked: path => path !== 'docs/usage.md', toggle: () => {} } }));
    // Two files and the empty folder have ticks, in the list and (files only) in their headers; docs/ has none.
    expect(html).toContain('Apply logs/');
    expect(html).not.toContain('Apply docs/<');
    expect(html).toMatch(/<li class="skipped">(?:(?!<\/li>).)*diff-path-name">docs\/<\/span>/s);
    expect(html).not.toMatch(/<li class="skipped">(?:(?!<\/li>).)*diff-path-name">logs\/<\/span>/s);
  });

  it('says so when the changes were discarded', async () => {
    const service = await heldRun();
    await service.command('discardWorkspaceReview', { taskId: task.id, runId: run.id });
    expect(renderThread()).toContain('Discarded, folder unchanged');
  });

  it('leaves a plain line on the earlier turn once a later turn carried its changes on', async () => {
    await heldRun();
    const brief = 'Also add a changelog';
    store.update('tasks', { ...store.get<Task>('tasks', task.id), inputRevision: 1, brief, currentInput: { brief, sourceIds: [] }, status: 'queued' });
    const next = newRun({}, { inputRevision: 1, input: { brief, sourceIds: [] } });
    await core(model([write('CHANGELOG.md', '- note\n', null), reply('Added CHANGELOG.md.')])).runner.run(store.get<Task>('tasks', task.id), next);
    const html = renderThread();
    const earlier = html.slice(0, html.indexOf('Added CHANGELOG.md.'));
    const later = html.slice(html.indexOf('Added CHANGELOG.md.'));
    expect(earlier).toMatch(/<p class="activity-summary changed-files changed-files-carried">.*Carried into the next turn/s);
    expect(later).toMatch(/Changed 2 files.*Not in your folder yet/s);
  });

  it('draws a tick per changed file in the viewer while changes wait', () => {
    const diff: WorkspaceDiff = { runId: run.id, additions: 2, deletions: 0, truncated: false, files: [
      { path: 'a.txt', status: 'added', binary: false, additions: 1, deletions: 0, truncated: false, hunks: [] },
      { path: 'b.txt', status: 'added', binary: false, additions: 1, deletions: 0, truncated: false, hunks: [] },
    ] };
    const html = renderToStaticMarkup(createElement(DiffBody, { diff, selection: { isTicked: path => path === 'a.txt', toggle: () => {} } }));
    // One tick per file in the list and the same one in the file's header.
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    expect(html).toContain('Apply a.txt');
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(DiffBody, { diff }))).not.toContain('type="checkbox"');
  });

  it('shows the review switch with an editable folder, locks it in a crew and hides it for a schedule', () => {
    const view = { id: id(), taskId: task.id, revision: 1, permissions: ['read', 'write'] as const, name: 'project', revoked: false };
    const render = (props: Partial<Parameters<typeof PermissionControls>[0]>) => renderToStaticMarkup(createElement(PermissionControls, {
      workers: [{ id: worker.id, name: worker.name, provider: 'openai', connected: true }], capabilities: ['source.read'] as ToolCapability[],
      grant: { ...view, permissions: [...view.permissions] }, taskId: task.id, sourceCount: 0, searchProvider: 'exa', onCapability: () => {}, onWorkspace: () => {}, ...props,
    }));
    expect(render({})).toMatch(/Review before applying/);
    expect(render({})).toContain('Changes reach the folder only when you apply them.');
    // Sources and review are on; with `workspace.apply` review reads off.
    expect(render({}).match(/role="switch"[^>]*aria-checked="true"/g)).toHaveLength(2);
    expect(render({ capabilities: ['source.read', 'workspace.apply'] }).match(/role="switch"[^>]*aria-checked="true"/g)).toHaveLength(1);
    expect(render({ grant: { ...view, permissions: ['read'] } })).not.toContain('Review before applying');
    expect(render({ reviewShown: false })).not.toContain('Review before applying');
    const crew = render({ reviewLocked: 'Crews apply as each orglet finishes.' });
    expect(crew).toContain('Crews apply as each orglet finishes.');
  });
});
