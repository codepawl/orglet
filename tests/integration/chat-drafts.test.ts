import { afterEach, beforeEach, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Source, Task, Worker, Workspace } from '../../apps/desktop/src/shared/contracts';
import { FollowUpComposer } from '../../apps/desktop/src/renderer/components/Composer';
import { dropDraft, emptyChatDraftKey, keepDraft, readDraft, taskDraftKey } from '../../apps/desktop/src/renderer/drafts';

/*
 * COD-257, found dogfooding: files added to a chat's message bar but not sent yet, and the words typed there, were
 * gone after opening another chat and coming back, because the bar was a new component with fresh state each time.
 * They are now kept per chat while the app is open.
 */

let store: Store;

beforeEach(() => { store = new Store(':memory:'); });
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
