import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupRecoveryAttempts, uncertainCallLabel } from '../../apps/desktop/src/shared/recovery-attempts';
import { describeToolCallArguments, type WorkspaceRecoveryView } from '../../apps/desktop/src/shared/workspace-recovery';
import { WorkspaceRecovery, attemptStateLabel, uncertainCallText } from '../../apps/desktop/src/renderer/components/WorkspaceRecovery';
import type { Run } from '../../apps/desktop/src/shared/contracts';

const token = 'a'.repeat(64);
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const taskId = uuid('0');
const blockedRunId = uuid('1');
const integratedRunId = uuid('2');
const retiredRunId = uuid('3');
const pendingRunId = uuid('4');

const worker = { id: 'worker', name: 'Backend Builder' };
const run = (id: string, startedAt: string, status: Run['status']): Run =>
  ({ id, taskId, status, startedAt, error: null, snapshot: { worker, skill: {} } } as unknown as Run);
const runs: Run[] = [
  run(integratedRunId, '2026-09-23T08:00:00.000Z', 'completed'),
  run(blockedRunId, '2026-09-23T09:00:00.000Z', 'failed'),
  run(retiredRunId, '2026-09-23T07:00:00.000Z', 'failed'),
  run(pendingRunId, '2026-09-23T10:00:00.000Z', 'interrupted'),
];

const view: WorkspaceRecoveryView = {
  taskId, truncated: false,
  attempts: [
    { runId: blockedRunId, reviewToken: token, retired: false },
    { runId: integratedRunId, reviewToken: token, retired: false },
    { runId: retiredRunId, reviewToken: token, retired: true },
    { runId: pendingRunId, reviewToken: token, retired: false },
  ],
  copies: [
    { runId: blockedRunId, state: 'ready', kind: 'copy', changeCount: 1, changes: [{ path: 'lib/http.js', status: 'pending' }] },
    { runId: integratedRunId, state: 'integrated', kind: 'copy', changeCount: 2,
      changes: [{ path: 'a.js', status: 'applied' }, { path: 'b.js', status: 'applied' }] },
    { runId: retiredRunId, state: 'ready', kind: 'copy', changeCount: 1, changes: [{ path: 'old.js', status: 'pending' }] },
    { runId: pendingRunId, state: 'ready', kind: 'copy', changeCount: 3,
      changes: [{ path: 'x.js', status: 'pending' }, { path: 'y.js', status: 'pending' }, { path: 'z.js', status: 'pending' }] },
  ],
  processes: [
    { id: uuid('5'), runId: blockedRunId, command: 'node --test', state: 'exited', exitCode: 1 },
    { id: uuid('6'), runId: blockedRunId, command: 'node lint.js', state: 'exited', exitCode: 0 },
    { id: uuid('7'), runId: blockedRunId, command: 'node build.js', state: 'timeout', exitCode: null },
    { id: uuid('8'), runId: integratedRunId, command: 'node --test', state: 'exited', exitCode: 0 },
  ],
  uncertainCalls: [
    { runId: blockedRunId, callId: 'a92f4612', replay: 'never', tool: 'workspace_write', summary: 'lib/http.js', at: '2026-09-23T09:05:00.000Z' },
    { runId: retiredRunId, callId: 'older', replay: 'never', tool: 'workspace_start_process', summary: 'node --test', at: null },
  ],
};

it('names an unknown call by what it did, never by its id', () => {
  expect(uncertainCallLabel({ tool: 'workspace_write', summary: 'lib/http.js' })).toEqual({ action: 'write', target: 'lib/http.js', tool: 'workspace_write' });
  expect(uncertainCallLabel({ tool: 'workspace_start_process', summary: 'node --test' })).toEqual({ action: 'run', target: 'node --test', tool: 'workspace_start_process' });
  expect(uncertainCallLabel({ tool: 'integrate_workspace_file', summary: 'lib/http.js' })).toEqual({ action: 'apply', target: 'lib/http.js', tool: 'integrate_workspace_file' });
  expect(uncertainCallLabel({ tool: null, summary: null })).toEqual({ action: 'other', target: null, tool: null });
  expect(uncertainCallText({ tool: 'workspace_write', summary: 'lib/http.js' })).toBe('Write lib/http.js');
  expect(uncertainCallText({ tool: 'workspace_start_process', summary: 'node --test' })).toBe('Run node --test');
  expect(uncertainCallText({ tool: 'integrate_workspace_file', summary: 'old.txt' })).toBe('Apply old.txt');
  expect(uncertainCallText({ tool: 'send_team_message', summary: null })).toBe('send_team_message');
  expect(uncertainCallText({ tool: null, summary: null })).toBe('Unnamed operation');
});

it('keeps only the path or the command out of a call\'s arguments', () => {
  expect(describeToolCallArguments('workspace_write', { path: 'lib/http.js', content: 'secret body', expectedHash: null })).toBe('lib/http.js');
  expect(describeToolCallArguments('workspace_start_process', { program: 'node', arguments: ['--test', 'lib'], timeoutMs: 1000 })).toBe('node --test lib');
  expect(describeToolCallArguments('integrate_workspace_file', { root: 'C:/private', path: 'old.txt', hash: 'x' })).toBe('old.txt');
  expect(describeToolCallArguments('send_team_message', { to: 'x', body: 'hello' })).toBeNull();
  expect(describeToolCallArguments('workspace_write', 'not an object')).toBeNull();
  const long = describeToolCallArguments('workspace_write', { path: 'a'.repeat(400) })!;
  expect([...long]).toHaveLength(300);
  expect(long.endsWith('…')).toBe(true);
});

