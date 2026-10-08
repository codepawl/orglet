import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { chatTurnCreatedAt, chatTurnInput, chatTurnMessageId, chatTurnRevisions } from '../../apps/desktop/src/shared/chat-turns';
import { turnMessageId } from '../../apps/desktop/src/shared/message-interactions';
import type { Run, Task, TaskDetail } from '../../apps/desktop/src/shared/contracts';
import { currentLocale } from '../../apps/desktop/src/renderer/i18n';
import { randomSource, seedProfile, STRESS_TIERS, type SeedSummary } from '../../scripts/stress/seed-profile';

/**
 * What keeps a large profile usable (docs/technical-guide.md → Scale). Each test names the cost it guards: a read that
 * went through every row of the app for one chat's sake, a payload that grew with the length of a chat, a start that
 * read every run again. They run on a small seeded profile with one long chat, so they take seconds.
 */
const scale = { ...STRESS_TIERS.tiny, name: 'scale', chats: 6, turnsPerChat: 4, longChats: 1, longChatTurns: 120, schedules: 3, notes: 20 };
let folder: string;
let summary: SeedSummary;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'orglet-scale-'));
  summary = await seedProfile(scale, join(folder, 'data'), join(folder, 'files'));
}, 60_000);
afterAll(() => {
  try { rmSync(folder, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a handle Windows still holds; the temp folder is cleared with the machine's */ }
});

const open = () => {
  const store = new Store(summary.databasePath);
  const core = new CoreService(store, () => undefined, async () => { throw new Error('No model.'); });
  return { store, core };
};
const heavyId = () => summary.longChatIds[0];

describe('the synthetic profile', () => {
  const countsOf = (databasePath: string) => {
    const store = new Store(databasePath);
    const tables = ['workers', 'tasks', 'runs', 'events', 'artifacts', 'chat_turns', 'chat_messages', 'reservations', 'ledger', 'knowledge', 'routines', 'sources', 'sync_records'];
    const counts = Object.fromEntries(tables.map(table => [table, Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count)]));
    const texts = createHash('sha256');
    for (const row of store.db.prepare('SELECT message_id,text FROM chat_messages ORDER BY message_id').all()) texts.update(`${row.message_id}
${row.text}
`);
    store.close();
    return { counts, texts: texts.digest('hex') };
  };

  it('has the size its configuration says, and writes the same profile every time', async () => {
    const other = await seedProfile(scale, join(folder, 'again', 'data'), join(folder, 'again', 'files'));
    const first = countsOf(summary.databasePath);
    expect(countsOf(other.databasePath)).toEqual(first);
    // 5 ordinary chats of 4 turns... one long chat of 120, one channel of 3 turns answered by 2 members.
    expect(first.counts.chat_turns).toBe(5 * 4 + 120 + 3);
    expect(first.counts.runs).toBe(5 * 4 + 120 + 3 * 2);
    expect(first.counts.artifacts).toBe(first.counts.runs);
    expect(first.counts.events).toBe(first.counts.runs * 2);
    expect(first.counts.workers).toBe(scale.orglets + 1);
    expect(first.counts.knowledge).toBe(scale.notes);
    expect(first.counts.routines).toBe(scale.schedules);
    expect(first.counts.sources).toBe(scale.sources);
    expect(first.counts.sync_records).toBeGreaterThan(first.counts.runs);
  }, 60_000);

  it('holds one live main chat for the orglet that owns the long chat, and archives the rest', () => {
    const { store } = open();
    const live = (store.all<Task>('tasks')).filter(task => !task.archivedAt && !task.channel);
    expect(live.map(task => task.id)).toContain(heavyId());
    expect(store.get<Task>('tasks', summary.chatIds[1]).archivedAt).toBeDefined();
    store.close();
  });
});

describe('a long chat is read as its newest turns', () => {
  it('keeps the newest turns with their runs, events and answers, and counts the rest', () => {
    const { store } = open();
    const whole = store.detail(heavyId());
    const recent = store.detail(heavyId(), 10);
    expect(whole.runs).toHaveLength(120);
    expect(whole.earlierTurns).toBeUndefined();
    expect(recent.earlierTurns).toBe(110);
    expect(recent.savedTurns!.map(turn => turn.localRevision)).toEqual(whole.savedTurns!.slice(-10).map(turn => turn.localRevision));
    expect(recent.runs.map(run => run.id)).toEqual(whole.runs.slice(-10).map(run => run.id));
    const keptRuns = new Set(recent.runs.map(run => run.id));
    expect(recent.events.length).toBeGreaterThan(0);
    expect(recent.events.every(event => keptRuns.has(event.runId))).toBe(true);
    expect(recent.artifacts.every(artifact => keptRuns.has(artifact.runId))).toBe(true);
    expect(recent.artifacts).toHaveLength(10);
    // The chat's own totals still count every turn.
    expect(recent.usage).toEqual(whole.usage);
    store.close();
  });

  it('lists the same turns on screen whether or not the older ones were read', () => {
    const { store } = open();
    const whole = store.detail(heavyId());
    const recent = store.detail(heavyId(), 10);
    expect(chatTurnRevisions(recent as TaskDetail)).toEqual(chatTurnRevisions(whole as TaskDetail).slice(-10));
    store.close();
  });

  it('reads a chat shorter than the window whole', () => {
    const { store } = open();
    const short = summary.chatIds[1];
    const detail = store.detail(short, 200);
    expect(detail.earlierTurns).toBeUndefined();
    expect(detail.runs).toHaveLength(store.detail(short).runs.length);
    store.close();
  });

  it('answers the task command with a window, and the whole chat when none is asked', async () => {
    const { store, core } = open();
    const windowed = await core.command('task', { id: heavyId(), recentTurns: 25 }) as TaskDetail;
    expect(windowed.runs).toHaveLength(25);
    expect(windowed.earlierTurns).toBe(95);
    const all = await core.command('task', { id: heavyId() }) as TaskDetail;
    expect(all.runs).toHaveLength(120);
    store.close();
  });

  it('marks the newest answer as seen without reading the chat', async () => {
    const { store, core } = open();
    const readDetail = vi.spyOn(store, 'detail');
    await core.command('markTaskSeen', { id: heavyId() });
    expect(readDetail).not.toHaveBeenCalled();
    const newest = store.db.prepare(`SELECT a.id FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE r.task_id=? ORDER BY a.rowid DESC LIMIT 1`).get(heavyId())!.id;
    expect(store.get<Task>('tasks', heavyId()).lastArtifactId).toBe(newest);
    store.close();
  });

  it('sends the list of chats without their turn ids', async () => {
    const { store, core } = open();
    expect(Object.keys(store.get<Task>('tasks', heavyId()).turnIds ?? {})).toHaveLength(120);
    const workspace = await core.command('workspace', {}) as { tasks: Task[] };
    expect(workspace.tasks.length).toBeGreaterThan(0);
    expect(workspace.tasks.every(task => task.turnIds === undefined)).toBe(true);
    store.close();
  });
});

describe('reads go through an index, not through the whole table', () => {
  const plan = (store: Store, sql: string, ...parameters: string[]) =>
    store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters).map(row => String(row.detail)).join(' | ');

  it('finds a chat\'s runs, a run\'s events and a chat\'s usage by index', () => {
    const { store } = open();
    expect(plan(store, 'SELECT data FROM runs WHERE task_id=?', 'x')).toMatch(/SEARCH .*USING (COVERING )?INDEX runs_task/);
    expect(plan(store, 'SELECT data FROM events WHERE run_id=?', 'x')).toMatch(/SEARCH .*USING (COVERING )?INDEX events_run/);
    expect(plan(store, 'SELECT * FROM reservations WHERE task_id=?', 'x')).toMatch(/INDEX reservations_task/);
    expect(plan(store, 'SELECT e.data FROM events e JOIN runs r ON r.id=e.run_id WHERE r.task_id=? ORDER BY e.rowid', 'x')).not.toMatch(/SCAN e\b|SCAN events/);
    store.close();
  });

  it('finds unsettled runs and chats, pending chats and schedule runs without scanning every row', () => {
    const { store } = open();
    expect(plan(store, `SELECT data FROM runs WHERE json_extract(data,'$.status') IN ('running','queued','pausing')`)).toMatch(/INDEX runs_unsettled/);
    expect(plan(store, `SELECT data FROM tasks WHERE json_extract(data,'$.status') IN ('running','queued','pausing')`)).toMatch(/INDEX tasks_unsettled/);
    expect(plan(store, `SELECT data FROM tasks WHERE json_extract(data,'$.pendingStart') IS NOT NULL`)).toMatch(/INDEX tasks_pending_start/);
    expect(plan(store, `SELECT data FROM tasks WHERE json_extract(data,'$.routineId') IS NOT NULL`)).toMatch(/INDEX tasks_routine/);
    store.close();
  });

  it('names the index in every query the tick and the start make, and each is served by it', () => {
    const { store } = open();
    const statements: string[] = [];
    const original = store.db.prepare.bind(store.db);
    vi.spyOn(store.db, 'prepare').mockImplementation(((sql: string) => { statements.push(sql); return original(sql); }) as never);
    store.pendingTasks();
    store.shiftPausedTasks();
    store.unsettledTasks();
    store.scheduleRunsToDeliver('2026-01-01T00:00:00.000Z');
    store.finishedScheduleRunsWithoutVerdict();
    store.archivedBefore('2026-01-01T00:00:00.000Z');
    store.recover();
    const reads = statements.filter(sql => /FROM (tasks|runs) INDEXED BY/.test(sql));
    // Without statistics SQLite walks the whole table in order instead of sorting the few rows an index returns.
    expect(reads.length).toBeGreaterThanOrEqual(8);
    vi.restoreAllMocks();
    for (const sql of reads) {
      const parameters = sql.includes('?') ? ['2026-01-01T00:00:00.000Z'] : [];
      const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters).map(row => String(row.detail)).join(' | ');
      expect(plan, sql).toMatch(/USING (COVERING )?INDEX (tasks|runs)_/);
      expect(plan, sql).not.toMatch(/SCAN (tasks|runs)(?! USING)/);
    }
    store.close();
  });

  it('keeps the five-second tick from reading every chat', async () => {
    const { store, core } = open();
    const readAll = vi.spyOn(store, 'all');
    await core.tick();
    expect(readAll.mock.calls.filter(([table]) => table === 'tasks')).toHaveLength(0);
    store.close();
  });

  it('keeps every change the core announces from reading every chat', () => {
    const { store, core } = open();
    const readAll = vi.spyOn(store, 'all');
    (core as unknown as { notify(): void }).notify();
    expect(readAll.mock.calls.filter(([table]) => table === 'tasks')).toHaveLength(0);
    store.close();
  });

  it('still hands off a chat that stopped at the end of a shift', () => {
    const { store, core } = open();
    const chat = store.get<Task>('tasks', summary.chatIds[1]);
    store.update('tasks', { ...chat, pauseReason: 'shift', status: 'partial' });
    (core as unknown as { notify(): void }).notify();
    const handed = store.get<Task>('tasks', chat.id);
    expect(handed.handoff?.artifactIds.length).toBeGreaterThan(0);
    expect(handed.handoff?.blockers.length).toBeGreaterThan(0);
    store.close();
  });

  it('recovers only the runs that were unsettled', () => {
    const { store } = open();
    const run = store.detail(summary.chatIds[1]).runs[0];
    store.db.prepare('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify({ ...run, status: 'running' }), run.id);
    store.recover();
    expect(store.get<Run>('runs', run.id).status).toBe('interrupted');
    expect(store.db.prepare(`SELECT COUNT(*) AS count FROM runs WHERE json_extract(data,'$.status')='running'`).get()!.count).toBe(0);
    store.close();
  });
});

