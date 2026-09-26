import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import helperScript from './desktop-host.ps1?raw';
import type { DesktopHost, DesktopHostRequest } from '../../shared/desktop-host';

/**
 * The desktop helper process (COD-261, phase 2a): Windows PowerShell 5.1, which every Windows 10 and 11 has, running
 * `desktop-host.ps1` with .NET's System.Windows.Automation. Nothing new is installed or written to disk: a short
 * command reads the script from the first line of standard input, and requests and answers follow as JSON lines.
 *
 * It starts the first time a step needs it, at below-normal priority so it never competes with the person's own work,
 * with only the system variables PowerShell needs (no keys, no tokens), and stops after a minute with nothing to do.
 */

/** How long the helper stays up after its last answer. */
export const DESKTOP_HELPER_IDLE_MS = 60_000;
/** How long starting it may take: compiling the small C# part takes one or two seconds. */
const START_TIMEOUT_MS = 30_000;
/** How long one request may take before the core gives up on it; the helper has its own shorter limits. */
const REQUEST_TIMEOUT_MS = 40_000;

const BOOTSTRAP = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))',
  '& ([scriptblock]::Create($source))',
].join('; ');

const Answer = z.object({ id: z.string().nullable(), ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(4000).optional() });

/** The helper's own short error codes, in words the worker and the person read. */
const HELPER_ERRORS: Record<string, string> = {
  app_not_answering: 'Ứng dụng không phản hồi. Nó có thể đang bận hoặc đang mở một hộp thoại.',
  element_gone: 'Phần tử này không còn trong cửa sổ.',
};

export function powershellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export class DesktopHelperProcess implements DesktopHost {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<ChildProcessWithoutNullStreams>;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private idleTimer?: NodeJS.Timeout;

  constructor(private idleMs = DESKTOP_HELPER_IDLE_MS, private executable = powershellPath()) {}

  get running() {
    return this.child !== undefined;
  }

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child) return Promise.resolve(this.child);
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const environment: Record<string, string> = {};
      for (const name of ['SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'PATH', 'PSModulePath', 'COMPUTERNAME', 'USERNAME']) {
        const value = process.env[name];
        if (value !== undefined) environment[name] = value;
      }
      const encoded = Buffer.from(BOOTSTRAP, 'utf16le').toString('base64');
      const child = spawn(this.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: environment,
      });
      if (child.pid) {
        try {
          setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        } catch {
          // Priority is a courtesy to the person's own work; the helper still works at normal priority.
        }
      }
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Không khởi động được trình hỗ trợ ứng dụng của Orglet.'));
      }, START_TIMEOUT_MS);
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Không chạy được Windows PowerShell trên máy này.'));
      });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if ((message as { ready?: boolean }).ready) {
          clearTimeout(timer);
          this.child = child;
          resolve(child);
          return;
        }
        const answer = Answer.safeParse(message);
        if (!answer.success || !answer.data.id) return;
        const waiting = this.pending.get(answer.data.id);
        if (!waiting) return;
        this.pending.delete(answer.data.id);
        if (answer.data.ok) waiting.resolve(answer.data.value);
        else waiting.reject(new Error(HELPER_ERRORS[answer.data.error ?? ''] ?? `Trình hỗ trợ ứng dụng gặp lỗi: ${(answer.data.error ?? '').slice(0, 300)}`));
        this.scheduleIdle();
      });
      child.on('exit', () => {
        clearTimeout(timer);
        if (this.child === child) this.child = undefined;
        this.starting = undefined;
        for (const waiting of this.pending.values()) waiting.reject(new Error('Trình hỗ trợ ứng dụng đã dừng. Thử lại bước này.'));
        this.pending.clear();
        reject(new Error(stderr.includes('Exception') ? 'Trình hỗ trợ ứng dụng không khởi động được trên máy này.' : 'Không khởi động được trình hỗ trợ ứng dụng của Orglet.'));
      });
      child.stdin.write(`${Buffer.from(helperScript, 'utf8').toString('base64')}\n`);
    });
    this.starting.catch(() => { this.starting = undefined; });
    return this.starting;
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
    this.idleTimer.unref();
  }

  async request(request: DesktopHostRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    clearTimeout(this.idleTimer);
    const child = await this.start();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(new Error(HELPER_ERRORS.app_not_answering))), REQUEST_TIMEOUT_MS);
      const onAbort = () => finish(() => reject(signal.reason instanceof Error ? signal.reason : new Error('Đã dừng bước trên ứng dụng.')));
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        // An answer that arrives after a stop is dropped; the step's journal row says what the core knows.
        this.pending.delete(requestId);
        this.scheduleIdle();
        settle();
      };
      this.pending.set(requestId, { resolve: value => finish(() => resolve(value)), reject: error => finish(() => reject(error)) });
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdin.write(`${JSON.stringify({ id: requestId, ...request })}\n`);
    });
  }

  /** Stops the helper; the next step starts a new one. */
  stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined;
    this.starting = undefined;
    if (!child) return;
    child.stdin.end();
    child.kill();
  }
}
