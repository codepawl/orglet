import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * A process Orglet started, named by its id and the moment the OS says it was created. An id alone is not enough:
 * once a process exits, Windows can hand the same id to an unrelated program, and killing that id would kill it.
 */
export type ProcessIdentity = { pid: number; startedAt: string };

/** Reads when the OS created each live process among `pids`; a process that is gone or unreadable is absent. */
export type StartTimeLookup = (pids: readonly number[]) => Promise<Map<number, string>>;

/** App quit waits this long at most; an answer that comes later confirms nothing, so nothing is killed. */
export const QUIT_LOOKUP_TIMEOUT_MS = 1500;
/**
 * The core's lookup runs beside a server's start, never in front of it, so it can wait for PowerShell to start on a
 * cold machine (seconds on a fresh CI runner) instead of giving up.
 */
const CORE_LOOKUP_TIMEOUT_MS = 30_000;
/** The reused lookup process exits after this long without a question. */
const HELPER_IDLE_MS = 60_000;

const identifiers = (pids: readonly number[]) => pids.map(pid => String(Math.trunc(pid))).filter(pid => /^\d+$/.test(pid));

/**
 * The creation time of each id through .NET directly, in 100 ns ticks (UTC): exact enough that a reused id never
 * matches, and cheaper than `Get-Process`, which loads a module first. An id that is gone or whose start time cannot
 * be read (another user's process) prints "<id> -".
 */
const WINDOWS_LOOKUP = 'foreach ($id in $ids) { try { $process = [System.Diagnostics.Process]::GetProcessById([int]$id); [Console]::Out.WriteLine("$id $($process.StartTime.ToUniversalTime().Ticks)") } catch { [Console]::Out.WriteLine("$id -") } }';

function windowsCommand(pids: readonly number[]) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ids = @(${identifiers(pids).join(',')}); ${WINDOWS_LOOKUP}`];
}

function posixCommand(pids: readonly number[]) {
  return ['-o', 'pid=,lstart=', '-p', identifiers(pids).join(',')];
}

/** Reads "pid time" lines into a map; lines without both parts, or with "-" for the time, are dropped. */
export function parseStartTimes(output: string): Map<number, string> {
  const times = new Map<number, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match && match[2] !== '-') times.set(Number(match[1]), match[2]);
  }
  return times;
}

/** The lookup as one short-lived command, synchronous and bounded, for app quit and for a core that died. */
export function readStartTimesNow(pids: readonly number[], platform: NodeJS.Platform = process.platform, timeoutMs = QUIT_LOOKUP_TIMEOUT_MS): Map<number, string> {
  if (!identifiers(pids).length) return new Map();
  const [file, args] = platform === 'win32' ? ['powershell.exe', windowsCommand(pids)] : ['ps', posixCommand(pids)];
  try {
    return parseStartTimes(execFileSync(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    // Timed out or failed: nothing is confirmed, so nothing is killed.
    return new Map();
  }
}

/**
 * Which reported processes are still the ones Orglet started: the id is alive and its creation time is the one
 * recorded when the server started. A process that is gone, was reused, or could not be read is left alone.
 */
export function stillOurs(reported: readonly ProcessIdentity[], live: ReadonlyMap<number, string>): number[] {
  return reported.filter(entry => live.get(entry.pid) === entry.startedAt).map(entry => entry.pid);
}

type Question = { pids: string[]; resolve: (times: Map<number, string>) => void };

/**
 * The core's lookup (COD-241). On Windows one PowerShell process is started on the first question and kept for the
 * next ones, reading ids from stdin, so its slow start is paid once and off any critical path; it exits after a
 * minute without a question and on shutdown. Elsewhere each question is one `ps` call, which is already cheap.
 * Questions are answered in order; a helper that dies or stalls answers "nothing known" and is started again later.
 */
export class StartTimeReader {
  private helper?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private current?: Question & { lines: string[]; timer: NodeJS.Timeout };
  private queue: Question[] = [];
  private idleTimer?: NodeJS.Timeout;

  constructor(private platform: NodeJS.Platform = process.platform, private timeoutMs = CORE_LOOKUP_TIMEOUT_MS) {}

  /** The running helper's process id, for tests that check it is reused. */
  get helperPid() { return this.helper?.pid; }

  read: StartTimeLookup = pids => {
    const wanted = identifiers(pids);
    if (!wanted.length) return Promise.resolve(new Map());
    if (this.platform !== 'win32') return this.readWithPs(pids);
    return new Promise(resolve => {
      this.queue.push({ pids: wanted, resolve });
      this.next();
    });
  };

  close() {
    clearTimeout(this.idleTimer);
    const helper = this.helper;
    this.helper = undefined;
    this.finishCurrent(new Map());
    for (const question of this.queue.splice(0)) question.resolve(new Map());
    helper?.kill();
  }

  private readWithPs(pids: readonly number[]): Promise<Map<number, string>> {
    return new Promise(resolve => {
      execFile('ps', posixCommand(pids), { timeout: this.timeoutMs, encoding: 'utf8' }, (_error, stdout) => resolve(parseStartTimes(stdout ?? '')));
    });
  }

  private next() {
    if (this.current || !this.queue.length) return;
    clearTimeout(this.idleTimer);
    const helper = this.startHelper();
    const question = this.queue.shift()!;
    const timer = setTimeout(() => {
      // A helper that stalls is replaced on the next question.
      this.helper?.kill();
      this.helper = undefined;
      this.finishCurrent(new Map());
    }, this.timeoutMs);
    timer.unref();
    this.current = { ...question, lines: [], timer };
    helper.stdin.write(`${question.pids.join(',')}\n`);
  }

  private startHelper(): ChildProcessWithoutNullStreams {
    if (this.helper) return this.helper;
    const script = `while ($null -ne ($line = [Console]::In.ReadLine())) { $ids = $line.Split(','); ${WINDOWS_LOOKUP}; [Console]::Out.WriteLine('.'); [Console]::Out.Flush() }`;
    const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }) as unknown as ChildProcessWithoutNullStreams;
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (chunk: string) => this.receive(chunk));
    helper.stdin.on('error', () => undefined);
    helper.on('error', () => this.lost(helper));
    helper.on('exit', () => this.lost(helper));
    // The helper never keeps the core alive on its own.
    helper.unref();
    this.helper = helper;
    this.buffer = '';
    return helper;
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '.') this.finishCurrent(parseStartTimes(this.current?.lines.join('\n') ?? ''));
      else this.current?.lines.push(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private finishCurrent(times: Map<number, string>) {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    clearTimeout(current.timer);
    current.resolve(times);
    if (this.queue.length) this.next();
    else this.scheduleIdleExit();
  }

  private scheduleIdleExit() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), HELPER_IDLE_MS);
    this.idleTimer.unref();
  }

  private lost(helper: ChildProcessWithoutNullStreams) {
    if (this.helper !== helper) return;
    this.helper = undefined;
    this.finishCurrent(new Map());
  }
}
