import { describe, expect, it } from 'vitest';
import {
  MAX_OPEN_CHATS,
  MAX_RECENT_CHATS,
  NO_OPEN_CHATS,
  chatExists,
  chatKey,
  chatKeyForTask,
  chatKeyForView,
  closeOpenChat,
  initialSidebarMode,
  isRosterChat,
  openChatState,
  parseChatKey,
  parseStoredOpenChats,
  pruneOpenChats,
  serializeOpenChats,
  shownOpenChats,
  strongestOpenChatState,
  visitChat,
  walkRecent,
  walkSnapshot,
  type OpenChatLists,
  type OpenChats,
} from '../../apps/desktop/src/renderer/openChats';
import { availableChatViews, chatViewToShow, memoriesOf, schedulesOf, viewOwnerOfTask } from '../../apps/desktop/src/renderer/chatViews';
import type { Routine, Task } from '../../apps/desktop/src/shared/contracts';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';

const chat = (fields: Partial<Task> & { id: string }) => ({ workerId: 'researcher', createdAt: '2026-09-30T08:00:00Z', ...fields }) as Task;

const researcherMain = chat({ id: 'main' });
const olderMain = chat({ id: 'older', createdAt: '2026-09-29T08:00:00Z' });
const sideThread = chat({ id: 'side', sideOf: { taskId: 'main' } as Task['sideOf'] });
const crewChat = chat({ id: 'crew-chat', teamId: 'crew', workerId: 'lead' });
const groupChat = chat({ id: 'group', assignees: ['researcher', 'writer'] });
const scheduleRun = chat({ id: 'run', routineId: 'digest' });
const tasks = [researcherMain, olderMain, sideThread, crewChat, groupChat, scheduleRun];

describe('keying a chat by what it opens (COD-340)', () => {
  it('keys an orglet or crew main chat by the orglet or crew, and every other chat by its own row', () => {
    expect(chatKeyForTask(researcherMain, tasks)).toBe('worker:researcher');
    expect(chatKeyForTask(crewChat, tasks)).toBe('team:crew');
    expect(chatKeyForTask(sideThread, tasks)).toBe('task:side');
    expect(chatKeyForTask(groupChat, tasks)).toBe('task:group');
    expect(chatKeyForTask(scheduleRun, tasks)).toBe('task:run');
    // Not the live chat any more (a newer one took over), so it is a chat of its own.
    expect(chatKeyForTask(olderMain, tasks)).toBe('task:older');
  });

  it('keys the empty chat by who it talks to, and waits for an open chat whose row has not arrived', () => {
    expect(chatKeyForView({ selected: null, teamId: '', workerId: 'writer', pendingGroup: false }, tasks)).toBe('worker:writer');
    expect(chatKeyForView({ selected: null, teamId: 'crew', workerId: 'writer', pendingGroup: false }, tasks)).toBe('team:crew');
    expect(chatKeyForView({ selected: null, teamId: '', workerId: 'writer', pendingGroup: true }, tasks)).toBeUndefined();
    expect(chatKeyForView({ selected: 'side', teamId: '', workerId: 'researcher', pendingGroup: false }, tasks)).toBe('task:side');
    expect(chatKeyForView({ selected: 'not-listed-yet', teamId: '', workerId: 'researcher', pendingGroup: false }, tasks)).toBeUndefined();
  });

  it('reads a key back, refuses anything it did not write, and tells a roster chat from the others', () => {
    expect(parseChatKey(chatKey({ kind: 'task', id: 'a:b' }))).toEqual({ kind: 'task', id: 'a:b' });
    expect(parseChatKey('worker:')).toBeUndefined();
    expect(parseChatKey('folder:x')).toBeUndefined();
    expect(parseChatKey('nothing')).toBeUndefined();
    expect(isRosterChat('worker:a')).toBe(true);
    expect(isRosterChat('team:a')).toBe(true);
    expect(isRosterChat('task:a')).toBe(false);
  });
});

