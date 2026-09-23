import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCache } from '../../apps/desktop/src/renderer/prefetch';
import { detailMatchesRow, followWorkspace, taskDetails, taskGrants } from '../../apps/desktop/src/renderer/caches';
import type { TaskDetail, Workspace } from '../../apps/desktop/src/shared/contracts';

/** A loader that answers with the key and counts how often it was asked. */
function counting(delayMs = 0) {
  const calls: string[] = [];
  const load = (key: string) => {
    calls.push(key);
    return new Promise<string>(resolve => setTimeout(() => resolve(`value:${key}`), delayMs));
  };
  return { calls, load };
}

describe('SessionCache', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shares one request between readers asking at once and keeps the answer', async () => {
    const loader = counting(10);
    const cache = new SessionCache<string>({ load: loader.load });
    const first = cache.read('a');
    const second = cache.read('a');
    expect(cache.loading('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBe('value:a');
    expect(await second).toBe('value:a');
    expect(loader.calls).toEqual(['a']);
    expect(cache.get('a')).toBe('value:a');
    // A third read answers from what is kept without asking again.
    expect(await cache.read('a')).toBe('value:a');
    expect(loader.calls).toEqual(['a']);
    expect(cache.loading('a')).toBe(false);
  });

  it('fetches only after the pointer has rested for the dwell, and not at all if it left first', async () => {
    const loader = counting();
    const cache = new SessionCache<string>({ load: loader.load, dwellMs: 100 });
    cache.dwell('a', true);
    await vi.advanceTimersByTimeAsync(60);
    cache.dwell('a', false);
    await vi.advanceTimersByTimeAsync(100);
    expect(loader.calls).toEqual([]);
    cache.dwell('b', true);
    await vi.advanceTimersByTimeAsync(99);
    expect(loader.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(loader.calls).toEqual(['b']);
    await vi.advanceTimersByTimeAsync(1);
    expect(cache.get('b')).toBe('value:b');
    // Resting again on something kept or on its way starts nothing.
    cache.dwell('b', true);
    await vi.advanceTimersByTimeAsync(200);
    expect(loader.calls).toEqual(['b']);
  });

  it('drops the least recently read entry past the limit', async () => {
    const loader = counting();
    const cache = new SessionCache<string>({ load: loader.load, limit: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    // Reading `a` makes `b` the oldest.
    expect(cache.get('a')).toBe('1');
    cache.set('c', '3');
    expect(cache.size()).toBe(2);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('forgets an entry on invalidation and disowns a request already on its way', async () => {
    const loader = counting(10);
    const cache = new SessionCache<string>({ load: loader.load });
    cache.set('kept', 'old');
    const pending = cache.read('late');
    cache.invalidate('kept');
    expect(cache.has('kept')).toBe(false);
    cache.invalidate();
    await vi.advanceTimersByTimeAsync(10);
    // The caller still gets its answer; the cache does not keep what it disowned.
    expect(await pending).toBe('value:late');
    expect(cache.has('late')).toBe(false);
  });

  it('tells subscribers when an entry lands, changes or goes', () => {
    const cache = new SessionCache<string>({ load: async key => key });
    const heard: number[] = [];
    const stop = cache.subscribe(() => heard.push(cache.size()));
    cache.set('a', '1');
    cache.prune(() => false);
    cache.invalidate();
    stop();
    cache.set('b', '2');
    expect(heard).toEqual([1, 0, 0]);
  });
});

const taskId = '11111111-1111-4111-8111-111111111111';
const detailOf = (overrides: Partial<TaskDetail['task']> = {}): TaskDetail => ({
  task: { id: taskId, brief: 'Read this', workerId: 'w', status: 'completed', createdAt: '2026-09-23T00:00:00.000Z', budgetMicros: 1, sourceIds: [], consent: true, accepted: true, inputRevision: 2, lastArtifactId: 'art-1', ...overrides },
  runs: [], events: [], artifacts: [], profiles: [], preflights: [], sources: [], workspaceEvidence: [], appProposals: [], usage: { chargedMicros: 0, reservedMicros: 0, uncertainCount: 0, inputTokens: 0, outputTokens: 0 },
});

describe('following the workspace', () => {
  it('keeps a chat whose row is unchanged and drops one whose answer, input or status moved on', () => {
    const detail = detailOf();
    expect(detailMatchesRow(detail, detail.task)).toBe(true);
    expect(detailMatchesRow(detail, { ...detail.task, seenStamp: 'later' })).toBe(true);
    expect(detailMatchesRow(detail, { ...detail.task, lastArtifactId: 'art-2' })).toBe(false);
    expect(detailMatchesRow(detail, { ...detail.task, inputRevision: 3 })).toBe(false);
    expect(detailMatchesRow(detail, { ...detail.task, status: 'running' })).toBe(false);
    expect(detailMatchesRow(detail, { ...detail.task, archivedAt: '2026-09-23T01:00:00.000Z' })).toBe(false);
    expect(detailMatchesRow(detail, undefined)).toBe(false);
  });

  it('prunes kept chats against the rows that arrived and drops every grant', () => {
    const unchanged = detailOf();
    const changed = detailOf({ id: '22222222-2222-4222-8222-222222222222' });
    taskDetails.set(unchanged.task.id, unchanged);
    taskDetails.set(changed.task.id, changed);
    taskGrants.set(unchanged.task.id, null);
    followWorkspace({ tasks: [unchanged.task, { ...changed.task, lastArtifactId: 'art-9' }] } as unknown as Workspace);
    expect(taskDetails.has(unchanged.task.id)).toBe(true);
    expect(taskDetails.has(changed.task.id)).toBe(false);
    expect(taskGrants.has(unchanged.task.id)).toBe(false);
  });
});
