import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import {
  SHIM_ROOT_VARIABLE, parsePackageCommand, quoteForCmd, runInCmd, runPackageCommand, shimFiles, toolchainEnvironment, writeShims,
} from '../../apps/desktop/src/core/tools/package-scripts';

describe('reading a package-manager command (COD-269)', () => {
  it('reads the script forms of npm, pnpm and yarn', () => {
    expect(parsePackageCommand('npm', ['test']).action).toEqual({ kind: 'script', name: 'test', arguments: [], orBinary: false });
    expect(parsePackageCommand('npm', ['t']).action).toMatchObject({ kind: 'script', name: 'test' });
    expect(parsePackageCommand('npm', ['run', 'build', '--', '--watch']).action).toEqual({ kind: 'script', name: 'build', arguments: ['--watch'], orBinary: false });
    expect(parsePackageCommand('pnpm', ['test', '--watch']).action).toEqual({ kind: 'script', name: 'test', arguments: ['--watch'], orBinary: false });
    expect(parsePackageCommand('yarn', ['lint']).action).toEqual({ kind: 'script', name: 'lint', arguments: [], orBinary: true });
    expect(parsePackageCommand('npm', ['run']).action).toEqual({ kind: 'list' });
  });

  it('keeps an unknown npm --flag before -- for npm and says so, as npm does', () => {
    const request = parsePackageCommand('npm', ['test', '--watch', 'unit']);
    expect(request.action).toEqual({ kind: 'script', name: 'test', arguments: ['unit'], orBinary: false });
    expect(request.warnings[0]).toContain('npm test -- --watch');
  });

  it('reads silent, if-present and a prefix folder', () => {
    const request = parsePackageCommand('npm', ['--prefix', 'app', '-s', 'run', '--if-present', 'check']);
    expect(request).toMatchObject({ directory: 'app', silent: true, ifPresent: true, action: { kind: 'script', name: 'check' } });
  });

  it('refuses installs and other commands with the reason, never pretending', () => {
    for (const [manager, words] of [['npm', ['install']], ['npm', ['ci']], ['pnpm', ['add', 'zod']], ['yarn', []], ['pnpm', ['dlx', 'x']]] as const) {
      const action = parsePackageCommand(manager, [...words]).action;
      expect(action.kind).toBe('refused');
      expect(action.kind === 'refused' && action.message).toContain('no network');
    }
    const publish = parsePackageCommand('npm', ['whoami']).action;
    expect(publish.kind === 'refused' && publish.message).toContain('npm whoami is not available');
    expect(parsePackageCommand('pnpm', ['-r', 'test']).action.kind).toBe('refused');
  });

  it('reads npx and npm exec as a binary', () => {
    expect(parsePackageCommand('npx', ['--yes', 'vitest', 'run']).action).toEqual({ kind: 'binary', binary: 'vitest', arguments: ['run'] });
    expect(parsePackageCommand('npm', ['exec', '--', 'tsc', '--noEmit']).action).toEqual({ kind: 'binary', binary: 'tsc', arguments: ['--noEmit'] });
  });

  it('quotes only what cmd would split', () => {
    expect(quoteForCmd('--reporter=dot')).toBe('--reporter=dot');
    expect(quoteForCmd('a b')).toBe('"a b"');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('running package scripts', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-package-scripts-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  function fakeRun() {
    const calls: { commandLine: string; cwd: string; event?: string }[] = [];
    const output: string[] = [];
    const options = {
      cwd: directory,
      environment: { PATH: 'C:\\Windows\\System32', [SHIM_ROOT_VARIABLE]: directory } as NodeJS.ProcessEnv,
      write: (_stream: 'stdout' | 'stderr', text: string) => { output.push(text); },
      run: async (commandLine: string, cwd: string, environment: NodeJS.ProcessEnv) => {
        calls.push({ commandLine, cwd, event: environment.npm_lifecycle_event });
        return commandLine.includes('fail') ? 3 : 0;
      },
    };
    return { calls, output, options };
  }

  it('runs npm pre and post scripts around the one named, in the package folder, and stops at a failure', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { pretest: 'node lint.js', test: 'node --test', posttest: 'node report.js' } }));
    await mkdir(join(directory, 'src'));
    const { calls, output, options } = fakeRun();
    expect(await runPackageCommand('npm', ['test', '--', '--test-reporter=dot'], { ...options, cwd: join(directory, 'src') })).toBe(0);
    expect(calls).toEqual([
      { commandLine: 'node lint.js', cwd: directory, event: 'pretest' },
      { commandLine: 'node --test --test-reporter=dot', cwd: directory, event: 'test' },
      { commandLine: 'node report.js', cwd: directory, event: 'posttest' },
    ]);
    expect(output.join('')).toContain('> shop@1.0.0 test\n> node --test --test-reporter=dot');
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'fail now', posttest: 'node report.js' } }));
    const second = fakeRun();
    expect(await runPackageCommand('npm', ['test'], second.options)).toBe(3);
    expect(second.calls).toHaveLength(1);
  });

  it('pnpm runs only the named script', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { prebuild: 'node a.js', build: 'node b.js' } }));
    const { calls, options } = fakeRun();
    expect(await runPackageCommand('pnpm', ['build'], options)).toBe(0);
    expect(calls.map(call => call.commandLine)).toEqual(['node b.js']);
  });

  it('names a missing script and the ones there are, or passes quietly with --if-present', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { build: 'node b.js' } }));
    const { output, options } = fakeRun();
    expect(await runPackageCommand('npm', ['test'], options)).toBe(1);
    expect(output.join('')).toContain('Missing script: "test". Scripts in package.json: build');
    expect(await runPackageCommand('npm', ['run', 'lint', '--if-present'], options)).toBe(0);
  });

  it('says when there is no package.json and never looks above the working copy', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node t.js' } }));
    const inner = join(directory, 'copy');
    await mkdir(inner);
    const { output, options } = fakeRun();
    expect(await runPackageCommand('npm', ['test'], { ...options, cwd: inner, environment: { ...options.environment, [SHIM_ROOT_VARIABLE]: inner } })).toBe(1);
    expect(output.join('')).toContain('no package.json');
  });

  it('runs a binary from node_modules/.bin and refuses one that is not there', async () => {
    await writeFile(join(directory, 'package.json'), '{}');
    await mkdir(join(directory, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(directory, 'node_modules', '.bin', 'tsc.cmd'), '@echo tsc\r\n');
    const { calls, output, options } = fakeRun();
    expect(await runPackageCommand('npx', ['tsc', '--noEmit'], options)).toBe(0);
    // Quoted even without spaces: the sandbox's cmd refuses an unquoted absolute path to a .cmd.
    expect(calls[0].commandLine).toBe(`"${join(directory, 'node_modules', '.bin', 'tsc.cmd')}" --noEmit`);
    expect(await runPackageCommand('npx', ['vitest'], options)).toBe(1);
    expect(output.join('')).toContain('cannot be downloaded');
  });

  it('writes shims that call the runtime and the helper', () => {
    const files = shimFiles();
    expect(files['node.cmd']).toBe('@"%ORGLET_NODE%" %*\r\n');
    expect(files['npm.cmd']).toBe('@"%ORGLET_NODE%" "%ORGLET_HELPER%" --package-manager npm %*\r\n');
    const environment = toolchainEnvironment({ Path: 'C:\\Windows\\System32', ELECTRON_RUN_AS_NODE: '1' }, { runtime: 'C:\\o\\Orglet.exe', helper: 'C:\\o\\helper.cjs', root: 'C:\\copy', shims: 'C:\\copy\\.orglet-tmp\\orglet-bin' });
    expect(environment.PATH).toBe('C:\\copy\\.orglet-tmp\\orglet-bin;C:\\Windows\\System32');
    expect(environment.Path).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('runs a real script through cmd with the node shim first on PATH', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\', process.env.npm_lifecycle_event)"' } }));
    const shims = writeShims(join(directory, '.orglet-tmp', 'orglet-bin'));
    const environment = toolchainEnvironment({ SystemRoot: process.env.SystemRoot, PATH: join(process.env.SystemRoot!, 'System32') }, { runtime: process.execPath, helper: 'unused', root: directory, shims });
    const code = await runPackageCommand('npm', ['--silent', 'test'], { cwd: directory, environment, write: () => {}, run: runInCmd });
    expect(code).toBe(0);
    expect(await readFile(join(directory, 'ran.txt'), 'utf8')).toBe('test');
  });
});

describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('package scripts in the packaged helper and the real sandbox', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-package-sandbox-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('runs npm test and a nested npm run with the bundled Node, and refuses npm install', async () => {
    const source = join(directory, 'source');
    await mkdir(join(source, 'test'), { recursive: true });
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', scripts: {
      test: 'node --test && npm run --silent report', report: 'node -e "console.log(`report from ${process.env.npm_lifecycle_event}`)"',
    } }));
    await writeFile(join(source, 'test', 'sum.test.js'), "const test = require('node:test'); const assert = require('node:assert'); test('adds', () => assert.equal(1 + 1, 2));");
    const runtimeExecutable = resolve('out/Orglet-win32-x64/Orglet.exe');
    const sandbox = new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE ?? resolve('out/Orglet-win32-x64/resources/wxc-exec.exe'));
    const runtime = new WorkspaceFilesRuntime({ sandbox, helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      runtimeExecutable, stateDirectory: join(directory, 'state') });
    const signal = new AbortController().signal;
    const copy = await runtime.createCopy(source, signal);
    const tested = await runtime.runCommand(copy.directory, { program: 'shell', arguments: ['npm test'], timeoutMs: 60000 }, signal);
    expect(tested.exitCode, tested.stdout + tested.stderr).toBe(0);
    expect(tested.stdout).toContain('> shop@1.0.0 test');
    expect(tested.stdout).toContain('report from report');
    const installed = await runtime.runCommand(copy.directory, { program: 'shell', arguments: ['npm install left-pad'], timeoutMs: 20000 }, signal);
    expect(installed.exitCode).toBe(1);
    expect(installed.stderr).toContain('no network');
    const fromNode = await runtime.runCommand(copy.directory, { program: 'node', arguments: ['-e', "process.exit(require('child_process').spawnSync('npm test', { shell: true, stdio: 'inherit' }).status)"], timeoutMs: 60000 }, signal);
    expect(fromNode.exitCode, fromNode.stdout + fromNode.stderr).toBe(0);
  });
});
