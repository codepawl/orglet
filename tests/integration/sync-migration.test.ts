import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, SCHEMA_VERSION, seedSkill, seedWorker } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { Report, type Artifact, type Run, type Task } from '../../apps/desktop/src/shared/contracts';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import { ChatSearch } from '../../apps/desktop/src/core/storage/chat-search';

const stores: Store[] = [];
const directories: string[] = [];
const databases: DatabaseSync[] = [];
const createdAt = '2026-01-01T00:00:00.000Z';
const context = SyncRecordingContext.parse({ accountKey: 'e'.repeat(64), generation: 1 });

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const database of databases.splice(0)) if (database.isOpen) database.close();
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('orglet-sync-v19-')) {
      throw new Error('Refusing to remove a directory outside this test fixture.');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

// Frozen V19 DDL, including the additive desktop and ledger-cache tables. This fixture never opens a V20 Store first.
const version19Schema = `
CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (entity_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(entity_id,revision));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, path TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL, provider TEXT NOT NULL, month TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), state TEXT NOT NULL CHECK(state IN ('held','unknown','settled')));
      CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(id), amount INTEGER NOT NULL CHECK(amount>=0), input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, pricing_version TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES (1);
CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS leases (run_id TEXT PRIMARY KEY REFERENCES runs(id), heartbeat TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS step_attempts (run_id TEXT NOT NULL REFERENCES runs(id), step INTEGER NOT NULL, reservation_id TEXT NOT NULL REFERENCES reservations(id), state TEXT NOT NULL, started_at TEXT NOT NULL, PRIMARY KEY(run_id,step));
        INSERT OR IGNORE INTO migrations VALUES (2);
        CREATE TABLE IF NOT EXISTS preflights (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), data TEXT NOT NULL);
        INSERT OR IGNORE INTO migrations VALUES (3);
        CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        INSERT OR IGNORE INTO migrations VALUES (4);
CREATE TABLE preflights_v5 (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL);
          INSERT INTO preflights_v5 SELECT id,task_id,data FROM preflights;
          DROP TABLE preflights;
          ALTER TABLE preflights_v5 RENAME TO preflights;
          CREATE INDEX preflights_task ON preflights(task_id);
          INSERT INTO migrations VALUES (5);
CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,revision));
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(id UNINDEXED, title, content, tags);
        INSERT OR IGNORE INTO migrations VALUES (6);
        CREATE TABLE IF NOT EXISTS tool_calls (
          run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('started','completed','uncertain')),
          output TEXT, PRIMARY KEY(run_id,call_id)
        );
        INSERT OR IGNORE INTO migrations VALUES (7);
ALTER TABLE tool_calls ADD COLUMN replay TEXT NOT NULL DEFAULT 'never'
            CHECK(replay IN ('read','idempotent','never'));
          INSERT INTO migrations VALUES (8);
CREATE TABLE IF NOT EXISTS workspace_grants (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), data TEXT NOT NULL
      );
CREATE TABLE IF NOT EXISTS workspace_copies (
        run_id TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL
      ); INSERT OR IGNORE INTO migrations VALUES (9);
CREATE TABLE IF NOT EXISTS workspace_processes (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), data TEXT NOT NULL
      ); INSERT OR IGNORE INTO migrations VALUES (10);
CREATE TABLE IF NOT EXISTS process_evidence (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), exit_code INTEGER NOT NULL
      ); INSERT OR IGNORE INTO migrations VALUES (11);
CREATE TABLE IF NOT EXISTS reservation_reviews (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(id),
        reason TEXT NOT NULL CHECK(reason IN ('missing_usage','request_failed','interrupted','legacy')),
        noted_at TEXT NOT NULL,
        actual_amount INTEGER CHECK(actual_amount>=0),
        verified_source TEXT CHECK(verified_source IN ('provider_dashboard','invoice')),
        resolved_at TEXT,
        CHECK((actual_amount IS NULL AND verified_source IS NULL AND resolved_at IS NULL)
          OR (actual_amount IS NOT NULL AND verified_source IS NOT NULL AND resolved_at IS NOT NULL))
      ); INSERT OR IGNORE INTO migrations VALUES (12);
CREATE TABLE IF NOT EXISTS workspace_read_evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        call_id TEXT NOT NULL,
        data TEXT NOT NULL,
        UNIQUE(run_id,call_id)
      ); INSERT OR IGNORE INTO migrations VALUES (13);
ALTER TABLE tool_calls ADD COLUMN name TEXT;
ALTER TABLE tool_calls ADD COLUMN summary TEXT;
ALTER TABLE tool_calls ADD COLUMN started_at TEXT;
INSERT INTO migrations VALUES (14);
CREATE TABLE IF NOT EXISTS app_proposals (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT NOT NULL REFERENCES runs(id), data TEXT NOT NULL
      ); INSERT OR IGNORE INTO migrations VALUES (15);
CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY, data TEXT NOT NULL
      ); INSERT OR IGNORE INTO migrations VALUES (16);
CREATE TABLE IF NOT EXISTS routine_folders (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS routine_arrivals (
          routine_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, modified_ms INTEGER NOT NULL, handled_at TEXT NOT NULL,
          PRIMARY KEY(routine_id,name,size,modified_ms)
        ); INSERT OR IGNORE INTO migrations VALUES (17);
CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('message','answer')), author TEXT, at TEXT NOT NULL, text TEXT NOT NULL, body TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS chat_messages_task ON chat_messages(task_id);
          CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5(body, content='chat_messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
          CREATE TRIGGER IF NOT EXISTS chat_messages_insert AFTER INSERT ON chat_messages BEGIN
            INSERT INTO chat_search(rowid, body) VALUES (new.id, new.body);
          END;
          CREATE TRIGGER IF NOT EXISTS chat_messages_delete AFTER DELETE ON chat_messages BEGIN
            INSERT INTO chat_search(chat_search, rowid, body) VALUES ('delete', old.id, old.body);
          END;
          CREATE TRIGGER IF NOT EXISTS chat_messages_update AFTER UPDATE ON chat_messages BEGIN
            INSERT INTO chat_search(chat_search, rowid, body) VALUES ('delete', old.id, old.body);
            INSERT INTO chat_search(rowid, body) VALUES (new.id, new.body);
          END;
          DROP TABLE IF EXISTS task_search;
          INSERT OR REPLACE INTO settings (id,data) SELECT 'chatSearchBackfill', '{"afterRowid":0}' WHERE EXISTS (SELECT 1 FROM tasks);
          INSERT INTO migrations VALUES (18);
CREATE TABLE IF NOT EXISTS browser_actions (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL, tab_id TEXT, kind TEXT NOT NULL,
          origin TEXT, target TEXT, risk TEXT NOT NULL, outcome TEXT NOT NULL, screenshot_id TEXT, at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS browser_actions_run ON browser_actions(run_id);
        CREATE TABLE IF NOT EXISTS browser_screenshots (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), hash TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL
        ); INSERT OR IGNORE INTO migrations VALUES (19);
CREATE TABLE IF NOT EXISTS desktop_actions (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL, kind TEXT NOT NULL,
          program TEXT, window_title TEXT, target TEXT, risk TEXT NOT NULL, outcome TEXT NOT NULL, screenshot_id TEXT, at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS desktop_actions_run ON desktop_actions(run_id);
        CREATE TABLE IF NOT EXISTS desktop_screenshots (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), hash TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL
        );
CREATE TABLE IF NOT EXISTS ledger_cache (
          ledger_id TEXT PRIMARY KEY REFERENCES ledger(id), cache_read_tokens INTEGER NOT NULL CHECK(cache_read_tokens>=0),
          cache_write_tokens INTEGER NOT NULL CHECK(cache_write_tokens>=0)
        );
ALTER TABLE desktop_actions ADD COLUMN duration_ms INTEGER;
`;

it('upgrades a real V19 SQLite file, retains its pre-upgrade copy and exports/restores every legacy turn and answer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orglet-sync-v19-'));
  directories.push(directory);
  const path = join(directory, 'workspace.sqlite');
  const legacy = new DatabaseSync(path);
  databases.push(legacy);
  legacy.exec('PRAGMA foreign_keys=ON;');
  legacy.exec(version19Schema);
  const skill = seedSkill(randomUUID());
  const worker = seedWorker(randomUUID(), skill.id);
  const updatedWorker = { ...worker, revision: 2, name: 'Edited after the first answer' };
  for (const [table, value] of [['skills', skill], ['workers', updatedWorker]] as const) {
    legacy.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?)`).run(value.id, JSON.stringify(value));
  }
  for (const value of [skill, worker, updatedWorker]) {
    legacy.prepare('INSERT INTO revisions VALUES(?,?,?)').run(value.id, value.revision, JSON.stringify(value));
  }
  const task: Task = {
    id: randomUUID(), workerId: worker.id, brief: 'First legacy question', sourceIds: [],
    status: 'completed', createdAt, budgetMicros: 1000, consent: false, accepted: false,
    inputRevision: 2, currentInput: { brief: 'Third question saved without a run', sourceIds: [] },
  };
  legacy.prepare('INSERT INTO tasks VALUES(?,?)').run(task.id, JSON.stringify(task));
  const firstRun: Run = {
    id: randomUUID(), taskId: task.id, startedAt: createdAt, status: 'completed', error: null,
    snapshot: { worker, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } },
  };
  const secondRun: Run = {
    id: randomUUID(), taskId: task.id, startedAt: '2026-01-01T01:00:00.000Z', status: 'failed', error: 'Legacy failure remains visible',
    snapshot: { worker: updatedWorker, skill, inputRevision: 1, input: { brief: 'Second legacy question', sourceIds: [] } },
  };
  for (const run of [firstRun, secondRun]) {
    legacy.prepare('INSERT INTO runs VALUES(?,?,?)').run(run.id, run.taskId, JSON.stringify(run));
  }
  const report = Report.parse({ title: 'First legacy answer', summary: 'A retained answer before migration', findings: [], limitations: ['Legacy evidence'] });
  const artifact: Artifact = { id: randomUUID(), runId: firstRun.id, report, createdAt,
    hash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  legacy.prepare('INSERT INTO artifacts VALUES(?,?,?)').run(artifact.id, artifact.runId, JSON.stringify(artifact));
  expect(legacy.prepare('SELECT MAX(version) AS version FROM migrations').get()?.version).toBe(19);
  expect(legacy.prepare("SELECT name FROM sqlite_master WHERE name IN ('sync_clock','chat_turns')").all()).toEqual([]);
  legacy.close();

  let upgraded = new Store(path, { syncNow: () => 1000 });
  stores.push(upgraded);
  upgraded.sync.setRecordingContext(context);
  expect(upgraded.db.prepare('SELECT MAX(version) AS version FROM migrations').get()?.version).toBe(SCHEMA_VERSION);
  const detail = upgraded.detail(task.id);
  expect(detail.savedTurns?.map(turn => turn.input.brief)).toEqual([
    'First legacy question', 'Second legacy question', 'Third question saved without a run',
  ]);
  expect(new Set(detail.savedTurns?.map(turn => turn.id)).size).toBe(3);
  expect(detail.runs.map(run => run.id)).toEqual([firstRun.id, secondRun.id]);
  expect(detail.runs[0].snapshot.worker.name).toBe(worker.name);
  expect(detail.runs[1].error).toBe(secondRun.error);
  expect(detail.artifacts).toEqual([artifact]);
  const records = upgraded.sync.snapshot(context);
  expect(records.filter(record => record.data.kind === 'turn')).toHaveLength(3);
  expect(records.filter(record => record.data.kind === 'run')).toHaveLength(2);
  expect(records.filter(record => record.data.kind === 'artifact')).toHaveLength(1);
  expect(upgraded.sync.outbox(context)).toEqual([]);

  const backupNames = readdirSync(directory).filter(name => name.startsWith('workspace.sqlite.v19-') && name.endsWith('.bak'));
  expect(backupNames).toHaveLength(1);
  const preUpgrade = new DatabaseSync(join(directory, backupNames[0]), { readOnly: true });
  databases.push(preUpgrade);
  expect(preUpgrade.prepare('SELECT MAX(version) AS version FROM migrations').get()?.version).toBe(19);
  expect(preUpgrade.prepare("SELECT name FROM sqlite_master WHERE name='sync_clock'").all()).toEqual([]);
  expect(JSON.parse(String(preUpgrade.prepare('SELECT data FROM tasks WHERE id=?').get(task.id)?.data))).toEqual(task);
  expect(JSON.parse(String(preUpgrade.prepare('SELECT data FROM artifacts WHERE id=?').get(artifact.id)?.data))).toEqual(artifact);
  expect(preUpgrade.prepare('SELECT COUNT(*) AS count FROM revisions').get()?.count).toBe(3);
  preUpgrade.close();

  const turnsBeforeRestart = detail.savedTurns;
  upgraded.close();
  stores.pop();
  upgraded = new Store(path, { syncNow: () => 900 });
  stores.push(upgraded);
  upgraded.sync.setRecordingContext(context);
  expect(upgraded.detail(task.id).savedTurns).toEqual(turnsBeforeRestart);
  expect(upgraded.sync.snapshot(context)).toEqual(records);
  expect(readdirSync(directory).filter(name => name.endsWith('.bak'))).toEqual(backupNames);

  const backup = new Backups(upgraded, () => false, () => {}).export();
  const restored = new Store(join(directory, 'restored.sqlite'));
  stores.push(restored);
  const manager = new Backups(restored, () => false, () => {});
  manager.restore(manager.preview(backup).token);
  expect(restored.detail(task.id).savedTurns?.map(turn => ({ id: turn.id, input: turn.input }))).toEqual(
    turnsBeforeRestart?.map(turn => ({ id: turn.id, input: turn.input })),
  );
  expect(restored.detail(task.id).runs.map(run => run.id)).toEqual([firstRun.id, secondRun.id]);
  expect(restored.detail(task.id).artifacts).toEqual([artifact]);
  new ChatSearch(restored).rebuild();
  expect(new ChatSearch(restored).search('Third question saved').chats[0]?.taskId).toBe(task.id);
  expect(new ChatSearch(restored).search('retained answer before migration').chats[0]?.taskId).toBe(task.id);
});
