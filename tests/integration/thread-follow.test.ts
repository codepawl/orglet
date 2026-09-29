import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { END_SLACK, asksToScrollUp, followsAfterScroll, gapToEnd, needsPersonKey, revealsNeed, type ThreadScroll } from '../../apps/desktop/src/renderer/threadFollow';
import { unansweredTurnLine } from '../../apps/desktop/src/renderer/turnOutcome';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import type { Artifact, Run, Skill, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { BrowserApprovalView } from '../../apps/desktop/src/shared/browser';
import type { DesktopApprovalView } from '../../apps/desktop/src/shared/desktop';

/*
 * COD-290, dogfood round 6: with Details open a browser card asking to click appeared while the thread stayed at
 * scrollTop 2008 of 2547, its Allow buttons 539px below the fold; older failed turns said "No reply to this message
 * yet."; and "Writing a reply…" stayed under a card waiting for the person's OK.
 */

/** A thread 600px tall and 700px wide, `height` tall inside, scrolled to `top`. */
const at = (top: number, height = 3000, view: Partial<ThreadScroll> = {}): ThreadScroll => ({ top, height, viewHeight: 600, viewWidth: 700, ...view });
const end = (height = 3000, view: Partial<ThreadScroll> = {}) => at(height - (view.viewHeight ?? 600), height, view);

describe('following the end of the thread', () => {
  it('measures the gap below the viewport, never negative', () => {
    expect(gapToEnd(end())).toBe(0);
    expect(gapToEnd(at(2000))).toBe(400);
    expect(gapToEnd(at(3000))).toBe(0);
  });

  it('keeps following when Details narrows the thread and scroll anchoring moves it off the end', () => {
    // The dogfood numbers: the thread got taller as it narrowed, and anchoring kept the text in place at 2008 of 2547.
    const before = end(2600, { viewWidth: 900 });
    const anchored = at(2008, 2547 + 600, { viewWidth: 640 });
    expect(gapToEnd(anchored)).toBe(539);
    expect(followsAfterScroll(true, before, anchored)).toBe(true);
  });

  it('leaves a reader who scrolled up where they are when the layout moves them', () => {
    expect(followsAfterScroll(false, at(1000), at(1000, 3400))).toBe(false);
    expect(followsAfterScroll(false, at(1000), at(1000, 3000, { viewHeight: 500 }))).toBe(false);
  });

  it('follows again when content shrank and the browser left the reader exactly at the end', () => {
    expect(followsAfterScroll(false, at(2000), end(2500))).toBe(true);
  });

  it('stops following on any move up by the reader, even a small one', () => {
    expect(followsAfterScroll(true, end(), at(2397))).toBe(false);
    expect(followsAfterScroll(true, end(), at(2300))).toBe(false);
    // Sub-pixel rounding at a zoom level is not a move.
    expect(followsAfterScroll(true, end(), at(2399.5))).toBe(true);
  });

  it('follows again once the reader scrolls back down to within the slack of the end', () => {
    expect(followsAfterScroll(false, at(2000), at(2400 - END_SLACK))).toBe(true);
    expect(followsAfterScroll(false, at(2000), at(2400 - END_SLACK - 40))).toBe(false);
    expect(END_SLACK).toBeLessThan(100);
  });

  it('stops following at once on a wheel turn or key that scrolls up', () => {
    expect(asksToScrollUp({ deltaY: -100 })).toBe(true);
    expect(asksToScrollUp({ deltaY: 100 })).toBe(false);
    expect(asksToScrollUp({ key: 'PageUp' })).toBe(true);
    expect(asksToScrollUp({ key: 'Home' })).toBe(true);
    expect(asksToScrollUp({ key: 'ArrowUp' })).toBe(true);
    expect(asksToScrollUp({ key: 'End' })).toBe(false);
    expect(asksToScrollUp({ key: 'a' })).toBe(false);
  });
});

describe('bringing what needs the person into view', () => {
  it('reveals a new card for a reader at the end or within one screen of it, never for one reading history', () => {
    expect(revealsNeed(true, at(0))).toBe(true);
    expect(revealsNeed(false, at(2100))).toBe(true);
    expect(revealsNeed(false, at(1801))).toBe(true);
    expect(revealsNeed(false, at(1800))).toBe(false);
    expect(revealsNeed(false, at(400))).toBe(false);
  });

  it('keys what waits on the person, and nothing while the chat works or has answered', () => {
    expect(needsPersonKey({ status: 'running', turn: 2, lastRunId: 'run', waitingIds: [undefined, undefined] })).toBe('');
    expect(needsPersonKey({ status: 'completed', turn: 2, lastRunId: 'run', waitingIds: [] })).toBe('');
    expect(needsPersonKey({ status: 'running', turn: 2, lastRunId: 'run', waitingIds: ['browser-card', undefined] })).toBe('browser-card');
    expect(needsPersonKey({ status: 'waiting_input', turn: 2, lastRunId: 'run', waitingIds: ['question'] })).toBe('question|waiting_input:2:run');
    const failed = needsPersonKey({ status: 'failed', turn: 2, lastRunId: 'run', waitingIds: [] });
    expect(failed).toBe('failed:2:run');
    // A retry that fails again is a new run, so its card is brought into view again.
    expect(needsPersonKey({ status: 'failed', turn: 2, lastRunId: 'retry', waitingIds: [] })).not.toBe(failed);
  });
});

const taskId = '11111111-1111-4111-8111-111111111111';
const time = '2026-09-27T09:00:00.000Z';
const skill: Skill = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, name: 'Skill', content: 'Help.' };
const worker: Worker = { id: '44444444-4444-4444-8444-444444444441', revision: 1, name: 'Dev', instructions: 'Work.', provider: 'openai', skillId: skill.id };
const runOf = (id: string, revision: number, status: Run['status'], error: string | null = null): Run => ({
  id, taskId, status, error, startedAt: time, snapshot: { worker, skill, inputRevision: revision, input: { brief: `Message ${revision}`, sourceIds: [] } },
});
const EEXIST = 'EEXIST: file already exists, mkdir \'docs\'';

