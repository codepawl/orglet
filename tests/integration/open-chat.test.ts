import { describe, expect, it } from 'vitest';
import { chatClosure, closedChatDestination, openChatRefresh, type OpenChatReads } from '../../apps/desktop/src/renderer/openChat';
import type { Run, Task, TaskDetail, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { WorkspaceGrantView } from '../../apps/desktop/src/shared/workspace-access';
import type { WorkspaceRecoveryView } from '../../apps/desktop/src/shared/workspace-recovery';

const worker = (id: string, name = id) => ({ id, name }) as Worker;
const team = (id: string, name = id) => ({ id, name }) as Team;
const chat = (fields: Partial<Task> & { id: string }) => ({ workerId: 'researcher', ...fields }) as Task;
const detailOf = (task: Task, runs: Run[] = []) => ({ task, runs }) as unknown as TaskDetail;
const runBy = (who: Worker) => ({ snapshot: { worker: who } }) as Run;

const grant = { id: 'grant', name: 'project' } as unknown as WorkspaceGrantView;
const recovery = { taskId: 'chat' } as unknown as WorkspaceRecoveryView;
const fulfilled = <T,>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value });
const rejected = (message: string): PromiseRejectedResult => ({ status: 'rejected', reason: new Error(message) });
const allRead = (task: Task): OpenChatReads => ({ detail: fulfilled(detailOf(task)), grant: fulfilled(grant), recovery: fulfilled(recovery) });

describe('refreshing the open chat (COD-282)', () => {
  it('closes a chat the workspace no longer lists, whatever its reads said, without an error', () => {
    const reads: OpenChatReads = { detail: rejected('Không tìm thấy mục này.'), grant: rejected('Không tìm thấy mục này.'), recovery: rejected('Không tìm thấy mục này.') };
    expect(openChatRefresh('chat', [chat({ id: 'other' })], reads)).toEqual({ gone: true });
  });

  it('keeps an archived chat open with no folder, and does not show the refusal to read its grant', () => {
    const archived = chat({ id: 'chat', archivedAt: '2026-09-27T08:00:00Z' });
    const reads: OpenChatReads = { ...allRead(archived), grant: rejected('Task đã đóng; không thể sử dụng workspace.') };
    const outcome = openChatRefresh('chat', [archived], reads);
    expect(outcome).toEqual({ gone: false, detail: reads.detail.status === 'fulfilled' ? reads.detail.value : undefined, grant: null, recovery });
  });

  it('passes everything through for an open chat', () => {
    const open = chat({ id: 'chat' });
    const outcome = openChatRefresh('chat', [open], allRead(open));
    expect(outcome).toMatchObject({ gone: false, grant, recovery });
    expect(outcome).not.toHaveProperty('error');
  });

  it('reports a read that fails on a chat still listed, and keeps what did arrive', () => {
    const open = chat({ id: 'chat' });
    const outcome = openChatRefresh('chat', [open], { ...allRead(open), detail: rejected('Hết thời gian chờ.') });
    expect(outcome).toMatchObject({ gone: false, detail: undefined, grant, recovery, error: 'Hết thời gian chờ.' });
  });
});

describe('where a chat that disappeared closes to', () => {
  const workspace = { workers: [worker('researcher'), worker('writer')], teams: [team('crew')] };

  it('goes to its crew, then its orglet, while they are listed', () => {
    expect(closedChatDestination(chat({ id: 'a', teamId: 'crew' }), workspace)).toEqual({ kind: 'team', id: 'crew' });
    expect(closedChatDestination(chat({ id: 'b', workerId: 'writer', sideOf: { taskId: 'main' } as Task['sideOf'] }), workspace)).toEqual({ kind: 'worker', id: 'writer' });
  });

  it('falls back to the first orglet, then the first crew, then nothing', () => {
    expect(closedChatDestination(chat({ id: 'c', workerId: 'gone' }), workspace)).toEqual({ kind: 'worker', id: 'researcher' });
    expect(closedChatDestination(undefined, workspace)).toEqual({ kind: 'worker', id: 'researcher' });
    expect(closedChatDestination(chat({ id: 'd', teamId: 'gone' }), { workers: [], teams: [team('crew')] })).toEqual({ kind: 'team', id: 'crew' });
    expect(closedChatDestination(chat({ id: 'e' }), { workers: [], teams: [] })).toBeUndefined();
  });
});

describe('whether the open chat takes a new message', () => {
  const researcher = worker('researcher', 'Researcher');
  const live = { workers: [researcher], teams: [], archivedWorkers: [], archivedTeams: [] };

  it('is open when the chat and its orglet are', () => {
    expect(chatClosure(detailOf(chat({ id: 'a' })), live)).toBeUndefined();
  });

  it('is read-only while the chat is archived', () => {
    expect(chatClosure(detailOf(chat({ id: 'a', archivedAt: '2026-09-27T08:00:00Z' })), live)).toEqual({ archived: true });
  });

  it('names an archived orglet or crew so it can be restored', () => {
    const archivedWorkers = [{ ...researcher, archivedAt: '2026-09-27T08:00:00Z' }];
    expect(chatClosure(detailOf(chat({ id: 'a' })), { ...live, workers: [], archivedWorkers })).toEqual({ archived: false, owner: { kind: 'worker', id: 'researcher', name: 'Researcher', state: 'archived' } });
    const archivedTeams = [{ ...team('crew', 'Launch crew'), archivedAt: '2026-09-27T08:00:00Z' }];
    expect(chatClosure(detailOf(chat({ id: 'b', teamId: 'crew' })), { ...live, archivedTeams })).toEqual({ archived: false, owner: { kind: 'team', id: 'crew', name: 'Launch crew', state: 'archived' } });
  });

  it('names a deleted orglet or crew from the chat’s own record', () => {
    expect(chatClosure(detailOf(chat({ id: 'a' }), [runBy(researcher)]), { ...live, workers: [] })).toEqual({ archived: false, owner: { kind: 'worker', id: 'researcher', name: 'Researcher', state: 'deleted' } });
    const frozen = chat({ id: 'b', teamId: 'crew', teamSnapshot: team('crew', 'Launch crew') });
    expect(chatClosure(detailOf(frozen), live)).toEqual({ archived: false, owner: { kind: 'team', id: 'crew', name: 'Launch crew', state: 'deleted' } });
  });

  it('leaves a group chat to the core, since it has no single owner', () => {
    expect(chatClosure(detailOf(chat({ id: 'a', assignees: ['researcher', 'gone'] })), { ...live, workers: [] })).toBeUndefined();
  });
});
