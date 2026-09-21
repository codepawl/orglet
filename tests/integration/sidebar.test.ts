import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Task, Workspace } from '../../apps/desktop/src/shared/contracts';
import { DEFAULT_ACCENT_COLOR } from '../../apps/desktop/src/shared/accent';

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

it('keeps a finished task marked seen after leaving it, and unread again after a new result', async () => {
  await core.command('createTemplate', { templateId: 'research-review', provider: 'demo' });
  const { workers } = await workspace();
  const id = await core.command('createTask', { workerId: workers[0].id, brief: 'Đánh dấu đã đọc', sourceIds: [], consent: false, budgetMicros: 1000 }) as string;
  const artifactId = crypto.randomUUID();
  store.put('tasks', { ...store.get<Task>('tasks', id), status: 'completed', lastArtifactId: artifactId });
  expect((await workspace()).tasks.find(task => task.id === id)?.seenStamp).toBeUndefined();

  await core.command('markTaskSeen', { id });
  expect((await workspace()).tasks.find(task => task.id === id)?.seenStamp).toBe(`0:${artifactId}`);

  const other = await core.command('createTask', { workerId: workers[0].id, brief: 'Công việc khác', sourceIds: [], consent: false, budgetMicros: 1000 }) as string;
  await core.command('task', { id: other });
  expect((await workspace()).tasks.find(task => task.id === id)?.seenStamp).toBe(`0:${artifactId}`);

  const nextArtifact = crypto.randomUUID();
  store.put('tasks', { ...store.get<Task>('tasks', id), status: 'completed', lastArtifactId: nextArtifact });
  expect((await workspace()).tasks.find(task => task.id === id)?.seenStamp).toBe(`0:${artifactId}`);
  await core.command('markTaskSeen', { id });
  expect((await workspace()).tasks.find(task => task.id === id)?.seenStamp).toBe(`0:${nextArtifact}`);
});

it('keeps the accent colour the user picks, and rejects anything that is not a hex colour', async () => {
  expect((await workspace()).accentColor).toBe(DEFAULT_ACCENT_COLOR);
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, accentColor: '#d97757' });
  expect((await workspace()).accentColor).toBe('#d97757');
  // Leaving it out of a later save keeps what was chosen rather than resetting it.
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000 });
  expect((await workspace()).accentColor).toBe('#d97757');
  await expect(core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, accentColor: 'blue' })).rejects.toThrow();
});

it('keeps the logo monochrome until the user picks the accent, and keeps that pick', async () => {
  // A store without the setting (an older workspace, or a restored backup, which never carries it) is monochrome.
  expect((await workspace()).logoColor).toBe('mono');
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, logoColor: 'accent' });
  expect((await workspace()).logoColor).toBe('accent');
  // Leaving it out of a later save keeps what was chosen rather than resetting it.
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000 });
  expect((await workspace()).logoColor).toBe('accent');
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, logoColor: 'mono' });
  expect((await workspace()).logoColor).toBe('mono');
  await expect(core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, logoColor: 'blue' })).rejects.toThrow();
});

it('adopts a tag colour chosen before the accent existed, rather than resetting to the default', async () => {
  store.setSetting('mentionColor', '#2e7a32');
  expect((await workspace()).accentColor).toBe('#2e7a32');
  // Once an accent is saved it wins; the old key is left alone rather than written back to.
  await core.command('settings', { theme: 'system', connectionLimitMicros: 5_000_000, accentColor: '#4f7fe0' });
  expect((await workspace()).accentColor).toBe('#4f7fe0');
});

it('keeps the colours made in the avatar picker and rejects anything but lowercase hex', async () => {
  expect((await workspace()).avatarColors).toEqual([]);
  await core.command('saveAvatarColors', { colors: ['#1f6feb', '#00a86b'] });
  expect((await workspace()).avatarColors).toEqual(['#1f6feb', '#00a86b']);
  await expect(core.command('saveAvatarColors', { colors: ['red'] })).rejects.toThrow();
  await expect(core.command('saveAvatarColors', { colors: ['#1f6feb', '#1f6feb'] })).rejects.toThrow();
});