describe('the Open list and the recent chats (COD-355)', () => {
  it('puts the chat on screen first in the recent list, and only a chat without any row on the Open list', () => {
    let state: OpenChats = NO_OPEN_CHATS;
    state = visitChat(state, 'worker:researcher');
    // A side thread hangs under its orglet and a group chat sits in its section: both have a row already.
    state = visitChat(state, 'task:side', true);
    state = visitChat(state, 'team:crew');
    state = visitChat(state, 'task:group', true);
    // An older run of a schedule has no row of its own anywhere.
    state = visitChat(state, 'task:old-run', false);
    expect(state.open).toEqual(['task:old-run']);
    expect(state.recent).toEqual(['task:old-run', 'task:group', 'team:crew', 'task:side', 'worker:researcher']);
  });

  it('never puts a roster chat on the Open list, even when asked to', () => {
    expect(visitChat(NO_OPEN_CHATS, 'worker:researcher', false).open).toEqual([]);
  });

  it('shows only the chats that still have no row, so none is listed twice', () => {
    const rowed = new Set(['task:side']);
    expect(shownOpenChats(['task:side', 'task:old-run', 'worker:researcher'], key => rowed.has(key))).toEqual(['task:old-run']);
  });

  it('keeps the Open list in the order chats were opened, so going back to one does not move its row', () => {
    const state = visitChat(visitChat(visitChat(NO_OPEN_CHATS, 'task:a'), 'task:b'), 'task:a');
    expect(state.open).toEqual(['task:a', 'task:b']);
    expect(state.recent).toEqual(['task:a', 'task:b']);
  });

  it('returns the same object when the chat on screen is already first and listed', () => {
    const state = visitChat(NO_OPEN_CHATS, 'task:a');
    expect(visitChat(state, 'task:a')).toBe(state);
  });

  it('lets the chat opened longest ago give way past the limits, never the one being opened', () => {
    let state: OpenChats = NO_OPEN_CHATS;
    for (let index = 0; index < MAX_OPEN_CHATS + 3; index++) state = visitChat(state, `task:${index}`);
    expect(state.open).toHaveLength(MAX_OPEN_CHATS);
    expect(state.open[0]).toBe('task:3');
    expect(state.open.at(-1)).toBe(`task:${MAX_OPEN_CHATS + 2}`);
    expect(state.recent).toHaveLength(MAX_RECENT_CHATS);
    expect(state.recent[0]).toBe(`task:${MAX_OPEN_CHATS + 2}`);
  });

  it('closing the chat on screen hands over to the chat used before it, and Ctrl+Tab forgets it', () => {
    const state: OpenChats = { open: ['task:side', 'task:group'], recent: ['task:group', 'worker:researcher', 'task:side'] };
    expect(closeOpenChat(state, 'task:group', 'task:group')).toEqual({
      state: { open: ['task:side'], recent: ['worker:researcher', 'task:side'] },
      activate: 'worker:researcher',
    });
  });

  it('closes another chat without moving the screen, and does nothing for a chat not on the list', () => {
    const state: OpenChats = { open: ['task:side', 'task:group'], recent: ['task:group', 'task:side'] };
    expect(closeOpenChat(state, 'task:side', 'task:group')).toEqual({ state: { open: ['task:group'], recent: ['task:group'] } });
    expect(closeOpenChat(state, 'worker:researcher', 'worker:researcher')).toEqual({ state });
    // A side thread opened from its row under the orglet: Ctrl+W there has nothing to close.
    expect(closeOpenChat(state, 'task:nested-side', 'task:nested-side')).toEqual({ state });
  });

  it('has nothing to hand over to when the closed chat was the only one used', () => {
    const state: OpenChats = { open: ['task:side'], recent: ['task:side'] };
    expect(closeOpenChat(state, 'task:side', 'task:side')).toEqual({ state: { open: [], recent: [] }, activate: undefined });
  });
});

describe('walking the recent chats with Ctrl+Tab', () => {
  it('starts from the chat on screen, goes one further back on each press, and wraps round', () => {
    const snapshot = walkSnapshot(['task:b', 'worker:a', 'team:c'], 'task:b');
    expect(snapshot).toEqual(['task:b', 'worker:a', 'team:c']);
    expect(walkRecent(snapshot, 0, 1)).toBe(1);
    expect(walkRecent(snapshot, 1, 1)).toBe(2);
    expect(walkRecent(snapshot, 2, 1)).toBe(0);
  });

  it('goes the other way with Shift, starting from the chat used longest ago', () => {
    expect(walkRecent(['task:b', 'worker:a', 'team:c'], 0, -1)).toBe(2);
  });

  it('puts an empty chat not in the list yet at the front, and does nothing with one chat', () => {
    expect(walkSnapshot(['worker:a'], 'worker:writer')).toEqual(['worker:writer', 'worker:a']);
    expect(walkSnapshot(['worker:a', 'task:b'], undefined)).toEqual(['worker:a', 'task:b']);
    expect(walkRecent(['worker:a'], 0, 1)).toBeUndefined();
    expect(walkRecent([], 0, 1)).toBeUndefined();
  });
});

