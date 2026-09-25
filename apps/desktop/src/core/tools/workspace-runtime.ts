import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Run, Task } from '../../shared/contracts';
import { WorkspaceGrantSnapshot, type WorkspacePermission } from '../../shared/workspace-access';
import { WorkspaceBlob, WorkspaceChangeKind, WorkspaceHash, WorkspaceManifest, WorkspaceOperation, WorkspacePath } from '../../shared/workspace-tools';
import { WorkspaceReadEvidence } from '../../shared/workspace-evidence';
import { Store } from '../storage/database';
import { ToolCalls, UnresolvedAttemptError } from '../storage/tool-calls';
import { WorkspaceGrants } from '../storage/workspace-grants';
import { WorkspaceRecovery } from '../storage/workspace-recovery';
import { ReadRecoveryFile, RecoveryFile, RestoreWorkspaceFile, WorkspaceConflictReason } from '../../shared/workspace-recovery';
import { WorkspaceDiffRequest, WorkspaceDiffSummary, summarize, type WorkspaceDiff } from '../../shared/workspace-diff';
import { planIntegration, plainCopyDiff, type IntegrationStep } from './workspace-plan';
import type { WorkspaceFilesRuntime } from './workspace-files-runtime';
import type { IntegrationStepInput, WorkspaceIntegration } from './workspace-integration';
import { WorkspaceProcesses } from './workspace-processes';
import { dependencyFolders } from './workspace-dependencies';
import { StartWorkspaceProcess, WorkspaceProcessId, WorkspaceProcessOutput, WorkspaceProcessStatus } from '../../shared/workspace-processes';

/**
 * One hand-in step and what became of it (COD-254). A change saved before then is a file write: its `hash` and
 * `bytes` describe the new file, as they always did.
 */
const Change = z.object({
  kind: WorkspaceChangeKind.default('write'),
  path: WorkspacePath.refine(Boolean),
  /** Where a moved file was. */
  from: WorkspacePath.refine(Boolean).optional(),
  /** The bytes the step leaves at `path`; null for a folder or a deletion. */
  hash: WorkspaceHash.nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  /** What the person's file must still be: the snapshot's hash, or null for a path that must be free. */
  expectedHash: z.string().nullable(),
  status: z.enum(['pending', 'applied', 'conflict', 'blocked']),
  backupPath: z.string().optional(),
  reason: z.string().optional(),
  conflict: WorkspaceConflictReason.optional(),
  restored: z.boolean().optional(),
}).strict();
type Change = z.infer<typeof Change>;

const Copy = z.object({
  runId: z.uuid(), grant: WorkspaceGrantSnapshot, directory: z.string().nullable(),
  state: z.enum(['preparing', 'ready', 'integrating', 'integrated', 'conflict', 'uncertain']),
  baseline: WorkspaceManifest,
  kind: z.enum(['copy', 'git-worktree']).optional(),
  /**
   * Counts operations that changed the copy: a write that changed a file's hash, a new folder, a move, a deletion.
   * Writes and command starts are both serialized per run, so a command that recorded this count at start ran either
   * before or after each change with no wall-clock comparison (COD-189).
   */
  edits: z.number().int().min(0).default(0),
  /** What the copy changed since its snapshot, counted when the run finished (COD-163, COD-254). */
  diff: WorkspaceDiffSummary.optional(),
  changes: z.array(Change),
}).strict();
type Copy = z.infer<typeof Copy>;
const ReadResult = z.object({ path: z.string(), hash: z.string(), content: z.string() }).passthrough();
const WriteResult = z.object({ hash: z.string() }).passthrough();
const FolderResult = z.object({ created: z.boolean() }).passthrough();

/** The operations a model may ask for, and the ones among them that change the private copy. */
const MODEL_OPERATIONS = ['list', 'read', 'search', 'write', 'create_folder', 'move', 'delete'];
const CHANGING_OPERATIONS = ['write', 'create_folder', 'move', 'delete'];

/**
 * A path the worker guessed, or a folder it has not created yet, is something it can correct; the answer goes back
 * as the tool's result instead of ending the run, and nothing was changed (COD-190).
 */
