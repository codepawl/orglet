import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { TeamRecovery } from '../../apps/desktop/src/core/orchestration/team-recovery';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { ToolCalls } from '../../apps/desktop/src/core/storage/tool-calls';
import { toolDefinitions } from '../../apps/desktop/src/core/tools/catalog';
import { isHarness, missingHarness } from '../../apps/desktop/src/shared/harness';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { isPlanRequest, memberIdsFromPlanPrompt } from './team-plan';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { toolDefinitions.reassign_team_work.timeoutMs = 900000; store.close(); });

function fixture() {
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const recipient = { ...worker, id: id(), name: 'Recipient' };
  const leadWorker = { ...worker, id: id(), name: 'Lead' };
  const skill = store.all<Skill>('skills')[0];
  const team: Team = { id: id(), revision: 1, name: 'Team', instructions: 'Coordinate', memberIds: [worker.id, recipient.id],
    synthesizerId: leadWorker.id, workflow: 'parallel', monthlyBudgetMicros: 1_000_000 };
  const task: Task = { id: id(), teamId: team.id, workerId: leadWorker.id, brief: 'Work', sourceIds: [],
    status: 'running', consent: true, accepted: false, createdAt: now(), budgetMicros: 1_000_000, inputRevision: 1 };
  store.put('tasks', task);
  const assignment = { workerId: worker.id, brief: 'Fix notes', expectedOutput: 'Updated notes', writeResources: ['notes'], dependsOn: [] };
  const source: Run = { id: id(), taskId: task.id, stage: 'member', status: 'failed', startedAt: now(), error: 'Failed',
    snapshot: { worker, skill, team, inputRevision: 1, assignment, toolCapabilities: ['source.read'] } };
  const target: Run = { ...source, id: id(), status: 'cancelled', snapshot: { ...source.snapshot, worker: recipient,
    assignment: undefined, toolCapabilities: ['source.read', 'network.web'] } };
  const lead: Run = { ...source, id: id(), stage: 'synthesis', status: 'running', snapshot: { ...source.snapshot, worker: leadWorker, assignment: undefined } };
  const plan: Run = { ...lead, id: id(), stage: 'plan', status: 'completed', snapshot: { ...lead.snapshot, plan: { assignments: [assignment] } } };
  for (const run of [source, target, lead, plan]) store.put('runs', run, { column: 'task_id', value: task.id });
  const input = { assignmentWorkerId: worker.id, newWorkerId: recipient.id, reason: 'Try another frozen team member' };
  return { source, target, lead, task, input, recovery: new TeamRecovery(store) };
}

it('retains frozen resources and intersects permissions while replaying a decision once', () => {
  const { source, target, lead, input, recovery } = fixture();
  const prepared = recovery.prepare(lead, 'decision', input);
  expect(prepared.snapshot.assignment).toEqual(source.snapshot.assignment);
  expect(prepared.snapshot.worker).toEqual(target.snapshot.worker);
  expect(prepared.snapshot.toolCapabilities).toEqual(['source.read']);
  expect(prepared.snapshot.reassignment?.sourceRunId).toBe(source.id);
  expect(new TeamRecovery(store).prepare(lead, 'decision', input).id).toBe(prepared.id);
  expect(() => recovery.prepare(lead, 'decision', { ...input, reason: 'Changed' })).toThrow('nội dung khác');
  expect(store.detail(lead.taskId).runs.filter(run => run.snapshot.reassignment)).toHaveLength(1);
});

it('rejects workers, foreign recipients and stale turns', () => {
  const { source, lead, task, input, recovery } = fixture();
  expect(() => recovery.prepare(source, 'worker-decision', input)).toThrow('trưởng nhóm');
  expect(() => recovery.prepare(lead, 'foreign', { ...input, newWorkerId: id() })).toThrow('thành viên');
  store.update('tasks', { ...task, inputRevision: 2 });
  expect(() => recovery.prepare(lead, 'stale', input)).toThrow('trưởng nhóm');
});

it('prevents another attempt while queued and stops after two failed reassignments', () => {
  const { lead, input, recovery } = fixture();
  const first = recovery.prepare(lead, 'first', input);
  expect(() => recovery.prepare(lead, 'concurrent', input)).toThrow('chưa hoàn tất');
  store.update('runs', { ...first, status: 'failed' });
  const second = recovery.prepare(lead, 'second', input);
  store.update('runs', { ...second, status: 'failed' });
  expect(() => recovery.prepare(lead, 'third', input)).toThrow('hai lần');
});

