import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/desktop/src/core/storage/database';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import { SyncRecord } from '../../apps/desktop/src/shared/sync-records';
import { assessScope } from '../../services/sync/src/scope-policy';

const stores: Store[] = [];
const context = { accountKey: 'a'.repeat(64), generation: 1 };
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });
function fixture() {
  const store = new Store(':memory:', { syncNow: () => 1000 }); stores.push(store);
  store.sync.setRecordingContext(context);
  const lead = store.all<Worker>('workers')[0];
  const former = { ...lead, id: randomUUID(), revision: 1, name: 'Former crew member' };
  store.version('workers', former);
  const team: Team = { id: randomUUID(), revision: 1, name: 'Crew', instructions: 'Read.', workflow: 'sequential',
    monthlyBudgetMicros: 1000, memberIds: [lead.id], synthesizerId: lead.id };
  store.version('teams', team);
  const task: Task = { id: randomUUID(), workerId: lead.id, teamId: team.id, teamSnapshot: { ...team, memberIds: [lead.id, former.id] },
    brief: 'Original', sourceIds: [], status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', budgetMicros: 0, consent: false, accepted: false };
  store.put('tasks', task);
  return { store, lead, former, team, task };
}
it('projects frozen crew participants without turning a crew chat into a channel or leaking wire metadata locally', () => {
  const { store, former, task } = fixture();
  const records = store.sync.snapshot(context);
  const chat = records.find(record => record.data.kind === 'chat' && record.data.value.id === task.id)!;
  expect(chat.data.kind === 'chat' && chat.data.value.participants).toContain(former.id);
  expect(chat.data.kind === 'chat' && chat.data.value.assignees).toBeUndefined();
  expect(assessScope(chat, records, [], records).roots).toContainEqual({ kind: 'worker', id: former.id });
  const peer = new Store(':memory:', { syncNow: () => 2000 }); stores.push(peer);
  peer.sync.setRecordingContext(context);
  for (let offset = 0; offset < records.length; offset += 100) peer.sync.receive(context, records.slice(offset, offset + 100));
  const received = peer.get<Task>('tasks', task.id);
  expect(received.teamId).toBe(task.teamId);
  expect(received.assignees).toBeUndefined();
  expect(received).not.toHaveProperty('participants');
});
it('repairs a legacy chat projection before bootstrap and preserves its durable turn identity', () => {
  const { store, former, task } = fixture();
  const turnIds = store.sync.turns.list(task.id).map(turn => turn.id);
  const saved = store.db.prepare('SELECT data FROM sync_records WHERE record_key=?').get(`chat:${task.id}`)!;
  const legacy = SyncRecord.parse(JSON.parse(String(saved.data)));
  if (legacy.data.kind !== 'chat') throw new Error('Missing chat fixture');
  delete legacy.data.value.participants;
  store.db.prepare('UPDATE sync_records SET data=? WHERE record_key=?').run(JSON.stringify(legacy), `chat:${task.id}`);
  store.sync.refreshFromCanonical();
  const chat = store.sync.snapshot(context).find(record => record.data.kind === 'chat' && record.data.value.id === task.id)!;
  expect(chat.data.kind === 'chat' && chat.data.value.participants).toContain(former.id);
  expect(store.sync.turns.list(task.id).map(turn => turn.id)).toEqual(turnIds);
});
it('receiving roster repair preserves an existing crew run snapshot and its authority', () => {
  const { store, task } = fixture();
  const peer = new Store(':memory:', { syncNow: () => 2000 }); stores.push(peer);
  peer.sync.setRecordingContext(context);
  peer.put('tasks', { ...task, consent: true, providerScopes: ['demo'], toolCapabilities: [] });
  const records = store.sync.snapshot(context).map(record => record.data.kind === 'chat' && record.data.value.id === task.id
    ? { ...record, id: randomUUID(), clock: { ...record.clock, wallMs: 3000 } } : record);
  for (let offset = 0; offset < records.length; offset += 100) peer.sync.receive(context, records.slice(offset, offset + 100));
  const received = peer.get<Task>('tasks', task.id);
  expect(received.teamSnapshot).toEqual(task.teamSnapshot);
  expect(received.teamId).toBe(task.teamId);
  expect(received.consent).toBe(false);
  expect(received.providerScopes).toEqual([]);
  expect(received).not.toHaveProperty('participants');
});
it('team knowledge and team state inherit member privacy, including legacy projection repair', () => {
  const { store, lead, former, team } = fixture();
  const note = Knowledge.parse({ id: randomUUID(), revision: 1, title: 'Crew note', content: 'Private crew guidance', tags: [], pinned: false,
    scope: { type: 'team', id: team.id }, status: 'approved', hash: 'a'.repeat(64), provenance: { kind: 'user' }, createdAt: '2026-01-01T00:00:00.000Z' });
  store.transaction(() => {
    store.put('knowledge', note);
    store.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?)').run(note.id, 1, JSON.stringify(note));
    store.sync.captureRevision('knowledge', note, 1);
  });
  const state = store.entityState(); state.teams[team.id] = { archivedAt: '2026-01-01T00:00:00.000Z' };
  store.setSetting('entityState', state);
  const records = store.sync.snapshot(context);
  for (const record of records.filter(record => record.data.kind === 'revision' && record.data.revision.entity === 'knowledge'
    || record.data.kind === 'entityState' && record.data.entity === 'team')) {
    expect(record.scopes).toContainEqual(expect.objectContaining({ kind: 'worker', id: lead.id }));
    const legacy = { ...record, scopes: [] };
    store.db.prepare('UPDATE sync_records SET data=? WHERE record_key=?').run(JSON.stringify(legacy), record.data.kind === 'revision'
      ? `revision:${record.data.revision.revisionId}` : `state:team:${team.id}`);
  }
  store.sync.refreshFromCanonical();
  store.version('teams', { ...team, revision: 2, memberIds: [lead.id, former.id] });
  const changed = store.sync.snapshot(context);
  for (const record of changed.filter(record => record.data.kind === 'revision' && record.data.revision.entity === 'knowledge'
    || record.data.kind === 'entityState' && record.data.entity === 'team')) {
    expect(record.scopes).toContainEqual(expect.objectContaining({ kind: 'worker', id: former.id }));
  }
  store.sync.setLocalOnly({ kind: 'worker', id: former.id, localOnly: true });
  expect(store.sync.snapshot(context).some(record => record.data.kind === 'revision' && record.data.revision.entity === 'knowledge')).toBe(false);
  store.sync.setLocalOnly({ kind: 'worker', id: lead.id, localOnly: true });
  expect(store.sync.snapshot(context).some(record => record.data.kind === 'revision' && record.data.revision.entity === 'knowledge')).toBe(false);
  expect(store.sync.snapshot(context).some(record => record.data.kind === 'entityState' && record.data.entity === 'team')).toBe(false);
});
