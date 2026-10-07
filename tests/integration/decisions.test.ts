import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Decisions } from '../../apps/desktop/src/core/decisions/service';
import { MAX_REVIEW_ATTEMPTS, NOTEWORTHY_QUESTION, quietRunState } from '../../apps/desktop/src/core/orchestration/quiet-runs';
import { attendedRuns, noteworthyBackgroundNotice, noteworthyNotice, noteworthyRuns, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { setLanguage } from '../../apps/desktop/src/renderer/i18n';
import { flaggedWhen } from '../../apps/desktop/src/renderer/components/RoutinesPanel';
import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../apps/desktop/src/shared/decisions';
import type { Routine, Task } from '../../apps/desktop/src/shared/contracts';
import { ERASE_CONFIRMATION } from '../../apps/desktop/src/shared/erase';
import type { Schedule } from '../../apps/desktop/src/shared/schedule';

const hourly: Schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'hours', weekday: 1, everyHours: 1 };
const daily: Schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 };

type Asked = { state: DecisionState; questions: DecisionQuestions; maxLength: number };

const connectedDependencies = {
  saved: () => ({ connection: 'openai', model: 'gpt-6-luna' }),
  save: () => {},
  readKey: async () => 'test-key',
  adapter: async () => { throw new Error('Not used by these tests.'); },
};

/** A Tacet with a connection that records every question and answers from `respond`; a throw is a provider failing. */
class AnsweringDecisions extends Decisions {
  constructor(private respond: (asked: Asked) => DecisionResponse | undefined) {
    super(connectedDependencies);
  }
  override async decide(state: DecisionState, questions: DecisionQuestions, maxLength = 1536): Promise<DecisionResponse | undefined> {
    return this.respond({ state, questions, maxLength });
  }
}

