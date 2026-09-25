import { createHash } from 'node:crypto';
import { StartWorkspaceProcess, WorkspaceProcess, describeCommand, loopbackBlockedHint } from '../../shared/workspace-processes';
import { BlockedHandIn, commandLine, type BlockingCommand, type HeldAnswer } from '../../shared/blocked-hand-in';
import type { RunErrorCode } from '../../shared/contracts';
import { Store, id } from '../storage/database';
import { ToolCalls, UnresolvedAttemptError } from '../storage/tool-calls';
import type { WorkspaceFilesRuntime } from './workspace-files-runtime';
import type { DependencyLink } from './workspace-dependencies';

type ActiveProcess = { runId: string; controller: AbortController; done: Promise<void> };

export const HAND_IN_BLOCKED_MESSAGE = 'Có lệnh chưa hoàn tất thành công. Xem đầu ra và kiểm tra lại trước khi tích hợp.';

/**
 * The failed-command rule refused a hand-in (COD-189). It carries the commands that blocked it and, once the runtime
 * and runner have them, the copy's fingerprint and the answer the orglet handed in, so the failed run keeps all three
 * (COD-270). The message is the one the rule always had.
 */
export class HandInBlockedError extends Error {
  readonly code: RunErrorCode = 'hand_in_blocked';
  copyFingerprint?: string;
  answer?: HeldAnswer;
  constructor(readonly commands: BlockingCommand[]) {
    super(HAND_IN_BLOCKED_MESSAGE);
  }

  /** What the failed run keeps. It is written from the runner's failure path, so an answer it cannot hold is dropped, never thrown. */
  record(): BlockedHandIn {
    const reason = { commands: this.commands, ...(this.copyFingerprint ? { copyFingerprint: this.copyFingerprint } : {}) };
    const withAnswer = BlockedHandIn.safeParse({ ...reason, ...(this.answer ? { answer: this.answer } : {}) });
    return withAnswer.success ? withAnswer.data : BlockedHandIn.parse(reason);
  }
}

/** The limitation an answer carries when the person applied its changes past a failed command (COD-270). */
export function acceptedFailureLine(process: Pick<WorkspaceProcess, 'command' | 'state' | 'exitCode'>): string {
  const command = commandLine(process.command);
  if (process.state === 'exited') return `Người dùng đã áp dụng thay đổi dù lệnh ${command} thất bại (mã thoát ${process.exitCode}).`;
  return `Người dùng đã áp dụng thay đổi dù lệnh ${command} không hoàn tất (${process.state}).`;
}

/** A saved start result is a process handle, not proof that the command finished. */
export class WorkspaceProcesses {
  private active = new Map<string, ActiveProcess>();
  constructor(private store: Store, private files: Pick<WorkspaceFilesRuntime, 'runCommand'>,
    private notify: () => void = () => {}) {}

  private save(process: WorkspaceProcess) {
    this.store.put('workspace_processes', WorkspaceProcess.parse(process), { column: 'run_id', value: process.runId });
    this.notify();
  }

  private get(runId: string, processId: string): WorkspaceProcess {
    const process = WorkspaceProcess.parse(this.store.get('workspace_processes', processId));
    if (process.runId !== runId) throw new Error('Tiến trình không thuộc lần chạy này.');
    return process;
  }

  private records(taskId: string): WorkspaceProcess[] {
    return this.store.db.prepare(`SELECT processes.data FROM workspace_processes processes
      JOIN runs ON runs.id=processes.run_id WHERE runs.task_id=? ORDER BY processes.rowid`).all(taskId)
      .map(row => WorkspaceProcess.parse(JSON.parse(String(row.data))));
  }

  assertKnown(taskId: string) {
    if (this.records(taskId).some(process => process.state === 'uncertain' && !this.store.setting(`workspace-retired:${process.runId}`, null))) {
      throw new UnresolvedAttemptError('Tiến trình bị gián đoạn chưa rõ kết quả; cần kiểm tra bản làm việc.');
    }
  }

  assertIdle(runId: string) {
    const running = this.store.db.prepare(`SELECT id FROM workspace_processes WHERE run_id=?
      AND json_extract(data,'$.state')='running' LIMIT 1`).get(runId);
    if (running) throw new Error('Tiến trình còn chạy; chờ hoặc hủy trước khi thao tác trên bản làm việc.');
  }

