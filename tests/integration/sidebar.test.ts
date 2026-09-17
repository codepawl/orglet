import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Workspace } from '../../apps/desktop/src/shared/contracts';

let store: Store; let core: CoreService;
beforeEach(() => { store = new Store(':memory:'); core = new CoreService(store, () => {}, async () => { throw new Error('no model'); }); });
afterEach(() => store.close());
const workspace = () => core.command('workspace', {}) as Promise<Workspace>;

it('keeps the chosen sidebar order and lists items created later after the placed ones', async () => {
  await core.command('createTemplate', { templateId: 'research-review', provider: 'demo' });
  const ids = (await workspace()).workers.map(worker => worker.id);
  const reversed = [...ids].reverse();
  await core.command('reorder', { kind: 'workers', ids: reversed.slice(0, 2) });
  const ordered = (await workspace()).workers.map(worker => worker.id);
  expect(ordered.slice(0, 2)).toEqual(reversed.slice(0, 2));
  expect(ordered.slice(2)).toEqual(ids.filter(id => !reversed.slice(0, 2).includes(id)));
  await expect(core.command('reorder', { kind: 'skills', ids })).rejects.toThrow();
});

it('stores task names separately from the task, so a run updating the task keeps the name', async () => {
  const { workers } = await workspace();
  const id = await core.command('createTask', { workerId: workers[0].id, brief: 'Long original brief', sourceIds: [], consent: false, budgetMicros: 1000 }) as string;
  await core.command('renameTask', { id, title: '  Short name  ' });
  expect((await workspace()).tasks.find(task => task.id === id)?.title).toBe('Short name');
  store.put('tasks', { ...store.get<Task>('tasks', id), status: 'completed' });
  expect((await workspace()).tasks.find(task => task.id === id)?.title).toBe('Short name');
  await core.command('renameTask', { id, title: '' });
  expect((await workspace()).tasks.find(task => task.id === id)?.title).toBeUndefined();
  await expect(core.command('renameTask', { id: crypto.randomUUID(), title: 'Missing' })).rejects.toThrow();
});

it('keeps the colours made in the avatar picker and rejects anything but lowercase hex', async () => {
  expect((await workspace()).avatarColors).toEqual([]);
  await core.command('saveAvatarColors', { colors: ['#1f6feb', '#00a86b'] });
  expect((await workspace()).avatarColors).toEqual(['#1f6feb', '#00a86b']);
  await expect(core.command('saveAvatarColors', { colors: ['red'] })).rejects.toThrow();
  await expect(core.command('saveAvatarColors', { colors: ['#1f6feb', '#1f6feb'] })).rejects.toThrow();
});
