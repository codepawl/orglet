import { expect, it } from 'vitest';
import { liveRunOf } from '../../apps/desktop/src/renderer/components/LiveRun';
import type { Run } from '../../apps/desktop/src/shared/contracts';
import type { RunProgressUpdate } from '../../apps/desktop/src/shared/progress';

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