  /**
   * Judges the code the run hands in (COD-189). The latest run of each distinct command that started after the
   * copy's last file change must have exited 0, or hand-in is blocked. A failure the copy has since moved past
   * does not block; it comes back as a report limitation so nothing is hidden. With no file change at all, or on
   * a record from before this rule, every command counts.
   *
   * `accepted` holds the processes the person chose to apply past (COD-270): each becomes a limitation line instead of
   * a block. Only those exact process records are let through; any other failure still blocks.
   */
  assertSuccessful(runId: string, copyEdits: number, accepted: ReadonlySet<string> = new Set()): string[] {
    this.assertIdle(runId);
    // Rows are inserted once at start and updated in place, so rowid is start order.
    const records = this.store.db.prepare('SELECT data FROM workspace_processes WHERE run_id=? ORDER BY rowid').all(runId);
    const latest = new Map<string, WorkspaceProcess>();
    for (const row of records) {
      const process = WorkspaceProcess.parse(JSON.parse(String(row.data)));
      const key = createHash('sha256').update(JSON.stringify([process.command.program, process.command.arguments])).digest('hex');
      latest.set(key, process);
    }
    const superseded: string[] = [];
    const acceptedLines: string[] = [];
    const blocking: BlockingCommand[] = [];
    for (const process of latest.values()) {
      if (process.state === 'exited' && process.exitCode === 0) continue;
      const startedAfterLastEdit = copyEdits === 0 || process.copyEditsAtStart === undefined || process.copyEditsAtStart >= copyEdits;
      if (startedAfterLastEdit && accepted.has(process.id)) {
        acceptedLines.push(acceptedFailureLine(process));
        continue;
      }
      if (startedAfterLastEdit) {
        blocking.push({ processId: process.id, program: process.command.program, arguments: process.command.arguments,
          state: process.state, exitCode: process.exitCode });
        continue;
      }
      const command = describeCommand(process.command, 300);
      superseded.push(process.state === 'exited'
        ? `Lệnh chạy trước lần sửa tệp cuối đã thất bại và chưa được chạy lại: ${command} (mã thoát ${process.exitCode}).`
        : `Lệnh chạy trước lần sửa tệp cuối không hoàn tất và chưa được chạy lại: ${command} (${process.state}).`);
    }
    if (blocking.length) throw new HandInBlockedError(blocking);
    return [...superseded, ...acceptedLines];
  }

  async start(options: { runId: string; callId: string; directory: string; command: unknown; copyEdits: number;
    signal: AbortSignal; authorize: () => void; dependencies?: DependencyLink[] }): Promise<{ processId: string }> {
    const command = StartWorkspaceProcess.parse(options.command);
    return new ToolCalls(this.store).execute({
      runId: options.runId, callId: options.callId, name: 'workspace_start_process', arguments: command, replay: 'never',
      authorize: options.authorize,
      perform: () => {
        this.assertIdle(options.runId);
        options.signal.throwIfAborted();
        const process: WorkspaceProcess = { id: id(), runId: options.runId, command, state: 'running',
          exitCode: null, stdout: '', stderr: '', copyEditsAtStart: options.copyEdits };
        this.save(process);
        const controller = new AbortController();
        const lifetime = AbortSignal.any([options.signal, controller.signal]);
        let lastSaved = 0;
        const done = Promise.resolve().then(() => {
          options.authorize();
          lifetime.throwIfAborted();
          return this.files.runCommand(options.directory, command, lifetime, output => {
            Object.assign(process, output);
            if (Date.now() - lastSaved >= 250) { lastSaved = Date.now(); this.save(process); }
          }, options.dependencies);
        }).then(result => {
          this.save({ id: process.id, runId: process.runId, command, state: result.termination,
            exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, copyEditsAtStart: options.copyEdits });
          this.store.event(options.runId, `Tiến trình đã dừng: ${result.termination}, mã thoát ${result.exitCode ?? 'unknown'}`);
        }).catch(error => {
          const uncertain: WorkspaceProcess = { id: process.id, runId: process.runId, command,
            state: 'uncertain', exitCode: null, stdout: process.stdout, stderr: process.stderr, copyEditsAtStart: options.copyEdits,
            error: (error instanceof Error ? error.message : 'Không nhận được kết quả tiến trình.').slice(0, 4000) };
          // If storage itself failed, the durable running record becomes uncertain on restart.
          try { this.save(uncertain); } catch { /* Keep the start record; never report a completed command. */ }
        }).finally(() => { this.active.delete(process.id); });
        this.active.set(process.id, { runId: options.runId, controller, done });
        return { processId: process.id };
      },
    });
  }

  async status(runId: string, processId: string, waitMs: number, signal: AbortSignal, authorize: () => void) {
    authorize();
    this.get(runId, processId);
    const active = this.active.get(processId);
    if (active && waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = setTimeout(finish, waitMs);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        void active.done.then(finish);
      });
    }
    signal.throwIfAborted();
    authorize();
    const process = this.get(runId, processId);
    // The hint rides on status and output alike, so a model that reads only one of them still sees why it failed.
    return { processId, state: process.state, exitCode: process.exitCode,
      stdoutBytes: Buffer.byteLength(process.stdout), stderrBytes: Buffer.byteLength(process.stderr), error: process.error ?? null,
      hint: loopbackBlockedHint(process) };
  }

  output(runId: string, processId: string, stream: 'stdout' | 'stderr', offset: number) {
    const process = this.get(runId, processId);
    const characters = Array.from(process[stream]);
    const end = Math.min(characters.length, offset + 16000);
    return { processId, stream, state: process.state, content: characters.slice(offset, end).join(''),
      nextOffset: end < characters.length ? end : null, hint: loopbackBlockedHint(process) };
  }

  async cancel(runId: string, processId: string) {
    this.get(runId, processId);
    const active = this.active.get(processId);
    if (active) { active.controller.abort(); await active.done; }
    const process = this.get(runId, processId);
    return { processId, state: process.state, exitCode: process.exitCode };
  }

  async stopRun(runId: string) {
    const running = [...this.active.values()].filter(process => process.runId === runId);
    for (const process of running) process.controller.abort();
    await Promise.all(running.map(process => process.done));
  }
}
