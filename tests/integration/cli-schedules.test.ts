import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseArguments, UsageError } from '../../apps/desktop/src/cli/arguments';
import type { ChatActionClient, ChatClient } from '../../apps/desktop/src/cli/chat-client';
import { runInteractive } from '../../apps/desktop/src/cli/interactive';
import { formatSchedules } from '../../apps/desktop/src/cli/output';
import { CliRequest, type ListValue, type SchedulesValue, type ScheduleValue } from '../../apps/desktop/src/cli/protocol';
import { parseSlash } from '../../apps/desktop/src/cli/slash';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { createCliToken } from '../../apps/desktop/src/main/cli-server';
import type { Routine, Workspace } from '../../apps/desktop/src/shared/contracts';

/** Schedules from the terminal (COD-354): list, on and off, delete, and create or edit without desktop-only settings. */

const researcherId = '11111111-1111-4111-8111-111111111111';
const writerId = '22222222-2222-4222-8222-222222222222';
const crewId = '33333333-3333-4333-8333-333333333333';
const routineId = '55555555-5555-4555-8555-555555555555';
const folderId = '66666666-6666-4666-8666-666666666666';
const token = createCliToken();

function routine(extra: Partial<Routine> = {}): Routine {
  return {
    id: routineId, name: 'Morning review', enabled: true, revision: 2, approvedConfig: '{}', nextDueAt: '2026-10-02T01:00:00.000Z', pending: null,
    schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '08:00', frequency: 'daily', weekday: 1 },
    trigger: { kind: 'schedule' },
    task: { workerId: researcherId, brief: 'Review yesterday', sourceIds: [], excludedSources: [], consent: true, providerScopes: ['openai'], budgetMicros: 500_000 },
    ...extra,
  } as Routine;
}

function fakeCore(options: { consent?: string[]; routines?: Routine[] } = {}) {
  const calls: { command: string; args: unknown }[] = [];
  const workspace = {
    workers: [{ id: researcherId, name: 'Researcher', provider: 'openai' }, { id: writerId, name: 'Writer', provider: 'anthropic' }, { id: '77777777-7777-4777-8777-777777777777', name: 'Sampler', provider: 'demo' }],
    teams: [{ id: crewId, name: 'Review crew', memberIds: [researcherId], synthesizerId: writerId }],
    tasks: [],
    routines: options.routines ?? [routine()],
    routineToday: { [routineId]: { day: '2026-10-01', runs: 1, spentMicros: 120_000 } },
    providerConsent: options.consent ?? ['openai'],
  } as unknown as Workspace;
  const request = async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === 'workspace') return workspace;
    if (command === 'saveRoutine') return { ...routine(), ...(args as object), id: (args as { id?: string }).id ?? routineId, nextDueAt: '2026-10-02T01:00:00.000Z' };
    return undefined;
  };
  const operations = new CliOperations({ request, version: () => '1', open: () => undefined, translate: message => message });
  const signal = new AbortController().signal;
  const saved = () => calls.find(call => call.command === 'saveRoutine')?.args as Record<string, unknown> | undefined;
  return { calls, operations, signal, saved };
}

describe('orglet schedule arguments', () => {
  it('parses add, edit, on, off and delete with timing and limits in USD', () => {
    expect(parseArguments(['schedule', 'add', 'Morning review', '--to', 'Researcher', '--brief', 'Review yesterday', '--every', 'weekly', '--day', 'friday', '--at', '8:30', '--timezone', 'Europe/Berlin', '--budget', '0.5', '--daily-cap', '$2'])).toEqual({
      kind: 'schedule-save',
      fields: { name: 'Morning review', target: 'Researcher', brief: 'Review yesterday', frequency: 'weekly', time: '08:30', weekday: 5, timeZone: 'Europe/Berlin', budgetMicros: 500_000, dailyCapMicros: 2_000_000 },
      json: false,
    });
    expect(parseArguments(['schedule', 'add', 'Ping', '--to', 'R', '--brief', 'b', '--every', '2h', '--at', '09:00', '--budget', '0.01', '--called', '--off'])).toMatchObject({ fields: { frequency: 'hours', everyHours: 2, trigger: 'called', enabled: false } });
    expect(parseArguments(['schedule', 'edit', 'Morning review', '--rename', 'Evening review', '--at', '18:00'])).toEqual({ kind: 'schedule-save', schedule: 'Morning review', fields: { name: 'Evening review', time: '18:00' }, json: false });
    expect(parseArguments(['schedule', 'off', 'Morning review'])).toEqual({ kind: 'schedule-enable', schedule: 'Morning review', enabled: false, json: false });
    expect(parseArguments(['schedule', 'delete', 'Morning review', '--confirm', 'Morning review'])).toEqual({ kind: 'schedule-delete', schedule: 'Morning review', confirmName: 'Morning review', json: false });
    expect(parseArguments(['schedules', '--json'])).toEqual({ kind: 'schedules', json: true });
  });

  it('refuses mistakes as usage errors', () => {
    const mistakes = [['schedule'], ['schedule', 'make', 'X'], ['schedule', 'add'], ['schedule', 'on', 'X', '--at', '08:00'], ['schedule', 'delete', 'X'],
      ['schedule', 'add', 'X', '--every', '5h'], ['schedule', 'add', 'X', '--at', '25:00'], ['schedule', 'add', 'X', '--day', 'someday'], ['schedule', 'add', 'X', '--budget', '0.0001'],
      ['schedule', 'add', 'X', '--budget', '101'], ['schedule', 'add', 'X', '--rename', 'Y'], ['schedule', 'edit', 'X', '--off'], ['list', '--brief', 'x'], ['schedule', 'add', 'X', 'extra']];
    for (const mistake of mistakes) expect(() => parseArguments(mistake), mistake.join(' ')).toThrow(UsageError);
    expect(parseSlash('/schedule on Morning review')).toEqual({ kind: 'schedule', action: 'on', name: 'Morning review' });
    expect(parseSlash('/schedule add X').kind).toBe('usage');
  });
});

