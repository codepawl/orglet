import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_TABS,
  chatTabExists,
  chatTabKey,
  chatTabState,
  closeChatTab,
  cycleChatTab,
  initialSidebarMode,
  neighbourTab,
  openChatTab,
  parseChatTabKey,
  parseStoredChatTabs,
  pruneChatTabs,
  serializeChatTabs,
  strongestChatTabState,
  tabKeyForTask,
  tabKeyForView,
  type ChatTabLists,
} from '../../apps/desktop/src/renderer/chatTabs';
import type { Task } from '../../apps/desktop/src/shared/contracts';

const chat = (fields: Partial<Task> & { id: string }) => ({ workerId: 'researcher', createdAt: '2026-09-30T08:00:00Z', ...fields }) as Task;

const researcherMain = chat({ id: 'main' });
const olderMain = chat({ id: 'older', createdAt: '2026-09-29T08:00:00Z' });
const sideThread = chat({ id: 'side', sideOf: { taskId: 'main' } as Task['sideOf'] });
const crewChat = chat({ id: 'crew-chat', teamId: 'crew', workerId: 'lead' });
const groupChat = chat({ id: 'group', assignees: ['researcher', 'writer'] });
const scheduleRun = chat({ id: 'run', routineId: 'digest' });
const tasks = [researcherMain, olderMain, sideThread, crewChat, groupChat, scheduleRun];

describe('keying a tab by what it opens (COD-340)', () => {
  it('keys an orglet or crew main chat by the orglet or crew, and every other chat by its own row', () => {
    expect(tabKeyForTask(researcherMain, tasks)).toBe('worker:researcher');
    expect(tabKeyForTask(crewChat, tasks)).toBe('team:crew');
    expect(tabKeyForTask(sideThread, tasks)).toBe('task:side');
    expect(tabKeyForTask(groupChat, tasks)).toBe('task:group');
    expect(tabKeyForTask(scheduleRun, tasks)).toBe('task:run');
    // Not the live chat any more (a newer one took over), so it is a chat of its own.
    expect(tabKeyForTask(olderMain, tasks)).toBe('task:older');
  });

  it('keys the empty chat by who it talks to, and waits for an open chat whose row has not arrived', () => {
    expect(tabKeyForView({ selected: null, teamId: '', workerId: 'writer', pendingGroup: false }, tasks)).toBe('worker:writer');
    expect(tabKeyForView({ selected: null, teamId: 'crew', workerId: 'writer', pendingGroup: false }, tasks)).toBe('team:crew');
    expect(tabKeyForView({ selected: null, teamId: '', workerId: 'writer', pendingGroup: true }, tasks)).toBeUndefined();
    expect(tabKeyForView({ selected: 'side', teamId: '', workerId: 'researcher', pendingGroup: false }, tasks)).toBe('task:side');
    expect(tabKeyForView({ selected: 'not-listed-yet', teamId: '', workerId: 'researcher', pendingGroup: false }, tasks)).toBeUndefined();
  });

  it('reads a key back, and refuses anything it did not write', () => {
    expect(parseChatTabKey(chatTabKey({ kind: 'task', id: 'a:b' }))).toEqual({ kind: 'task', id: 'a:b' });
    expect(parseChatTabKey('worker:')).toBeUndefined();
    expect(parseChatTabKey('folder:x')).toBeUndefined();
    expect(parseChatTabKey('nothing')).toBeUndefined();
  });
});

describe('opening, closing and walking the tabs', () => {
  it('adds a tab at the end once, and returns the same strip when the chat already has one', () => {
    const strip = openChatTab([], 'worker:a');
    expect(openChatTab(strip, 'worker:b')).toEqual(['worker:a', 'worker:b']);
    expect(openChatTab(strip, 'worker:a')).toBe(strip);
  });

  it('drops the leftmost other tab past the limit, never the one being opened', () => {
    const full = Array.from({ length: MAX_CHAT_TABS }, (_, index) => `task:${index}`);
    const opened = openChatTab(full, 'task:new');
    expect(opened).toHaveLength(MAX_CHAT_TABS);
    expect(opened[0]).toBe('task:1');
    expect(opened.at(-1)).toBe('task:new');
  });

  it('hands the open chat to the tab on its right, or on its left when it was the last', () => {
    const strip = ['a', 'b', 'c'].map(id => `task:${id}`);
    expect(closeChatTab(strip, 'task:b', 'task:b')).toEqual({ keys: ['task:a', 'task:c'], activate: 'task:c' });
    expect(closeChatTab(strip, 'task:c', 'task:c')).toEqual({ keys: ['task:a', 'task:b'], activate: 'task:b' });
    expect(neighbourTab(['task:only'], 'task:only')).toBeUndefined();
  });

  it('closes a tab in the background without moving the open chat, and never closes the last tab', () => {
    expect(closeChatTab(['task:a', 'task:b'], 'task:a', 'task:b')).toEqual({ keys: ['task:b'] });
    const alone = ['task:a'];
    expect(closeChatTab(alone, 'task:a', 'task:a')).toEqual({ keys: alone });
    expect(closeChatTab(alone, 'task:missing', 'task:a')).toEqual({ keys: alone });
  });

  it('walks right and left round the strip like Ctrl+Tab in a browser', () => {
    const strip = ['task:a', 'task:b', 'task:c'];
    expect(cycleChatTab(strip, 'task:c', 1)).toBe('task:a');
    expect(cycleChatTab(strip, 'task:a', -1)).toBe('task:c');
    expect(cycleChatTab(strip, 'task:a', 1)).toBe('task:b');
    // An empty group chat has no tab yet: the walk starts from an end.
    expect(cycleChatTab(strip, undefined, 1)).toBe('task:a');
    expect(cycleChatTab(strip, undefined, -1)).toBe('task:c');
    expect(cycleChatTab(['task:a'], 'task:a', 1)).toBeUndefined();
  });
});

