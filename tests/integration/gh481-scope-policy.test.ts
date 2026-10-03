import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SyncRecord, type SyncData, type SyncRoot } from '../../apps/desktop/src/shared/sync-records';
import { assessScope, deletionEntities, immutable } from '../../services/sync/src/scope-policy';

const device = randomUUID();
const epoch = randomUUID();
const worker = randomUUID();
const task = randomUUID();
const source = randomUUID();
const skill = randomUUID();
const at = '2026-01-01T00:00:00.000Z';
const roots: SyncRoot[] = [{ kind: 'worker', id: worker }, { kind: 'task', id: task }];
function record(data: unknown, scopes: SyncRoot[] = roots, wallMs = 1): SyncRecord {
  return SyncRecord.parse({ schemaVersion: 1, id: randomUUID(), origin: device,
    clock: { deviceId: device, wallMs, counter: 0 }, scopes: scopes.map(root => ({ ...root, epoch })), data });
}
const chat = () => record({ kind: 'chat', value: { id: task, workerId: worker, createdAt: at } });
const turn = (sourceIds = [source]) => record({ kind: 'turn', value: { id: randomUUID(), taskId: task, createdAt: at, input: { brief: 'hello', sourceIds } } });
const file = (scopes = roots) => record({ kind: 'source', value: { id: source, name: 'note.txt', bytes: 4, hash: 'a'.repeat(64) } }, scopes);
const withdrawal = (deleted = false, localOnly = true, wallMs = 2) => record({ kind: 'withdraw', root: roots[1], epoch, deleted, localOnly }, [], wallMs);
function owner(id = worker, skillId = skill) {
  return record({ kind: 'revision', revision: { entity: 'worker', revisionId: randomUUID(), generation: 1,
    clock: { deviceId: device, wallMs: 1, counter: 0 }, value: { id, name: 'Reader', instructions: 'Read carefully', provider: 'demo', skillId, taskBudgetMicros: 1000 } } }, [{ kind: 'worker', id }]);
}
const skillRevision = (scopes: SyncRoot[]) => record({ kind: 'revision', revision: { entity: 'skill', revisionId: randomUUID(), generation: 1,
  clock: { deviceId: device, wallMs: 1, counter: 0 }, value: { id: skill, name: 'Read', content: 'Read the note.' } } }, scopes);

it('derives chat descendants from the header rather than declared scopes or record ID', () => {
  const message = turn([]);
  expect(assessScope(message, [chat()], []).roots).toEqual(roots.slice().reverse());
  expect(() => assessScope({ ...message, id: randomUUID(), scopes: [] }, [chat()], [])).toThrow('scope_missing');
  expect(() => assessScope({ ...message, id: randomUUID(), scopes: [] }, [chat()], [{ kind: 'task', id: task }])).toThrow('permanently_deleted');
});

it('keeps a record-key deletion fence effective after envelope IDs and scopes change', () => {
  const message = turn([]);
  const data = message.data as Extract<SyncData, { kind: 'turn' }>;
  expect(() => assessScope({ ...message, id: randomUUID(), scopes: [] }, [chat()], [{ kind: 'record', id: `turn:${data.value.id}` }])).toThrow('permanently_deleted');
});

it('rejects unknown chat and source ownership rather than trusting scopes', () => {
  expect(() => assessScope(turn(), [], [])).toThrow('dependency_missing');
  expect(() => assessScope(file(), [chat()], [])).toThrow('dependency_missing');
  const forged = file();
  expect(() => assessScope(file(), [chat(), forged], [])).toThrow('dependency_missing');
});

it('derives source ownership from turn sourceIds absent on chat headers', () => {
  expect(assessScope(file(), [chat(), turn()], []).roots).toEqual(roots.slice().reverse());
  expect(() => assessScope(file([]), [chat(), turn()], [])).toThrow('scope_missing');
});

