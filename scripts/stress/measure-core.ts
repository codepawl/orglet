import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serialize } from 'node:v8';
import { performance } from 'node:perf_hooks';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { KnowledgeBase } from '../../apps/desktop/src/core/context/knowledge';
import { compileContext, memoryCandidate } from '../../apps/desktop/src/core/context/compiler';
import { compactThread } from '../../apps/desktop/src/core/context/thread';
import { eraseEverything } from '../../apps/desktop/src/core/storage/erase';
import type { Run, Task, TaskDetail, Worker } from '../../apps/desktop/src/shared/contracts';
import type { SeedSummary } from './seed-profile';

/**
 * Measures the core of a seeded profile in this process: the commands the window sends on start and on interaction,
 * the five-second tick, the notes context, the write path of a long chat, and backup, restore and erase on a copy.
 * Prints one JSON object with every measurement. Nothing here calls a model or the network.
 */
type Measurement = { milliseconds: number; first: number; payloadBytes?: number; serializeMilliseconds?: number; note?: string };

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(run: () => unknown | Promise<unknown>, repeats = 3, payload?: (value: unknown) => number): Promise<Measurement> {
  const times: number[] = [];
  let last: unknown;
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    const started = performance.now();
    last = await run();
    times.push(performance.now() - started);
  }
  const result: Measurement = { milliseconds: round(median(times)), first: round(times[0]) };
  if (payload) result.payloadBytes = payload(last);
  else if (last !== undefined && typeof last === 'object') {
    const started = performance.now();
    result.payloadBytes = serialize(last).byteLength;
    result.serializeMilliseconds = round(performance.now() - started);
  }
  return result;
}

const round = (value: number) => Math.round(value * 10) / 10;
const megabytes = (bytes: number) => round(bytes / 1024 / 1024);

