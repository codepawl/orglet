import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dependencyFolders, linkDependencies, unlinkDependencies } from '../../apps/desktop/src/core/tools/workspace-dependencies';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import type { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';

let directory: string;
let source: string;
let copy: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-dependencies-'));
  source = join(directory, 'source');
  copy = join(directory, 'copy');
  await mkdir(join(source, 'node_modules', 'greet'), { recursive: true });
  await mkdir(join(source, 'packages', 'web', 'node_modules'), { recursive: true });
  await mkdir(join(source, 'packages', 'docs'), { recursive: true });
  await mkdir(join(copy, 'packages', 'web'), { recursive: true });
  await mkdir(join(copy, 'packages', 'docs'), { recursive: true });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function manifest(paths: string[]): WorkspaceManifest {
  return { files: paths.map(path => ({ path, hash: 'a'.repeat(64), bytes: 1 })), omitted: [] } as WorkspaceManifest;
}

describe('installed dependencies for commands (COD-271)', () => {
  it('finds the node_modules next to each package.json the copy started with, root first', async () => {
    const links = await dependencyFolders(source, copy, manifest(['packages/web/package.json', 'package.json', 'packages/docs/package.json', 'src/index.js']));
    expect(links).toEqual([
      { link: join(copy, 'node_modules'), target: join(source, 'node_modules') },
      { link: join(copy, 'packages', 'web', 'node_modules'), target: join(source, 'packages', 'web', 'node_modules') },
    ]);
  });

  it.runIf(process.platform === 'win32')('never offers a node_modules that is itself a link', async () => {
    const elsewhere = join(directory, 'elsewhere');
    await mkdir(elsewhere);
    await symlink(elsewhere, join(source, 'packages', 'docs', 'node_modules'), 'junction');
    const links = await dependencyFolders(source, copy, manifest(['packages/docs/package.json']));
    expect(links).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('links while a command runs and removes only the link afterwards', async () => {
    await writeFile(join(source, 'node_modules', 'greet', 'index.js'), 'module.exports = "hi";');
    const links = await dependencyFolders(source, copy, manifest(['package.json']));
    const linked = await linkDependencies(links);
    expect(linked).toEqual(links);
    expect((await lstat(join(copy, 'node_modules'))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(copy, 'node_modules', 'greet', 'index.js'), 'utf8')).toBe('module.exports = "hi";');
    expect(await linkDependencies(links)).toEqual(links);
    await unlinkDependencies(linked);
    expect(await readdir(copy)).not.toContain('node_modules');
    expect(await readFile(join(source, 'node_modules', 'greet', 'index.js'), 'utf8')).toBe('module.exports = "hi";');
  });

  it('leaves a node_modules a command made in the copy alone', async () => {
    await mkdir(join(copy, 'node_modules'));
    await writeFile(join(copy, 'node_modules', 'mine.txt'), 'kept');
    const links = await dependencyFolders(source, copy, manifest(['package.json']));
    expect(await linkDependencies(links)).toEqual([]);
    await unlinkDependencies(links);
    expect(await readFile(join(copy, 'node_modules', 'mine.txt'), 'utf8')).toBe('kept');
  });
});

describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('installed dependencies in the packaged helper and the real sandbox', () => {
  it('runs a script that requires an installed package and a .bin tool, and cannot write into node_modules', async () => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'shop', scripts: {
      test: 'node -e "console.log(require(\'greet\'))" && greet world',
      poison: 'node -e "require(\'fs\').writeFileSync(\'node_modules/greet/index.js\', \'changed\')"',
    } }));
    await writeFile(join(source, 'node_modules', 'greet', 'index.js'), 'module.exports = "hello from greet";');
    await writeFile(join(source, 'node_modules', 'greet', 'cli.js'), 'console.log(`greet ${process.argv[2]}`);');
    await mkdir(join(source, 'node_modules', '.bin'));
    await writeFile(join(source, 'node_modules', '.bin', 'greet.cmd'), '@node "%~dp0\\..\\greet\\cli.js" %*\r\n');
    const runtimeExecutable = resolve('out/Orglet-win32-x64/Orglet.exe');
    const sandbox = new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE ?? resolve('out/Orglet-win32-x64/resources/wxc-exec.exe'));
    const runtime = new WorkspaceFilesRuntime({ sandbox, helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      runtimeExecutable, stateDirectory: join(directory, 'state') });
    const signal = new AbortController().signal;
    const prepared = await runtime.createCopy(source, signal);
    const links = await dependencyFolders(source, prepared.directory, prepared.manifest);
    const tested = await runtime.runCommand(prepared.directory, { program: 'shell', arguments: ['npm test'], timeoutMs: 60000 }, signal, undefined, links);
    expect(tested.exitCode, tested.stdout + tested.stderr).toBe(0);
    expect(tested.stdout).toContain('hello from greet');
    expect(tested.stdout).toContain('greet world');
    const poisoned = await runtime.runCommand(prepared.directory, { program: 'shell', arguments: ['npm run poison'], timeoutMs: 60000 }, signal, undefined, links);
    expect(poisoned.exitCode).not.toBe(0);
    expect(await readFile(join(source, 'node_modules', 'greet', 'index.js'), 'utf8')).toBe('module.exports = "hello from greet";');
    expect(await readdir(prepared.directory)).not.toContain('node_modules');
  });
});