it('accepts prior confirmed source ownership only through the explicit confirmed rows', () => {
  const prior = file();
  expect(assessScope(file(), [chat()], [], [prior]).roots).toEqual(roots.slice().reverse());
  expect(() => assessScope(file(), [chat(), prior], [])).toThrow('dependency_missing');
});

it('permits a shared source to select another genuinely public known owner', () => {
  const otherTask = randomUUID();
  const otherRoots: SyncRoot[] = [{ kind: 'worker', id: worker }, { kind: 'task', id: otherTask }];
  const otherChat = record({ kind: 'chat', value: { id: otherTask, workerId: worker, createdAt: at } }, otherRoots);
  const otherTurn = record({ kind: 'turn', value: { id: randomUUID(), taskId: otherTask, createdAt: at, input: { brief: 'shared', sourceIds: [source] } } }, otherRoots);
  const known = [chat(), turn(), otherChat, otherTurn, withdrawal()];
  expect(assessScope(file(otherRoots), known, []).roots).toContainEqual({ kind: 'task', id: otherTask });
  expect(() => assessScope(file(), known, [])).toThrow('scope_missing');
});

it('permits shared skills only when an actual latest owner revision names the skill', () => {
  const other = randomUUID();
  const privateOwner = record({ kind: 'withdraw', root: { kind: 'worker', id: worker }, epoch, deleted: false, localOnly: true }, []);
  const selected = skillRevision([{ kind: 'worker', id: other }]);
  expect(assessScope(selected, [owner(), owner(other), privateOwner], []).roots).toEqual([{ kind: 'worker', id: other }]);
  expect(() => assessScope(selected, [owner()], [])).toThrow('scope_missing');
  expect(() => assessScope(selected, [], [])).toThrow('dependency_missing');
});

it('keeps permanent withdrawal dominant over a newer re-enable clock', () => {
  const forever = withdrawal(true);
  const reenabling = withdrawal(false, false, 999);
  expect(() => assessScope(turn([]), [chat(), forever, reenabling], [])).toThrow('permanently_deleted');
  expect(() => assessScope(reenabling, [forever], [])).toThrow('permanently_deleted');
  expect(assessScope(forever, [reenabling], []).roots).toEqual([]);
});

it('accepts immutable payloads with refreshed scope epochs after an explicit re-enable', () => {
  const message = turn([]);
  const nextEpoch = randomUUID();
  const enable = record({ kind: 'withdraw', root: roots[1], epoch: nextEpoch, deleted: false, localOnly: false }, [], 3);
  expect(() => assessScope(message, [chat(), enable], [])).toThrow('scope_withdrawn');
  const refreshed = { ...message, scopes: message.scopes.map(scope => scope.kind === 'task' ? { ...scope, epoch: nextEpoch } : scope) };
  expect(assessScope(refreshed, [chat(), enable], []).roots).toHaveLength(2);
  expect(immutable('turn')).toBe(true);
  expect(refreshed.data).toBe(message.data);
});

it('requires side-thread parent roots and rejects cyclic or unknown ancestry', () => {
  const sideId = randomUUID();
  const side = record({ kind: 'chat', value: { id: sideId, workerId: worker, createdAt: at,
    sideOf: { taskId: task, throughTurnId: randomUUID() } } }, [...roots, { kind: 'task', id: sideId }]);
  expect(assessScope(side, [chat()], []).roots).toContainEqual({ kind: 'task', id: task });
  expect(() => assessScope(side, [], [])).toThrow('dependency_missing');
});

it('uses the winning candidate channel membership rather than requiring a removed public member', () => {
  const former = randomUUID();
  const channelId = randomUUID();
  const previous = record({ kind: 'chatField', taskId: task, change: { field: 'channel', value: {
    id: channelId, name: 'Research', members: [{ kind: 'orglet', id: worker }, { kind: 'orglet', id: former }] } } },
    [...roots, { kind: 'worker', id: former }]);
  const current = record({ kind: 'chatField', taskId: task, change: { field: 'channel', value: {
    id: channelId, name: 'Research', members: [{ kind: 'orglet', id: worker }] } } }, roots, 2);
  expect(assessScope(current, [chat(), previous], []).roots).toEqual(roots.slice().reverse());
});

