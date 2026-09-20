import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, win32 } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const executeFile = promisify(execFile);
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const Probe = z.object({ tier: z.literal('base-container') });

export type SandboxRequest = {
  directory: string;
  runtimeDirectories: string[];
  readOnlyPaths?: string[];
  commandLine: string;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput?: (output: { stdout: string; stderr: string }) => void;
};
export type SandboxResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  termination: 'exited' | 'cancelled' | 'timeout' | 'output_limit';
};

/** Neither the executor nor its child inherits provider keys, user PATH, shell startup options or profile paths. */
export function sandboxEnvironment(directory: string, runtimeDirectories: string[]): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('Không xác định được runtime Windows an toàn.');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    SystemDrive: systemRoot.slice(0, 2),
    ComSpec: win32.join(systemRoot, 'System32', 'cmd.exe'),
    PATH: [...runtimeDirectories, win32.join(systemRoot, 'System32')].join(';'),
    LOCALAPPDATA: directory,
    APPDATA: directory,
    USERPROFILE: directory,
    HOME: directory,
    TEMP: directory,
    TMP: directory,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main',
  };
}

export function sandboxConfiguration(request: SandboxRequest, environment: NodeJS.ProcessEnv) {
  return {
    version: '0.8.0-alpha',
    containerId: randomUUID(),
    containment: 'process',
    lifecycle: { destroyOnExit: true, preservePolicy: false },
    process: {
      commandLine: request.commandLine,
      cwd: request.directory,
      timeout: request.timeoutMs,
      env: Object.entries(environment).map(([key, value]) => `${key}=${value}`),
    },
    filesystem: { readwritePaths: [request.directory], readonlyPaths: [...request.runtimeDirectories, ...(request.readOnlyPaths ?? [])], deniedPaths: [] },
    fallback: { allowDaclMutation: false },
    // Network omitted in schema 0.8 means deny egress, ingress and host loopback.
    ui: { disable: false, clipboard: 'none', injection: false },
    processContainer: {
      leastPrivilege: false, capabilities: [],
      ui: { isolation: 'container', desktopSystemControl: false, systemSettings: 'none', ime: false },
    },
  };
}

export class WindowsSandbox {
  constructor(readonly executable: string) {}

  async assertSupported(directory: string): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Chạy lệnh cô lập hiện cần Windows x64 có BaseContainer.');
    }
    const environment = sandboxEnvironment(directory, []);
    try {
      const result = await executeFile(this.executable, ['--probe'], {
        env: environment, windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024,
      });
      Probe.parse(JSON.parse(result.stdout));
    } catch {
      throw new Error('Không xác minh được sandbox Windows. Chưa cho phép chạy lệnh.');
    }
  }

  async run(request: SandboxRequest): Promise<SandboxResult> {
    request.signal.throwIfAborted();
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Chạy lệnh cô lập hiện cần Windows x64 có BaseContainer.');
    }
    if (!request.commandLine || request.commandLine.length > 12000 || !Number.isInteger(request.timeoutMs)
      || request.timeoutMs < 1 || request.timeoutMs > MAX_TIMEOUT_MS) throw new Error('Lệnh hoặc giới hạn thực thi không hợp lệ.');
    const directory = await realpath(request.directory);
    const runtimeDirectories = await Promise.all(request.runtimeDirectories.map(path => realpath(path)));
    // Trusted callers choose runtime roots. Never infer filesystem grants from the command or environment.
    if (!isAbsolute(directory) || runtimeDirectories.some(path => !isAbsolute(path))) throw new Error('Workspace không hợp lệ.');
    const temporaryDirectory = join(directory, '.orglet-tmp');
    await mkdir(temporaryDirectory, { recursive: true });
    const actualTemporaryDirectory = await realpath(temporaryDirectory);
    const temporaryRelative = relative(directory, actualTemporaryDirectory);
    if (temporaryRelative.startsWith('..') || isAbsolute(temporaryRelative)) throw new Error('Workspace không hợp lệ.');
    await this.assertSupported(actualTemporaryDirectory);
    request.signal.throwIfAborted();
    const normalized = { ...request, directory, runtimeDirectories };
    const environment = sandboxEnvironment(actualTemporaryDirectory, runtimeDirectories);
    const configuration = sandboxConfiguration(normalized, environment);
    const encoded = Buffer.from(JSON.stringify(configuration)).toString('base64');
    if (encoded.length > 28000) throw new Error('Lệnh hoặc giới hạn thực thi không hợp lệ.');
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['--config-base64', encoded], {
        cwd: dirname(this.executable), env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let termination: SandboxResult['termination'] = 'exited';
      let bytes = 0;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputError: unknown;
      const stop = (reason: SandboxResult['termination']) => {
        if (termination !== 'exited') return;
        termination = reason;
        // BaseContainer's job owns descendants; closing the executor kills that job.
        child.kill();
      };
      const collect = (destination: Buffer[], chunk: Buffer) => {
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - bytes);
        if (remaining > 0) destination.push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        try { request.onOutput?.({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }); }
        catch (error) { outputError = error; stop('cancelled'); }
        if (bytes > MAX_OUTPUT_BYTES) stop('output_limit');
      };
      child.stdout.on('data', chunk => collect(stdout, chunk));
      child.stderr.on('data', chunk => collect(stderr, chunk));
      const abort = () => stop('cancelled');
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      const timer = setTimeout(() => stop('timeout'), request.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
      };
      child.on('error', error => {
        cleanup();
        reject(error);
      });
      child.on('close', exitCode => {
        cleanup();
        if (outputError) { reject(outputError); return; }
        resolve({ exitCode, termination, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
      });
    });
  }
}