describe('a quiet schedule run that Tacet finds noteworthy (COD-303)', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let answer: string;
  let level: number;
  let asked: Asked[];
  /** How far the core's clock runs ahead of the real one, to age a run past Tacet's window. */
  let clockAhead: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-decisions-'));
    answer = 'The backup stopped at 02:03 with "disk full".';
    level = 1.3;
    asked = [];
    clockAhead = 0;
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ async request() {
      return { calls: [{ id: 'answer', name: 'reply', arguments: JSON.stringify({ message: answer, title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 0 } };
    } }), undefined, () => new Date(Date.now() + clockAhead));
    const worker = store.workspace().workers[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
  });
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  /** Tacet rates every answer `level` out of 2. */
  function connectStub() {
    core.decisions = new AnsweringDecisions(request => {
      asked.push(request);
      return { model: 'gpt-6-luna', answers: { attention: { type: 'score', score: level, probabilities: {}, confidence: 0.5, legend: {} } }, usage: { inputTokens: 40 } };
    });
  }
  function turnOff() {
    core.decisions = new Decisions({ ...connectedDependencies, saved: () => 'off' });
  }
  async function run(schedule: Schedule): Promise<Task> {
    const workerId = store.workspace().workers[0].id;
    const routine = await core.command('saveRoutine', { name: 'Backup check', enabled: true, schedule, task: { workerId, sourceIds: [], brief: 'Check last night\'s backup log.', consent: true, providerScopes: ['openai'], budgetMicros: 100_000 } }) as Routine;
    const taskId = await core.routines.runCalled(routine.id, []);
    for (let index = 0; index < 300 && core.runner.isActive(taskId); index++) await new Promise(resolve => setTimeout(resolve, 10));
    return store.get<Task>('tasks', taskId);
  }

  it('asks how much the answer needs the person, with the request, and marks a high one to announce', async () => {
    connectStub();
    const task = await run(hourly);
    expect(task.status).toBe('completed');
    await core.tick();
    const reviewed = store.get<Task>('tasks', task.id);
    expect(reviewed.attention).toMatchObject({ score: 0.65, notified: true });
    expect(asked).toHaveLength(1);
    expect(asked[0].questions).toEqual(NOTEWORTHY_QUESTION);
    expect(asked[0].state).toBe(quietRunState(task, answer));
    expect(asked[0].maxLength).toBe(512);
    // Looked at once: the next tick asks nothing again.
    await core.tick();
    expect(asked).toHaveLength(1);
  });

  it('records a routine answer as looked at without announcing it', async () => {
    level = 0.6;
    connectStub();
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toMatchObject({ score: 0.3, notified: false });
  });

  it('leaves a run alone once its answer is older than the window, so turning Tacet on never announces history', async () => {
    turnOff();
    const task = await run(hourly);
    clockAhead = 16 * 60_000;
    connectStub();
    await core.tick();
    expect(asked).toHaveLength(0);
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('changes nothing while Tacet is off', async () => {
    turnOff();
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('changes nothing with no connection: no key is saved and nothing was chosen', async () => {
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('keeps today\'s behaviour when the provider fails to answer, and gives up on a run after a few tries', async () => {
    core.decisions = new AnsweringDecisions(request => {
      asked.push(request);
      throw new Error('Nhà cung cấp lỗi.');
    });
    const task = await run(hourly);
    for (let tick = 0; tick < MAX_REVIEW_ATTEMPTS + 3; tick++) await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
    expect(asked).toHaveLength(MAX_REVIEW_ATTEMPTS);
  });

  it('leaves a daily schedule\'s run alone: it is announced anyway', async () => {
    connectStub();
    const task = await run(daily);
    await core.tick();
    expect(asked).toHaveLength(0);
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('keeps the verdict through a backup', async () => {
    connectStub();
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention?.notified).toBe(true);
    expect(core.backups.export()).toContain('"attention"');
  });

  it('forgets the chosen connection with Erase everything', async () => {
    const real = new CoreService(store, () => {}, async () => { throw new Error('unused'); });
    await real.command('saveTacetSetting', { connection: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(await real.command('tacetSetting', {})).toEqual({ setting: { connection: 'anthropic', model: 'claude-sonnet-5-5' }, chosen: true });
    await real.command('eraseData', { scope: 'everything', confirm: ERASE_CONFIRMATION });
    expect(await real.command('tacetSetting', {})).toEqual({ setting: 'off', chosen: false });
  });
});

describe('announcing a run Tacet flagged (COD-303)', () => {
  const routine = { id: 'office', name: 'Backup check', schedule: hourly } as Routine;
  const names: ChatNames = { workers: [{ id: 'researcher', name: 'Researcher' } as never], teams: [], routines: [routine] };
  const run = (id: string, attention?: Task['attention']): Task => ({
    id, status: 'completed', routineId: 'office', brief: 'Check the backup', workerId: 'researcher', createdAt: '2026-09-27T08:00:00.000Z', budgetMicros: 1000, sourceIds: [], consent: true, accepted: false, ...(attention ? { attention } : {}),
  });

  it('announces a verdict that arrived since the last look, once, and never an old or quiet one', () => {
    setLanguage('en');
    const flagged = run('flagged', { score: 0.8, notified: true, decidedAt: '2026-09-27T08:01:00.000Z' });
    const routineAnswer = run('routine', { score: 0.3, notified: false, decidedAt: '2026-09-27T08:01:00.000Z' });
    const old = run('old', { score: 0.9, notified: true, decidedAt: '2026-09-20T08:01:00.000Z' });
    const before = attendedRuns([run('flagged'), run('routine')]);
    expect(noteworthyRuns(before, [flagged, routineAnswer, old], '2026-09-27T07:59:00.000Z').map(task => task.id)).toEqual(['flagged']);
    expect(noteworthyRuns(attendedRuns([flagged]), [flagged], '2026-09-27T07:59:00.000Z')).toEqual([]);
    expect(noteworthyNotice(flagged, names)).toEqual({ taskId: 'flagged', text: 'Backup check has something new', tone: 'success', about: 'Researcher' });
    expect(noteworthyBackgroundNotice(flagged, names)).toEqual({ taskId: 'flagged', title: 'Backup check', body: 'Something new' });
  });

  it('dates the card\'s line only when the flag is from another day in the schedule\'s zone', () => {
    setLanguage('en');
    const now = new Date('2026-09-27T09:30:00Z');
    expect(flaggedWhen('2026-09-27T09:12:00Z', 'UTC', now)).toMatch(/^9:12\sAM$/);
    expect(flaggedWhen('2026-09-26T09:12:00Z', 'UTC', now)).toMatch(/^9\/26\/26, 9:12\sAM$/);
    // 23:30 in Ho Chi Minh City on the 26th is not today there, though it is in UTC.
    expect(flaggedWhen('2026-09-26T16:30:00Z', 'Asia/Ho_Chi_Minh', new Date('2026-09-26T17:30:00Z'))).toMatch(/^9\/26\/26/);
  });
});
