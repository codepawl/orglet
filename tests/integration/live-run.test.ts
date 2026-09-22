import { expect, it } from 'vitest';
import { islandOf, liveRunOf } from '../../apps/desktop/src/renderer/components/LiveRun';
import type { Run } from '../../apps/desktop/src/shared/contracts';
import { emptyProgress, type ActivityStep, type RunProgressUpdate } from '../../apps/desktop/src/shared/progress';

function run(id: string, stage?: Run['stage']): Run {
  return { id, stage } as Run;
}

function update(runId: string, answer: string): RunProgressUpdate {
  return {
    taskId: 'task',
    runId,
    startedAt: Date.now(),
    progress: { thinking: '', preamble: '', activity: [], answer, writing: true },
  };
}

it('shows the streaming run of a worker chat, which has no synthesis run', () => {
  const worker = run('worker-run');
  const live = liveRunOf([worker], { 'worker-run': update('worker-run', 'Payment terms') });
  expect(live?.run.id).toBe('worker-run');
  expect(live?.update.progress?.answer).toBe('Payment terms');
});

it('prefers the synthesis run when a team is writing its answer', () => {
  const member = run('member-run', 'member');
  const synthesis = run('synthesis-run', 'synthesis');
  const updates = {
    'member-run': update('member-run', 'Member notes'),
    'synthesis-run': update('synthesis-run', 'Combined answer'),
  };
  expect(liveRunOf([member, synthesis], updates)?.run.id).toBe('synthesis-run');
});

it('falls back to a member while the synthesis run has not started streaming', () => {
  const member = run('member-run', 'member');
  const synthesis = run('synthesis-run', 'synthesis');
  expect(liveRunOf([member, synthesis], { 'member-run': update('member-run', 'Member notes') })?.run.id).toBe('member-run');
});

it('shows nothing when no run of the turn is streaming', () => {
  expect(liveRunOf([run('a'), run('b')], {})).toBeUndefined();
  expect(liveRunOf([run('a')], { 'other-task-run': update('other-task-run', 'x') })).toBeUndefined();
});

function step(kind: ActivityStep['kind'], target: string, done: boolean): ActivityStep {
  return { id: `${kind}-${target}-${done}`, kind, target, done };
}

it('names the file being read and, one beat behind, the last step that finished', () => {
  const progress = { ...emptyProgress(), activity: [step('read', 'contract.pdf', true), step('read', 'invoice.xlsx', false)] };
  const island = islandOf(progress, false);
  expect(island.state).toBe('reading');
  expect(island.label).toBe('Reading invoice.xlsx');
  expect(island.receipt).toBe('Read contract.pdf');
});

it('is thinking between steps, with the receipt kept', () => {
  const progress = { ...emptyProgress(), activity: [step('search', 'total', true)] };
  const island = islandOf(progress, false);
  expect(island.state).toBe('thinking');
  expect(island.receipt).toBe('Searched total');
});

it('never names the tool behind a step that is not a read, search or list', () => {
  const progress = { ...emptyProgress(), activity: [step('other', 'Bash', true), step('other', 'WebFetch', false)] };
  const island = islandOf(progress, false);
  expect(island.state).toBe('tool');
  expect(island.label).not.toContain('WebFetch');
  expect(island.receipt).not.toContain('Bash');
});

it('lets writing and pausing win over an open step', () => {
  const activity = [step('read', 'notes.md', false)];
  expect(islandOf({ ...emptyProgress(), activity, writing: true }, false).state).toBe('writing');
  expect(islandOf({ ...emptyProgress(), activity }, true).state).toBe('pausing');
});

it('gives a provider that reports no steps a thinking island with an empty receipt line', () => {
  const island = islandOf(emptyProgress(), false);
  expect(island.state).toBe('thinking');
  expect(island.receipt).toBe('');
});
