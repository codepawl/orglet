import { describe, expect, it } from 'vitest';
import { archivedChatKind, hidesActive } from '../../apps/desktop/src/renderer/sidebarChats';

type Row = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: string; workerId: string };
const chat = (id: string, fields: Partial<Row> = {}): Row => ({ id, workerId: 'scout', ...fields });

describe('what an archived chat was (COD-286)', () => {
  it('names a main chat, a side thread, a schedule run and a channel', () => {
    expect(archivedChatKind(chat('main'))).toBe('main');
    expect(archivedChatKind(chat('thread', { sideOf: 'main' }))).toBe('side');
    expect(archivedChatKind(chat('run', { routineId: 'daily' }))).toBe('schedule');
    expect(archivedChatKind(chat('crew-chat', { teamId: 'launch' }))).toBe('channel');
    expect(archivedChatKind(chat('group', { assignees: ['scout', 'writer'] }))).toBe('channel');
  });

  it('keeps a schedule run of several orglets named as a run', () => {
    expect(archivedChatKind(chat('group-run', { assignees: ['scout', 'writer'], routineId: 'daily' }))).toBe('schedule');
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
