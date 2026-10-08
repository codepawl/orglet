import { createHash } from 'node:crypto';
import { ChangedFilesRecord, ReadRecoveryOutput, RetireWorkspaceAttempt, WorkspaceRecoveryView, changeOutcomeOf, type RecoveryOutput } from '../../shared/workspace-recovery';
import { WorkspaceProcess, describeCommand } from '../../shared/workspace-processes';
import { countsOf, type WorkspaceDiffSummary } from '../../shared/workspace-diff';
import type { Run, Task } from '../../shared/contracts';
import { Store, now } from './database';

/**
 * Where a restore keeps a run's files line when its working copy is not on this computer (COD-299), in the settings
 * table beside `workspace-retired:`. Deleting the chat deletes it with the run's other workspace rows.
 */
export function restoredChangesKey(runId: string): string {
  return `workspace-restored:${runId}`;
}

/** The fields of a stored working copy that its files line is made of. */
type StoredCopy = { runId: string; state: WorkspaceRecoveryView['copies'][number]['state']; diff?: WorkspaceDiffSummary;
  review?: WorkspaceRecoveryView['copies'][number]['review']; carriedTo?: string };

function recordOfCopy(copy: StoredCopy): ChangedFilesRecord | undefined {
  if (!copy.diff) return undefined;
  if (copy.diff.files === 0 && (copy.diff.folders ?? 0) === 0) return undefined;
  const outcome = changeOutcomeOf({ state: copy.state, review: copy.review, carried: Boolean(copy.carriedTo) });
  const diff = countsOf(copy.diff);
  const record = outcome ? { runId: copy.runId, diff, outcome } : { runId: copy.runId, diff };
  return ChangedFilesRecord.parse(record);
}

/**
 * Every run's files line, as a backup keeps it (COD-299): from the run's working copy, or from an earlier restore when
 * that copy is not here. Only counts and where the changes stood; no path, content or hunk leaves the working copy.
 */
export function changedFilesRecords(store: Store): ChangedFilesRecord[] {
  const records = new Map<string, ChangedFilesRecord>();
  for (const row of store.db.prepare(`SELECT data FROM settings WHERE id LIKE 'workspace-restored:%'`).all()) {
    const record = ChangedFilesRecord.parse(JSON.parse(String(row.data)));
    records.set(record.runId, record);
  }
  for (const row of store.db.prepare('SELECT data FROM workspace_copies').all()) {
    const record = recordOfCopy(JSON.parse(String(row.data)) as StoredCopy);
    if (record) records.set(record.runId, record);
  }
  return [...records.values()];
}

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
      // A completed run's copy is only unsettled when the person applied it after review and the apply stopped (COD-279).
      const copyRow = this.store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(run.id);
      const reviewed = copyRow ? JSON.parse(String(copyRow.data)).review?.state === 'applied' : false;
      if ((run.status === 'completed' && !reviewed) || processes.some(process => process.state === 'running')) {
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
    const restored = this.store.db.prepare(`SELECT settings.data FROM settings JOIN runs ON settings.id='workspace-restored:' || runs.id
      WHERE runs.task_id=? AND NOT EXISTS (SELECT 1 FROM workspace_copies copies WHERE copies.run_id=runs.id)
      ORDER BY runs.rowid DESC LIMIT 100`).all(taskId).map(row => ChangedFilesRecord.parse(JSON.parse(String(row.data))));
    const runIds = new Set([...copies.map(row => JSON.parse(String(row.data)).runId as string),
      ...processes.map(row => WorkspaceProcess.parse(JSON.parse(String(row.data))).runId), ...calls.map(row => String(row.runId))]);
    return WorkspaceRecoveryView.parse({ taskId,
      attempts: [...runIds].map(runId => ({ runId, reviewToken: this.token(runId), retired: !!this.store.setting(`workspace-retired:${runId}`, null) })),
      copies: copies.slice(0, 100).map(row => {
        const copy = JSON.parse(String(row.data));
        const review = copy.review ? { state: copy.review.state, heldAt: copy.review.heldAt, decidedAt: copy.review.decidedAt,
          applied: copy.review.applied, skipped: copy.review.skipped } : undefined;
        return { runId: copy.runId, state: copy.state, kind: copy.kind ?? 'copy',
          changes: copy.changes.slice(0, 100), changeCount: copy.changes.length, ...(copy.diff ? { diff: copy.diff } : {}),
          ...(review ? { review } : {}), ...(copy.carriedTo ? { carried: true } : {}) };
      }),
      processes: processes.slice(0, 100).map(row => {
        const process = WorkspaceProcess.parse(JSON.parse(String(row.data)));
        return { id: process.id, runId: process.runId, state: process.state, exitCode: process.exitCode,
          command: describeCommand(process.command) };
      }),
      uncertainCalls: calls.slice(0, 100), ...(restored.length ? { restored } : {}),
      truncated: [copies, processes, calls].some(rows => rows.length > 100),
    });
  }
}
