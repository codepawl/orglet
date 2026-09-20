import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Run, Skill, Worker } from '../../apps/desktop/src/shared/contracts';
import { teamProgress } from '../../apps/desktop/src/shared/team-progress';

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

it('excludes planning and synthesis from assignment progress', () => {
  const planner = member('Lead', 'running');
  planner.stage = 'plan';
  const synthesis = { ...planner, id: id(), stage: 'synthesis' as const };
  expect(teamProgress([planner, synthesis], [])).toEqual([]);
});
