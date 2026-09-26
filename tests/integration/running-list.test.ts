import { describe, expect, it } from 'vitest';
import type { Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { RunProgressUpdate } from '../../apps/desktop/src/shared/progress';
import { runningCount, waitingForPersonCount, type RunningItem } from '../../apps/desktop/src/shared/running';
import { rememberCustomConnections } from '../../apps/desktop/src/renderer/customConnections';
import { elapsedShort, footerCount, runningButtonLabel, runningChatName, runningControls, runningGroups, runningMeta, runningStatusLine, waitLine } from '../../apps/desktop/src/renderer/runningList';

/* COD-244: how the Running view turns the core's list into sections, lines and controls. */

const worker = { id: 'minh', name: 'Minh', provider: 'claude-code' } as Worker;

function item(overrides: Partial<RunningItem>): RunningItem {
  return { key: overrides.runId ?? 'run', runId: 'run', taskId: 'task', state: 'running', worker, provider: 'claude-code', ...overrides };
}

function progressOf(runId: string, target: string): RunProgressUpdate {
  return { taskId: 'task', runId, startedAt: 0, progress: { thinking: '', preamble: '', activity: [{ id: 'step', kind: 'read', target, done: false }], answer: '', writing: false } };
}

describe('runningGroups', () => {
  it('keeps the core order inside each section and leaves out the empty ones', () => {
    const running = item({ runId: 'a', key: 'a' });
    const pausing = item({ runId: 'b', key: 'b', state: 'pausing' });
    const queued = item({ runId: 'c', key: 'c', state: 'queued', wait: { kind: 'provider', provider: 'claude-code', ahead: 0 } });
    const budget = item({ runId: 'd', key: 'd', state: 'queued', wait: { kind: 'budget' } });
    // A chat stopped at its budget goes on only once the person raises the limit, so it waits for them (COD-287).
    expect(runningGroups([running, pausing, queued, budget]).map(group => [group.id, group.items.map(entry => entry.key)])).toEqual([
      ['running', ['a', 'b']],
      ['queued', ['c']],
      ['paused', ['d']],
    ]);
    expect(runningGroups([])).toEqual([]);
    const approval = item({ runId: 'e', key: 'e', state: 'paused', wait: { kind: 'approval', tool: 'search', server: 'Docs' } });
    expect(runningGroups([approval]).map(group => group.id)).toEqual(['paused']);
  });

  it('counts on the footer only what is under way or will start by itself', () => {
    const items = [
      item({ key: 'a' }),
      item({ key: 'b', state: 'queued', wait: { kind: 'crew_slot', ahead: 1 } }),
      item({ key: 'c', state: 'queued', wait: { kind: 'budget' } }),
      item({ key: 'd', state: 'paused' }),
    ];
    expect(runningCount(items)).toBe(2);
  });

  it('counts what waits for the person apart, the same items the Waiting for you section lists (COD-287)', () => {
    const items = [
      item({ key: 'a' }),
      item({ key: 'b', state: 'pausing' }),
      item({ key: 'c', state: 'queued', wait: { kind: 'crew_slot', ahead: 1 } }),
      item({ key: 'd', state: 'queued', wait: { kind: 'budget' } }),
      item({ key: 'e', state: 'paused' }),
      item({ key: 'f', state: 'paused', wait: { kind: 'answer' } }),
      item({ key: 'g', state: 'paused', wait: { kind: 'approval', tool: 'search', server: 'Docs' } }),
    ];
    expect(waitingForPersonCount(items)).toBe(4);
    expect(runningCount(items) + waitingForPersonCount(items)).toBe(items.length);
    const waitingSection = runningGroups(items).find(group => group.id === 'paused');
    expect(waitingSection?.items.length).toBe(waitingForPersonCount(items));
    expect(waitingForPersonCount([])).toBe(0);
  });

  it('names both counts on the footer button for a screen reader, each only when there is one', () => {
    expect(runningButtonLabel(0, 0)).toBe('Running');
    expect(runningButtonLabel(2, 0)).toBe('Running: 2');
    expect(runningButtonLabel(0, 1)).toBe('Running: 1 waiting for you');
    expect(runningButtonLabel(2, 1)).toBe('Running: 2, 1 waiting for you');
    expect(footerCount(7)).toBe('7');
    expect(footerCount(120)).toBe('99+');
  });
});

describe('runningControls', () => {
  it('offers pause only while working, resume only when stopped, and stop for anything running or in line', () => {
    expect(runningControls(item({}))).toEqual({ pause: true, resume: false, stop: true });
    expect(runningControls(item({ state: 'pausing' }))).toEqual({ pause: false, resume: false, stop: true });
    expect(runningControls(item({ state: 'queued', wait: { kind: 'provider', provider: 'codex', ahead: 2 } }))).toEqual({ pause: false, resume: false, stop: true });
    expect(runningControls(item({ state: 'queued', wait: { kind: 'budget' } }))).toEqual({ pause: false, resume: true, stop: false });
    expect(runningControls(item({ state: 'paused' }))).toEqual({ pause: false, resume: true, stop: false });
    expect(runningControls(item({ state: 'paused', wait: { kind: 'approval', tool: 'search', server: 'Docs' } }))).toEqual({ pause: false, resume: false, stop: false });
    expect(runningControls(item({ state: 'paused', wait: { kind: 'answer' } }))).toEqual({ pause: false, resume: false, stop: false });
  });
});

describe('status lines', () => {
  it('words a working run with the step it streams, or with what the core recorded', () => {
    expect(runningStatusLine(item({}), progressOf('run', 'invoice.xlsx'))).toBe('Reading invoice.xlsx…');
    expect(runningStatusLine(item({ lastEvent: 'Đã đọc brief.md' }), undefined)).toBe('Reading brief.md…');
    expect(runningStatusLine(item({ stage: 'plan' }), undefined)).toBe('Assigning work…');
    expect(runningStatusLine(item({ state: 'pausing' }), progressOf('run', 'invoice.xlsx'))).toBe('Stopping after this step…');
    expect(runningStatusLine(item({ lastEvent: 'Đang gọi model · bước 1/6' }), undefined)).toBe('Thinking…');
  });

  it('says why a run waits and where it stands in line', () => {
    expect(waitLine({ kind: 'provider', provider: 'claude-code', ahead: 2 })).toBe('Waiting for Claude Code · 2 ahead');
    expect(waitLine({ kind: 'provider', provider: 'openai', ahead: 0 })).toBe('Waiting for OpenAI · next in line');
    expect(waitLine({ kind: 'crew_slot', ahead: 1 })).toBe('Waiting for a crew slot · 1 ahead');
    expect(waitLine({ kind: 'teammates', names: ['Lan', 'Huy'] })).toBe('Waiting for results from Lan, Huy');
    expect(waitLine({ kind: 'budget' })).toBe('Waiting for budget · raise the limit, then resume');
    // A custom connection is named by the person's name for it, and Gemini CLI like any other harness.
    const connectionId = '6f1c1c5e-8d4b-4a36-9f7e-2a8a4f7f2b11';
    rememberCustomConnections([{ id: connectionId, name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' }]);
    expect(waitLine({ kind: 'provider', provider: `custom:${connectionId}`, ahead: 1 })).toBe('Waiting for LM Studio · 1 ahead');
    expect(runningMeta(item({ provider: `custom:${connectionId}`, cost: null }), 0)).toEqual({ elapsed: undefined, cost: 'Cost unknown', provider: 'LM Studio' });
    expect(waitLine({ kind: 'provider', provider: 'gemini', ahead: 0 })).toBe('Waiting for Gemini CLI · next in line');
    rememberCustomConnections([]);
    expect(runningStatusLine(item({ state: 'paused', pauseReason: 'shift' }), undefined)).toBe('Paused at the end of the crew’s work hours');
    expect(runningStatusLine(item({ state: 'queued' }), undefined)).toBe('Starting…');
    expect(runningStatusLine(item({ state: 'paused', wait: { kind: 'approval', tool: 'search', server: 'Docs' } }), undefined)).toBe('Waiting for you to allow the MCP tool: search · Docs');
    expect(runningStatusLine(item({ state: 'paused', wait: { kind: 'answer' } }), undefined)).toBe('Waiting for your answer to the orglet’s question');
  });
});

describe('runningChatName', () => {
  const tasks = [
    { id: 'crew-chat', brief: 'Review', teamId: 'crew' },
    { id: 'titled', brief: 'Long brief\nsecond line', title: 'Invoices' },
    { id: 'untitled', brief: 'Summarise the contract\nplease' },
  ] as Task[];
  const teams = [{ id: 'crew', name: 'Review crew' }] as Team[];

  it('names a crew chat by its crew and any other chat by its title or first line', () => {
    expect(runningChatName(item({ taskId: 'crew-chat' }), tasks, teams)).toBe('Review crew');
    expect(runningChatName(item({ taskId: 'titled' }), tasks, teams)).toBe('Invoices');
    expect(runningChatName(item({ taskId: 'untitled' }), tasks, teams)).toBe('Summarise the contract');
    expect(runningChatName(item({ taskId: 'gone' }), tasks, teams)).toBe('');
  });
});

describe('runningMeta', () => {
  it('shows cost only for working runs, keeps an unknown cost unknown and a floor a floor', () => {
    const since = 1_000;
    expect(runningMeta(item({ since, cost: { micros: 1_250_000, atLeast: false } }), since + 65_000)).toEqual({ elapsed: '1m 05s', cost: '$1.25', provider: 'Claude Code' });
    expect(runningMeta(item({ since, cost: null }), since + 5_000).cost).toBe('Cost unknown');
    expect(runningMeta(item({ since, cost: { micros: 20_000, atLeast: true } }), since).cost).toBe('At least $0.02');
    expect(runningMeta(item({ state: 'queued', since, cost: { micros: 5, atLeast: false } }), since + 3_000)).toEqual({ elapsed: '3s', provider: 'Claude Code' });
    expect(runningMeta(item({ provider: 'demo', cost: { micros: 0, atLeast: false } }), 0)).toEqual({ elapsed: undefined, cost: '$0.00', provider: 'Demo' });
  });

  it('keeps the clock short and steady in width', () => {
    expect(elapsedShort(0)).toBe('0s');
    expect(elapsedShort(59_999)).toBe('59s');
    expect(elapsedShort(3_599_000)).toBe('59m 59s');
    expect(elapsedShort(3_600_000 + 7 * 60_000)).toBe('1h 07m');
  });
});