it('groups copies, commands and unknown calls under their attempt, newest first', () => {
  const grouped = groupRecoveryAttempts(view, runs);
  expect(grouped.shown.map(attempt => attempt.runId)).toEqual([pendingRunId, blockedRunId]);
  expect(grouped.earlier.map(attempt => attempt.runId)).toEqual([integratedRunId, retiredRunId]);
  const blocked = grouped.shown[1];
  expect(blocked.workerName).toBe('Backend Builder');
  expect(blocked.startedAt).toBe('2026-09-23T09:00:00.000Z');
  expect(blocked.commands).toEqual({ total: 3, passed: 1, failed: 2, unfinished: 0 });
  expect(blocked.processes.map(process => process.command)).toEqual(['node --test', 'node lint.js', 'node build.js']);
  expect(blocked.uncertainCalls.map(call => call.callId)).toEqual(['a92f4612']);
  expect(blocked.blocking).toBe(true);
  expect(blocked.needsDecision).toBe(true);
  expect(blocked.state).toBe('not_applied');
  expect(grouped.blocking?.runId).toBe(blockedRunId);
  const pending = grouped.shown[0];
  expect(pending.blocking).toBe(false);
  expect(pending.needsDecision).toBe(true);
  expect(pending.state).toBe('not_applied');
  expect(pending.pendingChanges).toBe(3);
  const [integrated, retired] = grouped.earlier;
  expect(integrated.state).toBe('integrated');
  expect(integrated.needsDecision).toBe(false);
  expect(integrated.commands.total).toBe(1);
  expect(retired.state).toBe('kept');
  expect(retired.blocking).toBe(false);
  expect(retired.needsDecision).toBe(false);
});

it('blocks on an unknown command or working copy too, and lifts the block once the attempt is retired', () => {
  const uncertainProcess: WorkspaceRecoveryView = { ...view, uncertainCalls: [],
    processes: [{ id: uuid('9'), runId: blockedRunId, command: 'node --test', state: 'uncertain', exitCode: null }] };
  expect(groupRecoveryAttempts(uncertainProcess, runs).blocking?.runId).toBe(blockedRunId);
  const conflictCopy: WorkspaceRecoveryView = { ...view, uncertainCalls: [], processes: [],
    copies: [{ runId: blockedRunId, state: 'conflict', kind: 'copy', changeCount: 0, changes: [] }] };
  expect(groupRecoveryAttempts(conflictCopy, runs).blocking?.runId).toBe(blockedRunId);
  const retired: WorkspaceRecoveryView = { ...view,
    attempts: view.attempts.map(attempt => attempt.runId === blockedRunId ? { ...attempt, retired: true } : attempt) };
  const grouped = groupRecoveryAttempts(retired, runs);
  expect(grouped.blocking).toBeUndefined();
  expect(grouped.shown.map(attempt => attempt.runId)).toEqual([pendingRunId]);
  expect(grouped.earlier.map(attempt => attempt.runId)).toEqual([blockedRunId, integratedRunId, retiredRunId]);
  expect(grouped.earlier[0].state).toBe('kept');
});

it('always shows the latest attempt when every attempt is settled', () => {
  const settled: WorkspaceRecoveryView = { ...view, uncertainCalls: [], processes: [],
    attempts: view.attempts.filter(attempt => attempt.runId !== pendingRunId && attempt.runId !== blockedRunId),
    copies: view.copies.filter(copy => copy.runId === integratedRunId || copy.runId === retiredRunId) };
  const grouped = groupRecoveryAttempts(settled, runs);
  expect(grouped.shown.map(attempt => attempt.runId)).toEqual([integratedRunId]);
  expect(grouped.earlier.map(attempt => attempt.runId)).toEqual([retiredRunId]);
  expect(groupRecoveryAttempts(undefined, runs)).toEqual({ shown: [], earlier: [], blocking: undefined });
});

it('says the state of an attempt in plain words (tests run in the English locale)', () => {
  expect(attemptStateLabel('integrated', 0)).toBe('Integrated');
  expect(attemptStateLabel('not_applied', 3)).toBe('Changes not applied: 3 files');
  expect(attemptStateLabel('not_applied', 1)).toBe('Changes not applied: 1 file');
  expect(attemptStateLabel('no_changes', 0)).toBe('No changes');
  expect(attemptStateLabel('kept', 0)).toBe('Kept current files');
});

it('renders one row per attempt with the action only where a decision is needed', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(WorkspaceRecovery, { view, runs, busy: false, onRetire: noop,
    readOutput: () => Promise.reject(new Error('unused')), readFile: () => Promise.reject(new Error('unused')) }));
  expect(html.match(/class="recovery-attempt( blocking)?"/g)).toHaveLength(2);
  expect(html).toContain(`id="recovery-attempt-${blockedRunId}"`);
  expect(html).toContain('class="recovery-attempt blocking"');
  expect(html).toContain('Write lib/http.js');
  expect(html).toContain('outcome unknown');
  expect(html).not.toContain('a92f4612');
  expect(html).toContain('3 commands · 1 passed, 2 failed');
  expect(html).toContain('1 file in the working copy');
  expect(html).toContain('Changes not applied: 3 files');
  expect(html).toContain('Show 2 earlier attempts');
  expect(html).not.toContain('Integrated');
  expect(html.match(/aria-label="Keep current files · Backend Builder"/g)).toHaveLength(2);
});
