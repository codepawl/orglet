import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const enabled = process.env.ORGLET_LIVE_SAAS === '1';

describe.runIf(enabled)('live SaaS sales site by a four-role Orglet team', () => {
  it('plans, builds, checks and retains a local site with real Codex and Windows isolation', async () => {
    const testResults = resolve('test-results');
    await mkdir(testResults, { recursive: true });
    const directory = await mkdtemp(join(testResults, 'live-saas-team-'));
    const projectDirectory = join(directory, 'site');
    const reportsDirectory = join(directory, 'reports');
    const stateDirectory = join(directory, 'workspaces');
    await mkdir(projectDirectory);
    await mkdir(reportsDirectory);
    await writeFile(join(projectDirectory, 'brief.md'), [
      '# Tallyloom sales-site brief',
      '',
      'Tallyloom is a fictional SaaS prototype for small product teams that collect and triage customer feedback in one place.',
      'Audience: a founder or product manager with a 3–10 person team and feedback scattered across email, chat and notes.',
      'Promise: one calm queue, clear ownership, and a weekly view of recurring requests. Do not claim live integrations or paying customers.',
      '',
      'Build a local static sales site, not a backend or deployed service. No external packages, fonts, images, network calls, forms that transmit data, or real payment flow.',
      'Required page: clear hero and CTA, three concrete feature explanations, interactive sample feedback queue, pricing with monthly/annual switch, FAQ, and closing CTA.',
      'Example plans only: Starter $19/month for 3 seats, Team $49/month for 10 seats. Annual billing uses a 20% illustrative discount.',
      'Primary CTA must lead to the local interactive demo section. Pricing buttons can point to the local contact section, which must state that signup is unavailable in this prototype.',
      'Accessibility: semantic HTML, visible keyboard focus, labeled controls, sufficient contrast, reduced-motion support. Responsive at 390px and 1280px.',
      '',
      'File ownership: product writes product-brief.md; design writes styles.css; frontend writes index.html and app.js; QA writes qa-report.md.',
      'The product role goes first. Design and frontend may run in parallel after its handoff. QA runs only after both files are integrated.',
      'Do not edit another role’s owned files. Communicate blockers and handoffs through Orglet team messages. A final report is not a substitute for creating the files.',
    ].join('\n'));

    const store = new Store(join(directory, 'orglet.sqlite'));
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
      throw new Error('This acceptance run must use the signed-in Codex CLI.');
    }, undefined, undefined, undefined, undefined, undefined, runtime);
    let taskId: string | undefined;
    try {
      const harnesses = await core.command('harnesses', { refresh: true }) as Array<{ id: string; status: string; version?: string }>;
      const codex = harnesses.find(harness => harness.id === 'codex');
      expect(codex?.status, 'Codex CLI must be signed in').toBe('signed_in');
      await writeFile(join(reportsDirectory, 'environment.json'), JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        codexVersion: codex?.version ?? null,
      }, null, 2));

      const template = store.workspace().workers[0];
      const roles: Array<{ name: string; instructions: string }> = [
        { name: 'Product strategist', instructions: 'Own product-brief.md only. Read brief.md, define audience, honest value proposition, page structure, concrete copy and acceptance criteria. Hand off to design and frontend.' },
        { name: 'Visual designer', instructions: 'Own styles.css only. Read brief.md and product-brief.md. Make a polished, calm responsive SaaS sales page with visible focus and reduced motion. Coordinate selectors with frontend through team messages. Do not edit HTML or JavaScript.' },
        { name: 'Frontend engineer', instructions: 'Own index.html and app.js only. Read brief.md and product-brief.md. Build semantic, accessible static markup and working local demo, pricing switch and FAQ. No external dependencies or network. Do not edit CSS.' },
        { name: 'QA reviewer', instructions: 'Own qa-report.md only. Read the integrated HTML, CSS and JS; run at least one real Node check through the workspace process tools and wait for exit code. State observed passes, failures and gaps without claiming browser testing you did not do.' },
      ];
      const members: Worker[] = [];
      for (const role of roles) {
        members.push(await core.command('saveWorker', {
          ...template,
          id: undefined,
          name: role.name,
          instructions: role.instructions,
          provider: 'codex',
        }) as Worker);
      }
      const lead = await core.command('saveWorker', {
        ...template,
        id: undefined,
        name: 'Site lead',
        instructions: 'Plan the four owned assignments and dependencies exactly as brief.md describes. Preserve failed roles and QA findings. Final answer names files actually created and what remains unverified.',
        provider: 'codex',
      }) as Worker;
      const team = await core.command('saveTeam', {
        name: 'Tallyloom site team',
        instructions: 'Create the local Tallyloom sales site in the granted workspace. Product precedes design and frontend; QA follows both. Workers edit only their assigned files. No deployment.',
        memberIds: members.map(member => member.id),
        synthesizerId: lead.id,
        workflow: 'parallel',
        monthlyBudgetMicros: 20_000_000,
      }) as Team;
      const task: Task = {
        id: id(),
        workerId: lead.id,
        teamId: team.id,
        teamSnapshot: team,
        brief: 'Build a medium-sized, local sales site for the fictional Tallyloom SaaS from brief.md. Assign all four roles with the documented ownership and dependencies. The finished site must have a responsive landing page, honest pricing, an interactive feedback queue demo, a billing switch, FAQ, and QA evidence. Integrate files before the lead reports completion; surface blockers and incomplete work.',
        sourceIds: [],
        consent: true,
        providerScopes: ['codex'],
        budgetMicros: 20_000_000,
        accepted: false,
        status: 'queued',
        createdAt: now(),
        inputRevision: 0,
      };
      taskId = task.id;
      store.put('tasks', task);
      await core.grantWorkspace({ taskId: task.id, directory: projectDirectory, permissions: ['read', 'write', 'execute'] });
      await core.teams.run(task, team);
    } finally {
      if (taskId) {
        const detail = store.detail(taskId);
        const journal = store.db.prepare('SELECT run_id,call_id,state,replay FROM tool_calls').all();
        const trace = {
          taskId,
          taskStatus: detail.task.status,
          runs: detail.runs.map(run => ({
            id: run.id,
            stage: run.stage,
            worker: run.snapshot.worker.name,
            status: run.status,
            error: run.error,
            plan: run.snapshot.plan,
          })),
          events: detail.events.map(event => ({
            runId: event.runId,
            sequence: event.sequence,
            message: event.message,
            teamMessage: event.teamMessage,
          })),
          toolCalls: journal,
          artifacts: detail.artifacts.map(artifact => ({
            id: artifact.id,
            runId: artifact.runId,
            title: artifact.report.title,
            summary: artifact.report.summary,
            limitations: artifact.report.limitations,
          })),
          files: await readdir(projectDirectory),
          usage: detail.usage,
        };
        await writeFile(join(reportsDirectory, 'trace.json'), JSON.stringify(trace, null, 2));
        for (const [index, artifact] of detail.artifacts.entries()) {
          await writeFile(join(reportsDirectory, `artifact-${index + 1}.md`), core.exportMarkdown(artifact.id));
        }
      }
      await core.runner.shutdown();
      store.close();
      console.log(`Live SaaS site retained at ${directory}`);
    }

    const trace = JSON.parse(await readFile(join(reportsDirectory, 'trace.json'), 'utf8')) as {
      taskStatus: string;
      runs: Array<{ stage: string; status: string }>;
      files: string[];
    };
    expect(trace.taskStatus).toBe('completed');
    expect(trace.runs.filter(run => run.stage === 'member' && run.status === 'completed')).toHaveLength(4);
    expect(trace.files).toEqual(expect.arrayContaining(['brief.md', 'product-brief.md', 'index.html', 'styles.css', 'app.js', 'qa-report.md']));
  }, 50 * 60_000);
});
