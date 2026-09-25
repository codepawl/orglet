import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { WorkspaceManifest, WorkspaceOperation } from '../../shared/workspace-tools';
import { WindowsSandbox } from './sandbox';
import type { SandboxRequest, SandboxResult } from './sandbox';
import { StartWorkspaceProcess } from '../../shared/workspace-processes';
import { prepareGitWorktree } from './workspace-git';
import { diffWorkspaceCopy } from './workspace-diff';
import type { WorkspaceDiff } from '../../shared/workspace-diff';
import { linkDependencies, unlinkDependencies, type DependencyLink } from './workspace-dependencies';

const HelperReply = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);

export class WorkspaceFilesRuntime {
  constructor(private options: {
    sandbox: WindowsSandbox;
    helperPath: string;
    stateDirectory: string;
    runtimeExecutable: string;
    gitExecutable?: string;
  }) {}

  async createCopy(sourceDirectory: string, signal: AbortSignal) {
    const source = await realpath(sourceDirectory);
    const parent = join(this.options.stateDirectory, 'copies');
    await mkdir(parent, { recursive: true });
    const session = join(parent, randomUUID());
    const seed = join(session, 'seed');
    await mkdir(seed, { recursive: true });
    const manifest = WorkspaceManifest.parse(await this.execute(seed, { operation: 'snapshot', source }, signal, [source]));
    if (!manifest.omitted.some(path => path.toLowerCase() === '.git')) {
      return { directory: seed, manifest, kind: 'copy' as const };
    }
    if (!this.options.gitExecutable) throw new Error('Cần Git cho Windows để tạo worktree riêng cho repository này.');
    const executable = await realpath(this.options.gitExecutable).catch(() => {
      throw new Error('Cần Git cho Windows để tạo worktree riêng cho repository này.');
    });
    const preparationSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    await prepareGitWorktree(session, { operation: 'prepare_git', executable }, preparationSignal);
    return { directory: join(session, 'worktree'), manifest, kind: 'git-worktree' as const };
  }

  /**
   * What a Git working copy changed since its snapshot (COD-163). The current inventory comes through the sandboxed
   * helper, the same walk the snapshot used, so Git only ever receives paths that walk verified as plain files.
   */
  async diffCopy(directory: string, baseline: WorkspaceManifest, includeHunks: boolean, signal: AbortSignal): Promise<Omit<WorkspaceDiff, 'runId'>> {
    if (!this.options.gitExecutable) throw new Error('Cần Git cho Windows để đọc thay đổi của bản làm việc này.');
    const executable = await realpath(this.options.gitExecutable).catch(() => {
      throw new Error('Cần Git cho Windows để đọc thay đổi của bản làm việc này.');
    });
    const current = WorkspaceManifest.parse(await this.execute(directory, { operation: 'manifest' }, signal));
    return diffWorkspaceCopy({ executable, worktree: directory, baseline, current, includeHunks, signal });
  }

  async execute(directory: string, raw: unknown, signal: AbortSignal, readOnlyPaths: string[] = []): Promise<unknown> {
    const request = WorkspaceOperation.parse(raw);
    const result = await this.invoke(directory, request, signal, request.operation === 'snapshot' ? 120000 : 30000, readOnlyPaths);
    return this.reply(result, signal);
  }

  private reply(result: SandboxResult, signal: AbortSignal): unknown {
    signal.throwIfAborted();
    if (result.termination !== 'exited') throw new Error(`Workspace tool đã dừng: ${result.termination}`);
    let reply: z.infer<typeof HelperReply>;
    try { reply = HelperReply.parse(JSON.parse(result.stdout)); }
    catch { throw new Error('Helper workspace không trả kết quả hợp lệ.'); }
    if (!reply.ok) throw new Error(reply.error);
    if (result.exitCode !== 0) throw new Error('Helper workspace không trả kết quả hợp lệ.');
    return reply.value;
  }

  /** Runs one command in the copy. The folder's installed dependencies are linked in, read-only, for its duration (COD-271). */
  async runCommand(directory: string, raw: unknown, signal: AbortSignal, onOutput?: SandboxRequest['onOutput'],
    dependencies: readonly DependencyLink[] = []): Promise<SandboxResult> {
    const command = StartWorkspaceProcess.parse(raw);
    const linked = await linkDependencies(dependencies);
    try {
      const readable = linked.map(dependency => dependency.target);
      return await this.invoke(directory, { operation: 'command', command }, signal, command.timeoutMs, readable, onOutput);
    } finally {
      await unlinkDependencies(linked);
    }
  }

  private async invoke(directory: string, request: unknown, signal: AbortSignal, timeoutMs: number,
    readOnlyPaths: string[] = [], onOutput?: SandboxRequest['onOutput']): Promise<SandboxResult> {
    signal.throwIfAborted();
    const controlDirectory = join(this.options.stateDirectory, 'requests');
    await mkdir(controlDirectory, { recursive: true });
    const requestPath = join(controlDirectory, `${randomUUID()}.json`);
    await writeFile(requestPath, JSON.stringify(request), { flag: 'wx' });
    try {
      return await this.options.sandbox.run({
        directory, runtimeDirectories: [dirname(this.options.runtimeExecutable)],
        readOnlyPaths: [this.options.helperPath, requestPath, ...readOnlyPaths],
        commandLine: `"${this.options.runtimeExecutable}" "${this.options.helperPath}" "${requestPath}"`,
        timeoutMs, signal, onOutput,
      });
    } finally {
      await rm(requestPath, { force: true });
    }
  }
}
