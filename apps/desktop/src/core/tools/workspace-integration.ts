import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkspaceHash, WorkspacePath } from '../../shared/workspace-tools';
import { WorkspaceConflictReason } from '../../shared/workspace-recovery';
import { Store } from '../storage/database';
import { ToolCalls } from '../storage/tool-calls';
import { sandboxEnvironment } from './sandbox';

const IntegrationReply = z.discriminatedUnion('status', [
  // A folder step has no bytes, so it has no hash.
  z.object({ status: z.literal('applied'), hash: WorkspaceHash.nullable() }).strict(),
  // The person's file as it is now; null when the path is missing, taken or not a file.
  z.object({ status: z.literal('conflict'), hash: WorkspaceHash.nullable(), reason: WorkspaceConflictReason.optional() }).strict(),
  z.object({ status: z.literal('blocked'), reason: z.string().max(4000) }).strict(),
  z.object({ status: z.literal('uncertain'), reason: z.string().max(4000) }).strict(),
]);
export type IntegrationResult = z.infer<typeof IntegrationReply> & { backupPath: string; created: boolean };

/**
 * One hand-in step for the broker (COD-254). A write carries the bytes; a move carries the hash the file at `from`
 * must still have; a delete carries the hash of the file it removes, whose bytes go to a private backup first.
 * `operation` may be left out for a write, the only step that existed before.
 */
export type IntegrationStepInput =
  | { operation?: 'write'; path: string; expectedHash: string | null; bytes: Buffer }
  | { operation: 'create_folder'; path: string }
  | { operation: 'move'; from: string; path: string; expectedHash: string }
  | { operation: 'delete'; path: string; expectedHash: string }
  | { operation: 'remove_folder'; path: string };

type ApplyOptions = IntegrationStepInput & {
  runId: string;
  callId: string;
  root: string;
  signal: AbortSignal;
  authorize: () => void;
  /** The journal's name for the call: a hand-in step, or putting a deleted file back from Details. */
  journalName?: 'integrate_workspace_file' | 'restore_workspace_file';
};

const INTERRUPTED = 'Tích hợp bị gián đoạn; cần kiểm tra file và bản gốc đã lưu.';

/**
 * The only way core changes the person's folder: every hand-in step goes through the Windows broker, journaled and
 * never replayed, with reconciliation metadata saved before the broker can change anything.
 */
export class WorkspaceIntegration {
  constructor(private store: Store, private executable: string, private stateDirectory: string) {}

  async apply(options: ApplyOptions): Promise<IntegrationResult> {
    const operation = options.operation ?? 'write';
    WorkspacePath.refine(Boolean).parse(options.path);
    if (options.operation === 'move') WorkspacePath.refine(Boolean).parse(options.from);
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Tích hợp file hiện chỉ hỗ trợ Windows x64.');
    const request = this.request(options);
    return new ToolCalls(this.store).execute({
      runId: options.runId, callId: options.callId, name: options.journalName ?? 'integrate_workspace_file', replay: 'never',
      arguments: { root: options.root, ...request.journal },
      authorize: () => { options.signal.throwIfAborted(); options.authorize(); },
      perform: async () => {
        const backups = join(this.stateDirectory, 'backups');
        await mkdir(backups, { recursive: true });
        const backupPath = join(backups, `${randomUUID()}.original`);
        // Persist reconciliation metadata before the broker can change anything.
        this.store.setSetting(`integration:${options.runId}:${options.callId}`, { root: options.root, ...request.journal, backupPath });
        options.signal.throwIfAborted();
        options.authorize();
        const reply = await this.invoke({ root: options.root, ...request.broker, backupPath }, options.signal);
        if (reply.status === 'uncertain') throw new Error(INTERRUPTED);
        const keepsBackup = operation === 'write' || operation === 'delete';
        return { ...reply, backupPath: keepsBackup ? backupPath : '', created: operation === 'write' && request.journal.expectedHash === null };
      },
    });
  }

  /** What the journal keeps (paths and hashes, never content) and what the broker receives, per step kind. */
  private request(options: ApplyOptions): { journal: Record<string, unknown>; broker: Record<string, unknown> } {
    if (options.operation === 'create_folder' || options.operation === 'remove_folder') {
      const step = { operation: options.operation, path: options.path };
      return { journal: step, broker: step };
    }
    if (options.operation === 'move' || options.operation === 'delete') {
      WorkspaceHash.parse(options.expectedHash);
      const step = { operation: options.operation, ...(options.operation === 'move' ? { from: options.from } : {}),
        path: options.path, expectedHash: options.expectedHash };
      return { journal: step, broker: step };
    }
    WorkspaceHash.nullable().parse(options.expectedHash);
    if (options.bytes.length > 1024 * 1024) throw new Error('Tệp vượt giới hạn 1 MiB của workspace tools.');
    const replacement = Buffer.from(options.bytes);
    const hash = createHash('sha256').update(replacement).digest('hex');
    // Journals written before COD-254 had no operation; a write keeps that exact shape so its fingerprint is unchanged.
    return {
      journal: { path: options.path, expectedHash: options.expectedHash, hash },
      broker: { operation: 'write', path: options.path, expectedHash: options.expectedHash, contentBase64: replacement.toString('base64') },
    };
  }

  private invoke(request: unknown, signal: AbortSignal): Promise<z.infer<typeof IntegrationReply>> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [], {
        env: sandboxEnvironment(this.stateDirectory, []), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let stopped = false;
      const stop = () => { stopped = true; child.kill(); };
      const timer = setTimeout(stop, 30000);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
      child.stdout.on('data', chunk => {
        if (output.length + chunk.length > 16000) stop();
        else output += chunk.toString();
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(request));
      child.on('error', error => { cleanup(); reject(error); });
      child.on('close', () => {
        cleanup();
        if (stopped) { reject(new Error(INTERRUPTED)); return; }
        try { resolve(IntegrationReply.parse(JSON.parse(output))); }
        catch { reject(new Error('Tích hợp không trả kết quả hợp lệ; không tự chạy lại.')); }
      });
    });
  }
}
