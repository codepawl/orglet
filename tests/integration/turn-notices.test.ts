import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { LiveRun } from '../../apps/desktop/src/renderer/components/LiveRun';
import { turnNotices } from '../../apps/desktop/src/renderer/components/turnNotices';
import type { AppProposal } from '../../apps/desktop/src/shared/app-proposals';
import type { Artifact, Run, Skill, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { WorkspaceRecoveryView } from '../../apps/desktop/src/shared/workspace-recovery';

/*
 * COD-217: a turn's notices read in the order they happened. What the run loaded before writing (memories, the step
 * line) sits above the answer; what came out of it (changed files, proposal cards) sits under it, and the message
 * actions row stays last. The same order holds while the answer streams.
 */

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222221';
const artifactId = '33333333-3333-4333-8333-333333333331';
const proposalId = '33333333-3333-4333-8333-333333333332';
const skillId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memoryId = '55555555-5555-4555-8555-555555555551';
const at = '2026-09-23T09:00:00.000Z';

const skill: Skill = { id: skillId, revision: 1, name: 'Skill', content: 'Help.' };
const worker: Worker = { id: '44444444-4444-4444-8444-444444444441', revision: 1, name: 'Scout', instructions: 'Work.', provider: 'anthropic', skillId };
const task: Task = { id: taskId, workerId: worker.id, brief: 'Tóm tắt hóa đơn.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: at };
const memory = { id: memoryId, revision: 1, text: 'Thích câu trả lời ngắn.' };
const run: Run = { id: runId, taskId, status: 'completed', startedAt: at, error: null,
  snapshot: { worker, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] }, context: { knowledge: [], memories: [{ ...memory, scope: { type: 'worker', id: worker.id }, pinned: false, hash: 'a'.repeat(64) }], manifest: { bytes: 0, loaded: [], omitted: [] } } } };
const answer = (format: 'chat' | 'report'): Artifact => ({ id: artifactId, runId, createdAt: at, hash: 'b'.repeat(64), usedMemories: [memory],
  report: { format, title: 'Tóm tắt', summary: 'Hóa đơn tháng 9 là 1.200.000đ.', findings: [], limitations: [] } });
const proposal: AppProposal = { id: proposalId, taskId, runId, inputRevision: 0, sequence: 1, createdAt: at, kind: 'settings', action: 'edit', title: 'Cài đặt', payload: {}, hold: null, status: 'pending',
  changes: [{ field: 'theme', before: 'system', after: 'dark' }] };
const recovery: WorkspaceRecoveryView = { taskId, attempts: [], processes: [], uncertainCalls: [], truncated: false,
  copies: [{ runId, state: 'integrated', kind: 'git-worktree', changes: [], changeCount: 0, diff: { files: 2, additions: 5, deletions: 1 } }] };

function renderTurn(format: 'chat' | 'report') {
  const detail: TaskDetail = { task, runs: [run], events: [{ id: '66666666-6666-4666-8666-666666666661', runId, message: 'Đã đọc invoice.xlsx', createdAt: at }],
    artifacts: [answer(format)], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [proposal],
    usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 } };
  return renderToStaticMarkup(createElement(TaskThread, {
    detail, recovery, workspace: { workers: [worker], skills: [skill], tasks: [task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

/** Where each marker first appears in the markup, so the order can be read off the numbers. */
function positions(html: string, markers: Record<string, string>) {
  const found: Record<string, number> = {};
  for (const [name, marker] of Object.entries(markers)) {
    found[name] = html.indexOf(marker);
    expect(found[name], `${name} is on the page`).toBeGreaterThan(-1);
  }
  return found;
}

const answerMarkers = {
  memories: 'class="used-memories"',
  steps: 'class="activity-summary"',
  bubble: `id="message-${artifactId}"`,
  changes: 'class="activity-summary changed-files"',
  proposals: 'class="app-proposals"',
  actions: 'class="message-actions"',
};

it('orders a finished chat turn: memories and steps, the answer, then changed files, proposals and the action row', () => {
  const html = renderTurn('chat');
  // The person's own action row comes first; the answer's is the one after the bubble.
  const answerStart = html.indexOf('class="assistant-message"');
  const found = positions(html.slice(answerStart), answerMarkers);
  expect(found.memories).toBeLessThan(found.steps);
  expect(found.steps).toBeLessThan(found.bubble);
  expect(found.bubble).toBeLessThan(found.changes);
  expect(found.changes).toBeLessThan(found.proposals);
  expect(found.proposals).toBeLessThan(found.actions);
  // Every notice sits inside the reply, so it shares the bubble's inset.
  const reply = html.slice(html.indexOf('class="chat-reply"'));
  expect(reply).toContain('class="turn-before"');
  expect(reply).toContain('class="turn-after"');
  expect(html).toContain('Memories used: 1');
  expect(html).toContain('Files changed: 2 · +5 −1');
  // Nothing of the turn is drawn twice.
  expect(html.match(/class="used-memories"/g)).toHaveLength(1);
  expect(html.match(/class="app-proposals"/g)).toHaveLength(1);
});

it('keeps the same order around a report card', () => {
  const html = renderTurn('report');
  const found = positions(html.slice(html.indexOf('class="assistant-message"')), { ...answerMarkers, bubble: 'class="report report-file"' });
  expect(found.memories).toBeLessThan(found.steps);
  expect(found.steps).toBeLessThan(found.bubble);
  expect(found.bubble).toBeLessThan(found.changes);
  expect(found.changes).toBeLessThan(found.proposals);
  expect(found.proposals).toBeLessThan(found.actions);
  expect(html).toContain('class="report-turn"');
});

it('shows the memories above the streaming text as soon as the run carries them', () => {
  const html = renderToStaticMarkup(createElement(LiveRun, {
    update: { taskId, runId, startedAt: Date.now(), progress: { thinking: '', preamble: '', answer: 'Hóa đơn tháng 9', activity: [{ id: 's1', kind: 'read', target: 'invoice.xlsx', done: true }], writing: true } },
    memories: run.snapshot.context!.memories,
  }));
  const found = positions(html, { memories: 'class="used-memories"', steps: 'class="activity-summary"', text: 'live-answer' });
  expect(found.memories).toBeLessThan(found.steps);
  expect(found.steps).toBeLessThan(found.text);
});

it('takes no space for a slot that is empty', () => {
  const empty = turnNotices({});
  expect(empty.before).toBeNull();
  expect(empty.after).toBeNull();
  const onlyMemories = turnNotices({ memories: [memory] });
  expect(onlyMemories.after).toBeNull();
  expect(renderToStaticMarkup(createElement('div', null, onlyMemories.before))).toContain('class="turn-before"');
});
