import { describe, expect, it } from 'vitest';
import type { Routine, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { backgroundNotices, chatStatuses, finishedChats, inAppNotice, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { collapseNotices, useNotices, type Notice } from '../../apps/desktop/src/renderer/components/notifications';
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
      { taskId: 'done', text: 'Researcher answered in a side thread', tone: 'success', about: 'Ask done' },
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
