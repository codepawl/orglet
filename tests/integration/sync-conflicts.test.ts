import { afterEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CONFLICT_CHANGED, SyncConflicts } from '../../apps/desktop/src/core/storage/sync-conflicts';
import { KnowledgeBase } from '../../apps/desktop/src/core/context/knowledge';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import type { Skill, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * Two computers change the same thing while apart (GH-484). Sync keeps both versions and uses the later one; the
 * person can choose, and the choice is a new revision that every computer ends up on.
 */

const context = SyncRecordingContext.parse({ accountKey: 'c'.repeat(64), generation: 1 });
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function computer(time: number) {
  const store = new Store(':memory:', { syncNow: () => time });
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}
function deliver(from: Store, to: Store) {
  const records = from.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) to.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}
/** Two computers holding the same orglet, each then renaming its instructions without the other knowing. */
function apart() {
  const first = computer(1_000);
  const second = computer(2_000);
  const worker = first.all<Worker>('workers')[0];
  // The second computer starts from the first one's orglet instead of a seed of its own.
  for (const own of second.all<Worker>('workers')) {
    second.db.prepare('DELETE FROM workers WHERE id=?').run(own.id);
  }
  deliver(first, second);
  first.version('workers', { ...first.get<Worker>('workers', worker.id), revision: first.nextRevision(worker.id), instructions: 'Written on the first computer' });
  second.version('workers', { ...second.get<Worker>('workers', worker.id), revision: second.nextRevision(worker.id), instructions: 'Written on the second computer' });
  deliver(first, second);
  deliver(second, first);
  return { first, second, workerId: worker.id };
}

it('lists what two computers changed while apart, the same on both, with the later change in use', () => {
  const { first, second, workerId } = apart();
  for (const store of [first, second]) {
    const [conflict] = new SyncConflicts(store).list();
    expect(new SyncConflicts(store).list()).toHaveLength(1);
    expect(conflict).toMatchObject({ entity: 'worker', id: workerId, name: 'Researcher' });
    expect(conflict.versions.map(version => version.text.split('\n\n')[1]).sort()).toEqual(['Written on the first computer', 'Written on the second computer']);
    expect(conflict.versions.find(version => version.current)?.text).toContain('Written on the second computer');
    expect(store.get<Worker>('workers', workerId).instructions).toBe('Written on the second computer');
  }
  expect(new SyncConflicts(first).list()[0].versions.find(version => version.thisComputer)?.text).toContain('first computer');
  expect(new SyncConflicts(second).list()[0].versions.find(version => version.thisComputer)?.text).toContain('second computer');
});

it('writes the chosen version as a new revision that reaches the other computer and keeps both older ones', () => {
  const { first, second, workerId } = apart();
  const [conflict] = new SyncConflicts(first).list();
  const other = conflict.versions.find(version => !version.current)!;
  const before = Number(first.db.prepare('SELECT COUNT(*) AS count FROM revisions WHERE entity_id=?').get(workerId)!.count);
  new SyncConflicts(first).resolve({ entity: 'worker', id: workerId, revisionId: other.revisionId, generation: conflict.generation });
  expect(first.get<Worker>('workers', workerId).instructions).toBe('Written on the first computer');
  expect(Number(first.db.prepare('SELECT COUNT(*) AS count FROM revisions WHERE entity_id=?').get(workerId)!.count)).toBe(before + 1);
  expect(new SyncConflicts(first).list()).toEqual([]);

  deliver(first, second);
  expect(second.get<Worker>('workers', workerId).instructions).toBe('Written on the first computer');
  expect(new SyncConflicts(second).list()).toEqual([]);
  const history = second.db.prepare('SELECT data FROM revisions WHERE entity_id=?').all(workerId).map(row => (JSON.parse(String(row.data)) as Worker).instructions);
  expect(history).toContain('Written on the second computer');
  // A choice made from a stale view is refused instead of overwriting what happened since.
  expect(() => new SyncConflicts(second).resolve({ entity: 'worker', id: workerId, revisionId: other.revisionId, generation: conflict.generation })).toThrow(CONFLICT_CHANGED);
});

it('keeping the version in use also settles it on both computers', () => {
  const { first, second, workerId } = apart();
  const [conflict] = new SyncConflicts(second).list();
  const current = conflict.versions.find(version => version.current)!;
  new SyncConflicts(second).resolve({ entity: 'worker', id: workerId, revisionId: current.revisionId, generation: conflict.generation });
  deliver(second, first);
  for (const store of [first, second]) {
    expect(new SyncConflicts(store).list()).toEqual([]);
    expect(store.get<Worker>('workers', workerId).instructions).toBe('Written on the second computer');
  }
});

it('covers skills and notes, and ignores an entity that was deleted', () => {
  const first = computer(1_000);
  const second = computer(2_000);
  for (const own of second.all<Worker>('workers')) second.db.prepare('DELETE FROM workers WHERE id=?').run(own.id);
  const worker = first.all<Worker>('workers')[0];
  const note = new KnowledgeBase(first).save({ title: 'Shared note', content: 'Original', tags: [], pinned: false, scope: { type: 'worker', id: worker.id } });
  deliver(first, second);
  const skill = first.get<Skill>('skills', worker.skillId);
  first.version('skills', { ...skill, revision: first.nextRevision(skill.id), content: 'Skill on the first computer' });
  second.version('skills', { ...second.get<Skill>('skills', skill.id), revision: second.nextRevision(skill.id), content: 'Skill on the second computer' });
  const edit = (content: string) => ({ id: note.id, title: note.title, content, tags: note.tags, pinned: note.pinned, scope: note.scope });
  new KnowledgeBase(first).save(edit('Note on the first computer'));
  new KnowledgeBase(second).save(edit('Note on the second computer'));
  deliver(first, second);
  deliver(second, first);
  expect(new SyncConflicts(first).list().map(conflict => conflict.entity).sort()).toEqual(['knowledge', 'skill']);

  const noteConflict = new SyncConflicts(first).list().find(conflict => conflict.entity === 'knowledge')!;
  new SyncConflicts(first).resolve({ entity: 'knowledge', id: note.id, generation: noteConflict.generation,
    revisionId: noteConflict.versions.find(version => version.thisComputer)!.revisionId });
  deliver(first, second);
  expect(second.get<typeof note>('knowledge', note.id).content).toBe('Note on the first computer');
  expect(new SyncConflicts(second).list().map(conflict => conflict.entity)).toEqual(['skill']);

  const state = first.entityState();
  first.setSetting('entityState', { ...state, workers: { ...state.workers, [worker.id]: { deletedAt: new Date().toISOString() } } });
  expect(new SyncConflicts(first).list().every(conflict => conflict.id !== worker.id)).toBe(true);
});