describe('the whole-app totals', () => {
  it('equal the sum the per-reservation join gave', () => {
    const { store } = open();
    const joined = store.db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.state!='settled' THEN r.amount ELSE 0 END),0) AS reserved, COALESCE(SUM(l.amount),0) AS charged,
      COALESCE(SUM(l.input_tokens),0) AS input_tokens, COALESCE(SUM(l.output_tokens),0) AS output_tokens
      FROM reservations r LEFT JOIN ledger l ON l.reservation_id=r.id`).get()!;
    const usage = store.usage();
    expect(usage.chargedMicros).toBe(Number(joined.charged));
    expect(usage.reservedMicros).toBe(Number(joined.reserved));
    expect(usage.inputTokens).toBe(Number(joined.input_tokens));
    expect(usage.outputTokens).toBe(Number(joined.output_tokens));
    expect(usage.chargedMicros).toBeGreaterThan(0);
    store.close();
  });
});

describe('starting the app', () => {
  it('captures the sync replica once, then leaves it alone at a normal start', () => {
    const first = open();
    const stamp = () => first.store.db.prepare(`SELECT data FROM settings WHERE id='syncBackfillRevision'`).get();
    expect(stamp()).toBeDefined();
    const countRecords = () => Number(first.store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count);
    const before = countRecords();
    expect(before).toBeGreaterThan(0);
    // A record taken away behind the app's back stays away at a normal start, which does not read every row again...
    first.store.db.prepare(`DELETE FROM sync_records WHERE record_key LIKE 'artifact:%' AND rowid IN (SELECT rowid FROM sync_records WHERE record_key LIKE 'artifact:%' LIMIT 1)`).run();
    first.store.close();
    const second = open();
    expect(Number(second.store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBe(before - 1);
    // ...and comes back when a restore asks for the whole pass.
    second.store.sync.refreshFromCanonical();
    expect(Number(second.store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBe(before);
    second.store.close();
  });

  it('can leave the pass for a database that was never stamped until the app has answered ready', () => {
    const { store } = open();
    store.db.prepare(`DELETE FROM settings WHERE id='syncBackfillRevision'`).run();
    const before = Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count);
    expect(Number(store.db.prepare("SELECT COUNT(*) AS count FROM sync_records WHERE record_key LIKE 'run:%'").get()!.count)).toBeGreaterThan(0);
    store.db.prepare(`DELETE FROM sync_records WHERE record_key LIKE 'run:%'`).run();
    store.close();
    const deferred = new Store(summary.databasePath, { deferSyncPass: true });
    // Open is quick and has read nothing through yet...
    expect(deferred.db.prepare(`SELECT data FROM settings WHERE id='syncBackfillRevision'`).get()).toBeUndefined();
    expect(Number(deferred.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBeLessThan(before);
    // ...and the pass comes when asked, once.
    deferred.sync.completeDeferredPass();
    expect(Number(deferred.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBe(before);
    expect(deferred.db.prepare(`SELECT data FROM settings WHERE id='syncBackfillRevision'`).get()).toBeDefined();
    deferred.close();
  });

  it('does not defer anything for a database that is stamped', () => {
    const stamped = new Store(summary.databasePath, { deferSyncPass: true });
    const records = Number(stamped.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count);
    stamped.sync.completeDeferredPass();
    expect(Number(stamped.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBe(records);
    stamped.close();
  });

  it('does the whole pass for a database that was never stamped', () => {
    const { store } = open();
    store.db.prepare(`DELETE FROM settings WHERE id='syncBackfillRevision'`).run();
    const before = Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count);
    expect(Number(store.db.prepare("SELECT COUNT(*) AS count FROM sync_records WHERE record_key LIKE 'run:%'").get()!.count)).toBeGreaterThan(0);
    store.db.prepare(`DELETE FROM sync_records WHERE record_key LIKE 'run:%'`).run();
    store.close();
    const again = open();
    expect(Number(again.store.db.prepare('SELECT COUNT(*) AS count FROM sync_records').get()!.count)).toBe(before);
    expect(again.store.db.prepare(`SELECT data FROM settings WHERE id='syncBackfillRevision'`).get()).toBeDefined();
    again.store.close();
  });
});

describe('sending a large queue to the sync service', () => {
  const context = { accountKey: 'b'.repeat(64), generation: 1 };

  it('picks each batch in the order the service needs by index, and checks only the records it picks', () => {
    const { store } = open();
    store.sync.setRecordingContext(context);
    store.sync.requeue(context, new Map());
    const queued = Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count);
    expect(queued).toBeGreaterThan(300);
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT sequence,data FROM sync_outbox INDEXED BY sync_outbox_order WHERE account_key=? AND bytes<=? ORDER BY rank,sort_key,sequence`)
      .all(context.accountKey, 2_000_000).map(row => String(row.detail)).join(' | ');
    expect(plan).toMatch(/INDEX sync_outbox_order/);
    expect(plan).not.toMatch(/TEMP B-TREE/);
    const first = store.sync.outbox(context, 100);
    expect(first).toHaveLength(100);
    const ranks = first.map(({ record }) => ({ withdraw: 0, delete: 0, entityState: 4, chat: 5, turn: 6, source: 7, run: 10, artifact: 11, event: 11 } as Record<string, number>)[record.data.kind] ?? (record.data.kind === 'revision' ? 1 : 8));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // Acknowledging a batch moves on to the next one.
    store.sync.acknowledge(context, first.map(({ record }) => record.id));
    expect(store.sync.outbox(context, 100).every(({ sequence }) => !first.some(sent => sent.sequence === sequence))).toBe(true);
    store.close();
  });

  it('counts an oversized change and ranks a row an older build queued without its place', () => {
    const { store } = open();
    store.sync.setRecordingContext(context);
    store.db.prepare('DELETE FROM sync_outbox').run();
    store.sync.requeue(context, new Map());
    const queued = store.db.prepare('SELECT data FROM sync_outbox LIMIT 1').get()!;
    // An older build inserts the three columns it knows; the row has no rank, size or sort key.
    const padded = JSON.stringify({ ...JSON.parse(String(queued.data)), id: '00000000-0000-4000-8000-0000000000aa' }) + ' '.repeat(2_100_000);
    store.db.prepare('INSERT INTO sync_outbox(account_key,record_id,data) VALUES(?,?,?)').run(context.accountKey, '00000000-0000-4000-8000-0000000000aa', padded);
    expect(store.sync.oversized(context)).toBe(1);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox WHERE rank IS NULL').get()!.count).toBe(0);
    expect(store.sync.outbox(context, 100).every(({ record }) => JSON.stringify(record).length < 2_000_000)).toBe(true);
    store.close();
  });
});

