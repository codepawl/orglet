import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { Task } from '../../apps/desktop/src/shared/contracts';

const directory = process.env.ORGLET_LIVE_SAAS_FOLLOWUP_DIR;
const enabled = process.env.ORGLET_LIVE_SAAS_FOLLOWUP === '1' && !!directory;
const terminal = new Set<Task['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'paused', 'waiting_budget', 'waiting_input']);

describe.runIf(enabled)('live Tallyloom team follow-up', () => {
  it('repairs the integrated CSS mismatch and reruns QA without replacing other roles files', async () => {
    const root = resolve(directory!);
    const projectDirectory = join(root, 'site');
    const reportsDirectory = join(root, 'reports');
    await mkdir(reportsDirectory, { recursive: true });
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
    const core = new CoreService(store, () => {}, async () => { throw new Error('This follow-up must use signed-in Codex CLI.'); },
      undefined, undefined, undefined, undefined, undefined, runtime);
    const task = store.all<Task>('tasks')[0];
    const revision = (task.inputRevision ?? 0) + 1;
    try {
      expect(terminal.has(task.status)).toBe(true);
      expect(task.status).not.toBe('completed');
      await core.command('reviseTask', {
        taskId: task.id,
        brief: [
          'Repair the existing local Tallyloom SaaS site. Read the current workspace brief, product-brief.md, index.html, app.js and styles.css before planning. The previous QA attempt found CSS/HTML selector mismatches; its failure is not a completed QA result.',
          'Assign only Visual designer to edit styles.css and QA reviewer to edit qa-report.md. QA depends on Visual designer. Product strategist and Frontend engineer already completed their files; do not rewrite product-brief.md, index.html or app.js.',
          'Visual designer: align all relevant selectors with the actual integrated HTML, especially .queue-card, .plan-card, .theme-panel, .contact-panel, .demo-toolbar and .billing-control. Preserve responsive 390px/1280px layout, visible focus, contrast and reduced-motion styling. Send QA a handoff. Own only styles.css.',
          'QA reviewer: after the CSS update integrates, inspect the actual HTML, CSS, JavaScript and product brief. Run node --check app.js and wait for exit code. Check selector alignment and required content. Write qa-report.md with what passed, failed and was not assessed. No browser-render or screen-reader claim without a browser tool. Lack of a browser is a limitation, not proof that static work failed. Own only qa-report.md.',
          'Use the team mailbox for blockers. Report assignmentOutcome blocked only if required work remains incomplete. Lead must preserve warnings and avoid claiming any unverified browser result. No deployment or network use.',
        ].join('\n'),
        sourceIds: [], consent: true, providerScopes: ['codex'], budgetMicros: 20_000_000,
      });
      const deadline = Date.now() + 35 * 60_000;
      while (Date.now() < deadline) {
        const current = store.get<Task>('tasks', task.id);
        if ((current.inputRevision ?? 0) === revision && terminal.has(current.status)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      const detail = store.detail(task.id);
      const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
      const runIds = new Set(runs.map(run => run.id));
      const trace = { taskId: task.id, revision, taskStatus: detail.task.status,
        runs: runs.map(run => ({ id: run.id, stage: run.stage, worker: run.snapshot.worker.name,
          status: run.status, error: run.error, plan: run.snapshot.plan })),
        events: detail.events.filter(event => runIds.has(event.runId)).map(event => ({ runId: event.runId,
          sequence: event.sequence, message: event.message, teamMessage: event.teamMessage })),
        artifacts: detail.artifacts.filter(artifact => runIds.has(artifact.runId)).map(artifact => ({
          id: artifact.id, runId: artifact.runId, title: artifact.report.title,
          summary: artifact.report.summary, limitations: artifact.report.limitations })),
        files: await readdir(projectDirectory), usage: detail.usage };
      await writeFile(join(reportsDirectory, 'followup-trace.json'), JSON.stringify(trace, null, 2));
      for (const [index, artifact] of detail.artifacts.filter(artifact => runIds.has(artifact.runId)).entries()) {
        await writeFile(join(reportsDirectory, `followup-artifact-${index + 1}.md`), core.exportMarkdown(artifact.id));
      }
      await core.runner.shutdown();
      store.close();
      console.log(`Live SaaS follow-up retained at ${root}`);
    }
    const trace = JSON.parse(await readFile(join(reportsDirectory, 'followup-trace.json'), 'utf8')) as {
      taskStatus: string; files: string[]; runs: Array<{ stage: string; status: string }>;
    };
    expect(trace.taskStatus).toBe('completed');
    expect(trace.files).toContain('qa-report.md');
    expect(trace.runs.filter(run => run.stage === 'member' && run.status === 'completed')).toHaveLength(2);
  }, 45 * 60_000);
});
