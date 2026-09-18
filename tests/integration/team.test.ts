import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { INVALID_PLAN_ERROR, MISSING_PLAN_ERROR, UNASSIGNED_PLAN_ERROR } from '../../apps/desktop/src/shared/contracts';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { nextTeamMessage } from '../../apps/desktop/src/shared/live-task';
import { isPlanRequest, planReply } from './team-plan';

let directory: string; let store: Store; let core: CoreService;
let failReviewer: boolean; let planMode: 'all' | 'first' | 'invalid' | 'fail'; let calls: string[]; let live: number; let peak: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-team-')); store = new Store(join(directory, 'state.sqlite'));
  failReviewer = false; planMode = 'all'; calls = []; live = 0; peak = 0;
  const adapter: ModelAdapter = { async request(messages, tools) {
    if (isPlanRequest(tools)) {
      if (planMode === 'fail') throw new Error('Injected plan failure');
      if (planMode === 'invalid') return { calls: [{ id: 'plan', name: 'submit_plan', arguments: JSON.stringify({ assignments: [{ workerId: '00000000-0000-4000-8000-000000000000', brief: 'Nope' }] }) }], usage: { input: 10, output: 10 } };
      return planReply(messages, planMode === 'first' ? ids => ids.slice(0, 1) : undefined);
    }
    const system = String(messages[0].content); calls.push(system); live++; peak = Math.max(peak, live);
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (failReviewer && system.includes('Check whether the source evidence')) throw new Error('Injected failure');
      return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Fixture report', summary: 'No source evidence provided.', findings: [], limitations: ['No files were supplied.'] }) }], usage: { input: 500, output: 100 } };
    } finally { live--; }
  } };
  core = new CoreService(store, () => {}, async () => adapter);
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Review only supplied evidence', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await done(taskId); return { team, taskId };
}
async function done(taskId: string) {
  for (let i = 0; i < 200 && core.teams.isActive(taskId); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
}
it('joins independent artifacts, keeps source scopes local and uses at most two parallel members', async () => {
  const { team, taskId } = await setup(); const detail = store.detail(taskId);
  expect(detail.task.status).toBe('completed'); expect(detail.runs).toHaveLength(4); expect(detail.artifacts).toHaveLength(3);
  expect(peak).toBe(2);
  const plan = detail.runs.find(run => run.stage === 'plan')!;
  expect(plan.status).toBe('completed'); expect(plan.snapshot.plan?.assignments).toHaveLength(2);
  expect(detail.artifacts.some(artifact => artifact.runId === plan.id)).toBe(false);
  const synthesis = detail.runs.find(run => run.stage === 'synthesis')!;
  expect(synthesis.snapshot.upstreamArtifactIds).toHaveLength(2);
  expect(new Set(detail.artifacts.map(a => a.id)).size).toBe(3);
  const other = await core.command('createTemplate', { templateId: 'research-review', provider: 'demo' }) as Team;
  expect(other.memberIds.some(id => team.memberIds.includes(id))).toBe(false);
});
it('preserves a failed role as partial and retries only missing members before a new join', async () => {
  failReviewer = true; const { taskId } = await setup(); const before = store.detail(taskId);
  expect(before.task.status).toBe('partial'); expect(before.artifacts).toHaveLength(2);
  expect(before.artifacts.at(-1)!.report.limitations.join(' ')).toContain('Role chưa hoàn tất');
  const retained = before.artifacts[0].id;
  failReviewer = false; await core.command('retry', { id: taskId }); await done(taskId);
  const after = store.detail(taskId); expect(after.task.status).toBe('completed'); expect(after.runs).toHaveLength(6);
  expect(after.artifacts.filter(a => a.id === retained)).toHaveLength(1); expect(after.artifacts).toHaveLength(4);
});
it('sequential members receive only already committed results from their task', async () => {
  const template = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, workflow: 'sequential' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Sequential fixture', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await done(taskId); const detail = store.detail(taskId);
  const members = detail.runs.filter(run => run.stage === 'member');
  expect(peak).toBe(1); expect(members[0].snapshot.upstreamArtifactIds).toEqual([]); expect(members[1].snapshot.upstreamArtifactIds).toHaveLength(1);
  expect(detail.runs.find(run => run.stage === 'synthesis')!.snapshot.upstreamArtifactIds).toHaveLength(2);
});
it('cancel prevents a synthesis dispatch and leaves committed outputs intact', async () => {
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Cancel fixture', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await core.command('cancel', { id: taskId }); await done(taskId);
  expect(store.detail(taskId).task.status).toBe('cancelled');
  const synthesis = store.detail(taskId).runs.find(run => run.stage === 'synthesis')!;
  expect(synthesis.status).toBe('cancelled');
  expect(store.db.prepare('SELECT * FROM reservations WHERE run_id=?').all(synthesis.id)).toEqual([]);
  expect(store.detail(taskId).artifacts.some(artifact => artifact.runId === synthesis.id)).toBe(false);
});
it('a team cannot change a task snapshot by updating its configuration', async () => {
  const { team, taskId } = await setup();
  await core.command('saveTeam', { ...team, instructions: 'Different team instructions' });
  expect(store.detail(taskId).task.teamSnapshot!.instructions).toBe(team.instructions);
  expect(store.detail(taskId).runs[0].snapshot.team!.revision).toBe(1);
  expect(store.all<Worker>('workers').filter(w => team.memberIds.includes(w.id))).toHaveLength(2);
});

it('enforces snapshotted required checks without depending on the team name', async () => {
  const template = await core.command('createTemplate', { templateId: 'eris-review', provider: 'openai' }) as Team;
  const team = await core.command('saveTeam', { ...template, name: 'Renamed audit' }) as Team;
  const imported = core.templates.import(core.templates.export(team.id));
  expect(imported.reviewPolicy).toEqual(team.reviewPolicy);
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'No run logs provided', sourceIds: [], consent: true, budgetMicros: 1_000_000 }) as string;
  await done(taskId);
  const detail = store.detail(taskId); const synthesis = detail.runs.find(run => run.stage === 'synthesis')!;
  const report = detail.artifacts.find(artifact => artifact.runId === synthesis.id)!.report;
  expect(detail.task.evidenceRequests).toHaveLength(1);
  const request = detail.task.evidenceRequests![0];
  expect(request.state).toBe('pending'); expect(request.checks).toHaveLength(5);
  const artifactBefore = JSON.stringify(report);
  await core.command('acknowledgeEvidence', { taskId, requestId: request.id });
  expect(store.detail(taskId).task.evidenceRequests![0].state).toBe('acknowledged');
  expect(store.detail(taskId).task.status).toBe('waiting_input');
  await expect(core.command('acknowledgeEvidence', { taskId, requestId: request.id })).rejects.toThrow('không còn');
  expect(JSON.stringify(store.detail(taskId).artifacts.find(artifact => artifact.runId === synthesis.id)!.report)).toBe(artifactBefore);
  expect(report.review!.checks).toHaveLength(5);
  expect(report.review!.checks.every(check => check.status === 'not_assessed')).toBe(true);
  expect(report.review!.recommendation).toBe('insufficient_evidence');
  expect(synthesis.snapshot.team!.reviewPolicy).toEqual(team.reviewPolicy);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
  await core.command('accept', { id: taskId });
  expect(store.detail(taskId).task).toMatchObject({ status: 'completed', accepted: true });
  expect(JSON.stringify(store.detail(taskId).artifacts.find(artifact => artifact.runId === synthesis.id)!.report)).toBe(artifactBefore);
});

