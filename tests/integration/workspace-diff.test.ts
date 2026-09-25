import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { prepareGitWorktree } from '../../apps/desktop/src/core/tools/workspace-git';
import { changedPaths, diffWorkspaceCopy } from '../../apps/desktop/src/core/tools/workspace-diff';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import { DIFF_FILE_LINE_LIMIT, DIFF_TOTAL_LINE_LIMIT } from '../../apps/desktop/src/shared/workspace-diff';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const execute = promisify(execFile);
const gitExecutable = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe');
const signal = () => new AbortController().signal;
const manifestOf = async (directory: string) => WorkspaceManifest.parse(await executeWorkspaceOperation(directory, { operation: 'manifest' }));
const posix = (path: string) => path.replaceAll('\\', '/');

/** A snapshot folder turned into the same bare repository and worktree a granted copy gets, without the sandbox. */
async function prepareCopy(session: string, seedFiles: Record<string, string | Buffer>) {
  const seed = join(session, 'seed');
  for (const [path, content] of Object.entries(seedFiles)) {
    await mkdir(join(seed, path, '..'), { recursive: true });
    await writeFile(join(seed, path), content);
  }
  const baseline = await manifestOf(seed);
  await prepareGitWorktree(session, { operation: 'prepare_git', executable: gitExecutable }, signal());
  return { worktree: join(session, 'worktree'), repository: join(session, 'repository.git'), baseline };
}

/** A folder path under `parent` exactly `length` characters long, made of folders of at most 49 characters. */
function folderOfLength(parent: string, length: number) {
  let path = parent;
  while (path.length < length) {
    const room = length - path.length - 1;
    path = room > 0 ? join(path, 'x'.repeat(Math.min(49, room))) : `${path}x`;
  }
  return path;
}

async function diffOf(worktree: string, baseline: WorkspaceManifest, options: { includeHunks?: boolean; outputByteLimit?: number } = {}) {
  return diffWorkspaceCopy({
    executable: gitExecutable, worktree, baseline, current: await manifestOf(worktree),
    includeHunks: options.includeHunks ?? true, signal: signal(), ...(options.outputByteLimit ? { outputByteLimit: options.outputByteLimit } : {}),
  });
}