describe('tabs whose chat left', () => {
  const lists: ChatTabLists = {
    workers: [{ id: 'researcher' }],
    teams: [{ id: 'crew' }],
    tasks: [
      { id: 'side' },
      { id: 'archived', archivedAt: '2026-09-30T09:00:00Z' },
      { id: 'deleted', deletedAt: '2026-09-30T09:00:00Z' },
    ],
  };

  it('drops an archived or deleted chat and a removed orglet or crew, and keeps the rest in order', () => {
    const strip = ['worker:researcher', 'task:archived', 'team:crew', 'worker:gone', 'task:deleted', 'team:gone', 'task:side'];
    expect(pruneChatTabs(strip, lists)).toEqual(['worker:researcher', 'team:crew', 'task:side']);
    expect(chatTabExists('task:missing', lists)).toBe(false);
  });

  it('keeps the open chat while it is on screen, and returns the same strip when nothing left', () => {
    expect(pruneChatTabs(['task:archived', 'task:side'], lists, 'task:archived')).toEqual(['task:archived', 'task:side']);
    const strip = ['worker:researcher', 'task:side'];
    expect(pruneChatTabs(strip, lists)).toBe(strip);
  });
});

describe('the one state a tab shows', () => {
  it('shows running, an error, and an answer not read yet', () => {
    expect(chatTabState({ status: 'running', seen: true })).toBe('running');
    expect(chatTabState({ status: 'queued', seen: true })).toBe('running');
    expect(chatTabState({ status: 'failed', seen: true })).toBe('error');
    expect(chatTabState({ status: 'interrupted', seen: true })).toBe('error');
    expect(chatTabState({ status: 'completed', seen: false })).toBe('unread');
    expect(chatTabState({ status: 'completed', seen: true })).toBe('idle');
    expect(chatTabState({ seen: true })).toBe('idle');
  });

  it('shows "needs you" over everything, since a run that stopped to ask still reads as running', () => {
    expect(chatTabState({ status: 'running', seen: true, pendingApproval: true })).toBe('needs-you');
    expect(chatTabState({ status: 'running', seen: true, waitsForPerson: true })).toBe('needs-you');
    expect(chatTabState({ status: 'completed', seen: false, heldForReview: true })).toBe('needs-you');
    expect(chatTabState({ status: 'waiting_input', seen: true })).toBe('needs-you');
    expect(chatTabState({ status: 'waiting_budget', seen: true })).toBe('needs-you');
    expect(chatTabState({ status: 'paused', seen: true })).toBe('needs-you');
  });

  it('rolls several chats up to the one that matters most, for a face on the rail', () => {
    expect(strongestChatTabState(['unread', 'running', 'idle'])).toBe('running');
    expect(strongestChatTabState(['running', 'error'])).toBe('error');
    expect(strongestChatTabState(['error', 'needs-you'])).toBe('needs-you');
    expect(strongestChatTabState([])).toBe('idle');
  });
});

describe('what is kept between starts', () => {
  it('writes only the keys, in order, and reads them back', () => {
    const stored = serializeChatTabs(['worker:researcher', 'task:side']);
    expect(JSON.parse(stored)).toEqual({ version: 1, keys: ['worker:researcher', 'task:side'] });
    expect(parseStoredChatTabs(stored)).toEqual(['worker:researcher', 'task:side']);
  });

  it('starts empty from nothing, a broken value or another version, and drops keys it cannot read', () => {
    expect(parseStoredChatTabs(null)).toEqual([]);
    expect(parseStoredChatTabs('{not json')).toEqual([]);
    expect(parseStoredChatTabs(JSON.stringify({ version: 2, keys: ['task:a'] }))).toEqual([]);
    expect(parseStoredChatTabs(JSON.stringify({ version: 1, keys: ['task:a', 7, 'bogus', 'task:a', 'team:b'] }))).toEqual(['task:a', 'team:b']);
  });

  it('opens a new install on the rail, and keeps the full sidebar for a profile used before', () => {
    expect(initialSidebarMode(null, false)).toBe('rail');
    expect(initialSidebarMode(null, true)).toBe('full');
    expect(initialSidebarMode('rail', true)).toBe('rail');
    expect(initialSidebarMode('full', false)).toBe('full');
    expect(initialSidebarMode('sideways', false)).toBe('rail');
  });
});