describe('orglet schedules in the app', () => {
  it('lists schedules with their timing, limits and today', async () => {
    const core = fakeCore();
    const value = await core.operations.run({ op: 'schedules', token }, core.signal) as SchedulesValue;
    expect(value.schedules).toEqual([{ id: routineId, name: 'Morning review', enabled: true, target: 'Researcher', trigger: 'schedule', frequency: 'daily', time: '08:00', weekday: 1, timeZone: 'Asia/Ho_Chi_Minh', nextDueAt: '2026-10-02T01:00:00.000Z', budgetMicros: 500_000, runsToday: 1, spentTodayMicros: 120_000 }]);
    expect(formatSchedules(value)).toBe('  Morning review  on  Researcher  daily at 08:00 (Asia/Ho_Chi_Minh)  $0.50 per run');
  });

  it('switches a schedule off the way its card does, and deletes only with its exact name', async () => {
    const core = fakeCore();
    await core.operations.run({ op: 'schedule-enable', token, schedule: 'morning', enabled: false }, core.signal);
    expect(core.saved()).toEqual({ id: routineId, name: 'Morning review', enabled: false, schedule: routine().schedule, trigger: { kind: 'schedule' }, task: routine().task });
    await expect(core.operations.run({ op: 'schedule-delete', token, schedule: 'morning', confirmName: 'morning' }, core.signal)).rejects.toThrow('Morning review');
    await core.operations.run({ op: 'schedule-delete', token, schedule: 'morning', confirmName: 'Morning review' }, core.signal);
    expect(core.calls.find(call => call.command === 'deleteRoutine')?.args).toEqual({ id: routineId });
  });

  it('creates a schedule with only the allowed fields and the providers already allowed in Settings', async () => {
    const core = fakeCore();
    const value = await core.operations.run({ op: 'schedule-save', token, name: 'Weekly notes', target: 'res', brief: 'Sum up the week', frequency: 'weekly', time: '17:00', weekday: 5, timeZone: 'Europe/Berlin', budgetMicros: 300_000 }, core.signal) as ScheduleValue;
    expect(core.saved()).toEqual({
      name: 'Weekly notes', enabled: true,
      schedule: { timeZone: 'Europe/Berlin', time: '17:00', frequency: 'weekly', weekday: 5 },
      trigger: { kind: 'schedule' },
      task: { workerId: researcherId, brief: 'Sum up the week', sourceIds: [], excludedSources: [], consent: true, providerScopes: ['openai'], budgetMicros: 300_000 },
    });
    expect(value.schedule.name).toBe('Weekly notes');
    await core.operations.run({ op: 'schedule-save', token, name: 'Samples', target: 'Sampler', brief: 'b', frequency: 'daily', time: '07:00', budgetMicros: 1000 }, core.signal);
    expect((core.calls.at(-1)!.args as { task: { consent: boolean; providerScopes: string[] } }).task).toMatchObject({ consent: false, providerScopes: [] });
  });

  it('refuses a schedule whose providers the desktop has not allowed, and one missing what it needs', async () => {
    const core = fakeCore();
    await expect(core.operations.run({ op: 'schedule-save', token, name: 'Crew job', target: 'Review crew', brief: 'b', frequency: 'daily', time: '07:00', budgetMicros: 1000 }, core.signal)).rejects.toThrow('anthropic');
    await expect(core.operations.run({ op: 'schedule-save', token, name: 'No timing', target: 'res', brief: 'b', budgetMicros: 1000 }, core.signal)).rejects.toThrow('--at');
    expect(core.saved()).toBeUndefined();
    // No permission, browser, folder, source or consent field can be sent at all.
    for (const extra of [{ toolCapabilities: ['web'] }, { browser: { profileId: 'clean' } }, { workspace: { folderId } }, { consent: true }, { providerScopes: ['anthropic'] }, { sourceIds: [] }, { trigger: 'folder' }]) {
      expect(CliRequest.safeParse({ op: 'schedule-save', token, name: 'X', ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('edits only the given fields, keeps desktop-only settings, and refuses to move such a schedule', async () => {
    const core = fakeCore({ consent: ['openai', 'anthropic'] });
    await core.operations.run({ op: 'schedule-save', token, schedule: 'morning', time: '09:15', brief: 'Review today', dailyCapMicros: 2_000_000 }, core.signal);
    expect(core.saved()).toEqual({
      id: routineId, name: 'Morning review', enabled: true,
      schedule: { ...routine().schedule, time: '09:15', dailyCapMicros: 2_000_000 },
      trigger: { kind: 'schedule' },
      task: { ...routine().task, brief: 'Review today' },
    });
    const moved = fakeCore({ consent: ['openai', 'anthropic'] });
    await moved.operations.run({ op: 'schedule-save', token, schedule: 'morning', target: 'Review crew' }, moved.signal);
    expect((moved.saved() as { task: object }).task).toEqual({ ...routine().task, workerId: writerId, teamId: crewId, consent: true, providerScopes: ['openai', 'anthropic'] });
    const watched = routine({ trigger: { kind: 'folder', folderId, folderName: 'Inbox' }, task: { ...routine().task, toolCapabilities: ['network.web'] } });
    const guarded = fakeCore({ consent: ['openai', 'anthropic'], routines: [watched] });
    await expect(guarded.operations.run({ op: 'schedule-save', token, schedule: 'morning', target: 'Writer' }, guarded.signal)).rejects.toThrow('Đổi người làm trong app');
    await guarded.operations.run({ op: 'schedule-save', token, schedule: 'morning', time: '07:00' }, guarded.signal);
    expect(guarded.saved()).toMatchObject({ trigger: { kind: 'folder', folderId }, task: { toolCapabilities: ['network.web'] } });
  });
});

const list: ListValue = { orglets: [{ name: 'Researcher', provider: 'openai', providerId: 'openai', color: '#4f7fe0' }], crews: [] };

async function notUsed(): Promise<never> {
  throw new Error('Not used in this test.');
}

describe('orglet chat session schedules', () => {
  it('lists schedules, switches one and runs one', async () => {
    const calls: string[] = [];
    const row = { id: routineId, name: 'Morning review', enabled: true, target: 'Researcher', trigger: 'schedule' as const, frequency: 'daily' as const, time: '08:00', weekday: 1, timeZone: 'UTC', nextDueAt: '2026-10-02T08:00:00.000Z', budgetMicros: 500_000 };
    const actions: ChatActionClient = {
      history: notUsed, reply: notUsed, react: notUsed, forward: notUsed, control: notUsed, answer: notUsed,
      chats: notUsed, side: notUsed, bring: notUsed, channel: notUsed, members: notUsed, rename: notUsed, archive: notUsed,
      schedules: async () => ({ schedules: [row] }),
      enableSchedule: async (name, enabled) => {
        calls.push(`enable ${name} ${enabled}`);
        return { schedule: { ...row, enabled } };
      },
      search: notUsed, running: notUsed, memories: notUsed, usage: notUsed, models: notUsed, preferences: notUsed,
      runSchedule: async name => {
        calls.push(`run ${name}`);
        return { schedule: { id: routineId, name: 'Morning review' }, taskId: 't' };
      },
    };
    const client: ChatClient = { list: async () => list, send: notUsed, read: notUsed, open: notUsed, actions };
    const input = new PassThrough();
    let transcript = '';
    const output = new Writable({ write(chunk, _encoding, callback) { transcript += chunk.toString(); callback(); } });
    const running = runInteractive({ input, output, client, mode: 'none', version: '9.9.9', terminal: false, to: 'Researcher' });
    input.end('/schedules\n/schedule off Morning review\n/schedule run Morning review\n/exit\n');
    expect(await running).toBe(0);
    expect(calls).toEqual(['enable Morning review false', 'run Morning review']);
    expect(transcript).toContain('Morning review  on  Researcher  daily at 08:00 (UTC)  $0.50 per run');
    expect(transcript).toContain('Switched off the schedule Morning review.');
    expect(transcript).toContain('Started Morning review.');
  });
});
