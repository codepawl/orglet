import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Worker, Workspace } from '../../apps/desktop/src/shared/contracts';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';

let directory: string; let store: Store; let core: CoreService; let replies: ModelReply[]; let clock: Date;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-archive-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; clock = new Date('2026-09-17T08:00:00Z');
  core = new CoreService(store, () => {}, async () => ({ async request() { const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply; } }), undefined, () => clock);
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

const until = async (check: () => boolean) => { for (let tries = 0; tries < 200 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
const workspace = () => core.command('workspace', {}) as Promise<Workspace>;
const settings = (patch: object) => core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, ...patch });
const answer = (message: string, knowledgeProposals: unknown[] = []): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, title: null, knowledgeProposals }) }], usage: { input: 200, output: 50 } });
async function task(provider: Worker['provider'], reply?: ModelReply) {
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider });
  if (reply) replies.push(reply);
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Một câu hỏi', sourceIds: [], consent: provider !== 'demo', providerScopes: provider === 'demo' ? [] : [provider], budgetMicros: 100_000 }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  return taskId;
}

it('archives and restores a task, and deletes archived tasks after the chosen number of days', async () => {
  const taskId = await task('demo');
  await core.command('archiveTask', { id: taskId, archived: true });
  expect((await workspace()).tasks[0].archivedAt).toBe(clock.toISOString());
  await core.command('archiveTask', { id: taskId, archived: false });
  expect((await workspace()).tasks[0].archivedAt).toBeUndefined();

  await settings({ archiveRetentionDays: 7 });
  await core.command('archiveTask', { id: taskId, archived: true });
  clock = new Date(clock.getTime() + 6 * 86_400_000); await core.tick();
  expect((await workspace()).tasks).toHaveLength(1);
  clock = new Date(clock.getTime() + 2 * 86_400_000); await core.tick();
  expect((await workspace()).tasks).toHaveLength(0);

  // 0 keeps archived tasks until the user deletes them.
  const kept = await task('demo');
  await settings({ archiveRetentionDays: 0 });
  await core.command('archiveTask', { id: kept, archived: true });
  clock = new Date(clock.getTime() + 400 * 86_400_000); await core.tick();
  expect((await workspace()).tasks.map(item => item.id)).toEqual([kept]);
});

it('deletes a free task completely, and empties a paid one while keeping its cost and a valid backup', async () => {
  const free = await task('demo');
  await core.command('deleteTask', { id: free });
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM runs WHERE task_id=?').get(free)!.count).toBe(0);
  await expect(core.command('task', { id: free })).rejects.toThrow();

  const paid = await task('openai', answer('Câu trả lời riêng tư'));
  const before = (await workspace()).usage.chargedMicros;
  expect(before).toBeGreaterThan(0);
  await core.command('deleteTask', { id: paid });
  expect((await workspace()).tasks).toHaveLength(0);
  expect((await workspace()).usage.chargedMicros).toBe(before);
  expect(store.get<Task>('tasks', paid)).toMatchObject({ brief: '(đã xóa)' });
  expect(JSON.stringify(store.detail(paid))).not.toContain('Câu trả lời riêng tư');
  await expect(core.command('task', { id: paid })).rejects.toThrow();
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});

it('drops unapproved knowledge from a deleted task but keeps the answer approved knowledge came from', async () => {
  const taskId = await task('openai', answer('Ghi nhớ điều này.', [{ title: 'Giữ lại', content: 'Bài học đã duyệt', tags: [] }, { title: 'Bỏ đi', content: 'Chưa duyệt', tags: [] }]));
  const [keep, drop] = ['Giữ lại', 'Bỏ đi'].map(title => store.all<Knowledge>('knowledge').find(item => item.title === title)!);
  await core.command('reviewKnowledge', { id: keep.id, revision: keep.revision, decision: 'approve' });
  await core.command('deleteTask', { id: taskId });
  expect(store.all<Knowledge>('knowledge').map(item => item.id)).toEqual([keep.id]);
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM knowledge_revisions WHERE id=?').get(drop.id)!.count).toBe(0);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});

it('refuses to archive or delete a running task', async () => {
  const taskId = await task('demo');
  store.update('tasks', { ...store.get<Task>('tasks', taskId), status: 'running' });
  await expect(core.command('archiveTask', { id: taskId, archived: true })).rejects.toThrow('đang chạy');
  await expect(core.command('deleteTask', { id: taskId })).rejects.toThrow('đang chạy');
});

it('archives, restores and deletes workers and teams without breaking history, and blocks what is still in use', async () => {
  const [researcher] = store.all<Worker>('workers');
  const skillId = researcher.skillId;
  const helper = await core.command('saveWorker', { name: 'Trợ lý', instructions: 'Help.', provider: 'demo', skillId, taskBudgetMicros: 100_000 }) as Worker;
  const taskId = await task('demo');

  // The last active worker stays.
  await core.command('archiveEntity', { kind: 'worker', id: helper.id, archived: true });
  expect((await workspace()).archivedWorkers.map(worker => worker.id)).toEqual([helper.id]);
  await expect(core.command('archiveEntity', { kind: 'worker', id: researcher.id, archived: true })).rejects.toThrow('ít nhất một Tí');
  await core.command('archiveEntity', { kind: 'worker', id: helper.id, archived: false });
  expect((await workspace()).workers.map(worker => worker.id)).toContain(helper.id);

  // A worker in a team is removed from the team first; the team itself can go.
  const team = await core.command('saveTeam', { name: 'Hội thử', instructions: 'Work together.', memberIds: [helper.id], synthesizerId: helper.id, workflow: 'sequential', monthlyBudgetMicros: 1_000_000 }) as { id: string };
  await expect(core.command('deleteEntity', { kind: 'worker', id: helper.id })).rejects.toThrow('Hội thử');
  await core.command('deleteEntity', { kind: 'team', id: team.id });
  expect((await workspace()).teams).toHaveLength(0);
  await core.command('deleteEntity', { kind: 'worker', id: helper.id });
  expect((await workspace()).workers.map(worker => worker.id)).toEqual([researcher.id]);

  // New work cannot go to an archived worker; old chats and backups still read fine.
  const other = await core.command('saveWorker', { name: 'Người khác', instructions: 'Help.', provider: 'demo', skillId, taskBudgetMicros: 100_000 }) as Worker;
  await core.command('archiveEntity', { kind: 'worker', id: researcher.id, archived: true });
  await expect(core.command('reviseTask', { taskId, brief: 'Còn đó không?', sourceIds: [], consent: false, providerScopes: [], budgetMicros: 100_000 })).rejects.toThrow('lưu trữ hoặc xóa');
  expect(store.detail(taskId).artifacts).toHaveLength(1);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
  expect(other.id).toBeTruthy();

  // Archived workers are deleted after the retention period like tasks.
  await settings({ archiveRetentionDays: 7 });
  clock = new Date(clock.getTime() + 8 * 86_400_000); await core.tick();
  expect((await workspace()).archivedWorkers).toHaveLength(0);
  expect(store.entityState().workers[researcher.id].deletedAt).toBeTruthy();
});
