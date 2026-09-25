import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { WorkspaceManifest } from '../../shared/workspace-tools';
import { executeWorkspaceOperation } from './workspace-files';
import { sandboxEnvironment } from './sandbox';

const ObjectId = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const GitRequest = z.object({ operation: z.literal('prepare_git'), executable: z.string().min(1).max(32768) }).strict();

/** The branch that keeps the bytes a working copy started from, so a later diff has something to compare with. */
export const SNAPSHOT_REF = 'refs/heads/orglet-snapshot';

export type GitOutput = { output: string; limited: boolean };
export type GitRun = (args: string[], options?: {
  input?: string;
  environment?: NodeJS.ProcessEnv;
  /** Bytes of stdout and stderr read before the process is stopped. */
  outputLimit?: number;
  /** Return what was read when the limit stops the process, instead of failing. */
  keepPartialOutput?: boolean;
}) => Promise<GitOutput>;

/**
 * Git with every user-controlled input switched off: no system or global config, no attributes outside the
 * repository, no hooks, no filters, no line-ending conversion, no prompts. `directory` is the copy's session folder,
 * where `empty.config` and the empty `templates` hook folder live; Git treats either one missing as empty.
 * The process starts in `cwd`, which is never the worker's directory, so no executable or DLL lookup starts there.
 */
export function isolatedGit(options: { executable: string; directory: string; cwd: string; signal: AbortSignal; failure: string }): GitRun {
  const templates = join(options.directory, 'templates');
  const configuration = join(options.directory, 'empty.config');
  const environment: NodeJS.ProcessEnv = {
    ...sandboxEnvironment(options.directory, []),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: configuration, GIT_CONFIG_GLOBAL: configuration,
    GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'Orglet', GIT_AUTHOR_EMAIL: 'workspace@localhost',
    GIT_COMMITTER_NAME: 'Orglet', GIT_COMMITTER_EMAIL: 'workspace@localhost',
  };
  // core.longpaths lets Git for Windows reach objects and files past MAX_PATH under a long user-data folder
  // (COD-257); other Gits ignore it. It does not lift the separate limit on $GIT_DIR, which is why callers name the
  // Git directory relative to `cwd`.
  const configurationArgs = ['-c', `core.hooksPath=${templates}`, '-c', 'core.fsmonitor=false',
    '-c', 'core.autocrlf=false', '-c', 'core.quotePath=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
    '-c', 'protocol.allow=never', '-c', 'commit.gpgsign=false', '-c', 'core.longpaths=true'];
  return (args, runOptions = {}) => new Promise<GitOutput>((resolve, reject) => {
    options.signal.throwIfAborted();
    const outputLimit = runOptions.outputLimit ?? 1024 * 1024;
    const child = spawn(options.executable, [...configurationArgs, ...args], {
      cwd: options.cwd, env: { ...environment, ...runOptions.environment }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal,
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let limited = false;
    let launchError: Error | undefined;
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (limited) return;
      bytes += chunk.length;
      if (bytes > outputLimit) {
        limited = true;
        target.push(chunk.subarray(0, chunk.length - (bytes - outputLimit)));
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', chunk => collect(output, chunk));
    child.stderr.on('data', chunk => collect(errors, chunk));
    child.stdin.on('error', () => {});
    child.stdin.end(runOptions.input ?? '');
    child.on('error', error => { launchError = error; });
    child.on('close', code => {
      if (launchError) {
        reject(launchError);
      } else if (limited && runOptions.keepPartialOutput) {
        resolve({ output: Buffer.concat(output).toString('utf8'), limited: true });
      } else if (limited || code !== 0) {
        reject(new Error(`${options.failure}: ${Buffer.concat(errors).toString('utf8').slice(0, 2000)}`));
      } else {
        resolve({ output: Buffer.concat(output).toString('utf8'), limited: false });
      }
    });
  });
}

/** Fixed core operation on a fresh snapshot, before any worker receives its directory. */
export async function prepareGitWorktree(directory: string, raw: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const request = GitRequest.parse(raw);
  if (!isAbsolute(directory) || !isAbsolute(request.executable)) throw new Error('Đường dẫn Git runtime không hợp lệ.');
  const seed = join(directory, 'seed');
  const repository = join(directory, 'repository.git');
  const worktree = join(directory, 'worktree');
  const templates = join(directory, 'templates');
  const configuration = join(directory, 'empty.config');
  await mkdir(repository);
  await mkdir(templates);
  await writeFile(configuration, '', { flag: 'wx' });
  const run = isolatedGit({ executable: request.executable, directory, cwd: repository, signal, failure: 'Không tạo được Git worktree riêng' });
  const git = async (args: string[], input = '') => (await run(args, { input })).output.trim();
  const manifest = WorkspaceManifest.parse(await executeWorkspaceOperation(seed, { operation: 'manifest' }));
  await git(['init', '--bare', '--quiet', `--template=${templates}`, '.']);
  await mkdir(join(repository, 'info'), { recursive: true });
  await writeFile(join(repository, 'info', 'attributes'), '* -text -filter -working-tree-encoding -ident\n', { flag: 'wx' });
  // Git runs in the repository, so it is named relatively: Git for Windows refuses a $GIT_DIR longer than
  // MAX_PATH - 40 ("'$GIT_DIR' too big"), which an absolute path under a long user-data folder reaches (COD-257).
  const repositoryArgs = ['--git-dir=.'];
  const paths = manifest.files.map(file => file.path);
  // Read exact bytes, without .gitattributes conversions, clean filters, hooks or the user's index.
  const hashes = paths.length ? (await git([...repositoryArgs, 'hash-object', '-w', '--no-filters', '--stdin-paths'],
    paths.map(path => JSON.stringify(join(seed, path).replaceAll('\\', '/'))).join('\n') + '\n')).split(/\r?\n/).map(hash => ObjectId.parse(hash)) : [];
  if (hashes.length !== paths.length) throw new Error('Git trả về số lượng file không khớp snapshot.');
  const entries = paths.map((path, index) => `100644 ${hashes[index]}\t${path}\0`).join('');
  await git([...repositoryArgs, 'update-index', '-z', '--index-info'], entries);
  const tree = ObjectId.parse(await git([...repositoryArgs, 'write-tree']));
  const commit = ObjectId.parse(await git([...repositoryArgs, 'commit-tree', tree, '-m', 'Granted workspace snapshot']));
  await git([...repositoryArgs, 'update-ref', SNAPSHOT_REF, commit]);
  await git([...repositoryArgs, 'worktree', 'add', '--detach', '--no-checkout', worktree, commit]);
  await git(['-C', worktree, 'read-tree', commit]);
  for (const entry of await readdir(seed)) {
    signal.throwIfAborted();
    const original = join(seed, entry);
    const destination = join(worktree, entry);
    if ([relative(seed, original), relative(worktree, destination)].some(path => path.startsWith('..') || isAbsolute(path))) {
      throw new Error('Đường dẫn Git runtime không hợp lệ.');
    }
    await rename(original, destination);
  }
  return { commit };
}
