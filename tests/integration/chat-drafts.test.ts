import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Source, Task, Worker, Workspace } from '../../apps/desktop/src/shared/contracts';
import { FollowUpComposer } from '../../apps/desktop/src/renderer/components/Composer';
import { dropDraft, emptyChatDraftKey, forgetAllDrafts, keepDraft, readDraft, taskDraftKey } from '../../apps/desktop/src/renderer/drafts';

/*
 * COD-257, found dogfooding: files added to a chat's message bar but not sent yet, and the words typed there, were
 * gone after opening another chat and coming back, because the bar was a new component with fresh state each time.
 * They are now kept per chat, and across a restart of the app, which an update does on its own.
 */

/** The renderer's own storage, which a restart of the app keeps. */
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
});

let store: Store;

beforeEach(() => { store = new Store(':memory:'); forgetAllDrafts(); });
afterEach(() => store.close());

function source(name: string): Source {
  return { id: id(), name, bytes: 1200 } as Source;
}

function chatWith(worker: Worker): Task {
  const task: Task = { id: id(), workerId: worker.id, brief: 'First message', sourceIds: [], consent: true, providerScopes: [],
    budgetMicros: 100_000, status: 'completed', accepted: false, createdAt: now() };
  store.put('tasks', task);
  return task;
}

function bar(task: Task) {
  const detail = store.detail(task.id);
  const workspace = { ...store.workspace(), teams: [] } as unknown as Workspace;
  return renderToStaticMarkup(createElement(FollowUpComposer, { detail, workspace, ready: {} as never, openSettings: () => {}, openChat: () => {}, action: () => {} }));
}

it('keeps what was typed and attached on a chat\'s bar until it is sent or removed', () => {
  const worker = store.all<Worker>('workers')[0];
  const first = chatWith(worker);
  const second = chatWith(worker);
  const invoice = source('invoice-acme.pdf');
  keepDraft(taskDraftKey(first.id), { text: 'Compare these two', intake: { sources: [invoice], skipped: [] } });

  // Coming back to the first chat, the bar is drawn with the same words and the same file card.
  const firstBar = bar(first);
  expect(firstBar).toContain('Compare these two');
  expect(firstBar).toContain('invoice-acme.pdf');
  // Another chat's bar is its own.
  const secondBar = bar(second);
  expect(secondBar).not.toContain('Compare these two');
  expect(secondBar).not.toContain('invoice-acme.pdf');

  // An emptied bar keeps nothing, so a sent message does not come back.
  keepDraft(taskDraftKey(first.id), { text: '  ', intake: { sources: [], skipped: [] } });
  expect(readDraft(taskDraftKey(first.id))).toBeUndefined();
  expect(bar(first)).not.toContain('invoice-acme.pdf');
});

it('names each empty chat by its orglet, crew or group, whatever order the group was picked in', () => {
  expect(emptyChatDraftKey({ workerId: 'lan' })).toBe('worker:lan');
  expect(emptyChatDraftKey({ teamId: 'crew', workerId: 'lead' })).toBe('team:crew');
  expect(emptyChatDraftKey({ workerIds: ['minh', 'lan'] })).toBe(emptyChatDraftKey({ workerIds: ['lan', 'minh'] }));
  expect(emptyChatDraftKey({})).toBeUndefined();
  keepDraft('worker:lan', { text: 'Draft', intake: { sources: [], skipped: [] } });
  dropDraft('worker:lan');
  expect(readDraft('worker:lan')).toBeUndefined();
});

it('brings a bar back after the app restarts, until chats, files or everything are erased', async () => {
  const invoice = source('invoice-acme.pdf');
  keepDraft('task:first', { text: 'Compare these two', intake: { sources: [invoice], skipped: [] } });
  keepDraft('worker:lan', { text: 'Only words', intake: { sources: [], skipped: [] } });

  // A restart loads the module afresh: the bars come back from storage.
  vi.resetModules();
  const restarted = await import('../../apps/desktop/src/renderer/drafts');
  expect(restarted.readDraft('task:first')).toEqual({ text: 'Compare these two', intake: { sources: [invoice], skipped: [] } });
  expect(restarted.readDraft('worker:lan')?.text).toBe('Only words');

  // Sending empties the bar, and the next restart does not bring it back.
  restarted.keepDraft('worker:lan', { text: '', intake: { sources: [], skipped: [] } });
  vi.resetModules();
  const again = await import('../../apps/desktop/src/renderer/drafts');
  expect(again.readDraft('worker:lan')).toBeUndefined();
  expect(again.readDraft('task:first')?.text).toBe('Compare these two');

  // Erasing forgets every bar, in memory and in storage.
  again.forgetAllDrafts();
  expect(again.readDraft('task:first')).toBeUndefined();
  vi.resetModules();
  expect((await import('../../apps/desktop/src/renderer/drafts')).readDraft('task:first')).toBeUndefined();
});

it('keeps at most the 50 bars written last, and starts empty when storage holds something else', async () => {
  for (let index = 0; index < 55; index += 1) keepDraft(`task:${index}`, { text: `Draft ${index}`, intake: { sources: [], skipped: [] } });
  expect(readDraft('task:4')).toBeUndefined();
  expect(readDraft('task:5')?.text).toBe('Draft 5');
  expect(readDraft('task:54')?.text).toBe('Draft 54');

  storage.set('orglet.chat-drafts', '{"not":"a list"');
  vi.resetModules();
  expect((await import('../../apps/desktop/src/renderer/drafts')).readDraft('task:54')).toBeUndefined();
  storage.set('orglet.chat-drafts', JSON.stringify([['task:ok', { text: 'Kept', intake: { sources: [], skipped: [] } }], ['task:bad', { text: 3 }]]));
  vi.resetModules();
  const restarted = await import('../../apps/desktop/src/renderer/drafts');
  expect(restarted.readDraft('task:ok')?.text).toBe('Kept');
  expect(restarted.readDraft('task:bad')).toBeUndefined();
});