it('starts fresh roles for an input revision while retaining previous artifacts and total usage', async () => {
  const { taskId } = await setup(); const before = store.detail(taskId); const oldArtifacts = structuredClone(before.artifacts);
  await core.command('reviseTask', { taskId, brief: 'Reassess with a new instruction', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 });
  await done(taskId); const after = store.detail(taskId);
  expect(after.task.inputRevision).toBe(1); expect(after.runs).toHaveLength(8); expect(after.artifacts).toHaveLength(6);
  expect(after.artifacts.slice(0, 3)).toEqual(oldArtifacts);
  expect(after.runs.filter(run => (run.snapshot.inputRevision ?? 0) === 1).every(run => run.snapshot.input?.brief === 'Reassess with a new instruction')).toBe(true);
  expect(after.usage.chargedMicros).toBeGreaterThan(before.usage.chargedMicros);
  const newJoin = after.runs.at(-1)!;
  expect(newJoin.snapshot.upstreamArtifactIds!.every(id => !oldArtifacts.some(artifact => artifact.id === id))).toBe(true);
  await expect(core.command('reviseTask', { taskId, brief: 'No consent', sourceIds: [], consent: false, providerScopes: [], budgetMicros: 1_000_000 })).rejects.toThrow('cho phép');
  expect(store.detail(taskId).task.inputRevision).toBe(1);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});

