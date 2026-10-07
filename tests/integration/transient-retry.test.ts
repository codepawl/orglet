import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refusedBeforeWork, retryAfterMs, withTransientRetry } from '../../apps/desktop/src/core/orchestration/transient';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Worker } from '../../apps/desktop/src/shared/contracts';

/** An error shaped like the providers' SDK errors: an HTTP status and the response headers. */
const httpError = (status: number, headers: Record<string, string> = {}) => Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
const unreachable = (code: string) => Object.assign(new Error('Connection error.'), { name: 'APIConnectionError', cause: Object.assign(new Error(code), { code }) });

describe('which failed requests are tried again (2026-10-07)', () => {
  it('retries only what the provider refused before working on it', () => {
    expect(refusedBeforeWork(httpError(429))).toEqual({ afterMs: undefined });
    expect(refusedBeforeWork(httpError(529))).toBeDefined();
    expect(refusedBeforeWork(httpError(503))).toBeDefined();
    expect(refusedBeforeWork(unreachable('ENOTFOUND'))).toEqual({});
    expect(refusedBeforeWork(unreachable('ECONNREFUSED'))).toEqual({});
    // These may have run, and been charged, so the run stops as before.
    expect(refusedBeforeWork(httpError(500))).toBeUndefined();
    expect(refusedBeforeWork(httpError(400))).toBeUndefined();
    expect(refusedBeforeWork(unreachable('ECONNRESET'))).toBeUndefined();
    expect(refusedBeforeWork(new Error('Request timed out.'))).toBeUndefined();
  });

  it('reads retry-after in seconds or as a date', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '7' }))).toBe(7000);
    expect(retryAfterMs({ 'retry-after': '2' })).toBe(2000);
    expect(retryAfterMs(new Headers({ 'retry-after': 'Wed, 07 Oct 2026 10:00:05 GMT' }), Date.parse('Wed, 07 Oct 2026 10:00:00 GMT'))).toBe(5000);
    expect(retryAfterMs(new Headers())).toBeUndefined();
  });

  it('waits, tries again, and gives up after the last pause or on a wait longer than a minute', async () => {
    const waits: number[] = [];
    let calls = 0;
    const answer = await withTransientRetry(async () => {
      calls++;
      if (calls < 3) throw httpError(429, { 'retry-after': '0' });
      return 'ok';
    }, new AbortController().signal, waitMs => waits.push(waitMs), [5, 5, 5]);
    expect(answer).toBe('ok');
    expect(waits).toEqual([0, 0]);
    let always = 0;
    await expect(withTransientRetry(async () => { always++; throw httpError(529); }, new AbortController().signal, () => {}, [1, 1])).rejects.toThrow('HTTP 529');
    expect(always).toBe(3);
    let tooLong = 0;
    await expect(withTransientRetry(async () => { tooLong++; throw httpError(429, { 'retry-after': '120' }); }, new AbortController().signal, () => {}, [1])).rejects.toThrow('HTTP 429');
    expect(tooLong).toBe(1);
  });

  it('stops waiting the moment the run is stopped', async () => {
    const controller = new AbortController();
    const pending = withTransientRetry(async () => { throw httpError(429); }, controller.signal, () => controller.abort(new Error('Đã hủy.')), [60_000]);
    await expect(pending).rejects.toThrow();
  });
});

describe('a run that meets a busy provider', () => {
  let store: Store;
  let core: CoreService;
  beforeEach(() => { store = new Store(':memory:'); });
  afterEach(async () => { await core?.runner.shutdown(); store.close(); });

  it('says it is trying again in the chat and answers once the provider takes the request', async () => {
    let calls = 0;
    core = new CoreService(store, () => {}, async () => ({
      async request(): Promise<ModelReply> {
        calls++;
        if (calls === 1) throw httpError(429, { 'retry-after': '0' });
        return { calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Xong.', title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 5 } };
      },
    }));
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Chào', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as string;
    for (let attempt = 0; attempt < 300 && store.detail(taskId).task.status !== 'completed'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(calls).toBe(2);
    expect(detail.events.some(event => event.message.startsWith('Nhà cung cấp đang bận hoặc mất mạng; thử lại sau'))).toBe(true);
    expect(detail.artifacts[0].report.summary).toBe('Xong.');
  });
});
