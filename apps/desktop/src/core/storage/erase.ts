import type { Source, Task } from '../../shared/contracts';
import { isMemory, type Knowledge } from '../../shared/knowledge';
import { KnowledgeBase } from '../context/knowledge';
import type { Store } from './database';
import { readCustomConnections, writeCustomConnections } from './custom-connections';

/**
 * Every table a full erase empties, children before parents so the foreign keys hold. `migrations` is left alone —
 * the schema stays where it is — and the FTS shadow tables are cleared by their virtual table, never directly.
 * `chat_messages` goes before `chat_search`: its triggers take each row out of the index, which is then already empty.
 * `tests/integration/erase.test.ts` fails when a new table is added and not listed here.
 */
export const ERASE_TABLES = [
  'ledger', 'reservation_reviews', 'step_attempts', 'reservations',
  'workspace_read_evidence', 'process_evidence', 'workspace_processes', 'workspace_copies',
  'tool_calls', 'checkpoints', 'leases', 'events', 'artifacts', 'app_proposals', 'runs',
  'profiles', 'preflights', 'workspace_grants', 'chat_messages', 'chat_search', 'tasks',
  'knowledge_search', 'knowledge_revisions', 'knowledge', 'revisions',
  'routine_arrivals', 'routine_folders', 'routines', 'workers', 'teams', 'skills', 'sources', 'settings', 'mcp_servers',
] as const;

const count = (store: Store, table: string) => Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);

/** Notes, with their revisions and search rows. Memories share the tables but are the person's own scope below. */
export function eraseKnowledge(store: Store): number {
  return eraseKnowledgeRows(store, item => !isMemory(item));
}

/** Everything workers remembered from chats, in every scope, including memories still waiting for review. */
export function eraseMemory(store: Store): number {
  return eraseKnowledgeRows(store, isMemory);
}

function eraseKnowledgeRows(store: Store, matches: (item: Knowledge) => boolean): number {
  const knowledge = new KnowledgeBase(store);
  const doomed = store.all<Knowledge>('knowledge').filter(matches);
  store.transaction(() => {
    for (const item of doomed) knowledge.deleteRows(item.id);
  });
  return doomed.length;
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

/**
 * Back to a fresh install: every row in every table, then the worker and skill a new workspace starts with. Custom
 * connections and MCP servers stay, like the API keys beside them in the credential store: each is set up once per
 * machine, and dropping its name and address while its secret stays would leave a secret nothing points at (COD-241).
 */
export function eraseEverything(store: Store): { entities: number } {
  const entities = count(store, 'workers') + count(store, 'teams') + count(store, 'skills') + count(store, 'routines');
  const connections = readCustomConnections(store);
  const mcpServers = store.db.prepare('SELECT id,data FROM mcp_servers ORDER BY rowid').all();
  store.transaction(() => {
    for (const table of ERASE_TABLES) store.db.prepare(`DELETE FROM ${table}`).run();
    if (connections.length) writeCustomConnections(store, connections);
    for (const server of mcpServers) store.db.prepare('INSERT INTO mcp_servers(id,data) VALUES(?,?)').run(server.id, server.data);
  });
  // Seeding writes a revision of its own, in its own transaction, so it waits until the tables are empty.
  store.seedDefaults();
  return { entities };
}
