import { describe, expect, it } from 'vitest';
import { acceptStep, appView, createHistory, currentView, recordView, replaceView, stepHistory, viewKey, type AppView, type AppViewState, type NavigationHistory } from '../../apps/desktop/src/renderer/navigation';

const baseState: AppViewState = { chat: null, recipient: 'worker-1', panel: null, settingsTab: 'general', libraryTab: 'skills', fromLibrary: false, routineEditing: false, noticesOpen: false };

function history(...views: string[]): NavigationHistory<string> {
  let result = createHistory(views[0], view => view);
  for (const view of views.slice(1)) result = recordView(result, view);
  return result;
}

describe('appView', () => {
  it('keeps only what the open panel shows', () => {
    const chat = appView({ ...baseState, chat: 'task-1', skillId: 'skill-1', settingsTab: 'usage' });
    expect(chat).toEqual({ chat: 'task-1', recipient: '', panel: null });
    expect(appView({ ...baseState, panel: 'settings', settingsTab: 'usage', libraryTab: 'knowledge' })).toEqual({ chat: null, recipient: 'worker-1', panel: 'settings', tab: 'usage' });
    expect(appView({ ...baseState, panel: 'skill', skillId: 'skill-1', fromLibrary: true })).toEqual({ chat: null, recipient: 'worker-1', panel: 'skill', item: 'skill-1', fromLibrary: true });
    expect(appView({ ...baseState, panel: 'routines', routineEditing: true, routineId: 'routine-1' })).toEqual({ chat: null, recipient: 'worker-1', panel: 'routines', editing: true, item: 'routine-1' });
    expect(appView({ ...baseState, noticesOpen: true, sourceId: 'source-1' })).toEqual({ chat: null, recipient: 'worker-1', panel: null, notices: true, source: 'source-1' });
  });

  it('keys equal views the same and different views apart', () => {
    const library = appView({ ...baseState, panel: 'library' });
    expect(viewKey(library)).toBe(viewKey(appView({ ...baseState, panel: 'library', settingsTab: 'about' })));
    expect(viewKey(library)).not.toBe(viewKey(appView({ ...baseState, panel: 'library', libraryTab: 'knowledge' })));
    expect(viewKey(appView({ ...baseState, panel: 'skill', skillId: 'skill-1' }))).not.toBe(viewKey(appView({ ...baseState, panel: 'skill', skillId: 'skill-1', fromLibrary: true })));
  });
});

describe('history', () => {
  it('records a step after the current one and drops the steps ahead of it', () => {
    let walk = history('library', 'skill', 'library');
    expect(walk.entries).toEqual(['library', 'skill', 'library']);
    walk = stepHistory(walk, 'back', () => true)!.history;
    walk = stepHistory(walk, 'back', () => true)!.history;
    expect(currentView(walk)).toBe('library');
    walk = recordView(walk, 'settings');
    expect(walk.entries).toEqual(['library', 'settings']);
    expect(stepHistory(walk, 'forward', () => true)).toBeUndefined();
  });

  it('does not record the view already shown', () => {
    const walk = recordView(history('library'), 'library');
    expect(walk.entries).toEqual(['library']);
  });

  it('walks back and forward through what was opened', () => {
    let walk = history('chat-a', 'chat-b', 'notices');
    const back = stepHistory(walk, 'back', () => true)!;
    expect(back.view).toBe('chat-b');
    walk = stepHistory(back.history, 'back', () => true)!.history;
    expect(currentView(walk)).toBe('chat-a');
    expect(stepHistory(walk, 'back', () => true)).toBeUndefined();
    const forward = stepHistory(walk, 'forward', () => true)!;
    expect(forward.view).toBe('chat-b');
    expect(stepHistory(forward.history, 'forward', () => true)!.view).toBe('notices');
  });

  it('skips and drops steps to things that no longer exist', () => {
    let walk = history('chat-a', 'chat-deleted', 'chat-b');
    const back = stepHistory(walk, 'back', view => view !== 'chat-deleted')!;
    expect(back.view).toBe('chat-a');
    expect(back.history.entries).toEqual(['chat-a', 'chat-b']);
    walk = back.history;
    expect(currentView(walk)).toBe('chat-a');
    expect(stepHistory(walk, 'forward', view => view !== 'chat-b')).toBeUndefined();
    expect(stepHistory(walk, 'forward', () => true)!.view).toBe('chat-b');
  });

  it('rewrites the current step and keeps the rest', () => {
    const walk = replaceView(history('empty', 'library'), 'chat-live');
    expect(walk.entries).toEqual(['empty', 'chat-live']);
    expect(walk.index).toBe(1);
  });

  it('caps the history at its limit, dropping the oldest steps', () => {
    let walk = createHistory('view-0', view => view, 3);
    for (let step = 1; step <= 5; step += 1) walk = recordView(walk, `view-${step}`);
    expect(walk.entries).toEqual(['view-3', 'view-4', 'view-5']);
    expect(currentView(walk)).toBe('view-5');
    expect(stepHistory(walk, 'back', () => true)!.view).toBe('view-4');
  });

  it('works on app views by key', () => {
    const empty: AppView = { chat: null, recipient: 'worker-1', panel: null };
    const settings: AppView = { ...empty, panel: 'settings', tab: 'general' };
    let walk = createHistory(empty, viewKey);
    walk = recordView(walk, settings);
    walk = recordView(walk, { ...settings });
    expect(walk.entries).toHaveLength(2);
    expect(stepHistory(walk, 'back', () => true)!.view).toEqual(empty);
  });
});

describe('acceptStep', () => {
  it('takes one press once when it arrives from two paths', () => {
    const mouse = { source: 'mouse' as const, direction: 'back' as const, at: 1000 };
    expect(acceptStep(undefined, mouse)).toBe(true);
    expect(acceptStep(mouse, { source: 'window', direction: 'back', at: 1050 })).toBe(false);
    expect(acceptStep(mouse, { source: 'window', direction: 'forward', at: 1050 })).toBe(true);
    expect(acceptStep(mouse, { source: 'mouse', direction: 'back', at: 1050 })).toBe(true);
    expect(acceptStep(mouse, { source: 'window', direction: 'back', at: 1400 })).toBe(true);
  });
});
