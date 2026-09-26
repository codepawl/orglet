import { expect, it } from 'vitest';
import { commandTally, workOutcomes } from '../../apps/desktop/src/shared/work-outcomes';
import type { WorkspaceRecoveryView } from '../../apps/desktop/src/shared/workspace-recovery';

it('counts only persisted command results from the requested turn and keeps unknown effects visible', () => {
  const recovery = {
    taskId: 'task', attempts: [], truncated: false,
    processes: [
      { id: 'a', runId: 'current', command: 'node test', state: 'exited', exitCode: 0 },
      { id: 'b', runId: 'current', command: 'node build', state: 'exited', exitCode: 1 },
      { id: 'c', runId: 'current', command: 'node check', state: 'uncertain', exitCode: null },
      { id: 'd', runId: 'old', command: 'node old', state: 'exited', exitCode: 0 },
    ],
    copies: [{ runId: 'current', state: 'conflict', kind: 'copy', changes: [], changeCount: 0 }],
    uncertainCalls: [{ runId: 'current', callId: 'write', replay: 'never', tool: 'workspace_write', summary: 'note.txt', at: null }],
  } as WorkspaceRecoveryView;
  expect(workOutcomes(recovery, new Set(['current']))).toEqual({
    passedCommands: 1, failedCommands: 1, unfinishedCommands: 1,
    fileConflicts: 1, uncertainCalls: 1, truncated: false,
  });
  expect(workOutcomes(recovery, new Set(['missing']))).toBeNull();
});

it('puts the last command first and counts the earlier ones apart (dogfood, 2026-09-26)', () => {
  // The reproduction failed, the fix went in, the test passed: newest first, as the recovery view lists them.
  const fixed = {
    taskId: 'task', attempts: [], truncated: false, copies: [], uncertainCalls: [],
    processes: [
      { id: 'b', runId: 'current', command: 'node test', state: 'exited', exitCode: 0 },
      { id: 'a', runId: 'current', command: 'node test', state: 'exited', exitCode: 1 },
      { id: 'o', runId: 'old', command: 'node old', state: 'timeout', exitCode: null },
    ],
  } as WorkspaceRecoveryView;
  expect(commandTally(fixed, new Set(['current']))).toEqual({
    last: { state: 'exited', exitCode: 0, outcome: 'passed' },
    earlier: { passed: 0, failed: 1, unfinished: 0 },
  });
  // The counts still add up to what the turn ran.
  const outcomes = workOutcomes(fixed, new Set(['current']))!;
  expect(outcomes.passedCommands + outcomes.failedCommands).toBe(2);

  const timedOut = { ...fixed, processes: [{ id: 'c', runId: 'current', command: 'node slow', state: 'timeout', exitCode: null }, ...fixed.processes] } as WorkspaceRecoveryView;
  expect(commandTally(timedOut, new Set(['current']))).toEqual({
    last: { state: 'timeout', exitCode: null, outcome: 'failed' },
    earlier: { passed: 1, failed: 1, unfinished: 0 },
  });
  expect(commandTally(fixed, new Set(['missing']))).toBeNull();
  expect(commandTally(undefined, new Set(['current']))).toBeNull();
});
