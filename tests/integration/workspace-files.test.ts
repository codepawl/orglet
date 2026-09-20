import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspacePath, WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';

let directory: string;
let source: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-files-'));
  source = join(directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'note.txt'), 'first line\nsecond line');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('rejects traversal, Windows aliases and internal paths', () => {
  for (const path of ['../secret', '/absolute', 'C:/secret', 'folder\\file', 'name.', 'CON.txt', '.git/config', 'a/.orglet-tmp/file']) {
    expect(WorkspacePath.safeParse(path).success, path).toBe(false);
  }
});

it('reads, searches and edits a private file only against its expected hash', async () => {
  const original = await executeWorkspaceOperation(source, { operation: 'read', path: 'note.txt', offset: 0 }) as { hash: string };
  expect(await executeWorkspaceOperation(source, { operation: 'search', path: '', text: 'second' })).toMatchObject({ matches: [{ path: 'note.txt', line: 2 }] });
  await executeWorkspaceOperation(source, { operation: 'write', path: 'note.txt', content: 'updated', expectedHash: original.hash });
  await expect(executeWorkspaceOperation(source, { operation: 'write', path: 'note.txt', content: 'stale', expectedHash: original.hash })).rejects.toThrow('đã thay đổi');
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('updated');
  await expect(executeWorkspaceOperation(source, { operation: 'write', path: 'note.txt', content: 'overwrite', expectedHash: null })).rejects.toThrow();
});

it('records an explicit snapshot manifest and leaves original files unchanged', async () => {
  const copy = join(directory, 'copy');
  await mkdir(copy);
  await mkdir(join(source, '.git'));
  await mkdir(join(source, 'node_modules'));
  const manifest = WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source }));
  expect(manifest.files.map(file => file.path)).toEqual(['note.txt']);
  expect(manifest.omitted).toEqual(['.git', 'node_modules']);
  await executeWorkspaceOperation(copy, { operation: 'write', path: 'note.txt', content: 'private change', expectedHash: manifest.files[0].hash });
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('first line\nsecond line');
});

it('paginates Unicode without corrupting characters and rejects invalid UTF-8', async () => {
  const content = '\uFEFF' + 'Tiếng Việt 🐈 '.repeat(2000);
  await writeFile(join(source, 'unicode.txt'), content);
  let offset: number | null = 0;
  let combined = '';
  while (offset !== null) {
    const result = await executeWorkspaceOperation(source, { operation: 'read', path: 'unicode.txt', offset }) as { content: string; nextOffset: number | null };
    combined += result.content;
    offset = result.nextOffset;
  }
  expect(combined).toBe(content);
  await writeFile(join(source, 'binary'), Buffer.from([0xff, 0xfe, 0x80]));
  await expect(executeWorkspaceOperation(source, { operation: 'read', path: 'binary', offset: 0 })).rejects.toThrow('UTF-8');
});

it.runIf(process.platform === 'win32')('does not traverse a junction for reading or snapshotting', async () => {
  const outside = join(directory, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'private'), 'canary');
  await symlink(outside, join(source, 'escape'), 'junction');
  await expect(executeWorkspaceOperation(source, { operation: 'read', path: 'escape/private', offset: 0 })).rejects.toThrow('vượt phạm vi');
  const manifest = WorkspaceManifest.parse(await executeWorkspaceOperation(source, { operation: 'manifest' }));
  expect(manifest.omitted).toContain('escape');
  expect(manifest.files).toHaveLength(1);
});

describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('packaged workspace helper in real sandbox', () => {
  it.each([process.execPath, resolve('out/Orglet-win32-x64/Orglet.exe')])('copies, edits and checks with runtime %s', async runtimeExecutable => {
    const sandbox = new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE ?? resolve('out/Orglet-win32-x64/resources/wxc-exec.exe'));
    const runtime = new WorkspaceFilesRuntime({ sandbox,
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      runtimeExecutable, stateDirectory: join(directory, 'state'),
    });
    const signal = new AbortController().signal;
    const copy = await runtime.createCopy(source, signal);
    expect(copy.manifest.files).toHaveLength(1);
    const result = await runtime.execute(copy.directory, { operation: 'read', path: 'note.txt', offset: 0 }, signal) as { hash: string; content: string };
    expect(result.content).toContain('first line');
    await runtime.execute(copy.directory, { operation: 'write', path: 'note.txt', expectedHash: result.hash, content: 'checked' }, signal);
    await runtime.execute(copy.directory, { operation: 'write', path: 'check.cjs', expectedHash: null,
      content: "if(require('fs').readFileSync('note.txt','utf8')!=='checked')process.exit(1);console.log('check passed');" }, signal);
    const check = await sandbox.run({ directory: copy.directory, runtimeDirectories: [resolve(runtimeExecutable, '..')],
      commandLine: `"${runtimeExecutable}" "${join(copy.directory, 'check.cjs')}"`, timeoutMs: 5000, signal });
    expect(check.exitCode, check.stderr).toBe(0);
    expect(check.stdout.trim()).toBe('check passed');
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('first line\nsecond line');
  });
});
