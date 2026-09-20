import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Run, Task } from '../../shared/contracts';
import { WorkspaceGrantSnapshot, type WorkspacePermission } from '../../shared/workspace-access';
import { WorkspaceBlob, WorkspaceFile, WorkspaceManifest, WorkspaceOperation } from '../../shared/workspace-tools';
import { WorkspaceReadEvidence } from '../../shared/workspace-evidence';
import { Store } from '../storage/database';
import { ToolCalls } from '../storage/tool-calls';
import { WorkspaceGrants } from '../storage/workspace-grants';
import { WorkspaceRecovery } from '../storage/workspace-recovery';
import { ReadRecoveryFile, RecoveryFile } from '../../shared/workspace-recovery';
import type { WorkspaceFilesRuntime } from './workspace-files-runtime';
import type { WorkspaceIntegration } from './workspace-integration';
import { WorkspaceProcesses } from './workspace-processes';
import { StartWorkspaceProcess, WorkspaceProcessId, WorkspaceProcessOutput, WorkspaceProcessStatus } from '../../shared/workspace-processes';

const Copy = z.object({
  runId: z.uuid(), grant: WorkspaceGrantSnapshot, directory: z.string().nullable(),
  state: z.enum(['preparing', 'ready', 'integrating', 'integrated', 'conflict', 'uncertain']),
  baseline: WorkspaceManifest,
  kind: z.enum(['copy', 'git-worktree']).optional(),
  changes: z.array(WorkspaceFile.extend({
    expectedHash: z.string().nullable(), status: z.enum(['pending', 'applied', 'conflict', 'blocked']),
    backupPath: z.string().optional(), reason: z.string().optional(),
  })),
}).strict();
type Copy = z.infer<typeof Copy>;
const ReadResult = z.object({ path: z.string(), hash: z.string(), content: z.string() }).passthrough();

/** Coordinates isolated working copies. It never reads worker-controlled file paths on the host. */
export class WorkspaceRuntime {
  private queues = new Map<string, Promise<unknown>>();
  private grants: WorkspaceGrants;
  private processes?: WorkspaceProcesses;
  constructor(private store: Store, private files: Pick<WorkspaceFilesRuntime, 'createCopy' | 'execute'>,
    private integration: Pick<WorkspaceIntegration, 'apply'>, private notify: () => void = () => {},
    commands?: Pick<WorkspaceFilesRuntime, 'runCommand'>) {
    this.grants = new WorkspaceGrants(store);
    if (commands) this.processes = new WorkspaceProcesses(store, commands, notify);
  }

