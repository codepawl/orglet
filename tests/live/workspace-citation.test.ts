import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

describe.runIf(process.env.ORGLET_LIVE_CITATION === '1')('real Codex team workspace citation', () => {
  it('keeps a QA finding about a file integrated by the prior worker', async () => {
    const root = resolve('test-results');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'live-citation-'));
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    await writeFile(join(workspace, 'note.txt'), 'state=old\n');
    const store = new Store(join(directory, 'orglet.sqlite'));
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(resolve('node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe')),
      helperPath: resolve('.vite/build/workspace-helper.cjs'),
      stateDirectory: join(directory, 'copies'),
      runtimeExecutable: process.execPath,
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, resolve('out/native-tools/WorkspaceIntegrate.exe'), join(directory, 'copies')),
      () => {}, files);
    let writerId = '';
    let qaId = '';
    const lead: ModelAdapter = { request: async (_messages, tools) => {
      const isPlan = tools.some(tool => tool.type === 'function' && tool.function.name === 'submit_plan');
      const name = isPlan ? 'submit_plan' : 'submit_report';
      const argumentsValue = isPlan ? { assignments: [
        { workerId: writerId, brief: 'Read note.txt, replace state=old with state=new using workspace_write, then finish.',
          expectedOutput: 'Changed note.txt', writeResources: ['note.txt'], dependsOn: [] },
        { workerId: qaId, brief: 'Read the integrated note.txt. Submit a structured report with one finding that cites the workspace_read evidenceId and confirms state=new.',
          expectedOutput: 'Cited QA finding', writeResources: [], dependsOn: [writerId] },
      ] } : { title: 'Team result', summary: 'Writer and QA completed; see their saved artifacts.',
        findings: [], limitations: [] };
      return { calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 10, output: 10 } };
    } };
    const core = new CoreService(store, () => {}, async () => lead, undefined, undefined, undefined,
      undefined, undefined, runtime);
    let taskId = '';
    try {
      const harnesses = await core.command('harnesses', { refresh: true }) as Array<{ id: string; status: string; version?: string }>;
      const codex = harnesses.find(item => item.id === 'codex');
      expect(codex?.status, 'Signed-in Codex CLI required').toBe('signed_in');
      await writeFile(join(directory, 'environment.json'), JSON.stringify({ codexVersion: codex?.version,
        platform: process.platform, arch: process.arch }, null, 2));
      const template = store.workspace().workers[0];
      const writer = await core.command('saveWorker', { ...template, id: undefined, name: 'Writer', provider: 'codex',
        instructions: 'Use granted workspace tools to edit note.txt exactly as assigned. Do not claim completion before the file edit succeeds.' }) as Worker;
      const qa = await core.command('saveWorker', { ...template, id: undefined, name: 'QA', provider: 'codex',
        instructions: 'Read the integrated note.txt and submit a structured report with a finding. Cite only the evidenceId returned by your own workspace_read. Do not invent source IDs.' }) as Worker;
      const coordinator = await core.command('saveWorker', { ...template, id: undefined, name: 'Lead', provider: 'openai',
        instructions: 'Coordinate Writer then QA.' }) as Worker;
      writerId = writer.id;
      qaId = qa.id;
      const team = await core.command('saveTeam', { name: 'Citation trial', instructions: 'Writer then QA.',
        memberIds: [writer.id, qa.id], synthesizerId: coordinator.id, workflow: 'sequential',
        monthlyBudgetMicros: 20_000_000 }) as Team;
      const task: Task = { id: id(), workerId: coordinator.id, teamId: team.id, teamSnapshot: team,
        brief: 'Change note.txt to state=new, then have QA cite its own read of the integrated file.',
        sourceIds: [], consent: true, providerScopes: ['openai', 'codex'], budgetMicros: 20_000_000,
        accepted: false, status: 'queued', createdAt: now(), inputRevision: 0 };
      taskId = task.id;
      store.put('tasks', task);
      await core.grantWorkspace({ taskId, directory: workspace, permissions: ['read', 'write'] });
      await core.teams.run(task, team);
      const detail = store.detail(taskId);
      const qaRun = detail.runs.find(run => run.stage === 'member' && run.snapshot.worker.id === qa.id);
      const qaArtifact = detail.artifacts.find(artifact => artifact.runId === qaRun?.id);
      const result = { taskStatus: detail.task.status, file: await readFile(join(workspace, 'note.txt'), 'utf8'),
        runs: detail.runs.map(run => ({ stage: run.stage, worker: run.snapshot.worker.name, status: run.status, error: run.error })),
        qaFindings: qaArtifact?.report.findings ?? [], evidence: detail.workspaceEvidence };
      await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
      expect(result.taskStatus).toBe('completed');
      expect(result.file).toBe('state=new\n');
      expect(qaArtifact?.report.findings[0].workspaceEvidenceIds?.[0]).toBeTruthy();
      expect(result.evidence.find(item => item.id === qaArtifact?.report.findings[0].workspaceEvidenceIds?.[0])?.grantCurrent).toBe(true);
    } finally {
      await core.runner.shutdown();
      store.close();
      console.log(`Citation trial retained at ${directory}; task ${taskId || 'not created'}`);
    }
  }, 12 * 60_000);
});
