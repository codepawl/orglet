import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkspaceHash, WorkspacePath } from '../../shared/workspace-tools';
import { Store } from '../storage/database';
import { ToolCalls } from '../storage/tool-calls';
import { sandboxEnvironment } from './sandbox';

const IntegrationReply = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), hash: WorkspaceHash }).strict(),
  z.object({ status: z.literal('conflict'), hash: WorkspaceHash }).strict(),
  z.object({ status: z.literal('blocked'), reason: z.string().max(4000) }).strict(),
  z.object({ status: z.literal('uncertain'), reason: z.string().max(4000) }).strict(),
]);
export type IntegrationResult = z.infer<typeof IntegrationReply> & { backupPath: string; created: boolean };

export class WorkspaceIntegration {
  constructor(private store: Store, private executable: string, private stateDirectory: string) {}

  async apply(options: {
    runId: string;
    callId: string;
    root: string;
    path: string;
    expectedHash: string | null;
    bytes: Buffer;
    signal: AbortSignal;
    authorize: () => void;
  }): Promise<IntegrationResult> {
    WorkspacePath.refine(Boolean).parse(options.path);
    WorkspaceHash.nullable().parse(options.expectedHash);
    if (options.bytes.length > 1024 * 1024) throw new Error('Tệp vượt giới hạn 1 MiB của workspace tools.');
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Tích hợp file hiện chỉ hỗ trợ Windows x64.');
    const replacement = Buffer.from(options.bytes);
    const hash = createHash('sha256').update(replacement).digest('hex');
    return new ToolCalls(this.store).execute({
      runId: options.runId, callId: options.callId, name: 'integrate_workspace_file', replay: 'never',
      arguments: { root: options.root, path: options.path, expectedHash: options.expectedHash, hash },
      authorize: () => { options.signal.throwIfAborted(); options.authorize(); },
      perform: async () => {
        const backups = join(this.stateDirectory, 'backups');
        await mkdir(backups, { recursive: true });
        const backupPath = join(backups, `${randomUUID()}.original`);
        // Persist reconciliation metadata before the broker can change anything.
        this.store.setSetting(`integration:${options.runId}:${options.callId}`, {
          root: options.root, path: options.path, expectedHash: options.expectedHash, hash, backupPath,
        });
        options.signal.throwIfAborted();
        options.authorize();
        const reply = await this.invoke({ root: options.root, path: options.path, expectedHash: options.expectedHash,
          contentBase64: replacement.toString('base64'), backupPath }, options.signal);
        if (reply.status === 'uncertain') throw new Error('Tích hợp bị gián đoạn; cần kiểm tra file và bản gốc đã lưu.');
        return { ...reply, backupPath, created: options.expectedHash === null };
      },
    });
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
        if (stopped) { reject(new Error('Tích hợp bị gián đoạn; cần kiểm tra file và bản gốc đã lưu.')); return; }
        try { resolve(IntegrationReply.parse(JSON.parse(output))); }
        catch { reject(new Error('Tích hợp không trả kết quả hợp lệ; không tự chạy lại.')); }
      });
    });
  }
}