describe('what a turn without an answer says', () => {
  it('names a failure with its error, a stop, a wait and an app closing, instead of "no reply yet"', () => {
    expect(unansweredTurnLine([runOf('a', 0, 'failed', EEXIST)], runOf('a', 0, 'failed', EEXIST))).toEqual({ text: `This turn didn’t finish: ${EEXIST}`, detail: EEXIST });
    expect(unansweredTurnLine([runOf('a', 0, 'failed')], undefined).text).toBe('This turn didn’t finish.');
    expect(unansweredTurnLine([runOf('a', 0, 'cancelled', 'Đã hủy.')], runOf('a', 0, 'cancelled', 'Đã hủy.')).text).toBe('This turn was stopped before it answered.');
    expect(unansweredTurnLine([runOf('a', 0, 'waiting_input')], undefined).text).toBe('This turn stopped while it waited for you.');
    expect(unansweredTurnLine([runOf('a', 0, 'waiting_budget')], undefined).text).toBe('This turn stopped when its budget ran out.');
    expect(unansweredTurnLine([runOf('a', 0, 'paused')], undefined).text).toBe('This turn was paused before it answered.');
    expect(unansweredTurnLine([runOf('a', 0, 'interrupted')], undefined).text).toBe('This turn stopped partway because the app closed.');
    expect(unansweredTurnLine([runOf('a', 0, 'completed')], undefined).text).toBe('No reply to this message yet.');
  });
});

function renderThread(detail: Omit<TaskDetail, 'profiles' | 'preflights' | 'sources' | 'workspaceEvidence' | 'appProposals' | 'usage'>) {
  const full: TaskDetail = { profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [], usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 }, ...detail };
  return renderToStaticMarkup(createElement(TaskThread, {
    detail: full, workspace: { workers: [worker], skills: [skill], tasks: [full.task] }, action: () => {}, showSources: () => {}, openMessage: () => {},
    proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

describe('the thread', () => {
  it('keeps an older failed turn\'s outcome after a newer message was answered', () => {
    const task: Task = { id: taskId, workerId: worker.id, brief: 'Message 1', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: time, inputRevision: 1 };
    const answer: Artifact = { id: '33333333-3333-4333-8333-333333333331', runId: 'second', createdAt: time, hash: 'b'.repeat(64), report: { format: 'chat', title: 'Answer', summary: 'Done.', findings: [], limitations: [] } };
    const html = renderThread({ task, runs: [runOf('first', 0, 'failed', EEXIST), runOf('second', 1, 'completed')], events: [], artifacts: [answer] });
    expect(html).toContain('This turn didn’t finish: EEXIST: file already exists');
    expect(html).toContain('class="muted turn-outcome"');
    expect(html).not.toContain('No reply to this message yet.');
  });

  it('says the run waits for the person\'s OK under a browser card, still, instead of "Writing a reply…"', () => {
    const task: Task = { id: taskId, workerId: worker.id, brief: 'Join the club.', sourceIds: [], consent: true, budgetMicros: 100_000, accepted: false, status: 'running', createdAt: time };
    const run = runOf('live', 0, 'running');
    const approval: BrowserApprovalView = { id: 'card', runId: run.id, actionId: 'action', workerName: worker.name, kind: 'click', element: 'Join', site: '127.0.0.1', url: 'http://127.0.0.1:4731/', reasons: [], requestedAt: time };
    const events = [{ id: '66666666-6666-4666-8666-666666666661', runId: run.id, message: 'Model đang trả kết quả…', createdAt: time }];
    const writing = renderThread({ task, runs: [run], events, artifacts: [] });
    expect(writing).toContain('<p class="run-status-line" aria-hidden="true">Writing a reply…</p>');
    const waiting = renderThread({ task, runs: [run], events, artifacts: [], browser: { approval, takenOver: false, inChrome: false, using: true, waiting: false, runId: run.id } });
    expect(waiting).toContain('<p class="run-status-line waiting" aria-hidden="true">Waiting for your OK…</p>');
    expect(waiting).not.toContain('Writing a reply…');
    // A desktop card waits the same way, in the same card, so the line lines up with it the same way.
    const desktopApproval: DesktopApprovalView = { id: 'desktop-card', runId: run.id, actionId: 'action', workerName: worker.name, kind: 'invoke', element: 'Save', program: 'notepad.exe', window: 'Untitled - Notepad', reasons: [], requestedAt: time };
    const desktop = renderThread({ task, runs: [run], events, artifacts: [], desktop: { approval: desktopApproval } });
    expect(desktop).toContain('class="browser-approval"');
    expect(desktop).toContain('<p class="run-status-line waiting" aria-hidden="true">Waiting for your OK…</p>');
    expect(desktop).not.toContain('Writing a reply…');
  });
});