describe('chats that left', () => {
  const lists: OpenChatLists = {
    workers: [{ id: 'researcher' }],
    teams: [{ id: 'crew' }],
    tasks: [
      { id: 'side' },
      { id: 'archived', archivedAt: '2026-09-30T09:00:00Z' },
      { id: 'deleted', deletedAt: '2026-09-30T09:00:00Z' },
    ],
  };

  it('drops an archived or deleted chat and a removed orglet or crew from both lists, and keeps the rest in order', () => {
    const state: OpenChats = {
      open: ['task:archived', 'task:side', 'task:deleted'],
      recent: ['worker:researcher', 'task:archived', 'team:crew', 'worker:gone', 'task:deleted', 'team:gone', 'task:side'],
    };
    expect(pruneOpenChats(state, lists)).toEqual({ open: ['task:side'], recent: ['worker:researcher', 'team:crew', 'task:side'] });
    expect(chatExists('task:missing', lists)).toBe(false);
  });

  it('keeps the chat on screen while it is read, and returns the same object when nothing left', () => {
    expect(pruneOpenChats({ open: ['task:archived', 'task:side'], recent: [] }, lists, 'task:archived').open).toEqual(['task:archived', 'task:side']);
    const state: OpenChats = { open: ['task:side'], recent: ['worker:researcher', 'task:side'] };
    expect(pruneOpenChats(state, lists)).toBe(state);
  });
});

describe('the one state an open chat shows', () => {
  it('shows running, an error, and an answer not read yet', () => {
    expect(openChatState({ status: 'running', seen: true })).toBe('running');
    expect(openChatState({ status: 'queued', seen: true })).toBe('running');
    expect(openChatState({ status: 'failed', seen: true })).toBe('error');
    expect(openChatState({ status: 'interrupted', seen: true })).toBe('error');
    expect(openChatState({ status: 'completed', seen: false })).toBe('unread');
    expect(openChatState({ status: 'completed', seen: true })).toBe('idle');
    expect(openChatState({ seen: true })).toBe('idle');
  });

  it('shows "needs you" over everything, since a run that stopped to ask still reads as running', () => {
    expect(openChatState({ status: 'running', seen: true, pendingApproval: true })).toBe('needs-you');
    expect(openChatState({ status: 'running', seen: true, waitsForPerson: true })).toBe('needs-you');
    expect(openChatState({ status: 'completed', seen: false, heldForReview: true })).toBe('needs-you');
    expect(openChatState({ status: 'waiting_input', seen: true })).toBe('needs-you');
    expect(openChatState({ status: 'waiting_budget', seen: true })).toBe('needs-you');
    expect(openChatState({ status: 'paused', seen: true })).toBe('needs-you');
  });

  it('rolls several chats up to the one that matters most, for a face on the rail', () => {
    expect(strongestOpenChatState(['unread', 'running', 'idle'])).toBe('running');
    expect(strongestOpenChatState(['running', 'error'])).toBe('error');
    expect(strongestOpenChatState(['error', 'needs-you'])).toBe('needs-you');
    expect(strongestOpenChatState([])).toBe('idle');
  });
});

describe('what is kept between starts', () => {
  it('writes the two lists and reads them back', () => {
    const state: OpenChats = { open: ['task:side'], recent: ['task:side', 'worker:researcher'] };
    const stored = serializeOpenChats(state);
    expect(JSON.parse(stored)).toEqual({ version: 2, open: ['task:side'], recent: ['task:side', 'worker:researcher'] });
    expect(parseStoredOpenChats(stored)).toEqual(state);
  });

  it('turns the tab strip of COD-340 into the Open list in strip order and the recent list newest first', () => {
    const strip = JSON.stringify({ version: 1, keys: ['worker:researcher', 'task:side', 'team:crew', 'task:group'] });
    expect(parseStoredOpenChats(strip)).toEqual({
      open: ['task:side', 'task:group'],
      recent: ['task:group', 'team:crew', 'task:side', 'worker:researcher'],
    });
  });

  it('starts empty from nothing, a broken value or an unknown version, and drops keys it cannot read', () => {
    expect(parseStoredOpenChats(null)).toEqual(NO_OPEN_CHATS);
    expect(parseStoredOpenChats('{not json')).toEqual(NO_OPEN_CHATS);
    expect(parseStoredOpenChats(JSON.stringify({ version: 3, open: ['task:a'] }))).toEqual(NO_OPEN_CHATS);
    expect(parseStoredOpenChats(JSON.stringify({ version: 1, keys: ['task:a', 7, 'bogus', 'task:a', 'team:b'] }))).toEqual({ open: ['task:a'], recent: ['team:b', 'task:a'] });
    // A roster chat never belongs on the Open list, even if one was written there.
    expect(parseStoredOpenChats(JSON.stringify({ version: 2, open: ['worker:a', 'task:b'], recent: 'nope' }))).toEqual({ open: ['task:b'], recent: [] });
  });

  it('opens a new install on the rail, and keeps the full sidebar for a profile used before', () => {
    expect(initialSidebarMode(null, false)).toBe('rail');
    expect(initialSidebarMode(null, true)).toBe('full');
    expect(initialSidebarMode('rail', true)).toBe('rail');
    expect(initialSidebarMode('full', false)).toBe('full');
    expect(initialSidebarMode('sideways', false)).toBe('rail');
  });
});

