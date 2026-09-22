import type { Source, Task } from '../../shared/contracts';
import type { Store } from './database';

/**
 * Every table a full erase empties, children before parents so the foreign keys hold. `migrations` is left alone —
 * the schema stays where it is — and the FTS shadow tables are cleared by their virtual table, never directly.
 * `tests/integration/erase.test.ts` fails when a new table is added and not listed here.
 */
export const ERASE_TABLES = [
  'ledger', 'reservation_reviews', 'step_attempts', 'reservations',
  'workspace_read_evidence', 'process_evidence', 'workspace_processes', 'workspace_copies',
  'tool_calls', 'checkpoints', 'leases', 'events', 'artifacts', 'runs',
  'profiles', 'preflights', 'workspace_grants', 'task_search', 'tasks',
  'knowledge_search', 'knowledge_revisions', 'knowledge', 'revisions',
  'routines', 'workers', 'teams', 'skills', 'sources', 'settings',
] as const;

const count = (store: Store, table: string) => Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);

export function eraseKnowledge(store: Store): number {
  const removed = count(store, 'knowledge');
  store.transaction(() => {
    for (const table of ['knowledge_search', 'knowledge_revisions', 'knowledge']) store.db.prepare(`DELETE FROM ${table}`).run();
  });
  return removed;
}

/**
 * Imported sources are rows pointing at the person's own files; Orglet keeps no copy, so nothing of theirs is
 * touched here. A source no chat refers to is removed. One a chat still cites cannot be, because opening that chat
 * reads its sources — it is revoked and its path and hash are dropped instead, which is what a revoked source
 * already looks like and leaves the app unable to read the file.
 */
export function eraseSources(store: Store): { sources: number; sourcesForgotten: number } {
  const cited = new Set(store.db.prepare('SELECT data FROM tasks').all()
    .flatMap(row => (JSON.parse(String(row.data)) as Task).sourceIds));
  const all = store.all<Source>('sources');
  const forgotten = all.filter(source => cited.has(source.id));
  store.transaction(() => {
    for (const source of all) {
      if (!cited.has(source.id)) { store.db.prepare('DELETE FROM sources WHERE id=?').run(source.id); continue; }
      store.db.prepare('UPDATE sources SET path=? WHERE id=?').run('', source.id);
      const { hash: _hash, ...rest } = source;
      store.update('sources', { ...rest, revoked: true });
    }
  });
  return { sources: all.length - forgotten.length, sourcesForgotten: forgotten.length };
}

/** Back to a fresh install: every row in every table, then the worker and skill a new workspace starts with. */
export function eraseEverything(store: Store): { entities: number } {
  const entities = count(store, 'workers') + count(store, 'teams') + count(store, 'skills') + count(store, 'routines');
  store.transaction(() => {
    for (const table of ERASE_TABLES) store.db.prepare(`DELETE FROM ${table}`).run();
  });
  // Seeding writes a revision of its own, in its own transaction, so it waits until the tables are empty.
  store.seedDefaults();
  return { entities };
}
