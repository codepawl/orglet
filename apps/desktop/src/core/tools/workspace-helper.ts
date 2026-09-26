import { readFile } from 'node:fs/promises';
import { executeWorkspaceOperation } from './workspace-files';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { StartWorkspaceProcess } from '../../shared/workspace-processes';
import { PACKAGE_MANAGER_FLAG, isPackageManager, runInCmd, runPackageCommand, toolchainEnvironment, writeShims } from './package-scripts';
import { DEPENDENCY_HOOKS_FILE, parseDependencyLinks } from './dependency-links';

async function command(raw: unknown, dependencies: unknown) {
  const input = StartWorkspaceProcess.parse(raw);
  const helper = resolve(process.argv[1]);
  const links = parseDependencyLinks(JSON.stringify(dependencies ?? []));
  // node, npm, pnpm, yarn and npx resolve to shims over the bundled Node, for the command and anything it starts (COD-269).
  const env = toolchainEnvironment(process.env, {
    runtime: process.execPath, helper, root: process.cwd(), shims: writeShims(join(tmpdir(), 'orglet-bin')),
    dependencies: { hooks: join(dirname(helper), DEPENDENCY_HOOKS_FILE), links },
  });
  const child = input.program === 'node'
    ? spawn(process.execPath, input.arguments, { windowsHide: true, stdio: 'inherit', env })
    : spawn(input.arguments[0], { shell: join(process.env.SystemRoot!, 'System32', 'cmd.exe'), windowsHide: true, stdio: 'inherit', env });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { process.exitCode = code ?? 1; resolve(); });
  });
}

async function packageManager(manager: string | undefined, words: string[]) {
  if (!isPackageManager(manager)) throw new Error('Unknown package manager');
  process.exitCode = await runPackageCommand(manager, words, {
    cwd: process.cwd(), environment: process.env,
    write: (stream, text) => { process[stream].write(text); },
    run: runInCmd,
  });
}

async function main() {
  if (process.argv[2] === PACKAGE_MANAGER_FLAG) {
    await packageManager(process.argv[3], process.argv.slice(4)).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
      process.exitCode = 1;
    });
    return;
  }
  try {
    const input = await readFile(process.argv[2], 'utf8');
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Workspace request too large');
    const request = JSON.parse(input);
    if (request.operation === 'command') {
      await command(request.command, request.dependencies);
      return;
    }
    const value = await executeWorkspaceOperation(process.cwd(), request);
    process.stdout.write(JSON.stringify({ ok: true, value }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Workspace operation failed' }));
    process.exitCode = 1;
  }
}
void main();