  private async serial<Result>(key: string, perform: () => Promise<Result>): Promise<Result> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(perform);
    this.queues.set(key, next);
    try { return await next; }
    finally { if (this.queues.get(key) === next) this.queues.delete(key); }
  }

  private saved(runId: string): Copy | null {
    const row = this.store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(runId);
    return row ? Copy.parse(JSON.parse(String(row.data))) : null;
  }

  async inspectFile(raw: unknown, isActive: (taskId: string) => boolean): Promise<RecoveryFile> {
    const input = ReadRecoveryFile.parse(raw);
    const signal = AbortSignal.timeout(30_000);
    return this.serial(input.runId, async () => {
      const run = this.store.get<Run>('runs', input.runId);
      const copy = this.saved(run.id);
      const authorize = () => {
        signal.throwIfAborted();
        if (run.taskId !== input.taskId || !copy?.directory
          || JSON.stringify(copy.grant) !== JSON.stringify(run.snapshot.workspaceGrant)) {
          throw new Error('Lần chạy chưa có quyền workspace phù hợp.');
        }
        if (isActive(input.taskId)) throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
        this.processes?.assertIdle(run.id);
        this.grants.assert(copy.grant, 'read');
      };
      authorize();
      // Inspection cannot prepare a new copy, write a file, or replay an old tool call.
      const result = await this.files.execute(copy!.directory!, { operation: 'read', path: input.path, offset: input.offset }, signal);
      authorize();
      return RecoveryFile.parse(result);
    });
  }

  private assertCopiesResolved(run: Run) {
    this.processes?.assertKnown(run.taskId);
    const unresolved = this.store.db.prepare(`SELECT copies.run_id FROM workspace_copies copies
      JOIN runs ON runs.id=copies.run_id WHERE runs.task_id=?
      AND json_extract(copies.data,'$.state') IN ('uncertain','conflict')
      AND NOT EXISTS (SELECT 1 FROM settings WHERE id='workspace-retired:' || copies.run_id) LIMIT 1`).get(run.taskId);
    if (unresolved) throw new Error('Bản làm việc bị gián đoạn; cần kiểm tra trước khi tiếp tục.');
  }

  private save(copy: Copy) {
    this.store.db.prepare(`INSERT INTO workspace_copies(run_id,data) VALUES(?,?)
      ON CONFLICT(run_id) DO UPDATE SET data=excluded.data`).run(copy.runId, JSON.stringify(Copy.parse(copy)));
    this.notify();
  }

  authorize(run: Run, permission: WorkspacePermission, signal: AbortSignal) {
    signal.throwIfAborted();
    new WorkspaceRecovery(this.store).assertAvailable(run.id);
    const grant = run.snapshot.workspaceGrant;
    if (!grant || grant.taskId !== run.taskId) throw new Error('Lần chạy chưa có quyền workspace phù hợp.');
    const stored = this.store.get<Run>('runs', run.id);
    const task = this.store.get<Task>('tasks', run.taskId);
    if (stored.taskId !== run.taskId || JSON.stringify(stored.snapshot.workspaceGrant) !== JSON.stringify(grant)
      || JSON.stringify(stored.snapshot.assignment) !== JSON.stringify(run.snapshot.assignment)
      || (task.inputRevision ?? 0) !== (run.snapshot.inputRevision ?? 0)) {
      throw new Error('Lần chạy chưa có quyền workspace phù hợp.');
    }
    return this.grants.assert(grant, permission);
  }

  private owns(run: Run, path: string) {
    if (!run.snapshot.team) return;
    const owned = run.snapshot.assignment?.writeResources ?? [];
    const target = path.toLowerCase();
    if (!owned.some(resource => target === resource.toLowerCase() || target.startsWith(`${resource.toLowerCase()}/`))) {
      throw new Error('Tệp không thuộc phạm vi được giao cho worker này.');
    }
  }

  private async prepare(run: Run, signal: AbortSignal): Promise<Copy> {
    this.authorize(run, 'read', signal);
    const retained = this.saved(run.id);
    if (retained) {
      if (retained.grant.id !== run.snapshot.workspaceGrant!.id || retained.grant.revision !== run.snapshot.workspaceGrant!.revision) {
        throw new Error('Lần chạy chưa có quyền workspace phù hợp.');
      }
      if (!retained.directory || ['preparing', 'uncertain'].includes(retained.state)) {
        throw new Error('Bản làm việc bị gián đoạn; cần kiểm tra trước khi tiếp tục.');
      }
      return retained;
    }
    const source = await this.grants.directory(run.snapshot.workspaceGrant!, 'read');
    const preparing: Copy = { runId: run.id, grant: run.snapshot.workspaceGrant!, directory: null,
      state: 'preparing', baseline: { files: [], omitted: [] }, changes: [] };
    this.save(preparing);
    try {
      const copy = await this.files.createCopy(source, signal);
      this.authorize(run, 'read', signal);
      await this.grants.directory(run.snapshot.workspaceGrant!, 'read');
      const ready: Copy = { ...preparing, directory: copy.directory, baseline: copy.manifest, kind: copy.kind, state: 'ready' };
      this.save(ready);
      this.store.event(run.id, 'Đã tạo bản làm việc riêng trong workspace được cấp quyền.');
      return ready;
    } catch (error) {
      this.save({ ...preparing, state: 'uncertain' });
      throw error;
    }
  }

  async execute(run: Run, callId: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
    const request = WorkspaceOperation.parse(raw);
    if (!['list', 'read', 'search', 'write'].includes(request.operation)) throw new Error('Tool không được policy cho phép.');
    const permission = request.operation === 'write' ? 'write' : 'read';
    return this.serial(run.id, async () => {
      this.authorize(run, permission, signal);
      this.processes?.assertIdle(run.id);
      if (permission === 'write') this.assertCopiesResolved(run);
      if (request.operation === 'write') this.owns(run, request.path);
      const copy = await this.prepare(run, signal);
      return new ToolCalls(this.store).execute({
        runId: run.id, callId, name: `workspace_${request.operation}`, arguments: request,
        replay: permission === 'write' ? 'never' : 'read',
        authorize: () => { this.authorize(run, permission, signal); },
        perform: async () => {
          if (permission === 'write' && copy.state !== 'ready') throw new Error('Bản làm việc đã tích hợp hoặc đang chờ xử lý xung đột.');
          await this.grants.directory(run.snapshot.workspaceGrant!, permission);
          const result = await this.files.execute(copy.directory!, request, signal);
          if (request.operation === 'read') {
            const read = ReadResult.parse(result);
            const evidence = WorkspaceReadEvidence.parse({
              id: randomUUID(), runId: run.id, callId, path: request.path, hash: read.hash,
              grantId: copy.grant.id, grantRevision: copy.grant.revision,
            });
            if (read.path !== request.path) throw new Error('Helper workspace trả về đường dẫn không khớp.');
            this.store.db.prepare(`INSERT INTO workspace_read_evidence(id,run_id,call_id,data) VALUES(?,?,?,?)
              ON CONFLICT(run_id,call_id) DO UPDATE SET id=excluded.id,data=excluded.data`)
              .run(evidence.id, run.id, callId, JSON.stringify(evidence));
            this.store.event(run.id, `Workspace ${request.operation}: ${request.path}`);
            this.notify();
            return { ...read, evidenceId: evidence.id };
          }
          this.store.event(run.id, `Workspace ${request.operation}: ${'path' in request ? request.path : ''}`);
          this.notify();
          return result;
        },
      });
    });
  }

  /** A report may cite only a completed read of unchanged bytes in this run's current grant. */
  async validateEvidence(run: Run, evidenceIds: readonly string[], signal: AbortSignal): Promise<void> {
    if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error('Finding trích bằng chứng workspace bị trùng.');
    await this.serial(run.id, async () => {
      this.authorize(run, 'read', signal);
      this.processes?.assertIdle(run.id);
      const copy = this.saved(run.id);
      if (!copy?.directory || copy.state !== 'ready') throw new Error('Bản làm việc không còn để kiểm tra trích dẫn.');
      for (const evidenceId of evidenceIds) {
        const row = this.store.db.prepare('SELECT data FROM workspace_read_evidence WHERE id=?').get(evidenceId);
        if (!row) throw new Error('Finding trích bằng chứng workspace không tồn tại.');
        const evidence = WorkspaceReadEvidence.parse(JSON.parse(String(row.data)));
        if (evidence.runId !== run.id || evidence.grantId !== copy.grant.id
          || evidence.grantRevision !== copy.grant.revision) {
          throw new Error('Finding trích bằng chứng workspace ngoài lượt hoặc quyền đã thay đổi.');
        }
        const call = this.store.db.prepare('SELECT state,output FROM tool_calls WHERE run_id=? AND call_id=?')
          .get(run.id, evidence.callId);
        if (!call || call.state !== 'completed') throw new Error('Finding trích lượt đọc workspace chưa hoàn tất.');
        const savedOutput = JSON.parse(String(call.output));
        if (savedOutput.evidenceId !== evidence.id || savedOutput.path !== evidence.path
          || savedOutput.hash !== evidence.hash) throw new Error('Bằng chứng workspace không khớp tool call đã lưu.');
        this.authorize(run, 'read', signal);
        const current = ReadResult.parse(await this.files.execute(copy.directory, {
          operation: 'read', path: evidence.path, offset: 0,
        }, signal));
        if (current.hash !== evidence.hash) throw new Error('Tệp workspace đã thay đổi; đọc lại trước khi trích dẫn.');
      }
      this.authorize(run, 'read', signal);
    });
  }

  async processTool(run: Run, callId: string, name: string, raw: unknown, signal: AbortSignal, lifetime: AbortSignal): Promise<unknown> {
    const processes = this.processes;
    if (!processes) throw new Error('Runtime tiến trình chưa được cấu hình.');
    const authorize = () => { this.authorize(run, 'execute', signal); };
    authorize();
    if (name === 'workspace_start_process') {
      const command = StartWorkspaceProcess.parse(raw);
      return this.serial(run.id, async () => {
        this.assertCopiesResolved(run);
        const copy = await this.prepare(run, signal);
        if (copy.state !== 'ready') throw new Error('Bản làm việc đã tích hợp hoặc đang chờ xử lý xung đột.');
        await this.grants.directory(run.snapshot.workspaceGrant!, 'execute');
        const started = await processes.start({ runId: run.id, callId, directory: copy.directory!, command, signal: lifetime,
          authorize: () => { this.authorize(run, 'execute', lifetime); } });
        return processes.status(run.id, started.processId, 1000, signal, authorize);
      });
    }
    return new ToolCalls(this.store).execute({ runId: run.id, callId, name, arguments: raw,
      replay: name === 'workspace_cancel_process' ? 'idempotent' : 'read', authorize,
      perform: async () => {
        if (name === 'workspace_process_status') {
          const input = WorkspaceProcessStatus.parse(raw);
          return processes.status(run.id, input.processId, input.waitMs, signal, authorize);
        }
        if (name === 'workspace_process_output') {
          const input = WorkspaceProcessOutput.parse(raw);
          return processes.output(run.id, input.processId, input.stream, input.offset);
        }
        if (name === 'workspace_cancel_process') return processes.cancel(run.id, WorkspaceProcessId.parse(raw).processId);
        throw new Error('Tool không được policy cho phép.');
      },
    });
  }

  async stopRun(runId: string) { await this.processes?.stopRun(runId); }

  integratedChangeCount(runId: string): number {
    const copy = this.saved(runId);
    return copy?.state === 'integrated' ? copy.changes.filter(change => change.status === 'applied').length : 0;
  }

  private async bytes(directory: string, file: z.infer<typeof WorkspaceFile>, signal: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let offset = 0;
    do {
      const page = WorkspaceBlob.parse(await this.files.execute(directory, { operation: 'blob', path: file.path, offset }, signal));
      if (page.hash !== file.hash) throw new Error('Bản làm việc thay đổi trong lúc tích hợp.');
      const bytes = Buffer.from(page.base64, 'base64');
      chunks.push(bytes);
      offset += bytes.length;
      if (offset > 1024 * 1024 || (page.nextOffset !== null && (page.nextOffset !== offset || bytes.length === 0))) {
        throw new Error('Helper workspace không trả kết quả hợp lệ.');
      }
      if (page.nextOffset === null) break;
    } while (true);
    const result = Buffer.concat(chunks);
    if (result.length !== file.bytes || createHash('sha256').update(result).digest('hex') !== file.hash) {
      throw new Error('Bản làm việc thay đổi trong lúc tích hợp.');
    }
    return result;
  }

  async finish(run: Run, signal: AbortSignal): Promise<void> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    new ToolCalls(this.store).assertEffectsResolved(run.id);
    this.assertCopiesResolved(run);
    if (!this.saved(run.id)) return;
    await this.serial(run.id, async () => {
      this.authorize(run, 'read', signal);
      this.processes?.assertSuccessful(run.id);
      const copy = this.saved(run.id)!;
      if (copy.state === 'integrated') return;
      if (copy.state !== 'ready' || !copy.directory) throw new Error('Bản làm việc bị gián đoạn; cần kiểm tra trước khi tiếp tục.');
      const manifest = WorkspaceManifest.parse(await this.files.execute(copy.directory, { operation: 'manifest' }, signal));
      const baseline = new Map(copy.baseline.files.map(file => [file.path, file]));
      if (copy.baseline.files.some(file => !manifest.files.some(current => current.path === file.path))) {
        throw new Error('Bản làm việc có tệp bị xóa; chưa tích hợp thay đổi này.');
      }
      copy.changes = manifest.files.filter(file => baseline.get(file.path)?.hash !== file.hash)
        .map(file => ({ ...file, expectedHash: baseline.get(file.path)?.hash ?? null, status: 'pending' }));
      for (const file of copy.changes) this.owns(run, file.path);
      if (!copy.changes.length) { this.save({ ...copy, state: 'integrated' }); return; }
      this.authorize(run, 'write', signal);
      // ponytail: one integration queue per core; use per-root queues if more than two concurrent workers are supported.
      await this.serial('integration', async () => {
        this.save({ ...copy, state: 'integrating' });
        try {
          for (const file of copy.changes) {
            const root = await this.grants.directory(run.snapshot.workspaceGrant!, 'write');
            const result = await this.integration.apply({ runId: run.id, callId: `integrate:${file.path}`,
              root, path: file.path, expectedHash: file.expectedHash,
              bytes: await this.bytes(copy.directory!, file, signal), signal,
              authorize: () => { this.authorize(run, 'write', signal); this.owns(run, file.path); },
            });
            if (result.status === 'uncertain') throw new Error('Tích hợp bị gián đoạn; cần kiểm tra file và bản gốc đã lưu.');
            file.status = result.status;
            file.backupPath = result.backupPath;
            if (result.status === 'blocked') file.reason = result.reason;
            this.save({ ...copy, state: result.status === 'applied' ? 'integrating' : 'conflict' });
            if (result.status !== 'applied') throw new Error('Workspace có xung đột; các tệp đã tích hợp được giữ lại.');
            this.store.event(run.id, `Đã tích hợp workspace: ${file.path}`);
          }
          this.save({ ...copy, state: 'integrated' });
        } catch (error) {
          if (this.saved(run.id)?.state === 'integrating') this.save({ ...copy, state: 'uncertain' });
          throw error;
        }
      });
    });
  }
}
