import { describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { Task } from '../../apps/desktop/src/shared/contracts';

const directory = process.env.ORGLET_LIVE_SAAS_REPAIR_DIR;
const enabled = process.env.ORGLET_LIVE_SAAS_REPAIR === '1' && !!directory;
const terminalStatuses = new Set<Task['status']>([
  'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'paused', 'waiting_budget', 'waiting_input',
]);

describe.runIf(enabled)('live SaaS team repair turn', () => {
  it('replans exact ownership and finishes the incomplete sales site', async () => {
    const root = resolve(directory!);
    const reportsDirectory = join(root, 'reports');
    const projectDirectory = join(root, 'site');
    const previousTrace = JSON.parse(await readFile(join(reportsDirectory, 'trace.json'), 'utf8')) as { taskId: string };
    const store = new Store(join(root, 'orglet.sqlite'));
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(resolve('node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe')),
      helperPath: resolve('.vite/build/workspace-helper.cjs'),
      stateDirectory: join(root, 'workspaces'),
      runtimeExecutable: process.execPath,
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, resolve('out/native-tools/WorkspaceIntegrate.exe'), join(root, 'workspaces')),
      () => {}, files);
    const core = new CoreService(store, () => {}, async () => {
      throw new Error('This repair run must use the real Codex CLI.');
    }, undefined, undefined, undefined, undefined, undefined, runtime);
    let expectedRevision: number | undefined;
    try {
      const before = store.get<Task>('tasks', previousTrace.taskId);
      expect(before.status).toBe('partial');
      expectedRevision = (before.inputRevision ?? 0) + 1;
      await core.command('reviseTask', {
        taskId: before.id,
        brief: [
          'Repair the incomplete local Tallyloom SaaS sales site. The previous turn is partial and its report explains the wrong write resources. Treat that history as evidence, not as completed deliverables.',
          'The planner cannot read workspace files, so use this exact ownership map in submit_plan.writeResources:',
          'Product strategist: ["product-brief.md"] only. It must create that file first from brief.md.',
          'Visual designer: ["styles.css"] only. It depends on Product strategist and must create responsive styling for the existing page.',
          'Frontend engineer: ["index.html", "app.js"] only. It depends on Product strategist, may run parallel with Visual designer, must make the local demo, monthly/annual pricing switch and FAQ work, and must point index.html to styles.css and app.js. Move any useful script from the old src/app.js into root app.js without editing src/app.js.',
          'QA reviewer: ["qa-report.md"] only. It depends on Product strategist, Visual designer and Frontend engineer; it must run Node syntax/check commands in the workspace, wait for exit codes, and record actual results and remaining gaps.',
          'Do not assign brief.md, styles, src or QA.md as write resources. Every worker must write its required file before submitting a report. A blocker-only report is not completion. Final synthesis must list files that actually exist and any failed checks. No deployment or network use.',
        ].join('\n'),
        sourceIds: [],
        consent: true,
        providerScopes: ['codex'],
        budgetMicros: 20_000_000,
      });
      const deadline = Date.now() + 35 * 60_000;
      while (Date.now() < deadline) {
        const task = store.get<Task>('tasks', before.id);
        if ((task.inputRevision ?? 0) === expectedRevision && terminalStatuses.has(task.status)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      const detail = store.detail(previousTrace.taskId);
      const revision = expectedRevision ?? detail.task.inputRevision ?? 0;
      const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
      const runIds = new Set(runs.map(run => run.id));
      const toolCalls = store.db.prepare('SELECT run_id,call_id,state,replay FROM tool_calls').all()
        .filter(call => runIds.has(String(call.run_id)));
      const processes = store.db.prepare('SELECT data FROM workspace_processes').all()
        .map(row => JSON.parse(String(row.data)) as { runId: string; state: string; exitCode: number | null })
        .filter(process => runIds.has(process.runId));
      const trace = {
        taskId: detail.task.id,
        revision,
        taskStatus: detail.task.status,
        runs: runs.map(run => ({
          id: run.id,
          stage: run.stage,
          worker: run.snapshot.worker.name,
          status: run.status,
          error: run.error,
          plan: run.snapshot.plan,
        })),
        events: detail.events.filter(event => runIds.has(event.runId)).map(event => ({
          runId: event.runId,
          sequence: event.sequence,
          message: event.message,
          teamMessage: event.teamMessage,
        })),
        artifacts: detail.artifacts.filter(artifact => runIds.has(artifact.runId)).map(artifact => ({
          id: artifact.id,
          runId: artifact.runId,
          title: artifact.report.title,
          summary: artifact.report.summary,
          limitations: artifact.report.limitations,
        })),
        toolCalls,
        processes,
        files: await readdir(projectDirectory),
        usage: detail.usage,
      };
      await writeFile(join(reportsDirectory, 'repair-trace.json'), JSON.stringify(trace, null, 2));
      for (const [index, artifact] of detail.artifacts.filter(artifact => runIds.has(artifact.runId)).entries()) {
        await writeFile(join(reportsDirectory, `repair-artifact-${index + 1}.md`), core.exportMarkdown(artifact.id));
      }
      await core.runner.shutdown();
      store.close();
      console.log(`Live SaaS repair retained at ${root}`);
    }

    const trace = JSON.parse(await readFile(join(reportsDirectory, 'repair-trace.json'), 'utf8')) as {
      taskStatus: string;
      runs: Array<{ stage: string; status: string }>;
      files: string[];
    };
    expect(trace.taskStatus).toBe('completed');
    expect(trace.runs.filter(run => run.stage === 'member' && run.status === 'completed')).toHaveLength(4);
    expect(trace.files).toEqual(expect.arrayContaining([
      'brief.md', 'product-brief.md', 'index.html', 'styles.css', 'app.js', 'qa-report.md',
    ]));
  }, 45 * 60_000);
});
