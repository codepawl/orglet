import { describe, expect, it } from 'vitest';
import { coalesceRuns } from '../../apps/desktop/src/renderer/coalesceRuns';

/** A run of work that finishes when the test says so. */
function controlledWork() {
  const starts: (() => void)[] = [];
  let started = 0;
  return {
    work: () => new Promise<void>(resolve => { started += 1; starts.push(resolve); }),
    finishOne: async () => { starts.shift()?.(); await new Promise(resolve => setTimeout(resolve, 0)); },
    get started() { return started; },
  };
}

describe('a burst of change notices', () => {
  it('starts work at once for the first notice', () => {
    const job = controlledWork();
    coalesceRuns(job.work)();
    expect(job.started).toBe(1);
  });

  it('runs one more time after the running work, however many notices arrived meanwhile', async () => {
    const job = controlledWork();
    const notify = coalesceRuns(job.work);
    notify();
    for (let index = 0; index < 30; index += 1) notify();
    expect(job.started).toBe(1);
    await job.finishOne();
    expect(job.started).toBe(2);
    await job.finishOne();
    expect(job.started).toBe(2);
  });

  it('starts fresh work for a notice that comes after the work is done', async () => {
    const job = controlledWork();
    const notify = coalesceRuns(job.work);
    notify();
    await job.finishOne();
    notify();
    expect(job.started).toBe(2);
  });

  it('keeps going after work that fails', async () => {
    let attempts = 0;
    const notify = coalesceRuns(async () => { attempts += 1; if (attempts === 1) throw new Error('failed'); });
    notify();
    notify();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(attempts).toBe(2);
  });
});
