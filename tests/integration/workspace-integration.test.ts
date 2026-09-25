import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { ToolCalls } from '../../apps/desktop/src/core/storage/tool-calls';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('Windows locked integration', () => {
  let directory: string;
  let root: string;
  let store: Store;
  let runId: string;
  let integration: WorkspaceIntegration;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-integrate-'));
    root = join(directory, 'workspace');
    await mkdir(root);
    await writeFile(join(root, 'note.txt'), 'original');
    store = new Store(join(directory, 'state.sqlite'));
    const worker = store.all<Worker>('workers')[0];
    const skill = store.all<Skill>('skills')[0];
    const task: Task = { id: id(), workerId: worker.id, brief: 'Integration', sourceIds: [], consent: true,
      accepted: false, status: 'running', createdAt: now(), budgetMicros: 100_000 };
    store.put('tasks', task);
    runId = id();
    store.put('runs', { id: runId, taskId: task.id, snapshot: { worker, skill }, status: 'running', startedAt: now(), error: null } satisfies Run,
      { column: 'task_id', value: task.id });
    integration = new WorkspaceIntegration(store, process.env.ORGLET_TEST_INTEGRATION_EXECUTABLE ?? resolve('out/native-tools/WorkspaceIntegrate.exe'), join(directory, 'state'));
  });
  afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  function apply(path = 'note.txt', expectedHash: string | null = digest('original'), callId = id(), content = 'replacement') {
    return integration.apply({ runId, callId, root, path, expectedHash, bytes: Buffer.from(content),
      signal: new AbortController().signal, authorize: () => {} });
  }

  it('writes under a lock, preserves original bytes, and replays only the saved result', async () => {
    const callId = id();
    const first = await apply('note.txt', digest('original'), callId);
    expect(first.status).toBe('applied');
    expect(await readFile(first.backupPath, 'utf8')).toBe('original');
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('replacement');
    await writeFile(join(root, 'note.txt'), 'later user edit');
    expect(await apply('note.txt', digest('original'), callId)).toEqual(first);
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('later user edit');
  });

  it('preserves an intervening user edit and reports a conflict', async () => {
    await writeFile(join(root, 'note.txt'), 'user change');
    const result = await apply();
    expect(result.status).toBe('conflict');
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('user change');
  });

  it('allows only one concurrent writer with the same baseline', async () => {
    const results = await Promise.all([apply('note.txt', digest('original'), id(), 'worker one'), apply('note.txt', digest('original'), id(), 'worker two')]);
    expect(results.filter(result => result.status === 'applied')).toHaveLength(1);
    expect(results.every(result => ['applied', 'blocked', 'conflict'].includes(result.status))).toBe(true);
    expect(['worker one', 'worker two']).toContain(await readFile(join(root, 'note.txt'), 'utf8'));
  });

  it('creates Unicode files without replacing existing files', async () => {
    const name = 'tài liệu/ghi chú.txt';
    const created = await apply(name, null);
    expect(created.status).toBe('applied');
    expect(created.created).toBe(true);
    expect(await readFile(join(root, name), 'utf8')).toBe('replacement');
    // A file that appeared at a new path is the person's: a conflict, never overwritten (COD-254).
    expect(await apply(name, null)).toMatchObject({ status: 'conflict', reason: 'exists' });
    expect(await apply('missing.txt', digest('original'))).toMatchObject({ status: 'conflict', reason: 'missing' });
  });

  describe('folders, moves and deletions (COD-254)', () => {
    type Step = Parameters<WorkspaceIntegration['apply']>[0];
    type StepInput = Step extends infer Item ? Item extends Step ? Omit<Item, 'runId' | 'callId' | 'root' | 'signal' | 'authorize'> : never : never;
    const step = (input: StepInput, callId = id()) =>
      integration.apply({ runId, callId, root, signal: new AbortController().signal, authorize: () => {}, ...input } as Step);
    const identity = async (path: string) => (await stat(path, { bigint: true })).ino;
    const present = (path: string) => stat(path).then(() => true, () => false);

    it('creates a folder with its parents, leaves an existing one alone and refuses a file in the way', async () => {
      expect(await step({ operation: 'create_folder', path: 'receipts/2026' })).toMatchObject({ status: 'applied', hash: null, backupPath: '' });
      expect(await step({ operation: 'create_folder', path: 'receipts' })).toMatchObject({ status: 'applied' });
      expect(await step({ operation: 'create_folder', path: 'note.txt' })).toMatchObject({ status: 'conflict', reason: 'exists' });
      expect((await stat(join(root, 'receipts', '2026'))).isDirectory()).toBe(true);
      expect(await step({ operation: 'write', path: 'receipts/2026/march.txt', expectedHash: null, bytes: Buffer.from('march') })).toMatchObject({ status: 'applied' });
      expect(await readFile(join(root, 'receipts', '2026', 'march.txt'), 'utf8')).toBe('march');
    });

    it('moves and renames the same file it hashed, keeping its identity, and changes letter case in place', async () => {
      const before = await identity(join(root, 'note.txt'));
      const moved = await step({ operation: 'move', from: 'note.txt', path: 'archive/2026/Meeting note.txt', expectedHash: digest('original') });
      expect(moved).toMatchObject({ status: 'applied', hash: digest('original'), backupPath: '' });
      expect(await present(join(root, 'note.txt'))).toBe(false);
      expect(await identity(join(root, 'archive', '2026', 'Meeting note.txt'))).toBe(before);
      expect(await step({ operation: 'move', from: 'archive/2026/Meeting note.txt', path: 'archive/2026/meeting note.txt', expectedHash: digest('original') }))
        .toMatchObject({ status: 'applied' });
      expect(await readdir(join(root, 'archive', '2026'))).toEqual(['meeting note.txt']);
    });

    it('never moves over a file, and stops at a source the person edited or removed', async () => {
      await writeFile(join(root, 'taken.txt'), 'theirs');
      expect(await step({ operation: 'move', from: 'note.txt', path: 'taken.txt', expectedHash: digest('original') }))
        .toMatchObject({ status: 'conflict', reason: 'exists' });
      await writeFile(join(root, 'note.txt'), 'user edit');
      expect(await step({ operation: 'move', from: 'note.txt', path: 'moved.txt', expectedHash: digest('original') }))
        .toMatchObject({ status: 'conflict', reason: 'changed', hash: digest('user edit') });
      expect(await step({ operation: 'move', from: 'gone.txt', path: 'moved.txt', expectedHash: digest('original') }))
        .toMatchObject({ status: 'conflict', reason: 'missing' });
      expect(await readFile(join(root, 'taken.txt'), 'utf8')).toBe('theirs');
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('user edit');
      expect(await present(join(root, 'moved.txt'))).toBe(false);
    });

    it('deletes only an unchanged file, after flushing its bytes to the private backup', async () => {
      await writeFile(join(root, 'duplicate.pdf'), 'contract v1');
      const deleted = await step({ operation: 'delete', path: 'duplicate.pdf', expectedHash: digest('contract v1') });
      expect(deleted).toMatchObject({ status: 'applied', hash: null });
      expect(await readFile(deleted.backupPath, 'utf8')).toBe('contract v1');
      expect(await present(join(root, 'duplicate.pdf'))).toBe(false);
      await writeFile(join(root, 'note.txt'), 'user edit');
      expect(await step({ operation: 'delete', path: 'note.txt', expectedHash: digest('original') })).toMatchObject({ status: 'conflict', reason: 'changed' });
      expect(await step({ operation: 'delete', path: 'duplicate.pdf', expectedHash: digest('contract v1') })).toMatchObject({ status: 'conflict', reason: 'missing' });
      expect(await step({ operation: 'delete', path: 'nowhere/duplicate.pdf', expectedHash: digest('contract v1') })).toMatchObject({ status: 'conflict', reason: 'missing' });
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('user edit');
    });

    it('removes a folder only while it is empty', async () => {
      await mkdir(join(root, 'empty'));
      await mkdir(join(root, 'full'));
      await writeFile(join(root, 'full', 'theirs.txt'), 'theirs');
      expect(await step({ operation: 'remove_folder', path: 'empty' })).toMatchObject({ status: 'applied' });
      expect(await present(join(root, 'empty'))).toBe(false);
      expect(await step({ operation: 'remove_folder', path: 'full' })).toMatchObject({ status: 'conflict', reason: 'not_empty' });
      expect(await step({ operation: 'remove_folder', path: 'empty' })).toMatchObject({ status: 'conflict', reason: 'missing' });
      expect(await readFile(join(root, 'full', 'theirs.txt'), 'utf8')).toBe('theirs');
    });

    it('refuses a junction or a hardlink on either side of a move, a delete or a folder step', async () => {
      const outside = join(directory, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'note.txt'), 'original');
      await symlink(outside, join(root, 'escape'), 'junction');
      const throughJunction = [
        await step({ operation: 'move', from: 'escape/note.txt', path: 'stolen.txt', expectedHash: digest('original') }),
        await step({ operation: 'move', from: 'note.txt', path: 'escape/planted.txt', expectedHash: digest('original') }),
        await step({ operation: 'delete', path: 'escape/note.txt', expectedHash: digest('original') }),
        await step({ operation: 'remove_folder', path: 'escape' }),
        await step({ operation: 'create_folder', path: 'escape' }),
        await step({ operation: 'create_folder', path: 'escape/inside' }),
      ];
      expect(throughJunction.map(result => result.status)).toEqual(Array(throughJunction.length).fill('blocked'));
      await link(join(root, 'note.txt'), join(directory, 'hardlink.txt'));
      const hardlinked = [
        await step({ operation: 'delete', path: 'note.txt', expectedHash: digest('original') }),
        await step({ operation: 'move', from: 'note.txt', path: 'moved.txt', expectedHash: digest('original') }),
      ];
      expect(hardlinked.map(result => result.status)).toEqual(['blocked', 'blocked']);
      expect(await readdir(outside)).toEqual(['note.txt']);
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('original');
      expect(await readFile(join(directory, 'hardlink.txt'), 'utf8')).toBe('original');
      expect(await present(join(root, 'stolen.txt'))).toBe(false);
      expect(await present(join(root, 'moved.txt'))).toBe(false);
    });

    it('journals a move with both paths and replays only its saved result', async () => {
      const callId = id();
      const first = await step({ operation: 'move', from: 'note.txt', path: 'moved.txt', expectedHash: digest('original') }, callId);
      await writeFile(join(root, 'note.txt'), 'a new note');
      expect(await step({ operation: 'move', from: 'note.txt', path: 'moved.txt', expectedHash: digest('original') }, callId)).toEqual(first);
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('a new note');
      expect(store.db.prepare('SELECT name,summary FROM tool_calls WHERE call_id=?').get(callId)).toEqual({ name: 'integrate_workspace_file', summary: 'note.txt → moved.txt' });
    });

    it('keeps the original when a delete crashes after its backup, and refuses to replay it', async () => {
      await writeFile(join(root, 'duplicate.pdf'), 'contract v1');
      const backupPath = join(directory, 'delete.backup');
      const callId = id();
      let launches = 0;
      const operation = { runId, callId, name: 'integration-crash-test', arguments: { point: 'delete-after_backup' }, replay: 'never' as const,
        authorize: () => {}, perform: () => new Promise<never>((_resolve, reject) => {
          launches++;
          const child = spawn(resolve('out/native-tools/WorkspaceIntegrateTest.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
          const timer = setTimeout(() => child.kill(), 10000);
          let reached = false;
          child.stderr.on('data', bytes => {
            if (bytes.toString().includes('after_backup')) { reached = true; child.kill(); }
          });
          child.stdin.end(JSON.stringify({ operation: 'delete', root, path: 'duplicate.pdf', expectedHash: digest('contract v1'), backupPath, testCrashAt: 'after_backup' }));
          child.on('error', error => { clearTimeout(timer); reject(error); });
          child.on('close', () => { clearTimeout(timer); reject(new Error(reached ? 'Injected process crash' : 'Crash point not reached')); });
        }),
      };
      await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('Injected process crash');
      expect(await readFile(backupPath, 'utf8')).toBe('contract v1');
      expect(await readFile(join(root, 'duplicate.pdf'), 'utf8')).toBe('contract v1');
      await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('chưa rõ');
      expect(launches).toBe(1);
    });
  });

  it('refuses a junction and leaves the outside file unchanged', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'note.txt'), 'original');
    await symlink(outside, join(root, 'escape'), 'junction');
    expect((await apply('escape/note.txt')).status).toBe('blocked');
    expect((await apply('escape/new.txt', null)).status).toBe('blocked');
    expect(await readFile(join(outside, 'note.txt'), 'utf8')).toBe('original');
    await expect(readFile(join(outside, 'new.txt'))).rejects.toThrow();
  });

  it('refuses a hardlinked file without changing either name', async () => {
    const outside = join(directory, 'hardlink.txt');
    await link(join(root, 'note.txt'), outside);
    expect((await apply()).status).toBe('blocked');
    expect(await readFile(outside, 'utf8')).toBe('original');
  });

  it.each(['after_backup', 'after_write'])('retains original bytes and refuses replay after a real process crash at %s', async point => {
    const backupPath = join(directory, 'original.backup');
    const callId = id();
    let launches = 0;
    const operation = { runId, callId, name: 'integration-crash-test', arguments: { point }, replay: 'never' as const,
      authorize: () => {}, perform: () => new Promise<never>((_resolve, reject) => {
        launches++;
        const child = spawn(resolve('out/native-tools/WorkspaceIntegrateTest.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const timer = setTimeout(() => child.kill(), 10000);
        let reached = false;
        child.stderr.on('data', bytes => {
          if (bytes.toString().includes(point)) { reached = true; child.kill(); }
        });
        child.stdin.end(JSON.stringify({ root, path: 'note.txt', expectedHash: digest('original'), backupPath,
          contentBase64: Buffer.from('replacement').toString('base64'), testCrashAt: point }));
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', () => { clearTimeout(timer); reject(new Error(reached ? 'Injected process crash' : 'Crash point not reached')); });
      }),
    };
    await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('Injected process crash');
    expect(await readFile(backupPath, 'utf8')).toBe('original');
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe(point === 'after_write' ? 'replacement' : 'original');
    store.close();
    store = new Store(join(directory, 'state.sqlite'));
    await writeFile(join(root, 'note.txt'), 'user edit after crash');
    await expect(new ToolCalls(store).execute(operation)).rejects.toThrow('chưa rõ');
    expect(launches).toBe(1);
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('user edit after crash');
  });
});
