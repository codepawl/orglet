import { expect, it } from 'vitest';
import { islandBeforeStreaming, islandOf, liveRunOf, runEventMessage, runStepLine, withBrowserControls, workingWorkers } from '../../apps/desktop/src/renderer/components/LiveRun';
import type { BrowserApprovalView, BrowserLive } from '../../apps/desktop/src/shared/browser';
import type { Activity, Run, Worker } from '../../apps/desktop/src/shared/contracts';
import { emptyProgress, type ActivityStep, type RunProgressUpdate } from '../../apps/desktop/src/shared/progress';

function run(id: string, stage?: Run['stage']): Run {
  return { id, stage } as Run;
}

function update(runId: string, answer: string): RunProgressUpdate {
  return {
    taskId: 'task',
    runId,
    startedAt: Date.now(),
    progress: { thinking: '', preamble: '', activity: [], answer, writing: true },
  };
}

const worker = { id: 'worker', name: 'Minh' } as Worker;
const other = { id: 'other', name: 'Lan' } as Worker;
const third = { id: 'third', name: 'Huy' } as Worker;

/** A run by `by` in the state the core reports. */
function runOf(id: string, by: Worker, status: Run['status'], stage?: Run['stage']): Run {
  return { id, stage, status, snapshot: { worker: by } } as Run;
}

it('shows the streaming run of a worker chat, which has no synthesis run', () => {
  const worker = run('worker-run');
  const live = liveRunOf([worker], { 'worker-run': update('worker-run', 'Payment terms') });
  expect(live?.run.id).toBe('worker-run');
  expect(live?.update.progress?.answer).toBe('Payment terms');
});

it('prefers the synthesis run when a team is writing its answer', () => {
  const member = run('member-run', 'member');
  const synthesis = run('synthesis-run', 'synthesis');
  const updates = {
    'member-run': update('member-run', 'Member notes'),
    'synthesis-run': update('synthesis-run', 'Combined answer'),
  };
  expect(liveRunOf([member, synthesis], updates)?.run.id).toBe('synthesis-run');
});

it('falls back to a member while the synthesis run has not started streaming', () => {
  const member = run('member-run', 'member');
  const synthesis = run('synthesis-run', 'synthesis');
  expect(liveRunOf([member, synthesis], { 'member-run': update('member-run', 'Member notes') })?.run.id).toBe('member-run');
});

it('shows nothing when no run of the turn is streaming', () => {
  expect(liveRunOf([run('a'), run('b')], {})).toBeUndefined();
  expect(liveRunOf([run('a')], { 'other-task-run': update('other-task-run', 'x') })).toBeUndefined();
});

it('names the workers whose runs are streaming or reported running, each once, and never a finished or queued one', () => {
  const runs = [
    runOf('plan', worker, 'completed', 'plan'),
    runOf('member-a', other, 'running', 'member'),
    runOf('member-b', third, 'queued', 'member'),
    runOf('member-c', worker, 'running', 'member'),
    runOf('member-d', worker, 'running', 'member'),
  ];
  const updates = { 'member-b': update('member-b', 'streaming already') };
  expect(workingWorkers(runs, updates).map(item => item.name)).toEqual(['Lan', 'Huy', 'Minh']);
  expect(workingWorkers(runs, {}).map(item => item.name)).toEqual(['Lan', 'Minh']);
  expect(workingWorkers([runOf('queued', worker, 'queued')], {})).toEqual([]);
});

function step(kind: ActivityStep['kind'], target: string, done: boolean): ActivityStep {
  return { id: `${kind}-${target}-${done}`, kind, target, done };
}

it('names the worker and the file being read and, one beat behind, the last step that finished', () => {
  const progress = { ...emptyProgress(), activity: [step('read', 'contract.pdf', true), step('read', 'invoice.xlsx', false)] };
  const island = islandOf(progress, false, [worker]);
  expect(island.state).toBe('reading');
  expect(island.label).toBe('Minh is reading invoice.xlsx…');
  expect(island.receipt).toBe('Read contract.pdf');
  expect(island.workers).toEqual([worker]);
});

