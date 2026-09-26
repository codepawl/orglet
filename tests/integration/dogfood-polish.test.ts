import { expect, it } from 'vitest';
import type { Artifact, Run } from '../../apps/desktop/src/shared/contracts';
import { readersByTurn } from '../../apps/desktop/src/renderer/components/TaskThread';
import { cancelledMessage } from '../../apps/desktop/src/core/orchestration/runner';

/*
 * COD-287: small things dogfood round 5 found in everyday use.
 */

const taskId = '11111111-1111-4111-8111-111111111111';

function run(id: string, workerId: string, name: string, revision: number, stage?: Run['stage']): Run {
  return {
    id, taskId, status: 'completed', startedAt: '2026-09-27T09:00:00.000Z', error: null, ...(stage ? { stage } : {}),
    snapshot: {
      inputRevision: revision,
      worker: { id: workerId, revision: 1, name, instructions: 'Work.', provider: 'openai', skillId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      skill: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, name: 'Skill', content: 'Help.' },
    },
  } as Run;
}

const answer = (runId: string) => ({ id: `${runId}-answer`, runId }) as Artifact;

const scout = '44444444-4444-4444-8444-444444444441';
const lead = '44444444-4444-4444-8444-444444444442';

it('shows no face under an orglet’s own answer, and keeps it for a reader that has not answered yet', () => {
  // Dogfood round 5: "Scout has read this far" sat under Scout's own reply.
  const answered = run('22222222-2222-4222-8222-222222222221', scout, 'Scout', 0);
  expect(readersByTurn({ runs: [answered], artifacts: [answer(answered.id)] }).size).toBe(0);

  const stopped = run('22222222-2222-4222-8222-222222222222', scout, 'Scout', 1);
  const readers = readersByTurn({ runs: [answered, { ...stopped, status: 'cancelled' }], artifacts: [answer(answered.id)] });
  expect(readers.get(1)?.map(reader => reader.snapshot.worker.name)).toEqual(['Scout']);
  expect(readers.get(0)).toBeUndefined();
});

it('counts a crew lead as having answered when its combining run answered and its plan run did not', () => {
  const plan = run('22222222-2222-4222-8222-222222222223', lead, 'Lead', 0, 'plan');
  const synthesis = run('22222222-2222-4222-8222-222222222224', lead, 'Lead', 0, 'synthesis');
  expect(readersByTurn({ runs: [plan, synthesis], artifacts: [answer(synthesis.id)] }).size).toBe(0);
});

it('warns about charges on a stopped run only where requests can cost money', () => {
  expect(cancelledMessage('demo')).toBe('Đã hủy.');
  expect(cancelledMessage('ollama')).toBe('Đã hủy.');
  expect(cancelledMessage('openai')).toBe('Đã hủy. Request đã gửi có thể vẫn bị tính phí.');
  // A custom connection has no known price, so it is never treated as free.
  expect(cancelledMessage('custom:a2adfa11-435c-44e2-a106-9d6cc4463f7f')).toBe('Đã hủy. Request đã gửi có thể vẫn bị tính phí.');
});