it('routes a later team message onto the live thread instead of opening a second task', async () => {
  const { team, taskId } = await setup();
  expect(nextTeamMessage(store.workspace().tasks, team.id)).toEqual({ mode: 'revise', taskId });
  await core.command('reviseTask', { taskId, brief: 'Follow-up in the same team chat', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 });
  await done(taskId);
  const after = store.workspace().tasks.filter(task => task.teamId === team.id && !task.routineId && !task.archivedAt);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(taskId);
  expect(after[0].inputRevision).toBe(1);
  expect(after[0].currentInput?.brief).toBe('Follow-up in the same team chat');
});

it('does not accept an earlier synthesis as the result of an unfinished revision', async () => {
  const { taskId } = await setup(); const task = store.detail(taskId).task;
  await core.command('accept', { id: taskId });
  store.update('tasks', { ...task, inputRevision: 1, status: 'partial', accepted: false });
  await expect(core.command('accept', { id: taskId })).rejects.toThrow('Chưa có báo cáo tổng hợp');
  expect(store.detail(taskId).task.accepted).toBe(false);
});

it('routes a subset of members from the plan and still returns one synthesis report', async () => {
  planMode = 'first';
  const { team, taskId } = await setup();
  const detail = store.detail(taskId);
  expect(detail.task.status).toBe('completed');
  expect(detail.runs.find(run => run.stage === 'plan')!.snapshot.plan!.assignments).toHaveLength(1);
  const members = detail.runs.filter(run => run.stage === 'member');
  expect(members.filter(run => run.status === 'completed')).toHaveLength(1);
  expect(members.find(run => run.status === 'cancelled')!.error).toBe(UNASSIGNED_PLAN_ERROR);
  const synthesis = detail.runs.find(run => run.stage === 'synthesis')!;
  expect(synthesis.status).toBe('completed');
  expect(synthesis.snapshot.upstreamArtifactIds).toHaveLength(1);
  expect(detail.artifacts.filter(artifact => artifact.runId === synthesis.id)).toHaveLength(1);
  expect(team.memberIds).toHaveLength(2);
});

it('fails closed when the orchestrator cannot plan and does not invent member results', async () => {
  planMode = 'fail';
  const { taskId } = await setup();
  const detail = store.detail(taskId);
  expect(detail.task.status).toBe('failed');
  const plan = detail.runs.find(run => run.stage === 'plan')!;
  expect(plan.status).toBe('failed'); expect(plan.error).toBeTruthy();
  expect(detail.runs.filter(run => run.stage === 'member').every(run => run.status === 'interrupted')).toBe(true);
  expect(detail.artifacts.filter(artifact => detail.runs.some(run => run.id === artifact.runId && run.stage === 'member'))).toHaveLength(0);
  expect(detail.runs.find(run => run.stage === 'synthesis')!.status).toBe('interrupted');
  expect(detail.runs.find(run => run.stage === 'synthesis')!.error).toBe(MISSING_PLAN_ERROR);
});

it('rejects a plan that names a worker outside the team', async () => {
  planMode = 'invalid';
  const { taskId } = await setup();
  const detail = store.detail(taskId);
  expect(detail.task.status).toBe('failed');
  expect(detail.runs.find(run => run.stage === 'plan')!.error).toBe(INVALID_PLAN_ERROR);
  expect(detail.artifacts).toHaveLength(0);
});