it('does not reassign a completed assignment', () => {
  const { source, lead, input, recovery } = fixture();
  store.update('runs', { ...source, status: 'completed' });
  expect(() => recovery.prepare(lead, 'duplicate', input)).toThrow('chưa hoàn tất');
});

it.each(['queued', 'completed'] as const)('recovers the same decision after an interruption before journal commit (child=%s)', async status => {
  const { lead, input, recovery } = fixture();
  let createdId = '';
  const operation = { runId: lead.id, callId: 'interrupted-decision', name: 'reassign_team_work', arguments: input,
    replay: 'idempotent' as const, authorize: () => {} };
  await expect(new ToolCalls(store).execute({ ...operation, perform: () => {
    const attempt = recovery.prepare(lead, operation.callId, input);
    createdId = attempt.id;
    store.update('runs', { ...attempt, status });
    throw new Error('Injected interruption before tool journal commit');
  } })).rejects.toThrow('Injected interruption');
  const resumed = await new ToolCalls(store).execute({ ...operation, perform: () => {
    const retained = new TeamRecovery(store).prepare(lead, operation.callId, input);
    return { id: retained.id, status: retained.status };
  } });
  expect(resumed).toEqual({ id: createdId, status });
  expect(store.detail(lead.taskId).runs.filter(run => run.snapshot.reassignment)).toHaveLength(1);
  expect(store.db.prepare('SELECT state FROM tool_calls WHERE run_id=?').get(lead.id)?.state).toBe('completed');
  await expect(new ToolCalls(store).execute({ ...operation, perform: () => { throw new Error('Must use committed journal output'); } })).resolves.toEqual(resumed);
});

