import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';

const execute = promisify(execFile);
const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('Git worktrees prepared from sandboxed snapshots', () => {
  let directory: string;
  let source: string;
  let templates: string;
  const signal = () => new AbortController().signal;
  const git = async (cwd: string, args: string[]) => (await execute(gitExecutable, [
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${templates}`, '-c', 'core.fsmonitor=false', ...args,
  ], { cwd, windowsHide: true, timeout: 10000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL' } })).stdout.trim();
  function files(executable: string | undefined = gitExecutable) {
    return new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE!),
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      runtimeExecutable: resolve('out/Orglet-win32-x64/Orglet.exe'),
      stateDirectory: join(directory, 'state'), gitExecutable: executable,
    });
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-git-copy-'));
    source = join(directory, 'source');
    templates = join(directory, 'templates');
    await mkdir(source);
    await mkdir(templates);
    await git(source, ['init', '--quiet', `--template=${templates}`]);
    await writeFile(join(source, 'note.txt'), 'committed\n');
    await git(source, ['add', '--', 'note.txt']);
    await git(source, ['commit', '--quiet', '-m', 'Fixture baseline']);
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('creates independent worktrees from dirty bytes without hooks, filters or changes to the original index', async () => {
    await writeFile(join(source, 'note.txt'), 'user dirty\r\n');
    await writeFile(join(source, 'ghi chú 🦦.txt'), 'untracked tiếng Việt\n');
    await writeFile(join(source, '.gitattributes'), '* text eol=lf filter=poison\n');
    await git(source, ['config', 'filter.poison.clean', 'exit 91']);
    await git(source, ['config', 'filter.poison.smudge', 'exit 92']);
    await git(source, ['config', 'filter.poison.required', 'true']);
    await git(source, ['config', 'core.fsmonitor', 'exit 93']);
    const hooks = join(source, '.git', 'hooks');
    await mkdir(hooks);
    await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nexit 94\n');
    await git(source, ['config', 'core.hooksPath', hooks]);
    const index = await readFile(join(source, '.git', 'index'));
    const configuration = await readFile(join(source, '.git', 'config'));
    const head = await readFile(join(source, '.git', 'HEAD'));
    const runtime = files();
    const [first, second] = await Promise.all([runtime.createCopy(source, signal()), runtime.createCopy(source, signal())]);
    expect(first.kind).toBe('git-worktree');
    expect(second.kind).toBe('git-worktree');
    expect(first.directory).not.toBe(second.directory);
    expect(await readFile(join(first.directory, '.git'), 'utf8')).toContain('repository.git/worktrees/');
    expect(await git(first.directory, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
    expect(await git(first.directory, ['show', 'HEAD:ghi chú 🦦.txt'])).toBe('untracked tiếng Việt');
    expect(await readFile(join(first.directory, 'note.txt'), 'utf8')).toBe('user dirty\r\n');
    expect(await git(first.directory, ['status', '--porcelain'])).toBe('');
    const baseline = first.manifest.files.find(file => file.path === 'note.txt')!;
    await runtime.execute(first.directory, { operation: 'write', path: 'note.txt', content: 'worker edit', expectedHash: baseline.hash }, signal());
    expect(await readFile(join(second.directory, 'note.txt'), 'utf8')).toBe('user dirty\r\n');
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('user dirty\r\n');
    expect(await readFile(join(source, '.git', 'index'))).toEqual(index);
    expect(await readFile(join(source, '.git', 'config'))).toEqual(configuration);
    expect(await readFile(join(source, '.git', 'HEAD'))).toEqual(head);
  });

  it('fails explicitly when Git is missing and never silently substitutes a plain copy', async () => {
    await expect(files(join(directory, 'missing-git.exe')).createCopy(source, signal())).rejects.toThrow('Cần Git cho Windows');
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('committed\n');
  });
});