it('derives frozen participants from chat payload and rejects stripped historical worker scopes', () => {
  const former = randomUUID();
  const fullRoots: SyncRoot[] = [...roots, { kind: 'worker', id: former }];
  const frozenChat = record({ kind: 'chat', value: { id: task, workerId: worker, createdAt: at, participants: [worker, former] } }, fullRoots);
  const message = turn([]);
  expect(() => assessScope(message, [frozenChat], [])).toThrow('scope_missing');
  const scoped = { ...message, scopes: fullRoots.map(root => ({ ...root, epoch })) };
  expect(assessScope(scoped, [frozenChat], []).roots).toContainEqual({ kind: 'worker', id: former });
  expect(() => assessScope(scoped, [frozenChat], [{ kind: 'worker', id: former }])).toThrow('permanently_deleted');
});

it('rejects legacy team chat headers that cannot prove their frozen participant roster', () => {
  const header = record({ kind: 'chat', value: { id: task, workerId: worker, createdAt: at, teamId: randomUUID() } });
  expect(() => assessScope(header, [], [])).toThrow('dependency_missing');
});

it('tags team chats and their turns with permanent team dependencies without needing a live team revision', () => {
  const team = randomUUID();
  const header = record({ kind: 'chat', value: { id: task, workerId: worker, teamId: team, participants: [worker], createdAt: at } });
  expect(deletionEntities(header.data)).toContainEqual({ kind: 'team', id: team });
  expect(deletionEntities(turn([]).data, [header])).toEqual([{ kind: 'task', id: task }, { kind: 'team', id: team }]);
  const title = record({ kind: 'chatField', taskId: task, change: { field: 'title', value: 'Research' } });
  expect(deletionEntities(title.data, [header])).toContainEqual({ kind: 'team', id: team });
});

it('tags team-scoped knowledge and state so permanent team deletion can purge payload before dependency assessment', () => {
  const team = randomUUID();
  const note = record({ kind: 'revision', revision: { entity: 'knowledge', revisionId: randomUUID(), generation: 1,
    clock: { deviceId: device, wallMs: 1, counter: 0 }, value: { id: randomUUID(), title: 'Note', content: 'Remember', tags: [], pinned: false,
      scope: { type: 'team', id: team }, status: 'approved', hash: 'a'.repeat(64), provenance: { kind: 'user' }, createdAt: at } } });
  expect(deletionEntities(note.data)).toContainEqual({ kind: 'team', id: team });
  const state = record({ kind: 'entityState', entity: 'team', id: team, value: null }, []);
  expect(deletionEntities(state.data)).toEqual([{ kind: 'team', id: team }]);
});

it('follows only winning chat ownership and bounds cyclic ancestry in deletion metadata', () => {
  const oldTeam = randomUUID();
  const currentTeam = randomUUID();
  const old = record({ kind: 'chat', value: { id: task, workerId: worker, teamId: oldTeam, participants: [worker], createdAt: at } });
  const current = record({ kind: 'chat', value: { id: task, workerId: worker, teamId: currentTeam, participants: [worker], createdAt: at,
    sideOf: { taskId: task, throughTurnId: randomUUID() } } }, roots, 2);
  const entities = deletionEntities(turn([]).data, [old, current]);
  expect(entities).toContainEqual({ kind: 'team', id: currentTeam });
  expect(entities).not.toContainEqual({ kind: 'team', id: oldTeam });
  expect(entities).toHaveLength(3);
});

it('does not tag every shared source owner as a hard deletion dependency', () => {
  const team = randomUUID();
  const header = record({ kind: 'chat', value: { id: task, workerId: worker, teamId: team, participants: [worker], createdAt: at } });
  expect(deletionEntities(file().data, [header, turn()])).toEqual([{ kind: 'source', id: source }]);
});
