import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Worker } from '../../apps/desktop/src/shared/contracts';
import { teamProgress } from '../../apps/desktop/src/shared/team-progress';
import { savedArtifactContext, savedAssignmentAttempts } from '../../apps/desktop/src/core/orchestration/artifact-provenance';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => { store.close(); });

function member(name: string, status: Run['status'], dependsOn: string[] = []): Run {
  const worker = { ...store.all<Worker>('workers')[0], id: id(), name };
  return { id: id(), taskId: 'fixture-task', stage: 'member', status, startedAt: now(), error: null,
    snapshot: { worker, skill: store.all<Skill>('skills')[0],
      assignment: { workerId: worker.id, brief: 'Assigned work', dependsOn } } };
}

it('keeps missing outputs and failed prerequisites visible as dependencies', () => {
  const prerequisite = member('Research', 'completed');
  const dependent = member('Review', 'queued', [prerequisite.snapshot.worker.id]);
  expect(teamProgress([prerequisite, dependent], [])[0].waitingFor).toEqual(['Research']);
  expect(teamProgress([prerequisite, dependent], [{ runId: prerequisite.id }])[0].waitingFor).toEqual([]);
  prerequisite.status = 'failed';
  expect(teamProgress([prerequisite, dependent], [{ runId: prerequisite.id }])[1].waitingFor).toEqual(['Research']);
});

it('uses the reassigned worker and does not reuse the old attempt output', () => {
  const failed = member('Original worker', 'failed');
  const dependent = member('Review', 'queued', [failed.snapshot.worker.id]);
  const replacement = member('Replacement', 'running');
  replacement.snapshot.assignment = failed.snapshot.assignment;
  const runs = [failed, dependent, replacement];
  const progress = teamProgress(runs, [{ runId: failed.id }]);
  expect(progress.map(item => item.run.id)).toEqual([replacement.id, dependent.id]);
  expect(progress[1].waitingFor).toEqual(['Replacement']);
  replacement.status = 'completed';
  expect(teamProgress(runs, [{ runId: failed.id }])[0].waitingFor).toEqual(['Replacement']);
  expect(teamProgress(runs, [{ runId: replacement.id }])[0].waitingFor).toEqual([]);
});

it('credits an artifact to the successful reassigned attempt and retains earlier failures', () => {
  const original = member('QA reviewer', 'failed');
  const firstRetry = member('Product strategist', 'failed');
  const successfulRetry = member('Visual designer', 'completed');
  firstRetry.snapshot.assignment = original.snapshot.assignment;
  successfulRetry.snapshot.assignment = original.snapshot.assignment;
  const artifact = { id: id(), runId: successfulRetry.id, hash: 'fixture', createdAt: now(),
    report: { title: 'QA report', summary: 'Created qa-report.md', findings: [], limitations: [] } };
  const runs = [original, firstRetry, successfulRetry];
  expect(savedArtifactContext([artifact], runs)[0]).toMatchObject({
    assignmentWorkerId: original.snapshot.worker.id,
    completedBy: { workerId: successfulRetry.snapshot.worker.id, workerName: 'Visual designer' },
  });
  expect(savedAssignmentAttempts(original.snapshot.worker.id, runs, [artifact]).map(attempt => [attempt.workerName, attempt.status, attempt.artifactId])).toEqual([
    ['QA reviewer', 'failed', null],
    ['Product strategist', 'failed', null],
    ['Visual designer', 'completed', artifact.id],
  ]);
});

it('excludes planning and synthesis from assignment progress', () => {
  const planner = member('Lead', 'running');
  planner.stage = 'plan';
  const synthesis = { ...planner, id: id(), stage: 'synthesis' as const };
  expect(teamProgress([planner, synthesis], [])).toEqual([]);
});
