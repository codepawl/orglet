import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

it('preview checks task scope, snapshot hash and live revocation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orglet-preview-'));
  const store = new Store(join(dir, 'state.sqlite'));
  const core = new CoreService(store, () => {}, async () => { throw new Error('No provider in this test'); });
  try {
    const path = join(dir, 'notes.txt'); await writeFile(path, 'Two lines\nSecond line');
    const [source] = await core.sources.import([path]);
    const worker = store.all<Worker>('workers')[0];
    const task: Task = { id: id(), brief: 'Review', workerId: worker.id, sourceIds: [source.id], consent: false, budgetMicros: 10000, createdAt: now(), status: 'queued', accepted: false };
    store.put('tasks', task);
    expect(await core.command('previewSource', { taskId: task.id, id: source.id })).toMatchObject({ text: 'Two lines\nSecond line', name: 'notes.txt' });
    const other = { ...task, id: id(), sourceIds: [] }; store.put('tasks', other);
    await expect(core.command('previewSource', { taskId: other.id, id: source.id })).rejects.toThrow('quyền');
    await core.command('revoke', { id: source.id });
    await expect(core.command('previewSource', { taskId: task.id, id: source.id })).rejects.toThrow('thu hồi');
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
