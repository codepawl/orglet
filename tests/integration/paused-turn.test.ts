import { describe, expect, it } from 'vitest';
import type { Activity, Run, Worker } from '../../apps/desktop/src/shared/contracts';
import { pausedAfter } from '../../apps/desktop/src/shared/paused-turn';

/*
 * COD-287: a crew paused after Scout's step read "Writer · combining", because the combining step is the turn's newest
 * run and a pause marks every run that had not started as paused too. The turn stopped after the last run that worked.
 */

function run(id: string, name: string, stage: Run['stage'], status: Run['status']): Run {
  const worker = { id: name.toLowerCase(), name } as Worker;
  return { id, taskId: 'crew-chat', stage, status, startedAt: '2026-09-27T10:00:00.000Z', error: null, snapshot: { worker } as Run['snapshot'] };
}

let nextEvent = 1;
function line(runId: string, sequence: number | undefined, message: string): Activity {
  return { id: `event-${nextEvent++}`, runId, message, createdAt: '2026-09-27T10:00:00.000Z', ...(sequence === undefined ? {} : { sequence }) };
}

const plan = run('plan', 'Writer', 'plan', 'completed');
const scout = run('scout', 'Scout', 'member', 'paused');
const editor = run('editor', 'Editor', 'member', 'paused');
const combining = run('combining', 'Writer', 'synthesis', 'paused');
const turn = [plan, scout, editor, combining];
// Every run of a crew turn is created at the start, each with the line that says so.
const created = [line('plan', 1, 'Routing.'), line('scout', 1, 'Starting Scout.'), line('editor', 1, 'Starting Editor.'), line('combining', 1, 'Combining 0 saved results.')];

describe('pausedAfter', () => {
  it('names the member whose step came last, not the combining step that never started', () => {
    const events = [...created, line('plan', 2, 'Calling the model · step 1/6'), line('scout', 2, 'Calling the model · step 1/6'), line('scout', 3, 'Read notes.md')];
    expect(pausedAfter(turn, events)?.id).toBe('scout');
  });

  it('names the lead when the crew paused right after handing out the work', () => {
    const events = [...created, line('plan', 2, 'Calling the model · step 1/6')];
    expect(pausedAfter(turn, events)?.id).toBe('plan');
  });

  it('names nobody when nothing had started, so the chat does not pretend someone worked', () => {
    expect(pausedAfter(turn, created)).toBeUndefined();
    expect(pausedAfter(turn, [])).toBeUndefined();
  });

  it('ignores lines of runs from other turns, and reads lines saved without a sequence by their order', () => {
    const olderTurn = run('older', 'Editor', 'member', 'completed');
    const events = [line('scout', undefined, 'Starting Scout.'), line('scout', undefined, 'Calling the model · step 1/6'), line('older', 2, 'Read old.md')];
    expect(pausedAfter(turn, events)?.id).toBe('scout');
    expect(pausedAfter([olderTurn, ...turn], events)?.id).toBe('older');
  });
});
