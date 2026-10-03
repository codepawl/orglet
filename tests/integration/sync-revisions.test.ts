import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { SyncRevisions } from '../../apps/desktop/src/core/storage/sync-revisions';
import type { Worker, Skill } from '../../apps/desktop/src/shared/contracts';

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});

function replica(worker: Worker, skill: Skill, time: number) {
  const store = new Store(':memory:', { syncNow: () => time });
  stores.push(store);
  store.versionMany([{ table: 'skills', value: skill }, { table: 'workers', value: worker }]);
  return { store, revisions: new SyncRevisions(store, () => time) };
}

function fixture() {
  const skill: Skill = { id: randomUUID(), revision: 1, name: 'Writer', content: 'Write clearly.' };
  const worker: Worker = { id: randomUUID(), revision: 1, name: 'Original', instructions: 'Be helpful.', provider: 'demo', skillId: skill.id };
  return { worker, skill };
}

function peer(first: ReturnType<typeof replica>, worker: Worker, skill: Skill, time: number) {
  const store = new Store(':memory:', { syncNow: () => time });
  stores.push(store);
  const revisions = store.sync.revisions;
  revisions.receive(first.revisions.read('skill', skill.id, 1));
  revisions.receive(first.revisions.read('worker', worker.id, 1));
  return { store, revisions };
}

it('merges independent revision 2 edits without renumbering frozen local references', () => {
  const { worker, skill } = fixture();
  const first = replica(worker, skill, 1000);
  const second = peer(first, worker, skill, 2000);
  expect(second.revisions.receive(first.revisions.read('worker', worker.id, 1)).kind).toBe('duplicate');
  function edit(target: typeof first, name: string) {
    const value = { ...worker, revision: 2, name };
    return target.store.transaction(() => {
      target.store.versionRows([{ table: 'workers', value }]);
      return target.revisions.capture('worker', value, 2);
    });
  }
  const firstEdit = edit(first, 'From first device');
  const secondEdit = edit(second, 'From second device');
  expect(firstEdit.revisionId).not.toBe(secondEdit.revisionId);
  expect(first.revisions.receive(secondEdit)).toEqual({ kind: 'applied', selected: true, localRevision: 3 });
  expect(second.revisions.receive(firstEdit)).toEqual({ kind: 'applied', selected: false, localRevision: 3 });
  for (const target of [first, second]) {
    expect(target.store.get<Worker>('workers', worker.id).name).toBe('From second device');
    expect(target.store.db.prepare('SELECT COUNT(*) AS count FROM revisions WHERE entity_id=?').get(worker.id)?.count).toBe(3);
  }
  expect(first.revisions.read('worker', worker.id, 2).value).toMatchObject({ name: 'From first device' });
  expect(second.revisions.read('worker', worker.id, 2).value).toMatchObject({ name: 'From second device' });
  expect(first.revisions.receive(secondEdit)).toEqual({ kind: 'duplicate', localRevision: 3 });
  const next = { ...first.store.get<Worker>('workers', worker.id), revision: 4, name: 'Follow-up' };
  const nextRevision = first.store.transaction(() => {
    first.store.versionRows([{ table: 'workers', value: next }]);
    return first.revisions.capture('worker', next, 4);
  });
  expect(nextRevision.generation).toBe(3);
  expect(second.revisions.receive(nextRevision).kind).toBe('applied');
  expect(second.store.get<Worker>('workers', worker.id).name).toBe('Follow-up');
});

it('keeps proposal and MCP authority local and removes an omitted public field', () => {
  const { worker, skill } = fixture();
  const first = replica({ ...worker, modelId: 'local-model', autoApplyProposals: true, mcpServerIds: [randomUUID()] }, skill, 1000);
  const second = replica(worker, skill, 2000);
  const value = { ...worker, revision: 2, name: 'Remote update' };
  const revision = second.store.transaction(() => {
    second.store.versionRows([{ table: 'workers', value }]);
    return second.revisions.capture('worker', value, 2);
  });
  first.revisions.receive(revision);
  const result = first.store.get<Worker>('workers', worker.id);
  expect(result.name).toBe('Remote update');
  expect(result.modelId).toBeUndefined();
  expect(result.autoApplyProposals).toBe(true);
  expect(result.mcpServerIds).toHaveLength(1);
  expect(() => first.revisions.receive({ ...revision, value: { ...revision.value, autoApplyProposals: true } })).toThrow();
  expect(() => first.revisions.receive({ ...revision, value: { ...revision.value, name: 'Changed identity' } })).toThrow('Định danh revision');
  expect(result.name).toBe('Remote update');
});

it('rolls back domain history, identity and clock together after an injected failure', () => {
  const { worker, skill } = fixture();
  const target = replica(worker, skill, 1000);
  const before = target.revisions.clock.read();
  expect(() => target.store.transaction(() => {
    const value = { ...worker, revision: 2, name: 'Must not survive' };
    target.store.versionRows([{ table: 'workers', value }]);
    target.revisions.capture('worker', value, 2);
    throw new Error('Injected failure');
  })).toThrow('Injected failure');
  expect(target.store.get<Worker>('workers', worker.id).name).toBe('Original');
  expect(target.store.nextRevision(worker.id)).toBe(2);
  expect(target.revisions.clock.read()).toEqual(before);
  expect(target.store.db.prepare('SELECT COUNT(*) AS count FROM sync_revision_ids WHERE entity_id=?').get(worker.id)?.count).toBe(1);
});
