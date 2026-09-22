import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { ERASE_TABLES } from '../../apps/desktop/src/core/storage/erase';
import { ERASE_CONFIRMATION, type EraseSummary } from '../../apps/desktop/src/shared/erase';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Skill, Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string; let store: Store; let core: CoreService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-erase-'));
  store = new Store(join(directory, 'test.sqlite'));
  core = new CoreService(store, () => {}, async () => { throw new Error('No adapter in this test'); });
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

const erase = (scope: Parameters<CoreService['eraseData']>[0], confirm?: string) => core.command('eraseData', { scope, ...(confirm ? { confirm } : {}) }) as Promise<EraseSummary>;

async function chatWithSource(name: string) {
  const path = join(directory, name); await writeFile(path, 'line one');
  const [source] = await core.sources.import([path]);
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Read it', status: 'completed', budgetMicros: 0, sourceIds: [source.id], consent: true, accepted: false, createdAt: now() };
  store.put('tasks', task);
  return { task, source };
}

it('removes chats without touching the workers, skills or knowledge that outlive them', async () => {
  const { task } = await chatWithSource('note.txt');
  const knowledge = core.knowledge.save({ title: 'Kept', content: 'A fact the user wrote.', tags: [], pinned: false, scope: { type: 'workspace' } });
  expect(store.all<Task>('tasks')).toHaveLength(1);

  const summary = await erase('chats');
  expect(summary.chats).toBe(1);
  expect(store.all<Task>('tasks').filter(row => !row.deletedAt)).toEqual([]);
  expect(store.all<Worker>('workers')).toHaveLength(1);
  expect(store.all<Skill>('skills')).toHaveLength(1);
  expect(store.all<Knowledge>('knowledge').map(row => row.id)).toEqual([knowledge.id]);
  // The source itself is not a chat, so it stays until the person asks for that too.
  expect(store.all<Source>('sources')).toHaveLength(1);
  expect(() => store.get('tasks', task.id)).toThrow();
});

it('erases knowledge with its revisions and search rows', async () => {
  core.knowledge.save({ title: 'One', content: 'First fact.', tags: [], pinned: false, scope: { type: 'workspace' } });
  core.knowledge.save({ title: 'Two', content: 'Second fact.', tags: [], pinned: false, scope: { type: 'workspace' } });

  const summary = await erase('knowledge');
  expect(summary.knowledge).toBe(2);
  for (const table of ['knowledge', 'knowledge_revisions', 'knowledge_search']) {
    expect(Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count)).toBe(0);
  }
});

it('forgets a cited source instead of orphaning the chat that cites it', async () => {
  const { task, source } = await chatWithSource('cited.txt');
  const loose = join(directory, 'loose.txt'); await writeFile(loose, 'nobody cites me');
  await core.sources.import([loose]);

  const summary = await erase('sources');
  expect(summary).toEqual(expect.objectContaining({ sources: 1, sourcesForgotten: 1 }));
  // The chat still opens, which is the whole reason a cited source is kept as a revoked row.
  const detail = store.detail(task.id);
  expect(detail.sources).toHaveLength(1);
  expect(detail.sources[0]).toEqual(expect.objectContaining({ id: source.id, revoked: true }));
  expect(detail.sources[0].hash).toBeUndefined();
  // With its path gone, nothing can read the file behind it again.
  await expect(core.sources.readVerified(source.id, [source.id])).rejects.toThrow();
});

it('puts everything back to a fresh install, and refuses without the typed word', async () => {
  await chatWithSource('note.txt');
  core.knowledge.save({ title: 'One', content: 'First fact.', tags: [], pinned: false, scope: { type: 'workspace' } });
  const firstWorker = store.all<Worker>('workers')[0].id;

  await expect(erase('everything')).rejects.toThrow(ERASE_CONFIRMATION);
  await expect(erase('everything', 'orglet')).rejects.toThrow(ERASE_CONFIRMATION);

  const summary = await erase('everything', ERASE_CONFIRMATION);
  expect(summary).toEqual(expect.objectContaining({ scope: 'everything', chats: 1, knowledge: 1, sources: 1 }));
  for (const table of ERASE_TABLES) {
    const rows = Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
    // Only the worker and skill a new workspace is seeded with, and the revisions behind them, survive.
    expect({ table, rows }).toEqual({ table, rows: ['workers', 'skills'].includes(table) ? 1 : table === 'revisions' ? 2 : 0 });
  }
  const seeded = store.all<Worker>('workers')[0];
  expect(seeded.name).toBe('Researcher');
  expect(seeded.id).not.toBe(firstWorker);
});

it('empties every table the schema has', () => {
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name));
  const shadow = /_(data|idx|content|docsize|config)$/;
  const expected = tables.filter(name => name !== 'migrations' && !shadow.test(name)).sort();
  expect([...ERASE_TABLES].sort()).toEqual(expected);
});