async function main() {
  const [summaryPath, copyDirectory, only] = process.argv.slice(2);
  const { readFileSync } = await import('node:fs');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as SeedSummary;
  const results: Record<string, Measurement | Record<string, unknown>> = {};
  const memory = () => { const usage = process.memoryUsage(); return { rssMB: megabytes(usage.rss), heapMB: megabytes(usage.heapUsed) }; };
  const wanted = (name: string) => !only || only.split(',').includes(name);

  // Start: the store (schema, sync backfill) and the service around it.
  const files = { databaseMB: megabytes(statSync(summary.databasePath).size) };
  results.files = files;
  const storeStarted = performance.now();
  const store = new Store(summary.databasePath);
  const storeMilliseconds = round(performance.now() - storeStarted);
  const coreStarted = performance.now();
  const core = new CoreService(store, () => undefined, async () => { throw new Error('No model in the stress run.'); });
  results.start = { storeMilliseconds, coreMilliseconds: round(performance.now() - coreStarted), memory: memory() };

  const heavyId = summary.longChatIds[0] ?? summary.chatIds[0];
  const ordinaryId = summary.chatIds[summary.config.longChats] ?? summary.chatIds[0];
  const worker = store.get<Worker>('workers', summary.workerIds[0]);

  if (wanted('commands')) {
    results.workspace = await measure(() => core.command('workspace', {}));
    results.task_heavy = await measure(() => core.command('task', { id: heavyId }));
    // What the window asks for since it reads only the newest turns of a chat; a core before that change ignores the argument.
    results.task_heavy_window = await measure(() => core.command('task', { id: heavyId, recentTurns: 100 }));
    results.task_ordinary = await measure(() => core.command('task', { id: ordinaryId }));
    results.search_common = await measure(() => core.command('searchChats', { query: 'report' }));
    results.search_phrase = await measure(() => core.command('searchChats', { query: 'budget forecast' }));
    results.search_miss = await measure(() => core.command('searchChats', { query: 'zzzmissingword' }));
    results.search_notes = await measure(() => core.command('searchKnowledge', { query: 'forecast' }));
    results.after_commands = { memory: memory() };
  }

  if (wanted('tick')) {
    // Called for every change the core announces: a status, an event, an answer.
    results.notify = await measure(() => (core as unknown as { notify(): void }).notify(), 5, () => 0);
    results.tick = await measure(() => core.tick(), 5);
    results.routines_tick = await measure(() => (core as unknown as { routines: { tick(): Promise<void> } }).routines.tick(), 5);
  }

  if (wanted('context')) {
    const knowledge = new KnowledgeBase(store);
    results.notes_candidates = await measure(() => knowledge.candidates(worker.id), 5, value => (value as unknown[]).length);
    results.notes_compile = await measure(() => {
      const candidates = knowledge.candidates(worker.id);
      return compileContext({ worker, skill: store.all<{ id: string; name: string; revision: number; content: string }>('skills')[0], colleagues: [], brief: 'Please prepare the budget forecast report for the quarter',
        candidates, memories: knowledge.memoryCandidates(worker.id).map(memoryCandidate) }).context.knowledge.length;
    }, 5, value => Number(value));
    const detail = store.detail(heavyId);
    const lastRun = detail.runs.at(-1) as Run;
    results.thread_compact_heavy = await measure(() => compactThread(detail as TaskDetail, lastRun, 'Next question'), 3, () => 0);
  }

  if (wanted('writes')) {
    results.detail_heavy = await measure(() => store.detail(heavyId));
    results.detail_ordinary = await measure(() => store.detail(ordinaryId));
    const heavyRuns = store.db.prepare('SELECT data FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(heavyId)!;
    const lastRun = JSON.parse(String(heavyRuns.data)) as Run;
    results.write_run_heavy = await measure(() => store.update('runs', { ...lastRun, error: null }), 5, () => 0);
    results.write_event_heavy = await measure(() => store.event(lastRun.id, 'Stress event'), 5, () => 0);
    results.write_task_heavy = await measure(() => store.update('tasks', store.get<Task>('tasks', heavyId)), 5, () => 0);
    const ordinaryRun = JSON.parse(String(store.db.prepare('SELECT data FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(ordinaryId)!.data)) as Run;
    results.write_run_ordinary = await measure(() => store.update('runs', { ...ordinaryRun, error: null }), 5, () => 0);
    results.next_created_at_heavy = await measure(() => store.sync.turns.nextCreatedAt(heavyId), 5, () => 0);
    results.usage_all = await measure(() => store.usage(), 5);
    // Adding an orglet to a channel: the chat's sync scopes are worked out again.
    const channelId = summary.channelTaskIds[0];
    if (channelId) {
      const channel = store.get<Task>('tasks', channelId);
      const extra = summary.workerIds.find(workerId => !(channel.assignees as string[]).includes(workerId))!;
      results.channel_member_added = await measure(() => store.update('tasks', { ...channel, assignees: [...(channel.assignees as string[]), extra] }), 1, () => 0);
      store.update('tasks', channel);
    }
    results.after_writes = { memory: memory() };
  }

  if (wanted('sources') && summary.bigSourceIds.length) {
    // A big CSV is a chat's file only when attached; the viewer path reads it through the source's own id.
    const taskWithSource = summary.chatIds.find(chatId => store.get<Task>('tasks', chatId).sourceIds.length) ?? ordinaryId;
    const sourceId = store.get<Task>('tasks', taskWithSource).sourceIds[0];
    if (sourceId) results.source_preview = await measure(() => core.command('previewSource', { taskId: taskWithSource, id: sourceId }), 3);
  }

  if (wanted('backup')) {
    const backups = core.backups;
    try {
      results.backup_export = await measure(() => backups.export().length, 1, value => Number(value));
    } catch (error) {
      results.backup_export = { error: error instanceof Error ? error.message : String(error) };
    }
    results.after_backup = { memory: memory() };
  }

  store.close();

  if (copyDirectory && wanted('destructive')) {
    mkdirSync(copyDirectory, { recursive: true });
    const copyPath = join(copyDirectory, 'orglet.sqlite');
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${copyPath}${suffix}`, { force: true });
    copyFileSync(summary.databasePath, copyPath);
    const copy = new Store(copyPath);
    const copyCore = new CoreService(copy, () => undefined, async () => { throw new Error('No model in the stress run.'); });
    let backupText: string | undefined;
    try {
      backupText = copyCore.backups.export();
      const started = performance.now();
      const preview = copyCore.backups.preview(backupText);
      const previewMilliseconds = round(performance.now() - started);
      const restoreStarted = performance.now();
      copyCore.backups.restore(preview.token);
      results.backup_roundtrip = { exportBytes: backupText.length, previewMilliseconds, restoreMilliseconds: round(performance.now() - restoreStarted) };
    } catch (error) {
      results.backup_roundtrip = { error: error instanceof Error ? error.message : String(error) };
    }
    const eraseStarted = performance.now();
    eraseEverything(copy);
    results.erase = { milliseconds: round(performance.now() - eraseStarted) };
    if (backupText) {
      try {
        const restoreStarted = performance.now();
        copyCore.backups.restore(copyCore.backups.preview(backupText).token);
        results.backup_restore_fresh = { milliseconds: round(performance.now() - restoreStarted) };
      } catch (error) {
        results.backup_restore_fresh = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    copy.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${copyPath}${suffix}`, { force: true });
    if (existsSync(dirname(copyPath))) rmSync(copyDirectory, { recursive: true, force: true });
  }
  results.final = { memory: memory() };
  console.log(`RESULT ${JSON.stringify(results)}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
