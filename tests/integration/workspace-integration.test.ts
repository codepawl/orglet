import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    expect((await apply(name, null)).status).toBe('blocked');
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
