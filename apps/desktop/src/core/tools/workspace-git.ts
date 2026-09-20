import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { WorkspaceManifest } from '../../shared/workspace-tools';
import { executeWorkspaceOperation } from './workspace-files';
import { sandboxEnvironment } from './sandbox';

const ObjectId = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const GitRequest = z.object({ operation: z.literal('prepare_git'), executable: z.string().min(1).max(32768) }).strict();

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
  const environment: NodeJS.ProcessEnv = {
    ...sandboxEnvironment(directory, []),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: configuration, GIT_CONFIG_GLOBAL: configuration,
    GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'Orglet', GIT_AUTHOR_EMAIL: 'workspace@localhost',
    GIT_COMMITTER_NAME: 'Orglet', GIT_COMMITTER_EMAIL: 'workspace@localhost',
  };
  const configurationArgs = ['-c', `core.hooksPath=${templates}`, '-c', 'core.fsmonitor=false',
    '-c', 'core.autocrlf=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
    '-c', 'protocol.allow=never', '-c', 'commit.gpgsign=false'];
  const git = (args: string[], input = '') => new Promise<string>((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(request.executable, [...configurationArgs, ...args], {
      // No executable or DLL lookup starts in the untrusted snapshot.
      cwd: repository, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal,
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let limited = false;
    let launchError: Error | undefined;
    const collect = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        limited = true;
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', chunk => collect(output, chunk));
    child.stderr.on('data', chunk => collect(errors, chunk));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', error => { launchError = error; });
    child.on('close', code => {
      if (launchError) {
        reject(launchError);
      } else if (limited || code !== 0) {
        reject(new Error(`Không tạo được Git worktree riêng: ${Buffer.concat(errors).toString('utf8').slice(0, 2000)}`));
      } else {
        resolve(Buffer.concat(output).toString('utf8').trim());
      }
    });
  });
  const manifest = WorkspaceManifest.parse(await executeWorkspaceOperation(seed, { operation: 'manifest' }));
  await git(['init', '--bare', '--quiet', `--template=${templates}`, '.']);
  await mkdir(join(repository, 'info'), { recursive: true });
  await writeFile(join(repository, 'info', 'attributes'), '* -text -filter -working-tree-encoding -ident\n', { flag: 'wx' });
  const repositoryArgs = [`--git-dir=${repository}`];
  const paths = manifest.files.map(file => file.path);
  // Read exact bytes, without .gitattributes conversions, clean filters, hooks or the user's index.
  const hashes = paths.length ? (await git([...repositoryArgs, 'hash-object', '-w', '--no-filters', '--stdin-paths'],
    paths.map(path => JSON.stringify(join(seed, path).replaceAll('\\', '/'))).join('\n') + '\n')).split(/\r?\n/).map(hash => ObjectId.parse(hash)) : [];
  if (hashes.length !== paths.length) throw new Error('Git trả về số lượng file không khớp snapshot.');
  const entries = paths.map((path, index) => `100644 ${hashes[index]}\t${path}\0`).join('');
  await git([...repositoryArgs, 'update-index', '-z', '--index-info'], entries);
  const tree = ObjectId.parse(await git([...repositoryArgs, 'write-tree']));
  const commit = ObjectId.parse(await git([...repositoryArgs, 'commit-tree', tree, '-m', 'Granted workspace snapshot']));
  await git([...repositoryArgs, 'update-ref', 'refs/heads/orglet-snapshot', commit]);
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
