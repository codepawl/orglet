import { describe, expect, it } from 'vitest';
import type { Routine, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { backgroundNotices, besideSideThread, chatStatuses, finishedChats, inAppNotice, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { collapseNotices, unreadGroupSize, useNotices, withNotice, type Notice } from '../../apps/desktop/src/renderer/components/notifications';
import { toast } from '../../apps/desktop/src/renderer/components/toast';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const researcher = { id: 'researcher', name: 'Researcher' } as Worker;
const writer = { id: 'writer', name: 'Writer' } as Worker;
const crew = { id: 'crew', name: 'Review crew', memberIds: ['writer'], synthesizerId: 'researcher' } as Team;
const standup = { id: 'standup', name: 'Daily standup note' } as Routine;
const names: ChatNames = { workers: [researcher, writer], teams: [crew], routines: [standup] };

const chat = (id: string, status: Task['status'], extra: Partial<Task> = {}): Task => ({
  id, status, brief: `Ask ${id}\nthe private part of the question`, workerId: 'researcher', createdAt: '2026-09-25T00:00:00.000Z',
  budgetMicros: 1000, sourceIds: [], consent: true, accepted: false, ...extra,
});
const side = (id: string, status: Task['status']) => chat(id, status, { sideOf: { taskId: 'main', throughRevision: 0 } });
const scheduleRun = (id: string, status: Task['status'], extra: Partial<Task> = {}) => chat(id, status, { routineId: 'standup', ...extra });

describe('which chats stopped working', () => {
  it('announces a side thread only when it stops working after being seen busy (COD-247)', () => {
    const before = chatStatuses([side('done', 'running'), side('failed', 'queued'), side('still', 'running'), side('old', 'completed'), side('stopped', 'running')]);
    const now = [side('done', 'completed'), side('failed', 'failed'), side('still', 'running'), side('old', 'completed'), side('stopped', 'cancelled'), side('new', 'completed')];
    const notices = finishedChats(before, now).map(finished => inAppNotice(finished, names));
    expect(notices).toEqual([
      { taskId: 'done', text: 'Researcher answered in a side thread', tone: 'success', about: 'Ask done', group: { key: 'side-thread-answers:researcher', size: 1 } },
      { taskId: 'failed', text: 'Researcher’s side thread needs a look', tone: 'error', about: 'Ask failed' },
    ]);
  });

  it('counts a schedule run that started and finished between two looks, but not any other chat that appeared finished (COD-258)', () => {
    const before = chatStatuses([chat('main', 'completed')]);
    const now = [chat('main', 'completed'), chat('another', 'completed'), scheduleRun('run', 'completed'), side('thread', 'completed')];
    expect(finishedChats(before, now).map(finished => finished.task.id)).toEqual(['run']);
  });

  it('says nothing of schedule runs a restored backup brought in, which started before the last look (COD-281)', () => {
    const before = chatStatuses([chat('main', 'completed')]);
    const now = [chat('main', 'completed'), scheduleRun('restored', 'completed'), scheduleRun('fresh', 'completed', { createdAt: '2026-09-27T10:00:30.000Z' })];
    expect(finishedChats(before, now, '2026-09-27T10:00:00.000Z').map(finished => finished.task.id)).toEqual(['fresh']);
  });

  it('tells a finished run from one that failed and one that waits for the person, and says nothing of a pause', () => {
    const before = chatStatuses(['done', 'partial', 'interrupted', 'input', 'budget', 'paused'].map(id => chat(id, 'running')));
    const now = [chat('done', 'completed'), chat('partial', 'partial'), chat('interrupted', 'interrupted'), chat('input', 'waiting_input'), chat('budget', 'waiting_budget'), chat('paused', 'paused')];
    expect(finishedChats(before, now).map(finished => [finished.task.id, finished.outcome])).toEqual([
      ['done', 'done'], ['partial', 'needs_look'], ['interrupted', 'needs_look'], ['input', 'needs_you'], ['budget', 'needs_you'],
    ]);
  });

  it('leaves out deleted chats', () => {
    const before = chatStatuses([chat('gone', 'running')]);
    expect(finishedChats(before, [chat('gone', 'completed', { deletedAt: '2026-09-25T01:00:00.000Z' })])).toEqual([]);
  });
});

describe('the notice inside the window', () => {
  it('names the schedule and says who ran it, for an orglet and for a crew (COD-258)', () => {
    expect(inAppNotice({ task: scheduleRun('run', 'completed'), outcome: 'done' }, names))
      .toEqual({ taskId: 'run', text: 'Daily standup note is ready', tone: 'success', about: 'Researcher' });
    expect(inAppNotice({ task: scheduleRun('run', 'waiting_input', { teamId: 'crew' }), outcome: 'needs_you' }, names))
      .toEqual({ taskId: 'run', text: 'Daily standup note needs you', tone: 'error', about: 'Review crew' });
    expect(inAppNotice({ task: scheduleRun('run', 'failed'), outcome: 'needs_look' }, names)?.text).toBe('Daily standup note needs a look');
  });

  it('says nothing for a main chat, whose own row carries the unread mark', () => {
    expect(inAppNotice({ task: chat('main', 'completed'), outcome: 'done' }, names)).toBeUndefined();
  });

  it('keeps the chat on the notice, so its row in Notifications opens it, and keeps notices about different runs apart', () => {
    const recorded = () => {
      let notices: Notice[] = [];
      const Probe = () => { notices = useNotices(); return null; };
      renderToStaticMarkup(createElement(Probe));
      return notices;
    };
    const before = recorded().at(-1)?.id ?? 0;
    toast('Daily standup note is ready', 'success', 'Researcher', { unread: true, chat: 'monday' });
    toast('Daily standup note is ready', 'success', 'Researcher', { unread: true, chat: 'tuesday' });
    const added = recorded().filter(notice => notice.id > before);
    expect(added.map(notice => notice.taskId)).toEqual(['monday', 'tuesday']);
    expect(collapseNotices([...added].reverse())).toHaveLength(2);
  });
});

/**
 * COD-287: fourteen side threads sent from three orglets' main chats left fourteen unread notices. An answer next to
 * where the person already is gets no notice, and one orglet's answers wait in Notifications as one row.
 */
describe('side-thread answers without the noise', () => {
  const sideOf = (id: string, mainChatId: string, workerId = 'researcher') => chat(id, 'completed', { workerId, sideOf: { taskId: mainChatId, throughRevision: 0 } });

  it('knows when the person is in the orglet’s main chat or another of its side threads', () => {
    const thread = sideOf('thread', 'main');
    expect(besideSideThread(thread, chat('main', 'completed'))).toBe(true);
    expect(besideSideThread(thread, sideOf('sibling', 'main'))).toBe(true);
    expect(besideSideThread(thread, chat('other-main', 'completed', { workerId: 'writer' }))).toBe(false);
    expect(besideSideThread(thread, sideOf('elsewhere', 'other-main', 'writer'))).toBe(false);
    expect(besideSideThread(thread, undefined)).toBe(false);
    expect(besideSideThread(chat('main', 'completed'), chat('main', 'completed'))).toBe(false);
  });

  it('counts one orglet’s answers into one notice that opens the newest', () => {
    const earlier = (counts: Record<string, number>) => (group: string) => counts[group] ?? 0;
    const third = inAppNotice({ task: sideOf('third', 'main'), outcome: 'done' }, names, earlier({ 'side-thread-answers:researcher': 2 }));
    expect(third).toEqual({ taskId: 'third', text: 'Researcher answered in 3 side threads', tone: 'success', about: 'Latest: Ask third', group: { key: 'side-thread-answers:researcher', size: 3 } });
    // Another orglet's answers are their own group.
    const writerAnswer = inAppNotice({ task: sideOf('draft', 'writer-main', 'writer'), outcome: 'done' }, names, earlier({ 'side-thread-answers:researcher': 2 }));
    expect(writerAnswer?.group).toEqual({ key: 'side-thread-answers:writer', size: 1 });
    // A failure stays a notice of its own: each one is a problem to look at.
    const failed = inAppNotice({ task: { ...sideOf('broken', 'main'), status: 'failed' }, outcome: 'needs_look' }, names, earlier({ 'side-thread-answers:researcher': 2 }));
    expect(failed?.group).toBeUndefined();
  });

  it('keeps one unread row per orglet in Notifications however many answers land, and starts over once seen', () => {
    const group = 'side-thread-answers:researcher';
    const answer = (id: number, size: number): Notice => ({ id, at: '2026-09-27T10:00:00.000Z', kind: 'done', text: `Researcher answered in ${size} side threads`, taskId: `thread-${id}`, group, ...(size > 1 ? { groupSize: size } : {}) });
    const other: Notice = { id: 2, at: '2026-09-27T10:00:00.000Z', kind: 'done', text: 'Writer answered in a side thread', group: 'side-thread-answers:writer' };
    let list = withNotice([], 0, answer(1, 1));
    list = withNotice(list, 0, other);
    expect(unreadGroupSize(list, 0, group)).toBe(1);
    list = withNotice(list, 0, answer(3, 2));
    list = withNotice(list, 0, answer(4, 3));
    expect(list.map(notice => notice.id)).toEqual([2, 4]);
    expect(unreadGroupSize(list, 0, group)).toBe(3);
    // Once the centre was opened, the old row stays as history and the next answer starts a new count.
    expect(unreadGroupSize(list, 4, group)).toBe(0);
    const afterSeen = withNotice(list, 4, answer(5, 1));
    expect(afterSeen.map(notice => notice.id)).toEqual([2, 4, 5]);
  });
});

/**
 * COD-287: every failed refresh added a Problems entry, so a chat that kept refusing to load filled Notifications
 * with the same line. The same problem still waiting unread is not listed again; once seen, a new one is.
 */
describe('a problem that keeps happening', () => {
  const problem = (id: number, text = 'Không đọc được dữ liệu.', about = 'Đọc dữ liệu từ phần lõi'): Notice => ({ id, at: '2026-09-27T10:00:00.000Z', kind: 'error', text, about });

  it('is listed once while it waits unread', () => {
    const first = withNotice([], 0, problem(1));
    const again = withNotice(first, 0, problem(2));
    expect(again).toBe(first);
    expect(withNotice(first, 0, problem(3, 'Một lỗi khác.'))).toHaveLength(2);
    expect(withNotice(first, 0, problem(4, 'Không đọc được dữ liệu.', 'Researcher'))).toHaveLength(2);
    // A note with the same words is not a problem, so it is kept as usual.
    expect(withNotice(first, 0, { ...problem(5), kind: 'info' })).toHaveLength(2);
  });

  it('is listed again after the person has looked', () => {
    const first = withNotice([], 0, problem(1));
    expect(withNotice(first, 1, problem(2)).map(notice => notice.id)).toEqual([1, 2]);
  });

  it('adds nothing to the unread count when the same failure is recorded again', () => {
    const recorded = () => {
      let notices: Notice[] = [];
      const Probe = () => { notices = useNotices(); return null; };
      renderToStaticMarkup(createElement(Probe));
      return notices;
    };
    const before = recorded().length;
    toast('Refresh failed for COD-287', 'error', 'Đọc dữ liệu từ phần lõi');
    toast('Refresh failed for COD-287', 'error', 'Đọc dữ liệu từ phần lõi');
    toast('Refresh failed for COD-287', 'error', 'Đọc dữ liệu từ phần lõi');
    expect(recorded().length).toBe(before + 1);
  });
});

describe('the system notification while Orglet is in the background (COD-258)', () => {
  const finished = [
    { task: chat('main', 'completed'), outcome: 'done' as const },
    { task: side('thread', 'waiting_input'), outcome: 'needs_you' as const },
    { task: scheduleRun('run', 'failed'), outcome: 'needs_look' as const },
    { task: chat('crew-chat', 'completed', { teamId: 'crew' }), outcome: 'done' as const },
    { task: chat('group', 'completed', { assignees: ['researcher', 'writer'] }), outcome: 'done' as const },
  ];

  it('stays quiet when the setting is off', () => {
    expect(backgroundNotices(finished, names, false)).toEqual([]);
  });

  it('names the orglet, crew, group or schedule and says what happened, for every kind of chat', () => {
    expect(backgroundNotices(finished, names, true)).toEqual([
      { taskId: 'main', title: 'Researcher', body: 'Done' },
      { taskId: 'thread', title: 'Researcher · side thread', body: 'Needs you' },
      { taskId: 'run', title: 'Daily standup note', body: 'Needs attention' },
      { taskId: 'crew-chat', title: 'Review crew', body: 'Done' },
      { taskId: 'group', title: 'Researcher, Writer', body: 'Done' },
    ]);
  });

  it('never carries what was asked or answered, and cuts a long name to fit', () => {
    const shown = backgroundNotices(finished, names, true);
    expect(JSON.stringify(shown)).not.toContain('private part');
    expect(JSON.stringify(shown)).not.toContain('Ask ');
    const longName = { ...standup, name: 'x'.repeat(300) };
    const [notice] = backgroundNotices([{ task: scheduleRun('run', 'completed'), outcome: 'done' }], { ...names, routines: [longName] }, true);
    expect(notice.title.length).toBe(120);
    expect(notice.title.endsWith('…')).toBe(true);
  });
});
