import { createHash } from 'node:crypto';
import { ReadRecoveryOutput, RetireWorkspaceAttempt, WorkspaceRecoveryView, type RecoveryOutput } from '../../shared/workspace-recovery';
import { WorkspaceProcess, describeCommand } from '../../shared/workspace-processes';
import type { Run, Task } from '../../shared/contracts';
import { Store, now } from './database';

/** Local inspection metadata only: never expose working directories, backups or cached tool output. */
export class WorkspaceRecovery {
  constructor(private store: Store) {}

  output(raw: unknown): RecoveryOutput {
    const input = ReadRecoveryOutput.parse(raw);
    const process = WorkspaceProcess.parse(this.store.get('workspace_processes', input.processId));
    const run = this.store.get<Run>('runs', process.runId);
    if (run.taskId !== input.taskId) throw new Error('Tiến trình không thuộc lần chạy này.');
    const characters = [...process[input.stream]];
    const end = Math.min(input.offset + 16000, characters.length);
    return { content: characters.slice(input.offset, end).join(''), nextOffset: end < characters.length ? end : null, state: process.state };
  }

  private token(runId: string): string {
    const state = [this.store.get<Run>('runs', runId),
      this.store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').all(runId),
      this.store.db.prepare('SELECT data FROM workspace_processes WHERE run_id=? ORDER BY id').all(runId),
      this.store.db.prepare('SELECT * FROM tool_calls WHERE run_id=? ORDER BY call_id').all(runId)];
    return createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }

  retire(raw: unknown, isActive: (taskId: string) => boolean): void {
    const input = RetireWorkspaceAttempt.parse(raw);
    this.store.transaction(() => {
      const run = this.store.get<Run>('runs', input.runId);
      const task = this.store.get<Task>('tasks', input.taskId);
      if (run.taskId !== task.id || isActive(task.id) || ['running', 'queued', 'pausing'].includes(task.status)
        || ['running', 'queued', 'pausing'].includes(run.status)) throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
      if (this.token(run.id) !== input.reviewToken) throw new Error('Trạng thái đã thay đổi. Kiểm tra lại trước khi xử lý.');
      if (this.store.setting(`workspace-retired:${run.id}`, null)) return;
      const processes = this.store.db.prepare('SELECT data FROM workspace_processes WHERE run_id=?').all(run.id)
        .map(row => WorkspaceProcess.parse(JSON.parse(String(row.data))));
      if (run.status === 'completed' || processes.some(process => process.state === 'running')) {
        throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
      }
      this.store.setSetting(`workspace-retired:${run.id}`, { taskId: task.id, runId: run.id, reviewedAt: now(), reviewToken: input.reviewToken });
      this.store.event(run.id, 'Đã giữ file hiện tại và kết thúc bản làm việc cũ. Lần chạy này không được coi là thành công.');
    });
  }

  assertAvailable(runId: string): void {
    if (this.store.setting(`workspace-retired:${runId}`, null)) throw new Error('Bản làm việc này đã kết thúc. Tạo lần chạy mới để tiếp tục.');
  }

  view(taskId: string): WorkspaceRecoveryView {
    this.store.get<Task>('tasks', taskId);
    const copies = this.store.db.prepare(`SELECT copies.data FROM workspace_copies copies JOIN runs ON runs.id=copies.run_id
      WHERE runs.task_id=? ORDER BY copies.rowid DESC LIMIT 101`).all(taskId);
    const processes = this.store.db.prepare(`SELECT processes.data FROM workspace_processes processes JOIN runs ON runs.id=processes.run_id
      WHERE runs.task_id=? ORDER BY processes.rowid DESC LIMIT 101`).all(taskId);
    const calls = this.store.db.prepare(`SELECT calls.run_id AS runId,calls.call_id AS callId,calls.replay,
      calls.name AS tool,calls.summary,calls.started_at AS at FROM tool_calls calls
      JOIN runs ON runs.id=calls.run_id WHERE runs.task_id=? AND calls.state='uncertain' ORDER BY calls.rowid DESC LIMIT 101`).all(taskId);
    const runIds = new Set([...copies.map(row => JSON.parse(String(row.data)).runId as string),
      ...processes.map(row => WorkspaceProcess.parse(JSON.parse(String(row.data))).runId), ...calls.map(row => String(row.runId))]);
    return WorkspaceRecoveryView.parse({ taskId,
      attempts: [...runIds].map(runId => ({ runId, reviewToken: this.token(runId), retired: !!this.store.setting(`workspace-retired:${runId}`, null) })),
      copies: copies.slice(0, 100).map(row => {
        const copy = JSON.parse(String(row.data));
        return { runId: copy.runId, state: copy.state, kind: copy.kind ?? 'copy',
          changes: copy.changes.slice(0, 100), changeCount: copy.changes.length };
      }),
      processes: processes.slice(0, 100).map(row => {
        const process = WorkspaceProcess.parse(JSON.parse(String(row.data)));
        return { id: process.id, runId: process.runId, state: process.state, exitCode: process.exitCode,
          command: describeCommand(process.command) };
      }),
      uncertainCalls: calls.slice(0, 100), truncated: [copies, processes, calls].some(rows => rows.length > 100),
    });
  }
}
