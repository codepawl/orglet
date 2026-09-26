import { describe, expect, it } from 'vitest';
import { archivedChatKind, archivedChatSection, archivedChatsIn, hidesActive } from '../../apps/desktop/src/renderer/sidebarChats';

type Row = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: string; workerId: string };
const chat = (id: string, fields: Partial<Row> = {}): Row => ({ id, workerId: 'scout', ...fields });

describe('archived chats in the sidebar (COD-286)', () => {
  const tasks: Row[] = [
    chat('open-thread', { sideOf: 'main' }),
    chat('old-thread', { sideOf: 'main', archivedAt: '2026-09-20T08:00:00Z' }),
    chat('new-thread', { sideOf: 'main', archivedAt: '2026-09-25T08:00:00Z' }),
    chat('main', { archivedAt: '2026-09-22T08:00:00Z' }),
    chat('scout-run', { routineId: 'daily', archivedAt: '2026-09-21T08:00:00Z' }),
    chat('crew-chat', { teamId: 'launch', archivedAt: '2026-09-23T08:00:00Z' }),
    chat('crew-run', { teamId: 'launch', routineId: 'weekly', archivedAt: '2026-09-24T08:00:00Z' }),
    chat('group', { assignees: ['scout', 'writer'], archivedAt: '2026-09-19T08:00:00Z' }),
    chat('everyone', { assignees: 'all', archivedAt: '2026-09-18T08:00:00Z' }),
    chat('deleted', { sideOf: 'main', archivedAt: '2026-09-26T08:00:00Z', deletedAt: '2026-09-26T09:00:00Z' }),
  ];

  it('lists each archived chat at the end of the section its row came from, most recently archived first', () => {
    expect(archivedChatsIn(tasks, 'workers').map(item => [item.task.id, item.kind])).toEqual([
      ['new-thread', 'side'], ['main', 'main'], ['scout-run', 'schedule'], ['old-thread', 'side'],
    ]);
    expect(archivedChatsIn(tasks, 'teams').map(item => [item.task.id, item.kind])).toEqual([['crew-run', 'schedule'], ['crew-chat', 'main']]);
    expect(archivedChatsIn(tasks, 'groups').map(item => [item.task.id, item.kind])).toEqual([['group', 'group'], ['everyone', 'group']]);
  });

  it('never lists an open or a deleted chat', () => {
    const listed = [...archivedChatsIn(tasks, 'workers'), ...archivedChatsIn(tasks, 'teams'), ...archivedChatsIn(tasks, 'groups')].map(item => item.task.id);
    expect(listed).not.toContain('open-thread');
    expect(listed).not.toContain('deleted');
  });

  it('keeps a schedule run of several orglets with the group chats, named as a run', () => {
    const run = chat('group-run', { assignees: ['scout', 'writer'], routineId: 'daily', archivedAt: '2026-09-25T08:00:00Z' });
    expect(archivedChatSection(run)).toBe('groups');
    expect(archivedChatKind(run)).toBe('schedule');
  });
});

describe('a chat hidden past "Show N more" (COD-286)', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  it('is revealed only when the one on screen sits past the limit', () => {
    expect(hidesActive(rows, 3, row => row === 'e')).toBe(true);
    expect(hidesActive(rows, 3, row => row === 'b')).toBe(false);
    expect(hidesActive(rows, 3, () => false)).toBe(false);
    expect(hidesActive(rows, 5, row => row === 'e')).toBe(false);
  });
});
