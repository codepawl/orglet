import { utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * Main's handle on the browser host process (COD-261). The host starts the first time something needs it and is
 * stopped when the app quits. It inherits no secrets: only the system variables a browser needs to start. The core's
 * requests pass through here unchanged, and a cancel follows its request by id.
 */
export class BrowserHostProcess {
  private child?: Electron.UtilityProcess;
  private starting?: Promise<Electron.UtilityProcess>;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private profilesRoot: string) {}

  get running() {
    return this.child !== undefined;
  }

  private start(): Promise<Electron.UtilityProcess> {
    if (this.child) return Promise.resolve(this.child);
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const environment: Record<string, string> = {};
      for (const name of ['SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'LANG']) {
        const value = process.env[name];
        if (value !== undefined) environment[name] = value;
      }
      const child = utilityProcess.fork(join(__dirname, 'browser-host.js'), [this.profilesRoot], { serviceName: 'Orglet Browser', stdio: 'pipe', env: environment });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Trình duyệt của Orglet không khởi động được.')); }, 15_000);
      child.on('message', message => {
        if (message?.ready) {
          clearTimeout(timer);
          this.child = child;
          resolve(child);
          return;
        }
        const waiting = typeof message?.id === 'string' ? this.pending.get(message.id) : undefined;
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.ok) waiting.resolve(message.value);
        else waiting.reject(new Error(typeof message.error === 'string' ? message.error : 'Trình duyệt gặp lỗi.'));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        this.child = undefined;
        this.starting = undefined;
        for (const waiting of this.pending.values()) waiting.reject(new Error('Trình duyệt của Orglet đã dừng. Thử lại bước này.'));
        this.pending.clear();
        reject(new Error('Trình duyệt của Orglet không khởi động được.'));
      });
    });
    this.starting.catch(() => { this.starting = undefined; });
    return this.starting;
  }

  /** One request; `id` lets a later `cancel` reach it. */
  async request(request: unknown, id: string = randomUUID()): Promise<unknown> {
    const child = await this.start();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.postMessage({ id, request });
    });
  }

  cancel(id: string) {
    this.child?.postMessage({ id, cancel: true });
  }

  /** A request that only makes sense when the host is already running, such as which profiles are open. */
  async requestIfRunning(request: unknown): Promise<unknown> {
    if (!this.child) return undefined;
    return this.request(request);
  }

  /** Closes the browser windows, then the process; a host that does not answer in two seconds is stopped anyway. */
  async stop() {
    const child = this.child;
    if (!child) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 2_000);
      child.on('message', message => { if (message?.shutdown) { clearTimeout(timer); resolve(); } });
      child.postMessage({ shutdown: true });
    });
    child.kill();
  }
}
