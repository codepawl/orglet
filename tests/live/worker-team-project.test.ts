import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Store } from '../../apps/desktop/src/core/storage/database';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

const enabled = process.env.ORGLET_LIVE_PROJECT === '1';
const terminalStatuses = new Set<Task['status']>(['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'paused', 'waiting_budget', 'waiting_input']);

async function waitForTask(store: Store, taskId: string): Promise<void> {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const task = store.get<Task>('tasks', taskId);
    if (terminalStatuses.has(task.status)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Task ${taskId} did not finish within 12 minutes.`);
}

describe.runIf(enabled)('live individual and team project', () => {
  it('runs both paths against the signed-in Codex CLI and retains their evidence', async () => {
    const base = resolve('test-results');
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(join(base, 'live-orglet-project-'));
    const project = join(directory, 'project');
    const reports = join(directory, 'reports');
    await mkdir(project);
    await mkdir(reports);
    await writeFile(join(project, 'brief.md'), [
      '# Weekend stationery pop-up',
      'A one-day pop-up will sell all available stock if demand allows.',
      'Fixed booth fee: 100,000 VND. No taxes, payment fees, or discounts are specified.',
      'Deliver a short plan that separates facts from assumptions and flags missing information.',
    ].join('\n'));
    await writeFile(join(project, 'inventory.csv'), [
      'item,units,unit_cost_vnd,unit_price_vnd',
      'Notebook,12,12000,20000',
      'Pen,20,5000,9000',
      'Sticker,15,3000,6000',
    ].join('\n'));

    const store = new Store(join(directory, 'orglet.sqlite'));
    const core = new CoreService(store, () => {}, async () => {
      throw new Error('This acceptance run must use the real Codex CLI, not an API adapter.');
    });
    const taskIds: Record<string, string> = {};
    try {
      const harnesses = await core.command('harnesses', { refresh: true }) as Array<{ id: string; status: string; auth: string }>;
      const codex = harnesses.find(harness => harness.id === 'codex');
      expect(codex, 'Codex CLI was not detected').toBeTruthy();
      expect(codex?.status, 'Codex CLI is not signed in').toBe('signed_in');

      const sources = await core.sources.import([join(project, 'brief.md'), join(project, 'inventory.csv')]);
      const defaultWorker = store.workspace().workers[0];
      const worker = await core.command('saveWorker', {
        ...defaultWorker,
        id: undefined,
        name: 'Pop-up analyst',
        instructions: 'Read the supplied sources. Calculate carefully, cite what you used, and do not invent missing costs.',
        provider: 'codex',
      }) as Worker;
      taskIds.individual = await core.command('createTask', {
        workerId: worker.id,
        brief: 'Create a concise one-day plan for the stationery pop-up. Calculate total sales, inventory cost, gross profit, and profit after the booth fee if every unit sells. Show the arithmetic and say what is unknown.',
        sourceIds: sources.map(source => source.id),
        consent: true,
        providerScopes: ['codex'],
        budgetMicros: 1_000_000,
      }) as string;
      await waitForTask(store, taskIds.individual);

      const numbersWorker = await core.command('saveWorker', {
        ...defaultWorker,
        id: undefined,
        name: 'Numbers checker',
        instructions: 'Check calculations from the supplied inventory and brief. State equations and assumptions clearly.',
        provider: 'codex',
      }) as Worker;
      const launchWorker = await core.command('saveWorker', {
        ...defaultWorker,
        id: undefined,
        name: 'Launch planner',
        instructions: 'Draft practical launch steps using the supplied brief. Do not invent demand or additional costs.',
        provider: 'codex',
      }) as Worker;
      const lead = await core.command('saveWorker', {
        ...defaultWorker,
        id: undefined,
        name: 'Pop-up lead',
        instructions: 'Assign the numbers check and launch plan to the right workers, then combine only their saved results. Preserve disagreements and missing information.',
        provider: 'codex',
      }) as Worker;
      const team = await core.command('saveTeam', {
        name: 'Pop-up trial team',
        instructions: 'Produce a concise, source-backed plan. Keep calculations and assumptions visible.',
        memberIds: [numbersWorker.id, launchWorker.id],
        synthesizerId: lead.id,
        workflow: 'parallel',
        monthlyBudgetMicros: 5_000_000,
      }) as Team;
      taskIds.team = await core.command('createTask', {
        workerId: lead.id,
        teamId: team.id,
        brief: 'Use the brief and inventory to produce a one-day pop-up plan. Have one worker verify the economics and another outline launch steps. The final answer must state total sales, inventory cost, gross profit, profit after booth fee, and any missing evidence.',
        sourceIds: sources.map(source => source.id),
        consent: true,
        providerScopes: ['codex'],
        budgetMicros: 1_000_000,
      }) as string;
      await waitForTask(store, taskIds.team);
    } finally {
      for (const [name, taskId] of Object.entries(taskIds)) {
        const detail = store.detail(taskId);
        const trace = {
          name,
          taskId,
          status: detail.task.status,
          runs: detail.runs.map(run => ({ id: run.id, stage: run.stage, status: run.status, provider: run.snapshot.worker.provider, worker: run.snapshot.worker.name, error: run.error, plan: run.snapshot.plan })),
          events: detail.events.map(event => ({ runId: event.runId, sequence: event.sequence, message: event.message, teamMessage: event.teamMessage })),
          artifacts: detail.artifacts.map(artifact => ({ id: artifact.id, runId: artifact.runId, title: artifact.report.title, summary: artifact.report.summary, limitations: artifact.report.limitations, findings: artifact.report.findings })),
          usage: detail.usage,
        };
        await writeFile(join(reports, `${name}-trace.json`), JSON.stringify(trace, null, 2));
        for (const [index, artifact] of detail.artifacts.entries()) {
          await writeFile(join(reports, `${name}-${index + 1}.md`), core.exportMarkdown(artifact.id));
        }
      }
      await core.runner.shutdown();
      store.close();
      console.log(`Live project retained at ${directory}`);
    }

    const saved = new Store(join(directory, 'orglet.sqlite'));
    try {
      const individual = saved.detail(taskIds.individual);
      const team = saved.detail(taskIds.team);
      expect(individual.task.status).toBe('completed');
      expect(individual.artifacts).toHaveLength(1);
      expect(team.task.status).toBe('completed');
      expect(team.runs.some(run => run.stage === 'plan' && run.status === 'completed')).toBe(true);
      expect(team.runs.filter(run => run.stage === 'member' && run.status === 'completed')).toHaveLength(2);
      expect(team.runs.some(run => run.stage === 'synthesis' && run.status === 'completed')).toBe(true);
      expect(team.artifacts).toHaveLength(3);
    } finally {
      saved.close();
    }
  }, 25 * 60_000);
});
