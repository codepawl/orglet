import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { Task } from '../../apps/desktop/src/shared/contracts';

const directory = process.env.ORGLET_LIVE_PROJECT_DIR;
const enabled = process.env.ORGLET_LIVE_WORKSPACE === '1' && !!directory;
const terminalStatuses = new Set<Task['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'paused', 'waiting_budget', 'waiting_input']);

describe.runIf(enabled)('live workspace follow-up', () => {
  it('edits and checks the project through real Codex and native isolation', async () => {
    const root = resolve(directory!);
    const project = join(root, 'project');
    const reports = join(root, 'reports');
    const savedIndividual = JSON.parse(await readFile(join(reports, 'individual-trace.json'), 'utf8')) as { taskId: string };
    const store = new Store(join(root, 'orglet.sqlite'));
    const stateDirectory = join(root, 'workspaces');
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(resolve('node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe')),
      helperPath: resolve('.vite/build/workspace-helper.cjs'),
      stateDirectory,
      runtimeExecutable: process.execPath,
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, resolve('out/native-tools/WorkspaceIntegrate.exe'), stateDirectory),
      () => {}, files);
    const core = new CoreService(store, () => {}, async () => {
      throw new Error('This follow-up must use the real Codex CLI.');
    }, undefined, undefined, undefined, undefined, undefined, runtime);
    try {
      await core.grantWorkspace({ taskId: savedIndividual.taskId, directory: project, permissions: ['read', 'write', 'execute'] });
      await core.command('reviseTask', {
        taskId: savedIndividual.taskId,
        brief: 'Use only the granted workspace tools to read brief.md and inventory.csv. Create sales-summary.md with the sellout sales, inventory cost, gross profit, and profit after booth fee, showing the arithmetic. Then start a Node command in the private workspace to verify that sales-summary.md contains 121,000 VND, wait for its exit status, and reply only after exit code 0. Do not change the input files.',
        sourceIds: [],
        consent: true,
        providerScopes: ['codex'],
        budgetMicros: 1_000_000,
      });
      const deadline = Date.now() + 12 * 60_000;
      while (Date.now() < deadline) {
        if (terminalStatuses.has(store.get<Task>('tasks', savedIndividual.taskId).status)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      const detail = store.detail(savedIndividual.taskId);
      const latestRevision = detail.task.inputRevision ?? 0;
      const runs = detail.runs.filter(run => run.snapshot.inputRevision === latestRevision);
      const runIds = new Set(runs.map(run => run.id));
      const calls = store.db.prepare('SELECT run_id,call_id,state,replay FROM tool_calls').all()
        .filter(call => runIds.has(String(call.run_id)));
      const processes = store.db.prepare('SELECT data FROM workspace_processes').all()
        .map(row => JSON.parse(String(row.data)) as { runId: string; state: string; exitCode: number | null })
        .filter(process => runIds.has(process.runId));
      const trace = {
        taskId: savedIndividual.taskId,
        revision: latestRevision,
        status: detail.task.status,
        runs: runs.map(run => ({ id: run.id, status: run.status, error: run.error, provider: run.snapshot.worker.provider })),
        events: detail.events.filter(event => runIds.has(event.runId)).map(event => ({ sequence: event.sequence, message: event.message })),
        toolCalls: calls,
        processes,
        artifacts: detail.artifacts.filter(artifact => runIds.has(artifact.runId)).map(artifact => ({ id: artifact.id, summary: artifact.report.summary })),
      };
      await writeFile(join(reports, 'workspace-followup-trace.json'), JSON.stringify(trace, null, 2));
      for (const artifact of detail.artifacts.filter(artifact => runIds.has(artifact.runId))) {
        await writeFile(join(reports, 'workspace-followup.md'), core.exportMarkdown(artifact.id));
      }
      await core.runner.shutdown();
      store.close();
    }

    const trace = JSON.parse(await readFile(join(reports, 'workspace-followup-trace.json'), 'utf8')) as {
      status: string;
      processes: Array<{ state: string; exitCode: number | null }>;
      toolCalls: Array<{ state: string }>;
      artifacts: unknown[];
    };
    expect(trace.status).toBe('completed');
    expect(trace.artifacts).toHaveLength(1);
    expect(trace.processes.some(process => process.state === 'exited' && process.exitCode === 0)).toBe(true);
    expect(trace.toolCalls.every(call => call.state === 'completed')).toBe(true);
    expect(await readFile(join(project, 'sales-summary.md'), 'utf8')).toContain('121,000 VND');
  }, 20 * 60_000);
});