it.each((['openai', 'claude-code', 'codex', 'cursor'] as const).flatMap(provider =>
  (['complete', 'pause', 'timeout'] as const).map(mode => ({ provider, mode }))))('recovers a prerequisite with $provider (mode=$mode)', async ({ provider, mode }) => {
  if (mode === 'timeout') toolDefinitions.reassign_team_work.timeoutMs = 200;
  let firstId = '';
  let secondId = '';
  let prerequisiteAttempts = 0;
  let decisions = 0;
  let dependentCalls = 0;
  const adapter: ModelAdapter = { request: async (messages, tools, signal) => {
    const respond = (name: string, input: unknown) => ({ calls: [{ id: id(), name, arguments: JSON.stringify(input) }], usage: { input: 10, output: 10 } });
    if (isPlanRequest(tools)) {
      [firstId, secondId] = memberIdsFromPlanPrompt(messages);
      return respond('submit_plan', { assignments: [
        { workerId: firstId, brief: 'recover-prerequisite', expectedOutput: 'Evidence' },
        { workerId: secondId, brief: 'consume-recovered-evidence', dependsOn: [firstId] },
      ] });
    }
    const context = messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
    if (context.includes('"assignment":"recover-prerequisite')) {
      prerequisiteAttempts++;
      if (prerequisiteAttempts === 1) throw new Error('Injected first attempt failure');
      if (mode === 'timeout') {
        await new Promise<void>((_resolve, reject) => {
          signal.throwIfAborted();
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return respond('submit_report', { title: 'Recovered', summary: 'committed-recovery-evidence', findings: [], limitations: [] });
    }
    if (context.includes('"assignment":"consume-recovered-evidence')) {
      dependentCalls++;
      expect(context).toContain('committed-recovery-evidence');
      return respond('submit_report', { title: 'Dependent', summary: 'Used recovered evidence', findings: [], limitations: [] });
    }
    if (!decisions++) {
      const coordination = messages.flatMap(message => {
        if (typeof message.content !== 'string') return [];
        try { return [JSON.parse(message.content)]; } catch { return []; }
      }).find(message => message.assignments);
      expect(coordination.assignments.find((assignment: { workerId: string }) => assignment.workerId === firstId).status).toBe('failed');
      expect(coordination.assignments.find((assignment: { workerId: string }) => assignment.workerId === secondId).dependsOn).toEqual([firstId]);
      return respond('reassign_team_work', { assignmentWorkerId: firstId, newWorkerId: secondId, reason: 'Retry with another member' });
    }
    expect(context).toContain('committed-recovery-evidence');
    if (mode !== 'timeout') {
      expect(context).toContain(`"completedBy":{"workerId":"${secondId}"`);
      expect(context).not.toContain(`"completedBy":{"workerId":"${firstId}"`);
    }
    if (mode === 'pause' && decisions === 2) {
      core.teams.pause(store.all<Task>('tasks').find(task => task.status === 'running')!.id);
      return respond('read_team_messages', {});
    }
    return respond('submit_report', { title: 'Complete', summary: 'Both assignments completed', findings: [], limitations: [] });
  } };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, {
    detect: async () => isHarness(provider) ? [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in' }] : [],
    execute: async request => {
      expect(request.coreToolsOnly).toBe(true);
      const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
      const response = await adapter.request(context.messages, context.tools, request.signal, () => {});
      const call = response.calls[0];
      return { output: { call: { name: call.name, arguments: JSON.parse(call.arguments) } }, costUsd: null };
    },
  });
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  for (const workerId of [...team.memberIds, team.synthesizerId]) {
    await core.command('saveWorker', { ...store.get<Worker>('workers', workerId), provider });
  }
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Recover work', sourceIds: [], consent: true, providerScopes: [provider], budgetMicros: 1_000_000 }) as string;
  for (let attempt = 0; attempt < 300 && core.teams.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
  if (mode === 'timeout') {
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('failed');
    expect(detail.runs.find(run => run.snapshot.reassignment)?.status).toBe('cancelled');
    expect(core.runner.isActive(taskId)).toBe(false);
    expect(prerequisiteAttempts).toBe(2);
    expect(dependentCalls).toBe(0);
    expect(detail.artifacts).toHaveLength(0);
    return;
  }
  if (mode === 'pause') {
    expect(store.detail(taskId).task.status).toBe('paused');
    await core.command('resume', { id: taskId });
    for (let attempt = 0; attempt < 300 && core.teams.isActive(taskId); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(core.teams.isActive(taskId)).toBe(false);
  }
  const detail = store.detail(taskId);
  expect(detail.task.status, JSON.stringify(detail.runs.map(run => ({ stage: run.stage, status: run.status, error: run.error })))).toBe('completed');
  expect(prerequisiteAttempts).toBe(2);
  expect(dependentCalls).toBe(1);
  expect(detail.runs.filter(run => run.snapshot.reassignment)).toHaveLength(1);
  expect(detail.artifacts).toHaveLength(3);
  expect(detail.artifacts.at(-1)?.report.limitations).toEqual([]);
  const backup = new Backups(store, () => false, () => {}).export();
  const restored = new Store(':memory:');
  try {
    const manager = new Backups(restored, () => false, () => {});
    manager.restore(manager.preview(backup).token);
    const restoredAttempt = restored.detail(taskId).runs.find(run => run.snapshot.reassignment);
    expect(restoredAttempt?.snapshot.reassignment).toEqual(detail.runs.find(run => run.snapshot.reassignment)?.snapshot.reassignment);
    expect(restoredAttempt?.status).toBe('completed');
    if (mode === 'complete') {
      const mutations: Array<(attempt: Run) => void> = [
        attempt => { attempt.snapshot.reassignment!.sourceRunId = attempt.id; },
        attempt => { attempt.snapshot.reassignment!.decisionRunId = attempt.snapshot.reassignment!.sourceRunId; },
        attempt => { attempt.snapshot.assignment!.writeResources = ['outside-assignment']; },
        attempt => { attempt.snapshot.toolCapabilities = ['network.web']; },
      ];
      for (const mutate of mutations) {
        const envelope = JSON.parse(backup);
        const attempt = (envelope.payload.runs as Run[]).find(run => run.snapshot.reassignment)!;
        mutate(attempt);
        envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
        expect(() => manager.preview(JSON.stringify(envelope))).toThrow('Quyết định giao lại việc không hợp lệ');
      }
    }
  } finally {
    restored.close();
  }
});

it('keeps the working folder when a retried turn reassigns work (COD-188)', () => {
  const { source, target, lead, task, input, recovery } = fixture();
  const grant = { id: id(), taskId: task.id, revision: 1, permissions: ['read', 'write', 'execute'] as ('read' | 'write' | 'execute')[] };
  const started = { frozenAt: now() } as unknown as NonNullable<Run['snapshot']['context']>;
  store.update('runs', { ...source, snapshot: { ...source.snapshot, workspaceGrant: grant, context: started } });
  // The retry's attempt for the recipient comes after the first, cancelled one that had no folder yet.
  const retried: Run = { ...target, id: id(), status: 'failed', snapshot: { ...target.snapshot, workspaceGrant: grant, context: started } };
  store.put('runs', retried, { column: 'task_id', value: task.id });
  const prepared = recovery.prepare(lead, 'after-retry', input);
  expect(prepared.snapshot.workspaceGrant).toEqual(grant);
});