describe.runIf(existsSync(gitExecutable))('workspace diff against the snapshot (COD-163)', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-diff-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('reports modified, added, deleted, renamed and binary files with hunks and counts', async () => {
    const original = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
    const moved = Array.from({ length: 20 }, (_, index) => `kept ${index + 1}`).join('\n') + '\n';
    const { worktree, baseline } = await prepareCopy(directory, {
      'src/app.ts': original, 'docs/old.md': '# gone\n', 'keep.txt': 'same\n', 'old-name.txt': moved,
      'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
    });
    await writeFile(join(worktree, 'src', 'app.ts'), original.replace('line 3', 'line three').replace('line 12\n', 'line 12\nline 13\n'));
    await unlink(join(worktree, 'docs', 'old.md'));
    await unlink(join(worktree, 'old-name.txt'));
    await writeFile(join(worktree, 'new-name.txt'), moved);
    await writeFile(join(worktree, 'new.txt'), 'fresh\n');
    await writeFile(join(worktree, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x09, 0x08, 0x07]));

    const diff = await diffOf(worktree, baseline);
    expect(diff.truncated).toBe(false);
    expect(diff.files.map(file => [file.path, file.status, file.additions, file.deletions, file.binary])).toEqual([
      ['docs/old.md', 'deleted', 0, 1, false],
      ['image.png', 'modified', 0, 0, true],
      ['new-name.txt', 'renamed', 0, 0, false],
      ['new.txt', 'added', 1, 0, false],
      ['src/app.ts', 'modified', 2, 1, false],
    ]);
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(2);
    expect(diff.files.find(file => file.path === 'new-name.txt')!.previousPath).toBe('old-name.txt');
    expect(diff.files.find(file => file.binary)!.hunks).toEqual([]);
    const app = diff.files.find(file => file.path === 'src/app.ts')!;
    expect(app.hunks).toHaveLength(2);
    expect(app.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(app.hunks[0].lines.filter(line => line.kind !== 'context')).toEqual([
      { kind: 'removed', text: 'line 3', oldLine: 3, newLine: null },
      { kind: 'added', text: 'line three', oldLine: null, newLine: 3 },
    ]);
    expect(app.hunks[1].lines.at(-1)).toEqual({ kind: 'added', text: 'line 13', oldLine: null, newLine: 13 });
    expect(app.hunks[0].lines[0]).toEqual({ kind: 'context', text: 'line 1', oldLine: 1, newLine: 1 });
    const deleted = diff.files.find(file => file.path === 'docs/old.md')!;
    expect(deleted.hunks[0].lines).toEqual([{ kind: 'removed', text: '# gone', oldLine: 1, newLine: null }]);
    expect(diff.files.find(file => file.path === 'new.txt')!.hunks[0].lines).toEqual([{ kind: 'added', text: 'fresh', oldLine: null, newLine: 1 }]);
  });

  it('never lists the worktree pointer or an unchanged file', async () => {
    const { worktree, baseline } = await prepareCopy(directory, { 'keep.txt': 'same\n' });
    expect(changedPaths(baseline, await manifestOf(worktree))).toEqual([]);
    expect(await diffOf(worktree, baseline)).toEqual({ files: [], additions: 0, deletions: 0, truncated: false });
  });

  it('caps the lines of one file, the lines of the whole diff, and the bytes read from Git', async () => {
    const { worktree, baseline } = await prepareCopy(directory, { 'small.txt': 'a\n' });
    const long = Array.from({ length: DIFF_FILE_LINE_LIMIT + 500 }, (_, index) => `row ${index}`).join('\n') + '\n';
    await writeFile(join(worktree, 'long.txt'), long);
    const single = await diffOf(worktree, baseline);
    const longFile = single.files.find(file => file.path === 'long.txt')!;
    expect(longFile.additions).toBe(DIFF_FILE_LINE_LIMIT + 500);
    expect(longFile.truncated).toBe(true);
    expect(longFile.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(DIFF_FILE_LINE_LIMIT);
    expect(single.truncated).toBe(true);

    const perFile = DIFF_FILE_LINE_LIMIT - 100;
    const fileCount = Math.ceil(DIFF_TOTAL_LINE_LIMIT / perFile) + 1;
    for (let index = 0; index < fileCount; index += 1) {
      await writeFile(join(worktree, `many-${String(index).padStart(2, '0')}.txt`), Array.from({ length: perFile }, (_, line) => `v${line}`).join('\n') + '\n');
    }
    await unlink(join(worktree, 'long.txt'));
    const total = await diffOf(worktree, baseline);
    const withHunks = total.files.filter(file => file.hunks.length > 0);
    const withoutHunks = total.files.filter(file => file.hunks.length === 0);
    expect(withHunks.reduce((sum, file) => sum + file.hunks.reduce((lines, hunk) => lines + hunk.lines.length, 0), 0)).toBeLessThanOrEqual(DIFF_TOTAL_LINE_LIMIT);
    expect(withoutHunks.length).toBeGreaterThan(0);
    expect(withoutHunks.every(file => file.truncated && file.additions === perFile)).toBe(true);
    expect(total.truncated).toBe(true);
    expect(total.additions).toBe(fileCount * perFile);

    const limited = await diffOf(worktree, baseline, { outputByteLimit: 16 * 1024 });
    expect(limited.truncated).toBe(true);
    expect(limited.files).toHaveLength(fileCount);
    expect(limited.files.filter(file => file.hunks.length > 0).length).toBeLessThan(fileCount);
    expect(limited.files.every(file => file.hunks.length > 0 || file.truncated)).toBe(true);

    const counts = await diffOf(worktree, baseline, { includeHunks: false });
    expect(counts.truncated).toBe(false);
    expect(counts.files.every(file => file.hunks.length === 0 && !file.truncated)).toBe(true);
    expect(counts.additions).toBe(total.additions);
  });

  it('runs no hook, clean filter, external diff or line-ending conversion from the copy or its repository', async () => {
    const { worktree, repository, baseline } = await prepareCopy(directory, { 'note.txt': 'committed\n' });
    const markers = join(directory, 'markers');
    await mkdir(markers);
    const hooks = join(directory, 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'post-index-change'), `#!/bin/sh\necho hooked > "${posix(join(markers, 'hook'))}"\n`);
    const configure = (key: string, value: string) => execute(gitExecutable, [`--git-dir=${repository}`, 'config', key, value],
      { windowsHide: true, timeout: 10000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL' } });
    await configure('core.hooksPath', hooks);
    await configure('filter.poison.clean', `echo poisoned > "${posix(join(markers, 'clean'))}"; exit 91`);
    await configure('filter.poison.required', 'true');
    await configure('diff.poison.command', `echo driver > "${posix(join(markers, 'driver'))}"`);
    await configure('diff.external', `echo external > "${posix(join(markers, 'external'))}"`);
    await configure('core.autocrlf', 'true');
    // What a worker can write: attributes that would run the filter and convert line endings.
    await writeFile(join(worktree, '.gitattributes'), '* filter=poison diff=poison text eol=crlf\n');
    await writeFile(join(worktree, 'note.txt'), 'worker edit\r\nsecond\r\n');

    const diff = await diffOf(worktree, baseline);
    expect(await readdir(markers)).toEqual([]);
    const note = diff.files.find(file => file.path === 'note.txt')!;
    expect(note.hunks[0].lines).toEqual([
      { kind: 'removed', text: 'committed', oldLine: 1, newLine: null },
      { kind: 'added', text: 'worker edit\r', oldLine: null, newLine: 1 },
      { kind: 'added', text: 'second\r', oldLine: null, newLine: 2 },
    ]);
    expect(diff.files.map(file => file.path)).toEqual(['.gitattributes', 'note.txt']);
  });

  it('diffs a copy whose session folder sits under a long user-data path', async () => {
    // COD-257: Git for Windows refuses a $GIT_DIR longer than MAX_PATH - 40 ("'$GIT_DIR' too big"), and the copy's
    // linked worktree directory was passed absolute. Pad the session so that directory is 240 characters long.
    const linkedDirectoryTail = join('repository.git', 'worktrees', 'worktree').length + 1;
    const session = folderOfLength(directory, 240 - linkedDirectoryTail);
    await mkdir(session, { recursive: true });
    expect(join(session, 'repository.git', 'worktrees', 'worktree').length).toBe(240);
    const { worktree, baseline } = await prepareCopy(session, { 'src/app.ts': 'one\ntwo\n' });
    await writeFile(join(worktree, 'src', 'app.ts'), 'one\nthree\n');
    const diff = await diffOf(worktree, baseline);
    expect(diff.files.map(file => [file.path, file.additions, file.deletions])).toEqual([['src/app.ts', 1, 1]]);
  });

  it('refuses a copy whose .git file points elsewhere', async () => {
    const { worktree, baseline } = await prepareCopy(directory, { 'note.txt': 'committed\n' });
    // Git marks the pointer hidden, which Windows refuses to overwrite in place; a worker's write goes the same way.
    await rm(join(worktree, '.git'), { force: true });
    await writeFile(join(worktree, '.git'), `gitdir: ${join(directory, 'elsewhere')}\n`);
    await writeFile(join(worktree, 'note.txt'), 'changed\n');
    // The Git directory is derived from the session, so the rewritten pointer changes nothing.
    const diff = await diffOf(worktree, baseline);
    expect(diff.files.map(file => file.path)).toEqual(['note.txt']);
    const stray = join(directory, 'stray');
    await mkdir(stray);
    await writeFile(join(stray, '.git'), 'gitdir: nowhere\n');
    await expect(diffWorkspaceCopy({ executable: gitExecutable, worktree: stray, baseline, current: baseline, includeHunks: true, signal: signal() }))
      .rejects.toThrow('không có bản gốc để so sánh');
  });
});

describe.runIf(existsSync(gitExecutable))('workspace diff through the runtime (COD-163)', () => {
  let directory: string;
  let source: string;
  let store: Store;
  let task: Task;
  let run: Run;
  let grants: WorkspaceGrants;
  const integrated: string[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-diff-runtime-'));
    source = join(directory, 'source');
    await mkdir(join(source, '.git'), { recursive: true });
    await writeFile(join(source, 'note.txt'), 'original\nsecond\n');
    await writeFile(join(source, 'extra.txt'), 'extra\n');
    store = new Store(join(directory, 'state.sqlite'));
    grants = new WorkspaceGrants(store);
    const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
    const skill = store.all<Skill>('skills')[0];
    task = { id: id(), workerId: worker.id, brief: 'Update note.txt', consent: true, providerScopes: ['openai'],
      sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now() };
    store.put('tasks', task);
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] });
    run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null, snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id) } };
    store.put('runs', run, { column: 'task_id', value: task.id });
    integrated.length = 0;
  });
  afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

  function fixture(kind: 'git-worktree' | 'copy' = 'git-worktree') {
    return new WorkspaceRuntime(store, {
      createCopy: async (original, abort) => {
        abort.throwIfAborted();
        const session = join(directory, id());
        const seed = join(session, 'seed');
        await mkdir(seed, { recursive: true });
        const manifest = WorkspaceManifest.parse(await executeWorkspaceOperation(seed, { operation: 'snapshot', source: original }));
        if (kind === 'copy') return { directory: seed, manifest, kind };
        await prepareGitWorktree(session, { operation: 'prepare_git', executable: gitExecutable }, abort);
        return { directory: join(session, 'worktree'), manifest, kind };
      },
      execute: async (copy, request, abort) => { abort.throwIfAborted(); return executeWorkspaceOperation(copy, request); },
      diffCopy: async (copy, baseline, includeHunks, abort) => diffWorkspaceCopy({ executable: gitExecutable, worktree: copy, baseline, current: await manifestOf(copy), includeHunks, signal: abort }),
    }, { apply: async options => {
      integrated.push(options.path);
      const created = 'expectedHash' in options && options.expectedHash === null;
      return { status: 'applied', hash: 'a'.repeat(64), backupPath: join(directory, 'backup'), created };
    } });
  }

  async function edit(runtime: WorkspaceRuntime, path: string, content: string) {
    const read = await runtime.execute(run, id(), { operation: 'read', path, offset: 0 }, signal()) as { hash: string };
    return runtime.execute(run, id(), { operation: 'write', path, expectedHash: read.hash, content }, signal());
  }

  it('keeps the counts with the copy when the run finishes and serves the hunks on request', async () => {
    const runtime = fixture();
    await edit(runtime, 'note.txt', 'changed\nsecond\nthird\n');
    await runtime.execute(run, id(), { operation: 'write', path: 'made.txt', expectedHash: null, content: 'new\n' }, signal());
    expect(await runtime.finish(run, signal())).toEqual([]);
    expect(integrated.sort()).toEqual(['made.txt', 'note.txt']);
    const view = new WorkspaceRecovery(store).view(task.id);
    expect(view.copies[0].diff).toEqual({ files: 2, additions: 3, deletions: 1 });
    const diff = await runtime.diff({ taskId: task.id, runId: run.id });
    expect(diff.runId).toBe(run.id);
    expect(diff.files.map(file => [file.path, file.status, file.additions, file.deletions])).toEqual([['made.txt', 'added', 1, 0], ['note.txt', 'modified', 2, 1]]);
    expect(diff.files[1].hunks[0].lines.map(line => `${line.kind[0]} ${line.text}`)).toEqual(['r original', 'a changed', 'c second', 'a third']);
  });

  it('records no counts while nothing changed, refuses a run without a copy, and lists a plain copy without lines', async () => {
    const runtime = fixture();
    await expect(runtime.diff({ taskId: task.id, runId: run.id })).rejects.toThrow('không có bản làm việc để so sánh');
    await runtime.execute(run, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal());
    expect(await runtime.diff({ taskId: task.id, runId: run.id })).toEqual({ runId: run.id, files: [], additions: 0, deletions: 0, truncated: false });
    await runtime.finish(run, signal());
    expect(new WorkspaceRecovery(store).view(task.id).copies[0].diff).toEqual({ files: 0, additions: 0, deletions: 0 });
    const other = { id: id(), workerId: task.workerId, brief: 'Other', consent: true, sourceIds: [], budgetMicros: 1000, accepted: false, status: 'queued' as const, createdAt: now() };
    store.put('tasks', other);
    await expect(runtime.diff({ taskId: other.id, runId: run.id })).rejects.toThrow('không thuộc cuộc trò chuyện này');

    const plain = fixture('copy');
    const plainRun = { ...run, id: id() };
    store.put('runs', plainRun, { column: 'task_id', value: task.id });
    await plain.execute(plainRun, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal());
    // A plain folder copy kept only hashes (COD-254): it lists what happened to each file, without lines.
    expect(await plain.diff({ taskId: task.id, runId: plainRun.id })).toEqual({ runId: plainRun.id, files: [], additions: 0, deletions: 0, truncated: false, lines: false });
    await plain.finish(plainRun, signal());
    expect(new WorkspaceRecovery(store).view(task.id).copies.find(copy => copy.runId === plainRun.id)!.diff).toEqual({ files: 0, additions: 0, deletions: 0, lines: false });
  });

  it('lists moves, deletions and new folders of a Git copy, with Git\'s hunks for the edits (COD-254)', async () => {
    const runtime = fixture();
    await runtime.execute(run, id(), { operation: 'create_folder', path: 'archive/empty' }, signal());
    await runtime.execute(run, id(), { operation: 'move', from: 'extra.txt', to: 'archive/extra.txt' }, signal());
    await runtime.execute(run, id(), { operation: 'delete', path: 'note.txt' }, signal());
    const diff = await runtime.diff({ taskId: task.id, runId: run.id });
    expect(diff.files.map(file => [file.path, file.status, file.previousPath ?? null])).toEqual([
      ['archive/extra.txt', 'renamed', 'extra.txt'], ['note.txt', 'deleted', null],
    ]);
    expect(diff.folders).toEqual([{ path: 'archive', status: 'added' }, { path: 'archive/empty', status: 'added' }]);
    expect(diff.lines).toBeUndefined();
    await runtime.finish(run, signal());
    expect(new WorkspaceRecovery(store).view(task.id).copies[0].diff).toEqual({ files: 2, additions: 0, deletions: 2, moved: 1, removed: 1, folders: 2 });
  });
});