it('is thinking between steps, with the receipt kept', () => {
  const progress = { ...emptyProgress(), activity: [step('search', 'total', true)] };
  const island = islandOf(progress, false, [worker]);
  expect(island.state).toBe('thinking');
  expect(island.label).toBe('Minh is thinking…');
  expect(island.receipt).toBe('Searched total');
});

it('never names the tool behind a step that is not a read, search or list', () => {
  const progress = { ...emptyProgress(), activity: [step('other', 'Bash', true), step('other', 'WebFetch', false)] };
  const island = islandOf(progress, false, [worker]);
  expect(island.state).toBe('tool');
  expect(island.label).not.toContain('WebFetch');
  expect(island.receipt).not.toContain('Bash');
});

it('lets writing and pausing win over an open step', () => {
  const activity = [step('read', 'notes.md', false)];
  expect(islandOf({ ...emptyProgress(), activity, writing: true }, false, [worker]).state).toBe('writing');
  expect(islandOf({ ...emptyProgress(), activity }, true, [worker]).state).toBe('pausing');
});

it('gives a provider that reports no steps a thinking island with an empty receipt line', () => {
  const island = islandOf(emptyProgress(), false, [worker]);
  expect(island.state).toBe('thinking');
  expect(island.receipt).toBe('');
});

it('counts several workers in their own sentence, keeps their faces and the state of the run shown', () => {
  const progress = { ...emptyProgress(), activity: [step('read', 'invoice.xlsx', false)] };
  const island = islandOf(progress, false, [worker, other, third]);
  expect(island.label).toBe('3 orglets are working…');
  expect(island.state).toBe('reading');
  expect(island.workers.map(item => item.name)).toEqual(['Minh', 'Lan', 'Huy']);
  expect(islandBeforeStreaming({ workers: [worker, other], stage: 'member', pausing: false }).label).toBe('2 orglets are working…');
});

it('says pausing without a name, since it is the task that stops', () => {
  expect(islandOf(emptyProgress(), true, [worker]).label).toBe('Stopping after this step…');
  expect(islandOf(emptyProgress(), true, [worker, other]).label).toBe('Stopping after this step…');
});

it('names what the core itself observed before anything has streamed, with no receipt', () => {
  expect(islandBeforeStreaming({ workers: [worker], pausing: false })).toEqual({ state: 'thinking', label: 'Minh is thinking…', named: { before: '', name: 'Minh', after: ' is thinking…' }, workers: [worker] });
  expect(islandBeforeStreaming({ workers: [worker], stage: 'plan', pausing: false }).label).toBe('Minh is assigning work…');
  expect(islandBeforeStreaming({ workers: [worker], stage: 'member', pausing: false }).label).toBe('Working with Minh…');
  expect(islandBeforeStreaming({ workers: [worker], stage: 'synthesis', pausing: false }).label).toBe('Minh is combining…');
  expect(islandBeforeStreaming({ workers: [worker], message: 'Đã đọc brief.md', pausing: false })).toEqual({ state: 'reading', label: 'Minh is reading brief.md…', named: { before: '', name: 'Minh', after: ' is reading brief.md…' }, workers: [worker] });
  expect(islandBeforeStreaming({ workers: [worker], message: 'Đang chờ lượt 2', pausing: false })).toEqual({ state: 'waiting', label: 'Minh is waiting for a turn…', named: { before: '', name: 'Minh', after: ' is waiting for a turn…' }, workers: [worker] });
  expect(islandBeforeStreaming({ workers: [worker], message: 'Đã đọc brief.md', pausing: true }).state).toBe('pausing');
});

it('reads the line of the run the island is about, not the latest line of the chat from another orglet', () => {
  const events = [
    { id: '1', runId: 'auditor-run', message: 'Đã đọc run.log', createdAt: '1' },
    { id: '2', runId: 'writer-run', message: 'Model đang trả kết quả…', createdAt: '2' },
    { id: '3', runId: 'auditor-run', message: 'Tin nhắn cho Writer', createdAt: '3', teamMessage: {} },
  ] as Activity[];
  expect(runEventMessage(events, 'auditor-run')).toBe('Đã đọc run.log');
  expect(runEventMessage(events, 'writer-run')).toBe('Model đang trả kết quả…');
  expect(runEventMessage(events, 'lead-run')).toBeUndefined();
});