describe('the views of the chat on screen (COD-355)', () => {
  it('always lists the chat first, and another view only while it has something, with its count', () => {
    expect(availableChatViews({ files: 0, changes: 0, schedules: 0, memory: 0 })).toEqual([{ name: 'chat' }]);
    expect(availableChatViews({ files: 2, changes: 0, schedules: 1, memory: 4 })).toEqual([
      { name: 'chat' }, { name: 'files', count: 2 }, { name: 'schedules', count: 1 }, { name: 'memory', count: 4 },
    ]);
  });

  it('shows the view asked for while it is listed, and falls back to the chat once it is empty', () => {
    const views = availableChatViews({ files: 1, changes: 0, schedules: 0, memory: 0 });
    expect(chatViewToShow('files', views)).toBe('files');
    expect(chatViewToShow('changes', views)).toBe('chat');
    expect(chatViewToShow(undefined, views)).toBe('chat');
  });

  const digest = { id: 'digest', task: { workerId: 'lead', teamId: 'crew' } } as Routine;
  const morning = { id: 'morning', task: { workerId: 'researcher' } } as Routine;

  it('finds whose chat it is: the orglet, the crew, the schedule a run belongs to, and nobody for a group chat', () => {
    expect(viewOwnerOfTask(researcherMain, [])).toEqual({ kind: 'worker', id: 'researcher' });
    expect(viewOwnerOfTask(sideThread, [])).toEqual({ kind: 'worker', id: 'researcher' });
    expect(viewOwnerOfTask(crewChat, [])).toEqual({ kind: 'team', id: 'crew' });
    expect(viewOwnerOfTask(scheduleRun, [digest])).toEqual({ kind: 'team', id: 'crew' });
    expect(viewOwnerOfTask(groupChat, [])).toBeUndefined();
  });

  it('lists the schedules that run as that orglet or crew, and a crew schedule is not its lead orglet\'s', () => {
    const routines = [digest, morning];
    expect(schedulesOf(routines, { kind: 'worker', id: 'researcher' })).toEqual([morning]);
    expect(schedulesOf(routines, { kind: 'team', id: 'crew' })).toEqual([digest]);
    expect(schedulesOf(routines, { kind: 'worker', id: 'lead' })).toEqual([]);
    expect(schedulesOf(routines, undefined)).toEqual([]);
  });

  it('lists the memories kept for that orglet or crew, newest first, leaving out notes, archived ones and other scopes', () => {
    const memory = (id: string, scope: Knowledge['scope'], fields: Partial<Knowledge> = {}) => ({ id, kind: 'memory', status: 'approved', scope, createdAt: `2026-09-2${id.length}T00:00:00Z`, ...fields }) as Knowledge;
    const knowledge = [
      memory('a', { type: 'worker', id: 'researcher' }),
      memory('bb', { type: 'worker', id: 'researcher' }),
      memory('ccc', { type: 'worker', id: 'researcher' }, { status: 'archived' }),
      memory('dddd', { type: 'worker', id: 'researcher' }, { kind: 'note' } as Partial<Knowledge>),
      memory('eeeee', { type: 'team', id: 'crew' }),
      memory('ffffff', { type: 'workspace' } as Knowledge['scope']),
    ];
    expect(memoriesOf(knowledge, { kind: 'worker', id: 'researcher' }).map(item => item.id)).toEqual(['bb', 'a']);
    expect(memoriesOf(knowledge, { kind: 'team', id: 'crew' }).map(item => item.id)).toEqual(['eeeee']);
    expect(memoriesOf(knowledge, undefined)).toEqual([]);
  });
});