describe('the time shown on a message', () => {
  it('reads as it did when each call made its own format, and costs far less', async () => {
    const { clockLabel } = await import('../../apps/desktop/src/renderer/components/TimeMark');
    const moments = Array.from({ length: 200 }, (_, index) => new Date(Date.UTC(2026, 0, 1, index % 24, (index * 7) % 60)).toISOString());
    for (const at of moments.slice(0, 12)) {
      expect(clockLabel(at)).toBe(new Date(at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }));
    }
    const started = performance.now();
    for (let round = 0; round < 50; round += 1) for (const at of moments) clockLabel(at);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('saved turns', () => {
  it('answer by number, by id and by time without reading the whole chat', () => {
    const { store } = open();
    const turns = store.sync.turns;
    const all = turns.list(heavyId());
    expect(turns.get(heavyId(), 7)).toEqual(all[7]);
    expect(turns.get(heavyId(), 9999)).toBeUndefined();
    expect(turns.ids(heavyId())).toEqual(Object.fromEntries(all.map(turn => [turn.localRevision, turn.id])));
    expect(turns.listFrom(heavyId(), 100).map(turn => turn.localRevision)).toEqual(all.filter(turn => turn.localRevision >= 100).map(turn => turn.localRevision));
    expect(turns.windowStart(heavyId(), 10)).toBe(all.at(-10)!.localRevision);
    expect(turns.windowStart(heavyId(), 500)).toBeUndefined();
    const latest = Math.max(...all.map(turn => Date.parse(turn.createdAt)));
    expect(Date.parse(turns.nextCreatedAt(heavyId(), 0))).toBe(latest + 1);
    store.close();
  });
});

/** The thread listing as it was written, kept to prove the indexed one lists the same turns in the same order. */
function referenceRevisions(detail: Pick<TaskDetail, 'task' | 'runs' | 'savedTurns'>): number[] {
  const input = (revision: number) => {
    const saved = detail.savedTurns?.find(turn => turn.localRevision === revision);
    if (saved) return saved.input;
    if (revision === (detail.task.inputRevision ?? 0) && detail.task.currentInput) return detail.task.currentInput;
    return detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)?.snapshot.input
      ?? (revision === 0 && (detail.task.inputRevision ?? 0) === 0 ? { brief: detail.task.brief, sourceIds: detail.task.sourceIds } : undefined);
  };
  const createdAt = (revision: number) => detail.savedTurns?.find(turn => turn.localRevision === revision)?.createdAt
    ?? detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision)?.startedAt ?? detail.task.createdAt;
  const messageId = (revision: number) => detail.savedTurns?.find(turn => turn.localRevision === revision)?.id ?? turnMessageId(detail.task.id, revision, detail.task.turnIds);
  return [...new Set([0, detail.task.inputRevision ?? 0, ...detail.runs.map(run => run.snapshot.inputRevision ?? 0), ...(detail.savedTurns ?? []).map(turn => turn.localRevision)])]
    .filter(revision => Boolean(input(revision)?.brief) || detail.runs.some(run => (run.snapshot.inputRevision ?? 0) === revision))
    .sort((first, second) => createdAt(first).localeCompare(createdAt(second)) || messageId(first).localeCompare(messageId(second)));
}

describe('the thread\'s list of turns', () => {
  const random = randomSource(11);
  function syntheticDetail(turns: number, shape: 'saved' | 'legacy'): TaskDetail {
    const taskId = random.uuid();
    const worker = { id: random.uuid(), name: 'Orglet', revision: 1, provider: 'demo', skillId: random.uuid(), instructions: 'x' } as Run['snapshot']['worker'];
    const skill = { id: worker.skillId, name: 'Skill', revision: 1, content: 'x' };
    const at = (index: number) => new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();
    const runs: Run[] = Array.from({ length: turns }, (_, index) => ({ id: random.uuid(), taskId, status: 'completed', startedAt: at(index), error: null,
      snapshot: { worker, skill, inputRevision: index, ...(shape === 'legacy' ? { input: { brief: `Message ${index}`, sourceIds: [] } } : {}) } }));
    const savedTurns = shape === 'saved' ? Array.from({ length: turns }, (_, index) => ({ id: random.uuid(), taskId, createdAt: at(index), input: { brief: `Message ${index}`, sourceIds: [] }, localRevision: index })) : undefined;
    const task = { id: taskId, brief: 'Message 0', workerId: worker.id, status: 'completed', createdAt: at(0), budgetMicros: 1, sourceIds: [], consent: true, accepted: false, inputRevision: turns - 1 } as Task;
    return { task, runs, savedTurns, events: [], artifacts: [], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [], usage: {} as TaskDetail['usage'] };
  }

  it.each(['saved', 'legacy'] as const)('lists the same turns in the same order as before (%s turns)', shape => {
    const detail = syntheticDetail(300, shape);
    expect(chatTurnRevisions(detail)).toEqual(referenceRevisions(detail));
    expect(chatTurnInput(detail, 5)?.brief).toBe('Message 5');
    expect(chatTurnCreatedAt(detail, 5)).toBe(new Date(Date.UTC(2026, 0, 1) + 5 * 60_000).toISOString());
    expect(chatTurnMessageId(detail, 5)).toBe(shape === 'saved' ? detail.savedTurns![5].id : turnMessageId(detail.task.id, 5, detail.task.turnIds));
  });

  it('lists a 4,000-turn chat in well under a second', () => {
    const detail = syntheticDetail(4000, 'saved');
    const started = performance.now();
    const revisions = chatTurnRevisions(detail);
    const elapsed = performance.now() - started;
    expect(revisions).toHaveLength(4000);
    // Searching the saved turns and runs for each one took about 12 s here; one pass over each takes a few milliseconds.
    expect(elapsed).toBeLessThan(1000);
  });
});
