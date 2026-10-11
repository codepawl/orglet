import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { BudgetLedger } from '../../apps/desktop/src/core/budgets/ledger';
import { SKIPPED_PREVIOUS_RUNNING, Schedule, nextOccurrence, normalizedSchedule, runsPerDay, scheduleDay } from '../../apps/desktop/src/shared/schedule';
import type { Routine, RoutineToday, Task } from '../../apps/desktop/src/shared/contracts';
import { backgroundNotices, inAppNotice, quietRun, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { cadenceInWords } from '../../apps/desktop/src/renderer/scheduleWords';
import { setLanguage } from '../../apps/desktop/src/renderer/i18n';

const zone = 'Asia/Ho_Chi_Minh';
/** The renderer's language switch sets the page's lang; outside a page, a stand-in document takes it. */
function inVietnamese(check: () => void) {
  const host = globalThis as { document?: unknown };
  const hadDocument = 'document' in host;
  host.document ??= { documentElement: {} };
  try {
    setLanguage('vi');
    check();
  } finally {
    setLanguage('en');
    if (!hadDocument) delete host.document;
  }
}
const daily: Schedule = { timeZone: zone, time: '09:00', frequency: 'daily', weekday: 1 };
const hourly: Schedule = { timeZone: zone, time: '09:00', frequency: 'hours', weekday: 1, everyHours: 1 };
/** 100,000 input tokens at $0.40 per million: each run of the fake model settles 40,000 micros. */
const RUN_COST_MICROS = 40_000;

describe('hourly and weekday schedule math (COD-288)', () => {
  it('runs every few hours from midnight, or inside a window with an exclusive end', () => {
    const at = new Date('2026-01-05T01:59:50Z'); // Monday 08:59:50 in Ho Chi Minh City
    expect(nextOccurrence(hourly, at)).toBe('2026-01-05T02:00:00.000Z');
    expect(nextOccurrence({ ...hourly, everyHours: 4 }, at)).toBe('2026-01-05T05:00:00.000Z');
    expect(runsPerDay(hourly)).toBe(24);
    expect(runsPerDay({ ...hourly, everyHours: 3 })).toBe(8);
    const window = { ...hourly, window: { from: '09:00', to: '18:00' } };
    expect(runsPerDay(window)).toBe(9);
    expect(nextOccurrence(window, new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05T02:00:00.000Z');
    // 17:30 local: 18:00 is the end of the window, not a run, so the next is tomorrow at 09:00.
    expect(nextOccurrence(window, new Date('2026-01-05T10:30:00Z'))).toBe('2026-01-06T02:00:00.000Z');
    const halfPast = { ...hourly, everyHours: 2 as const, window: { from: '09:30', to: '12:00' } };
    expect(runsPerDay(halfPast)).toBe(2);
    expect(nextOccurrence(halfPast, new Date('2026-01-05T02:40:00Z'))).toBe('2026-01-05T04:30:00.000Z');
    expect(nextOccurrence({ ...hourly, timeZone: 'Asia/Kathmandu', window: { from: '09:00', to: '11:00' } }, new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05T03:15:00.000Z');
  });

  it('keeps weekday schedules and the weekdays-only switch to Monday through Friday', () => {
    const workdays: Schedule = { ...daily, frequency: 'weekdays' };
    expect(nextOccurrence(workdays, new Date('2026-01-09T01:00:00Z'))).toBe('2026-01-09T02:00:00.000Z');
    expect(nextOccurrence(workdays, new Date('2026-01-10T03:00:00Z'))).toBe('2026-01-12T02:00:00.000Z');
    const officeHours: Schedule = { ...hourly, window: { from: '09:00', to: '18:00' }, weekdaysOnly: true };
    // Friday 17:30 local, then the weekend is skipped.
    expect(nextOccurrence(officeHours, new Date('2026-01-09T10:30:00Z'))).toBe('2026-01-12T02:00:00.000Z');
  });

  it('skips the hour a daylight-saving change removes and runs the repeated hour once', () => {
    const newYork: Schedule = { ...hourly, timeZone: 'America/New_York' };
    // 2026-03-08: 02:00 local does not exist; after 01:30 EST the next run is 03:00 EDT.
    expect(nextOccurrence(newYork, new Date('2026-03-08T06:30:00Z'))).toBe('2026-03-08T07:00:00.000Z');
    // 2026-11-01: 01:00 happens twice; it runs at the first one only, then 02:00 EST.
    const runs: string[] = [];
    let after = new Date('2026-11-01T04:30:00Z');
    for (let index = 0; index < 3; index++) {
      const next = nextOccurrence(newYork, after);
      runs.push(next);
      after = new Date(next);
    }
    expect(runs).toEqual(['2026-11-01T05:00:00.000Z', '2026-11-01T07:00:00.000Z', '2026-11-01T08:00:00.000Z']);
    // A window in the same zone keeps its wall times across the change.
    const morning: Schedule = { ...newYork, everyHours: 2, window: { from: '08:00', to: '12:00' } };
    expect(nextOccurrence(morning, new Date('2026-03-07T18:00:00Z'))).toBe('2026-03-08T12:00:00.000Z');
    expect(nextOccurrence(morning, new Date('2026-03-06T18:00:00Z'))).toBe('2026-03-07T13:00:00.000Z');
  });

  it('refuses an hourly schedule without its interval, an interval that does not divide a day, and a window that ends before it starts', () => {
    expect(Schedule.safeParse({ ...daily, frequency: 'hours' }).success).toBe(false);
    expect(Schedule.safeParse({ ...hourly, everyHours: 5 }).success).toBe(false);
    expect(Schedule.safeParse({ ...hourly, window: { from: '18:00', to: '09:00' } }).success).toBe(false);
    expect(Schedule.safeParse({ ...hourly, window: { from: '09:00', to: '09:00' } }).success).toBe(false);
    expect(Schedule.safeParse({ ...hourly, window: { from: '09:00', to: '18:00' }, weekdaysOnly: true, dailyCapMicros: 2_000_000 }).success).toBe(true);
    // Switching back to daily drops what only an hourly schedule follows.
    expect(normalizedSchedule({ ...hourly, frequency: 'daily', window: { from: '09:00', to: '18:00' }, weekdaysOnly: true, dailyCapMicros: 5000 })).toEqual({ ...daily, dailyCapMicros: 5000 });
  });

  it('counts a day in the schedule\'s own time zone', () => {
    expect(scheduleDay(new Date('2026-01-05T16:30:00Z'), zone)).toBe('2026-01-05');
    expect(scheduleDay(new Date('2026-01-05T17:30:00Z'), zone)).toBe('2026-01-06');
  });
});

describe('the card names the cadence (COD-288)', () => {
  it('names the cadence in a few words', () => {
    setLanguage('en');
    expect(cadenceInWords(hourly)).toBe('Every hour');
    expect(cadenceInWords({ ...hourly, everyHours: 2, window: { from: '09:00', to: '18:00' }, weekdaysOnly: true })).toMatch(/^Every 2 hours, 9:00\sAM–6:00\sPM, weekdays only$/);
    expect(cadenceInWords({ ...daily, frequency: 'weekdays' })).toMatch(/^Weekdays at 9:00\sAM$/);
    inVietnamese(() => expect(cadenceInWords({ ...hourly, everyHours: 3 })).toBe('Mỗi 3 giờ'));
  });
});

describe('notices of an hourly schedule (COD-288)', () => {
  const office = { id: 'office', name: 'Inbox sweep', schedule: { ...hourly, window: { from: '09:00', to: '18:00' } } } as Routine;
  const morning = { id: 'morning', name: 'Morning note', schedule: daily } as Routine;
  const names: ChatNames = { workers: [{ id: 'researcher', name: 'Researcher' } as never], teams: [], routines: [office, morning], heldForReview: ['held'] };
  const run = (id: string, routineId: string, status: Task['status']): Task => ({
    id, status, routineId, brief: 'Sweep the inbox', workerId: 'researcher', createdAt: '2026-09-27T00:00:00.000Z', budgetMicros: 1000, sourceIds: [], consent: true, accepted: false,
  });

  it('keeps a quiet finished run off the toasts and the desktop, and still announces problems, waits and held changes', () => {
    const quiet = { task: run('quiet', 'office', 'completed'), outcome: 'done' as const };
    expect(quietRun(quiet, names)).toBe(true);
    expect(inAppNotice(quiet, names)).toBeUndefined();
    expect(backgroundNotices([quiet], names, true)).toEqual([]);
    const failed = { task: run('failed', 'office', 'failed'), outcome: 'needs_look' as const };
    const waiting = { task: run('waiting', 'office', 'waiting_input'), outcome: 'needs_you' as const };
    const held = { task: run('held', 'office', 'completed'), outcome: 'done' as const };
    for (const chat of [failed, waiting, held]) {
      expect(quietRun(chat, names)).toBe(false);
      expect(inAppNotice(chat, names)).toBeDefined();
    }
    expect(backgroundNotices([failed, waiting, held], names, true)).toHaveLength(3);
    // A daily schedule's run is still news every time.
    expect(inAppNotice({ task: run('daily', 'morning', 'completed'), outcome: 'done' }, names)?.text).toBe('Morning note is ready');
  });
});

describe('an hourly schedule and its daily cap, in the core (COD-288)', () => {
  let store: Store;
  let core: CoreService;
  let current: Date;
  let directory: string;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;

  beforeEach(async () => {
    current = new Date('2026-01-05T01:59:50Z');
    directory = await mkdtemp(join(tmpdir(), 'orglet-hourly-'));
    store = new Store(join(directory, 'state.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ async request() {
      if (gate) await gate;
      return { calls: [{ id: 'answer', name: 'reply', arguments: JSON.stringify({ message: 'Inbox swept.', title: null, knowledgeProposals: [] }) }], usage: { input: 100_000, output: 0 } };
    } }), undefined, () => current);
    const worker = store.workspace().workers[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
  });
  afterEach(async () => {
    release?.();
    await idle();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  function hold() {
    gate = new Promise<void>(resolve => { release = resolve; });
  }
  function letGo() {
    release?.();
    gate = undefined;
    release = undefined;
  }
  async function idle() {
    for (let index = 0; index < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); index++) await new Promise(resolve => setTimeout(resolve, 10));
  }
  async function save(schedule: Schedule, overrides: Record<string, unknown> = {}) {
    const workerId = store.workspace().workers[0].id;
    return await core.command('saveRoutine', { name: 'Inbox sweep', enabled: true, schedule, task: { workerId, sourceIds: [], brief: 'Sweep the inbox', consent: true, providerScopes: ['openai'], budgetMicros: 100_000 }, ...overrides }) as Routine;
  }
  const routineOf = (id: string) => store.get<Routine>('routines', id);
  const runsOf = (id: string) => store.all<Task>('tasks').filter(task => task.routineId === id);
  const today = async (id: string): Promise<RoutineToday> => (await core.command('workspace', {}) as { routineToday: Record<string, RoutineToday> }).routineToday[id];

  it('keeps the fingerprint of a daily or weekly schedule without a cap, and approves an hourly cadence and a cap', async () => {
    const plain = await save(daily);
    expect(plain.approvedConfig).toBe(core.routines.configuration(plain.task));
    expect(core.routines.configuration(plain.task, undefined, undefined, { ...daily, frequency: 'weekly', weekday: 3 })).toBe(plain.approvedConfig);
    const fingerprints = [
      plain.approvedConfig,
      core.routines.configuration(plain.task, undefined, undefined, hourly),
      core.routines.configuration(plain.task, undefined, undefined, { ...hourly, everyHours: 2 }),
      core.routines.configuration(plain.task, undefined, undefined, { ...hourly, window: { from: '09:00', to: '18:00' } }),
      core.routines.configuration(plain.task, undefined, undefined, { ...daily, frequency: 'weekdays' }),
      core.routines.configuration(plain.task, undefined, undefined, { ...daily, dailyCapMicros: 200_000 }),
    ];
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    // A row changed without a save, as a hand edit or an old backup could, does not run until it is saved again.
    const capped = await save({ ...hourly, dailyCapMicros: 300_000 }, { name: 'Capped' });
    const { dailyCapMicros: _cap, ...uncapped } = capped.schedule;
    store.update('routines', { ...capped, schedule: uncapped });
    await expect(core.routines.runCalled(capped.id, [])).rejects.toThrow('lưu lại quyền chạy');
    store.update('routines', { ...capped, schedule: { ...capped.schedule, everyHours: 2 } });
    await expect(core.routines.runCalled(capped.id, [])).rejects.toThrow('lưu lại quyền chạy');
    expect(runsOf(capped.id)).toHaveLength(0);
  });

  it('saves a small daily cap, because a run has no limit of its own to sit below it', async () => {
    const routine = await save({ ...hourly, dailyCapMicros: 50_000 });
    expect(routine.schedule.dailyCapMicros).toBe(50_000);
  });

  it('never skips or stops a run for money, however far the day has gone past a saved daily cap', async () => {
    const routine = await save({ ...hourly, dailyCapMicros: 70_000 });
    for (let attempt = 0; attempt < 3; attempt++) {
      await core.routines.runCalled(routine.id, []);
      await idle();
    }
    expect(runsOf(routine.id).map(task => task.status)).toEqual(['completed', 'completed', 'completed']);
    expect(await today(routine.id)).toEqual({ day: '2026-01-05', runs: 3, spentMicros: 3 * RUN_COST_MICROS });
    expect(routineOf(routine.id).notice).toBeUndefined();
  });

  it('does not refuse a request inside a run because the day passed the saved daily cap', async () => {
    const routine = await save({ ...hourly, dailyCapMicros: 150_000 });
    await core.routines.runCalled(routine.id, []);
    await idle();
    const [task] = runsOf(routine.id);
    const runId = store.detail(task.id).runs[0].id;
    const ledger = new BudgetLedger(store);
    expect(() => ledger.reserve(runId, task.id, 'openai', 120_000)).not.toThrow();
  });

  it('skips an hour while the previous run is still going, says so once, and runs again once it ends', async () => {
    const routine = await save(hourly);
    hold();
    await core.tick();
    current = new Date('2026-01-05T02:00:00Z');
    await core.tick();
    expect(runsOf(routine.id)).toHaveLength(1);
    current = new Date('2026-01-05T02:59:58Z');
    await core.tick();
    current = new Date('2026-01-05T03:00:00Z');
    await core.tick();
    const skipped = routineOf(routine.id);
    expect(runsOf(routine.id)).toHaveLength(1);
    expect(skipped.notice?.reason).toBe(SKIPPED_PREVIOUS_RUNNING);
    expect(skipped.pending).toBeNull();
    expect(skipped.nextDueAt).toBe('2026-01-05T04:00:00.000Z');
    current = new Date('2026-01-05T03:59:58Z');
    await core.tick();
    current = new Date('2026-01-05T04:00:00Z');
    await core.tick();
    expect(routineOf(routine.id).notice).toEqual(skipped.notice);
    letGo();
    await idle();
    current = new Date('2026-01-05T04:59:58Z');
    await core.tick();
    current = new Date('2026-01-05T05:00:00Z');
    await core.tick();
    await idle();
    expect(runsOf(routine.id)).toHaveLength(2);
    expect(routineOf(routine.id).notice).toBeUndefined();
  });

  it('keeps one catch-up for the hours missed while closed, and the next on-time run replaces it', async () => {
    const routine = await save(hourly);
    current = new Date('2026-01-05T06:30:00Z'); // opened after four missed hours
    await core.tick();
    expect(routineOf(routine.id).pending?.dueAt).toBe('2026-01-05T02:00:00.000Z');
    expect(runsOf(routine.id)).toHaveLength(0);
    current = new Date('2026-01-05T06:59:58Z');
    await core.tick();
    current = new Date('2026-01-05T07:00:00Z');
    await core.tick();
    await idle();
    expect(runsOf(routine.id)).toHaveLength(1);
    expect(routineOf(routine.id).pending).toBeNull();
  });
});
