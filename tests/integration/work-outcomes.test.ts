import { expect, it } from 'vitest';
import { workOutcomes } from '../../apps/desktop/src/shared/work-outcomes';
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
    uncertainCalls: [{ runId: 'current', callId: 'write', replay: 'never' }],
  } as WorkspaceRecoveryView;
  expect(workOutcomes(recovery, new Set(['current']))).toEqual({
    passedCommands: 1, failedCommands: 1, unfinishedCommands: 1,
    fileConflicts: 1, uncertainCalls: 1, truncated: false,
  });
  expect(workOutcomes(recovery, new Set(['missing']))).toBeNull();
});
