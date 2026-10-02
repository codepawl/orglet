import { describe, expect, it } from 'vitest';
import { archiveGroupOfChat, archiveGroups } from '../../apps/desktop/src/renderer/archive';

type Entity = { id: string; archivedAt?: string };
type Chat = { id: string; archivedAt?: string; deletedAt?: string; teamId?: string; assignees?: 'all' | string[]; routineId?: string; sideOf?: string };

const worker = (id: string, archivedAt?: string): Entity => ({ id, archivedAt });
const chat = (id: string, fields: Partial<Chat> = {}): Chat => ({ id, ...fields });

describe('what Settings → Lưu trữ lists (COD-375)', () => {
  const workers = [worker('old-orglet', '2026-09-20T08:00:00Z'), worker('new-orglet', '2026-09-27T08:00:00Z')];
  const teams = [worker('launch-crew', '2026-09-24T08:00:00Z')];
  const tasks: Chat[] = [
    chat('open-thread', { sideOf: 'main' }),
    chat('old-thread', { sideOf: 'main', archivedAt: '2026-09-20T08:00:00Z' }),
    chat('new-thread', { sideOf: 'main', archivedAt: '2026-09-25T08:00:00Z' }),
    chat('main', { archivedAt: '2026-09-22T08:00:00Z' }),
    chat('scout-run', { routineId: 'daily', archivedAt: '2026-09-21T08:00:00Z' }),
    chat('crew-chat', { teamId: 'launch', archivedAt: '2026-09-23T08:00:00Z' }),
    chat('crew-run', { teamId: 'launch', routineId: 'weekly', archivedAt: '2026-09-26T08:00:00Z' }),
    chat('group', { assignees: ['scout', 'writer'], archivedAt: '2026-09-28T08:00:00Z' }),
    chat('deleted', { sideOf: 'main', archivedAt: '2026-09-26T08:00:00Z', deletedAt: '2026-09-26T09:00:00Z' }),
  ];

  it('groups everything archived as orglets, channels and chats, in that order', () => {
    const groups = archiveGroups({ workers, teams, tasks });
    expect(groups.map(group => group.id)).toEqual(['orglets', 'channels', 'chats']);
  });

  it('lists each group most recently archived first', () => {
    const groups = archiveGroups({ workers, teams, tasks });
    const ids = (id: string) => groups.find(group => group.id === id)!.entries.map(entry => entry.id);
    expect(ids('orglets')).toEqual(['new-orglet', 'old-orglet']);
    // A crew archived before crews became channels is a channel, beside the channels' own chats.
    expect(ids('channels')).toEqual(['group', 'launch-crew', 'crew-chat']);
    // A schedule run of a crew is a run, so it lists with the chats.
    expect(ids('chats')).toEqual(['crew-run', 'new-thread', 'main', 'scout-run', 'old-thread']);
  });

  it('never lists an open chat, a deleted chat or an orglet that is not archived', () => {
    const everyone = archiveGroups({ workers: [...workers, worker('active')], teams, tasks }).flatMap(group => group.entries.map(entry => entry.id));
    expect(everyone).not.toContain('open-thread');
    expect(everyone).not.toContain('deleted');
    expect(everyone).not.toContain('active');
  });

  it('keeps what each entry was so the row can word it', () => {
    const groups = archiveGroups({ workers, teams, tasks });
    const channels = groups.find(group => group.id === 'channels')!.entries;
    expect(channels.map(entry => entry.type)).toEqual(['chat', 'team', 'chat']);
    const chats = groups.find(group => group.id === 'chats')!.entries;
    expect(chats.map(entry => entry.type === 'chat' ? entry.kind : entry.type)).toEqual(['schedule', 'side', 'main', 'schedule', 'side']);
  });

  it('leaves an empty group out, and the whole list empty when nothing is archived', () => {
    expect(archiveGroups({ workers, teams: [], tasks: [] }).map(group => group.id)).toEqual(['orglets']);
    expect(archiveGroups({ workers: [worker('active')], teams: [], tasks: [chat('live')] })).toEqual([]);
  });

  it('files only a channel\'s own chat with the channels', () => {
    expect(archiveGroupOfChat('channel')).toBe('channels');
    expect(archiveGroupOfChat('main')).toBe('chats');
    expect(archiveGroupOfChat('side')).toBe('chats');
    expect(archiveGroupOfChat('schedule')).toBe('chats');
  });
});