it('lets a crew member say what it is doing the way the same orglet does in its own chat', () => {
  const member = (message?: string) => islandBeforeStreaming({ workers: [worker], stage: 'member', message, pausing: false });
  expect(member('Bắt đầu role Minh.').label).toBe('Working with Minh…');
  expect(member('Đang gọi model · bước 1/6').label).toBe('Working with Minh…');
  expect(member('Model đang trả kết quả…')).toMatchObject({ state: 'writing', label: 'Minh is writing a reply…' });
  expect(member('Đã đọc run.log')).toMatchObject({ state: 'reading', label: 'Minh is reading run.log…' });
  expect(member('Đang chờ lượt gọi provider; chưa giữ ngân sách cho bước này.')).toMatchObject({ state: 'waiting', label: 'Minh is waiting for a turn…' });
  const solo = islandBeforeStreaming({ workers: [worker], message: 'Model đang trả kết quả…', pausing: false });
  expect(member('Model đang trả kết quả…')).toEqual(solo);
  expect(runStepLine({ stage: 'member', message: 'Model đang trả kết quả…', pausing: false })).toBe(runStepLine({ message: 'Model đang trả kết quả…', pausing: false }));
  // Planning and combining are the lead's whole run, whatever its model is doing.
  expect(islandBeforeStreaming({ workers: [worker], stage: 'synthesis', message: 'Model đang trả kết quả…', pausing: false }).label).toBe('Minh is combining…');
  expect(islandBeforeStreaming({ workers: [worker], stage: 'plan', message: 'Model đang trả kết quả…', pausing: false }).label).toBe('Minh is assigning work…');
});

it('cuts the sentence around the one name it carries, wherever the translation puts it (COD-250)', () => {
  const long = { id: 'long', name: 'Quarterly Revenue Operations Coordinator' } as Worker;
  const reading = islandOf({ ...emptyProgress(), activity: [step('read', 'invoice.xlsx', false)] }, false, [long]);
  expect(reading.named).toEqual({ before: '', name: 'Quarterly Revenue Operations Coordinator', after: ' is reading invoice.xlsx…' });
  expect(reading.label).toBe('Quarterly Revenue Operations Coordinator is reading invoice.xlsx…');
  expect(islandBeforeStreaming({ workers: [worker], stage: 'member', pausing: false }).named).toEqual({ before: 'Working with ', name: 'Minh', after: '…' });
  expect(islandOf(emptyProgress(), false, [worker, other]).named).toBeUndefined();
  expect(islandOf(emptyProgress(), true, [worker]).named).toBeUndefined();
});

it('says the person has the browser while a card waits, and waits for the OK again once it is handed back (COD-257)', () => {
  const running = islandBeforeStreaming({ workers: [worker], pausing: false });
  const controls = { watch: () => {}, handBack: () => {} };
  const approval = { id: 'card', runId: 'run', actionId: 'action', workerName: 'Minh' } as BrowserApprovalView;
  const held: BrowserLive = { approval, takenOver: true, inChrome: false, using: true, waiting: false, runId: 'run' };
  const island = withBrowserControls(running, held, [worker], controls);
  expect(island.label).toBe('You have the browser');
  expect(island.actions?.map(action => action.kind)).toEqual(['watch', 'handBack']);
  // With the tabs in Chrome there is nothing to watch in Orglet, so only Hand back stays.
  const inChrome = withBrowserControls(running, { ...held, inChrome: true }, [worker], controls);
  expect(inChrome.label).toBe('You have the page in Chrome');
  expect(inChrome.actions?.map(action => action.kind)).toEqual(['handBack']);
  // Handed back with the card still open: the island waits for the OK again.
  const handedBack = withBrowserControls(running, { ...held, takenOver: false }, [worker], controls);
  expect(handedBack.label).toBe('Minh is waiting for your OK…');
  expect(handedBack.actions).toBeUndefined();
});