function missingPathResult(request: WorkspaceOperation, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/ENOENT|no such file or directory/i.test(message)) throw error;
  const path = request.operation === 'move' ? request.from : 'path' in request ? request.path : '';
  return { missing: true as const, path, error: `No such file or folder in the working copy: ${path || '.'}`, hint: 'List the parent folder, or write the file to create it.' };
}

function isMissingPathResult(result: unknown): result is ReturnType<typeof missingPathResult> {
  return typeof result === 'object' && result !== null && (result as { missing?: unknown }).missing === true;
}

/** A folder, move or delete the helper refused before changing anything; the worker can correct it (COD-254). */
function isRefusedResult(result: unknown): result is { refused: true; error: string } {
  return typeof result === 'object' && result !== null && (result as { refused?: unknown }).refused === true;
}

/**
 * Whether an operation changed the copy, for the command rule (COD-189): a write that changed the bytes, a folder that
 * was not there, any move or deletion. Reads never do.
 */
function changedTheCopy(request: WorkspaceOperation, result: unknown): boolean {
  if (request.operation === 'write') return WriteResult.parse(result).hash !== request.expectedHash;
  if (request.operation === 'create_folder') return FolderResult.parse(result).created;
  return request.operation === 'move' || request.operation === 'delete';
}

/** What a change to the private copy looks like in the run's activity; the trace reads these sentences. */
function copyEvent(request: WorkspaceOperation): string {
  if (request.operation === 'move') return `Workspace move: ${request.from} → ${request.to}`;
  return `Workspace ${request.operation}: ${'path' in request ? request.path : ''}`;
}

function refusedEvent(request: WorkspaceOperation): string {
  if (request.operation === 'move') return `Không chuyển được: ${request.from} → ${request.to}`;
  if (request.operation === 'delete') return `Không xóa được: ${request.path}`;
  return `Không tạo được thư mục: ${'path' in request ? request.path : ''}`;
}

/** The sentence a hand-in step leaves in the run's activity once it reached the person's folder. */
function integratedEvent(step: IntegrationStep): string {
  if (step.kind === 'folder') return `Đã tạo thư mục: ${step.path}`;
  if (step.kind === 'move') return `Đã chuyển tệp: ${step.from} → ${step.path}`;
  if (step.kind === 'delete') return `Đã xóa tệp và giữ bản gốc riêng: ${step.path}`;
  if (step.kind === 'remove_folder') return `Đã xóa thư mục trống: ${step.path}`;
  return `Đã tích hợp workspace: ${step.path}`;
}

/** A write keeps the call id it always had, so a journal from before COD-254 still matches. */
function integrationCallId(step: IntegrationStep): string {
  return step.kind === 'write' ? `integrate:${step.path}` : `integrate:${step.kind}:${step.path}`;
}

function changeOf(step: IntegrationStep): Change {
  const base = { kind: step.kind, path: step.path, status: 'pending' as const };
  if (step.kind === 'write') return { ...base, hash: step.hash, bytes: step.bytes, expectedHash: step.expectedHash };
  if (step.kind === 'move') return { ...base, from: step.from, hash: step.hash, bytes: step.bytes, expectedHash: step.hash };
  if (step.kind === 'delete') return { ...base, hash: null, bytes: null, expectedHash: step.expectedHash };
  return { ...base, hash: null, bytes: null, expectedHash: null };
}

