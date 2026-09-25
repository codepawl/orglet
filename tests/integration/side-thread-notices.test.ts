import { expect, it } from 'vitest';
import type { Task } from '../../apps/desktop/src/shared/contracts';
import { finishedSideThreads, sideThreadStatuses } from '../../apps/desktop/src/renderer/sideThreadNotices';

const row = (id: string, status: Task['status'], side = true): Task => ({
  id, status, brief: `Ask ${id}\nmore`, workerId: 'worker', createdAt: '2026-09-25T00:00:00.000Z', budgetMicros: 1000, sourceIds: [],
  consent: true, accepted: false, ...(side ? { sideOf: { taskId: 'main', throughRevision: 0 } } : {}),
});

it('announces a side thread only when it stops working after being seen busy (COD-247)', () => {
  const before = sideThreadStatuses([row('done', 'running'), row('failed', 'queued'), row('still', 'running'), row('old', 'completed'), row('stopped', 'running'), row('main', 'running', false)]);
  expect(before.has('main')).toBe(false);
  const now = [row('done', 'completed'), row('failed', 'failed'), row('still', 'running'), row('old', 'completed'), row('stopped', 'cancelled'), row('main', 'completed', false), row('new', 'completed')];
  expect(finishedSideThreads(before, now)).toEqual([
    { id: 'done', workerId: 'worker', name: 'Ask done', failed: false },
    { id: 'failed', workerId: 'worker', name: 'Ask failed', failed: true },
  ]);
});
