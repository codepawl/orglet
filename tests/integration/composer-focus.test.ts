// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import type { Task, Worker, Workspace } from '../../apps/desktop/src/shared/contracts';
import { FollowUpComposer, restoreUnsent } from '../../apps/desktop/src/renderer/components/Composer';

/*
 * COD-284, found dogfooding the packaged app: after sending, the follow-up typed straight away went nowhere. The
 * message box was disabled while the message was on its way, which dropped focus to the page, and focus never came
 * back. The box now empties at once and stays enabled; only a second send waits.
 */

// Tells React this test drives it through `act`, so updates are flushed before each expectation.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The test DOM lays nothing out, so the bar's height measuring has nothing to watch.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void };

function deferred(): Deferred {
  let resolve: Deferred['resolve'] = () => {};
  let reject: Deferred['reject'] = () => {};
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let store: Store;
let container: HTMLDivElement;
let root: Root;
let pendingCall: Deferred;
let call: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new Store(':memory:');
  pendingCall = deferred();
  call = vi.fn(() => pendingCall.promise);
  (window as unknown as { orglet: unknown }).orglet = { call, pickSources: vi.fn(async () => []), pickFolder: vi.fn(async () => ({ sources: [], skipped: [] })) };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  store.close();
});

function chat(): Task {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'First message', sourceIds: [], consent: true, providerScopes: [],
    budgetMicros: 100_000, status: 'completed', accepted: false, createdAt: now() };
  store.put('tasks', task);
  return task;
}

/** Runs a command the way the app's `action` does: a failure is shown elsewhere and never thrown at the bar. */
function action(command: () => Promise<unknown>) {
  void command().catch(() => undefined);
}

function renderBar(task: Task) {
  const detail = store.detail(task.id);
  const workspace = { ...store.workspace(), teams: [] } as unknown as Workspace;
  act(() => {
    root.render(createElement(FollowUpComposer, { detail, workspace, ready: {} as never, openSettings: () => {}, openChat: () => {}, action }));
  });
  return container.querySelector('textarea')!;
}

function type(textarea: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressEnter(textarea: HTMLTextAreaElement) {
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

it('keeps the message box focused and enabled while a message is on its way, and keeps what is typed meanwhile', async () => {
  const textarea = renderBar(chat());
  act(() => textarea.focus());
  type(textarea, 'Compare the two invoices');
  pressEnter(textarea);

  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toBe('reviseTask');
  expect((call.mock.calls[0][1] as { brief: string }).brief).toBe('Compare the two invoices');
  expect(textarea.disabled).toBe(false);
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe('');

  type(textarea, 'and flag the late one');
  // A second send waits for the first; the words stay in the box.
  pressEnter(textarea);
  expect(call).toHaveBeenCalledTimes(1);

  await act(async () => { pendingCall.resolve(undefined); await pendingCall.promise; });
  expect(textarea.value).toBe('and flag the late one');
  expect(document.activeElement).toBe(textarea);
});

it('puts a message that failed to send back in front of what was typed since', async () => {
  const textarea = renderBar(chat());
  act(() => textarea.focus());
  type(textarea, 'Compare the two invoices');
  pressEnter(textarea);
  type(textarea, 'and flag the late one');

  await act(async () => { pendingCall.reject(new Error('Mất kết nối')); await pendingCall.promise.catch(() => undefined); });
  expect(textarea.value).toBe('Compare the two invoices\n\nand flag the late one');
});

it('gives focus to the message box after files are picked from the + menu', async () => {
  const textarea = renderBar(chat());
  const add = container.querySelector<HTMLButtonElement>('.composer-add')!;
  act(() => add.focus());
  act(() => add.click());
  const files = container.querySelector<HTMLButtonElement>('[role=menuitem]')!;
  expect(document.activeElement).toBe(files);
  await act(async () => { files.click(); });
  expect(container.querySelector('[role=menu]')).toBeNull();
  expect(document.activeElement).toBe(textarea);
});

it('restores an unsent message on its own, or before the words typed after it', () => {
  expect(restoreUnsent('First', '')).toBe('First');
  expect(restoreUnsent('First', '  ')).toBe('First');
  expect(restoreUnsent('First', 'Second')).toBe('First\n\nSecond');
});