/** Coordinates isolated working copies. It never reads worker-controlled file paths on the host. */
export class WorkspaceRuntime {
  private queues = new Map<string, Promise<unknown>>();
  private grants: WorkspaceGrants;
  private processes?: WorkspaceProcesses;
  constructor(private store: Store, private files: Pick<WorkspaceFilesRuntime, 'createCopy' | 'execute'> & Partial<Pick<WorkspaceFilesRuntime, 'diffCopy'>>,
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

  /**
   * What a run changed in its copy, with hunks, for the person to read (COD-163). Read-only: nothing is applied,
   * and the person's folder is never touched. It queues behind the run's own file operations so it never reads a
   * file mid-write, and it follows the copy's read grant the way inspecting a file does.
   */
  async diff(raw: unknown): Promise<WorkspaceDiff> {
    const input = WorkspaceDiffRequest.parse(raw);
    const signal = AbortSignal.timeout(60_000);
    return this.serial(input.runId, async () => {
      const run = this.store.get<Run>('runs', input.runId);
      if (run.taskId !== input.taskId) throw new Error('Lần chạy không thuộc cuộc trò chuyện này.');
      const copy = this.saved(run.id);
      if (!copy?.directory) throw new Error('Lần chạy này không có bản làm việc để so sánh.');
      this.grants.assert(copy.grant, 'read');
      if (copy.kind !== 'git-worktree') {
        // A plain folder copy kept only the snapshot's hashes: what happened to each file, without lines (COD-254).
        const current = WorkspaceManifest.parse(await this.files.execute(copy.directory, { operation: 'manifest' }, signal));
        return { runId: run.id, ...plainCopyDiff(copy.baseline, current) };
      }
      if (!this.files.diffCopy) throw new Error('Cần Git cho Windows để đọc thay đổi của bản làm việc này.');
      const diff = await this.files.diffCopy(copy.directory, copy.baseline, true, signal);
      return { runId: run.id, ...diff };
    });
  }

  /** The counts a finished run keeps beside its copy; a Git worktree needs Git to count lines. */
  private async summarizeCopy(copy: Copy, current: WorkspaceManifest, signal: AbortSignal): Promise<WorkspaceDiffSummary | undefined> {
    if (!copy.directory) return undefined;
    if (copy.kind !== 'git-worktree') return summarize(plainCopyDiff(copy.baseline, current));
    if (!this.files.diffCopy) return undefined;
    return summarize(await this.files.diffCopy(copy.directory, copy.baseline, false, signal));
  }

  private assertCopiesResolved(run: Run) {
    this.processes?.assertKnown(run.taskId);
    const unresolved = this.store.db.prepare(`SELECT copies.run_id FROM workspace_copies copies
      JOIN runs ON runs.id=copies.run_id WHERE runs.task_id=?
      AND json_extract(copies.data,'$.state') IN ('uncertain','conflict')
      AND NOT EXISTS (SELECT 1 FROM settings WHERE id='workspace-retired:' || copies.run_id) LIMIT 1`).get(run.taskId);
    if (unresolved) throw new UnresolvedAttemptError('Bản làm việc bị gián đoạn; cần kiểm tra trước khi tiếp tục.');
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

  /**
   * A crew member changes only its assignment's `writeResources`. A new folder may also be a parent of an owned path,
   * since writing an owned file creates its parents; removing a folder needs the folder itself to be owned.
   */
  private owns(run: Run, path: string, parentFolder = false) {
    if (!run.snapshot.team) return;
    const owned = run.snapshot.assignment?.writeResources ?? [];
    const target = path.toLowerCase();
    const inside = (resource: string) => target === resource.toLowerCase() || target.startsWith(`${resource.toLowerCase()}/`);
    const above = (resource: string) => parentFolder && resource.toLowerCase().startsWith(`${target}/`);
    if (!owned.some(resource => inside(resource) || above(resource))) {
      throw new Error('Tệp không thuộc phạm vi được giao cho worker này.');
    }
  }

  private ownsRequest(run: Run, request: WorkspaceOperation) {
    if (request.operation === 'write' || request.operation === 'delete') this.owns(run, request.path);
    if (request.operation === 'create_folder') this.owns(run, request.path, true);
    if (request.operation === 'move') {
      this.owns(run, request.from);
      this.owns(run, request.to);
    }
  }

  private ownsStep(run: Run, step: IntegrationStep) {
    if (step.kind === 'move') this.owns(run, step.from);
    this.owns(run, step.path, step.kind === 'folder');
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
      state: 'preparing', baseline: { files: [], omitted: [] }, edits: 0, changes: [] };
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
    if (!MODEL_OPERATIONS.includes(request.operation)) throw new Error('Tool không được policy cho phép.');
    const permission = CHANGING_OPERATIONS.includes(request.operation) ? 'write' : 'read';
    return this.serial(run.id, async () => {
      this.authorize(run, permission, signal);
      this.processes?.assertIdle(run.id);
      if (permission === 'write') this.assertCopiesResolved(run);
      this.ownsRequest(run, request);
      const copy = await this.prepare(run, signal);
      return new ToolCalls(this.store).execute({
        runId: run.id, callId, name: `workspace_${request.operation}`, arguments: request,
        replay: permission === 'write' ? 'never' : 'read',
        authorize: () => { this.authorize(run, permission, signal); },
        perform: async () => {
          if (permission === 'write' && copy.state !== 'ready') throw new Error('Bản làm việc đã tích hợp hoặc đang chờ xử lý xung đột.');
          await this.grants.directory(run.snapshot.workspaceGrant!, permission);
          const result = await this.files.execute(copy.directory!, request, signal).catch(error => missingPathResult(request, error));
          if (isMissingPathResult(result)) {
            this.store.event(run.id, `Không có tệp hoặc thư mục: ${result.path}`);
            this.notify();
            return result;
          }
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
          if (isRefusedResult(result)) {
            this.store.event(run.id, refusedEvent(request));
            this.notify();
            return result;
          }
          if (changedTheCopy(request, result)) {
            copy.edits += 1;
            this.save(copy);
          }
          this.store.event(run.id, copyEvent(request));
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
        const source = await this.grants.directory(run.snapshot.workspaceGrant!, 'execute');
        const dependencies = await dependencyFolders(source, copy.directory!, copy.baseline);
        const started = await processes.start({ runId: run.id, callId, directory: copy.directory!, command, signal: lifetime,
          copyEdits: copy.edits, dependencies, authorize: () => { this.authorize(run, 'execute', lifetime); } });
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

  /**
   * Puts a file a hand-in deleted back where it was, from the private backup the broker flushed before deleting it
   * (COD-254). It goes through the same broker as a new file: create-new semantics, so whatever stands at that path now
   * is never overwritten, and the chat must still hold the same folder with edit access. It is journaled like any
   * other effect; an interrupted restore is an unknown outcome to review, never retried by itself.
   */
  async restore(raw: unknown, isActive: (taskId: string) => boolean): Promise<void> {
    const input = RestoreWorkspaceFile.parse(raw);
    const signal = AbortSignal.timeout(60_000);
    await this.serial(input.runId, async () => {
      const run = this.store.get<Run>('runs', input.runId);
      if (run.taskId !== input.taskId) throw new Error('Lần chạy không thuộc cuộc trò chuyện này.');
      if (isActive(input.taskId)) throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
      const copy = this.saved(run.id);
      const change = copy?.changes.find(item => item.kind === 'delete' && item.path === input.path);
      if (!copy || !change || change.status !== 'applied' || !change.backupPath || !change.expectedHash) {
        throw new Error('Không có tệp đã xóa để khôi phục ở đường dẫn này.');
      }
      if (change.restored) return;
      const grant = this.grants.snapshot(run.taskId);
      if (!grant || grant.id !== copy.grant.id || !grant.permissions.includes('write')) {
        throw new Error('Cần quyền sửa trên đúng thư mục này để khôi phục tệp.');
      }
      const bytes = await readFile(change.backupPath);
      if (createHash('sha256').update(bytes).digest('hex') !== change.expectedHash) {
        throw new Error('Bản gốc đã lưu không còn khớp; không khôi phục.');
      }
      await this.serial('integration', async () => {
        const root = await this.grants.directory(grant, 'write');
        const result = await this.integration.apply({ runId: run.id, callId: `restore:${change.path}:${randomUUID()}`,
          journalName: 'restore_workspace_file', root, signal, operation: 'write', path: change.path, expectedHash: null, bytes,
          authorize: () => {
            this.grants.assert(grant, 'write');
            if (isActive(input.taskId)) throw new Error('Dừng công việc trước khi xử lý bản làm việc.');
          },
        });
        if (result.status === 'conflict') throw new Error('Đã có tệp ở đường dẫn này; không ghi đè. Đổi tên hoặc chuyển tệp đó rồi thử lại.');
        if (result.status !== 'applied') throw new Error('Không khôi phục được tệp; xem lại trong Chi tiết.');
        change.restored = true;
        this.save(copy);
        this.store.event(run.id, `Đã khôi phục tệp đã xóa: ${change.path}`);
      });
    });
  }

  integratedChangeCount(runId: string): number {
    const copy = this.saved(runId);
    return copy?.state === 'integrated' ? copy.changes.filter(change => change.status === 'applied').length : 0;
  }

  private async bytes(directory: string, file: { path: string; hash: string; bytes: number }, signal: AbortSignal): Promise<Buffer> {
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

  /** What the broker needs for one step: only a write carries bytes, read through the sandboxed helper. */
  private async stepInput(directory: string, step: IntegrationStep, signal: AbortSignal): Promise<IntegrationStepInput> {
    if (step.kind === 'write') {
      return { operation: 'write', path: step.path, expectedHash: step.expectedHash, bytes: await this.bytes(directory, step, signal) };
    }
    if (step.kind === 'move') return { operation: 'move', from: step.from, path: step.path, expectedHash: step.hash };
    if (step.kind === 'delete') return { operation: 'delete', path: step.path, expectedHash: step.expectedHash };
    return { operation: step.kind === 'folder' ? 'create_folder' : 'remove_folder', path: step.path };
  }

  /** Integrates the copy and returns the limitations to report: command failures the code has since moved past. */
  async finish(run: Run, signal: AbortSignal): Promise<string[]> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    new ToolCalls(this.store).assertEffectsResolved(run.id);
    this.assertCopiesResolved(run);
    if (!this.saved(run.id)) return [];
    return this.serial(run.id, async () => {
      this.authorize(run, 'read', signal);
      const copy = this.saved(run.id)!;
      const limitations = this.processes?.assertSuccessful(run.id, copy.edits) ?? [];
      if (copy.state === 'integrated') return limitations;
      if (copy.state !== 'ready' || !copy.directory) throw new Error('Bản làm việc bị gián đoạn; cần kiểm tra trước khi tiếp tục.');
      const manifest = WorkspaceManifest.parse(await this.files.execute(copy.directory, { operation: 'manifest' }, signal));
      // Counted before integration and kept even when integration is refused, so the chat can still show what changed.
      copy.diff = await this.summarizeCopy(copy, manifest, signal);
      // A linked worktree carries Git's own `.git` pointer file at its root; the plan never integrates it over the
      // person's repository. A plan that cannot be ordered safely is refused before anything changes.
      let steps: IntegrationStep[];
      try {
        steps = planIntegration(copy.baseline, manifest);
        for (const step of steps) this.ownsStep(run, step);
      } catch (error) {
        this.save(copy);
        throw error;
      }
      copy.changes = steps.map(changeOf);
      if (!copy.changes.length) { this.save({ ...copy, state: 'integrated' }); return limitations; }
      this.authorize(run, 'write', signal);
      // ponytail: one integration queue per core; use per-root queues if more than two concurrent workers are supported.
      await this.serial('integration', async () => {
        this.save({ ...copy, state: 'integrating' });
        try {
          for (const [index, step] of steps.entries()) {
            const change = copy.changes[index];
            const root = await this.grants.directory(run.snapshot.workspaceGrant!, 'write');
            const result = await this.integration.apply({ runId: run.id, callId: integrationCallId(step), root, signal,
              ...await this.stepInput(copy.directory!, step, signal),
              authorize: () => { this.authorize(run, 'write', signal); this.ownsStep(run, step); },
            });
            if (result.status === 'uncertain') throw new Error('Tích hợp bị gián đoạn; cần kiểm tra file và bản gốc đã lưu.');
            change.status = result.status;
            if (result.backupPath) change.backupPath = result.backupPath;
            if (result.status === 'blocked') change.reason = result.reason;
            if (result.status === 'conflict') change.conflict = result.reason ?? 'changed';
            this.save({ ...copy, state: result.status === 'applied' ? 'integrating' : 'conflict' });
            if (result.status !== 'applied') throw new Error('Workspace có xung đột; các tệp đã tích hợp được giữ lại.');
            this.store.event(run.id, integratedEvent(step));
          }
          this.save({ ...copy, state: 'integrated' });
        } catch (error) {
          if (this.saved(run.id)?.state === 'integrating') this.save({ ...copy, state: 'uncertain' });
          throw error;
        }
      });
      return limitations;
    });
  }
}
