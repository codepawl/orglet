import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { appChatClient } from '../../apps/desktop/src/cli/chat-client';
import { call, exchange, StoppedError } from '../../apps/desktop/src/cli/client';
import { activityLines, shimmer } from '../../apps/desktop/src/cli/activity';
import { cliEndpoint, type CliActivity, type CliProgressFrame } from '../../apps/desktop/src/cli/protocol';
import { Transcript } from '../../apps/desktop/src/cli/transcript';
import { displayWidth, stripAnsi } from '../../apps/desktop/src/cli/terminal';
import { CliActivityFeed, type CliObserver } from '../../apps/desktop/src/main/cli-activity';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';
import { CliServer, createCliToken, writeCliToken } from '../../apps/desktop/src/main/cli-server';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { ToolCalls } from '../../apps/desktop/src/core/storage/tool-calls';
import { ClaudeStreamParser } from '../../apps/desktop/src/core/harness/claudeStream';
import { CliProgressFrame as ProgressFrameSchema } from '../../apps/desktop/src/cli/protocol';
import type { Run, Skill, Task, TaskDetail, Worker, Workspace } from '../../apps/desktop/src/shared/contracts';
import type { RunActivity } from '../../apps/desktop/src/shared/run-activity';

const timestamp = '2026-09-28T10:00:00.000Z';
const worker: Worker = { id: 'worker', name: 'Researcher', provider: 'codex', instructions: 'Help with the task', skillId: 'skill', revision: 1 };
const run = { id: 'run', taskId: 'task', status: 'running', startedAt: timestamp, snapshot: { worker, inputRevision: 2 } } as Run;
const detail = { task: { id: 'task', inputRevision: 2, status: 'running' }, runs: [run], events: [], artifacts: [] } as unknown as TaskDetail;
const coreStep: RunActivity = { id: 'model:1', runId: 'run', taskId: 'task', kind: 'model', state: 'running', label: 'model',
  startedAt: timestamp, updatedAt: timestamp };
const step: CliActivity = { ...coreStep, name: 'Researcher' };
const frame = (steps: CliActivity[]): CliProgressFrame => ({ type: 'progress', taskId: 'task', steps, omitted: 0 });

describe('CLI activity projection', () => {
  it('keeps early and interleaved steps in timestamp order, joins frozen authors, and excludes old turns', () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.observe({ activity: coreStep });
    const otherRun = { ...run, id: 'other', snapshot: { ...run.snapshot, worker: { ...worker, name: 'Writer' } } };
    const oldRun = { ...run, id: 'old', snapshot: { ...run.snapshot, inputRevision: 1 } };
    feed.update({ ...detail, runs: [run, otherRun, oldRun] }, 2);
    feed.observe({ activity: { ...coreStep, id: 'read', runId: 'other', kind: 'tool', label: 'workspace_read', detail: 'README.md',
      startedAt: '2026-09-28T10:00:01.000Z' } });
    feed.observe({ activity: { ...coreStep, id: 'read', runId: 'other', kind: 'tool', label: 'workspace_read', state: 'completed',
      startedAt: '2026-09-28T10:00:01.000Z', updatedAt: '2026-09-28T10:00:02.000Z' } });
    feed.observe({ activity: { ...coreStep, runId: 'old' } });
    expect(frames.at(-1)?.steps.map(value => [value.id, value.name, value.state])).toEqual([
      ['model:1', 'Researcher', 'running'], ['read', 'Writer', 'completed'],
    ]);
    expect(frames.at(-1)?.steps[1].detail).toBe('README.md');
  });

  it('discloses only Codex summaries and does not treat stream closure as success', () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.update(detail, 2);
    feed.observe({ activity: coreStep });
    const progress = { taskId: 'task', runId: 'run', startedAt: Date.parse(timestamp),
      progress: { thinking: 'Public summary', preamble: 'Ignored preamble', activity: [], answer: 'Partial answer', writing: false } };
    feed.observe({ progress });
    expect(frames.at(-1)?.steps[0]).toMatchObject({ label: 'thinking', detail: 'Public summary', state: 'running' });
    expect(JSON.stringify(frames)).not.toContain('Partial answer');
    feed.observe({ progress: { ...progress, progress: null } });
    expect(frames.at(-1)?.steps[0].state).toBe('running');
    feed.update({ ...detail, runs: [{ ...run, status: 'failed' }] }, 2);
    expect(frames.at(-1)?.steps[0].state).toBe('failed');

    const claudeFrames: CliProgressFrame[] = [];
    const claude = new CliActivityFeed(value => claudeFrames.push(value));
    claude.update({ ...detail, runs: [{ ...run, snapshot: { ...run.snapshot, worker: { ...worker, provider: 'claude-code' } } }] }, 2);
    claude.observe({ activity: coreStep });
    claude.observe({ progress });
    expect(JSON.stringify(claudeFrames)).not.toContain('Public summary');
  });

  it('keeps first-seen and completion times when native crew steps arrive before run metadata', () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.update(detail, 2);
    const nativeRun = { ...run, id: 'native', snapshot: { ...run.snapshot, worker: { ...worker, name: 'Writer' } } };
    const nativeStep = { id: 'read', kind: 'read' as const, target: 'README.md', done: false };
    const progress = { taskId: 'task', runId: 'native', startedAt: 1,
      progress: { thinking: 'PRIVATE THINKING', preamble: 'PRIVATE PREAMBLE', answer: 'PRIVATE ANSWER', writing: false, activity: [nativeStep] } };
    feed.observe({ progress }, timestamp);
    feed.observe({ activity: { ...coreStep, id: 'other-read', kind: 'tool', label: 'workspace_read', state: 'completed',
      startedAt: '2026-09-28T10:00:01.000Z', updatedAt: '2026-09-28T10:00:01.000Z' } });
    feed.observe({ progress: { ...progress, progress: { ...progress.progress, activity: [{ ...nativeStep, done: true }] } } }, '2026-09-28T10:00:02.000Z');
    feed.observe({ progress: { ...progress, progress: { ...progress.progress, activity: [{ ...nativeStep, done: true }] } } }, '2026-09-28T10:00:03.000Z');
    feed.update(detail, 2);
    feed.update(detail, 2);
    feed.update({ ...detail, runs: [run, nativeRun] }, 2);
    expect(frames.at(-1)?.steps.map(value => value.id)).toEqual(['native:1:read', 'other-read']);
    expect(frames.at(-1)?.steps[0]).toMatchObject({ startedAt: timestamp, updatedAt: '2026-09-28T10:00:02.000Z', state: 'completed' });
    expect(JSON.stringify(frames)).not.toContain('PRIVATE');
  });

  it('bounds history and marks a completed run with missing tool completion as unknown', () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.update(detail, 2);
    for (let index = 0; index < 501; index += 1) feed.observe({ activity: { ...coreStep, id: `step:${index}`, state: 'completed' } });
    expect(frames.at(-1)).toMatchObject({ omitted: 1 });
    expect(frames.at(-1)?.steps).toHaveLength(500);
    feed.observe({ activity: { ...coreStep, id: 'tool', kind: 'tool', label: 'workspace_read' } });
    feed.update({ ...detail, runs: [{ ...run, status: 'completed' }] }, 2);
    expect(frames.at(-1)?.steps.find(value => value.id === 'tool')?.state).toBe('unknown');
    feed.observe({ activity: { ...coreStep, id: 'step:0', state: 'completed' } });
    expect(frames.at(-1)?.steps.some(value => value.id === 'step:0')).toBe(false);
  });

  it('filters unrelated chats before buffering and keeps detail truncation inside the schema', () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.bind('task');
    for (let index = 0; index < 1001; index += 1) feed.observe({ activity: { ...coreStep, taskId: 'unrelated', id: `other:${index}` } });
    feed.observe({ activity: coreStep });
    feed.update(detail, 2);
    expect(frames.at(-1)?.steps).toHaveLength(1);
    for (let index = 0; index < 24; index += 1) feed.observe({ activity: { ...coreStep, id: `detail:${index}`, detail: 'x'.repeat(4000) } });
    feed.observe({ activity: { ...coreStep, id: 'one', detail: 'x' } });
    feed.observe({ activity: { ...coreStep, id: 'tail', detail: 'y'.repeat(4000) } });
    expect(ProgressFrameSchema.safeParse(frames.at(-1)).success).toBe(true);
    expect(frames.at(-1)?.steps.at(-1)?.detail).toContain('details truncated');
  });

  it('preserves a native tool completion time through later snapshots and marks explicit harness errors', async () => {
    const frames: CliProgressFrame[] = [];
    const feed = new CliActivityFeed(value => frames.push(value));
    feed.update({ ...detail, runs: [{ ...run, snapshot: { ...run.snapshot, worker: { ...worker, provider: 'claude-code' } } }] }, 2);
    const parser = new ClaudeStreamParser(progress => feed.observe({ progress: { taskId: 'task', runId: 'run', startedAt: 1, progress } }));
    parser.push(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'bad-read', name: 'Read' } } }) + '\n');
    parser.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bad-read', is_error: true, content: 'PRIVATE RESULT' }] } }) + '\n');
    const finished = frames.at(-1)?.steps[0];
    expect(finished?.state).toBe('failed');
    await new Promise(resolve => setTimeout(resolve, 5));
    parser.push(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'thinking' } } }) + '\n');
    parser.push(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1,
      delta: { type: 'thinking_delta', thinking: 'PRIVATE THINKING' } } }) + '\n');
    expect(frames.at(-1)?.steps[0].updatedAt).toBe(finished?.updatedAt);
    expect(JSON.stringify(frames)).not.toMatch(/PRIVATE/);
  });
});

describe('CLI observed tool lifecycle', () => {
  it('observes returned errors and uncertain effects without exporting content or changing replay', async () => {
    const store = new Store(':memory:');
    try {
      const seededWorker = store.all<Worker>('workers')[0];
      const task: Task = { id: id(), workerId: seededWorker.id, brief: 'Check', sourceIds: [], status: 'running',
        budgetMicros: 1000, consent: true, accepted: false, createdAt: now() };
      store.put('tasks', task);
      const attempt: Run = { id: id(), taskId: task.id, status: 'running', error: null, startedAt: now(),
        snapshot: { worker: seededWorker, skill: store.all<Skill>('skills')[0] } };
      store.put('runs', attempt, { column: 'task_id', value: task.id });
      const observations: RunActivity[] = [];
      store.onActivity = activity => observations.push(activity);
      const journal = new ToolCalls(store);
      const options = { runId: attempt.id, callId: 'read', name: 'workspace_read', arguments: { path: 'notes.txt', content: 'PRIVATE INPUT' },
        replay: 'read' as const, authorize: () => {}, perform: async () => ({ error: 'PRIVATE OUTPUT' }) };
      expect(await journal.execute(options)).toEqual({ error: 'PRIVATE OUTPUT' });
      expect(observations.map(value => value.state)).toEqual(['running', 'failed']);
      expect(JSON.stringify(observations)).not.toMatch(/PRIVATE/);
      await journal.execute({ ...options, perform: () => { throw new Error('Must replay'); } });
      expect(observations).toHaveLength(2);
      await expect(journal.execute({ ...options, callId: 'interrupted', perform: () => { throw new Error('Interrupted'); } })).rejects.toThrow('Interrupted');
      expect(observations.at(-1)?.state).toBe('unknown');
      for (const [index, result] of [{ result: { error: 'private browser error' } }, { isError: true }, { state: 'exited', exitCode: 1 }].entries()) {
        await journal.execute({ ...options, callId: `wrapped:${index}`, perform: () => result });
        expect(observations.at(-1)?.state).toBe('failed');
      }
      store.onActivity = () => { throw new Error('Observer disconnected'); };
      expect(await journal.execute({ ...options, callId: 'safe', perform: () => 'unchanged' })).toBe('unchanged');
    } finally {
      store.close();
    }
  });
});

describe('CLI progress pipe', () => {
  let folder: string | undefined;
  let server: CliServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (folder) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it('receives validated progress before the final answer, keeps old send single-response, and cleans observers', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-activity-'));
    const token = createCliToken();
    await writeCliToken(folder, token);
    const observers = new Set<CliObserver>();
    let completed = false;
    const operations = new CliOperations({ version: () => 'test', open: () => {}, translate: message => message, pollMilliseconds: 5,
      observe: observer => { observers.add(observer); return () => { observers.delete(observer); }; },
      request: async command => {
        if (command === 'workspace') return { workers: [worker], teams: [], tasks: [] } as unknown as Workspace;
        if (command === 'createTask') {
          completed = false;
          for (const observer of observers) observer({ activity: coreStep });
          setTimeout(() => {
            for (const observer of observers) observer({ activity: { ...coreStep, state: 'completed' } });
            completed = true;
          }, 30);
          return 'task';
        }
        if (command === 'task') return { ...detail, task: { ...detail.task, status: completed ? 'completed' : 'running' },
          runs: [{ ...run, status: completed ? 'completed' : 'running' }] };
        throw new Error(command);
      },
    });
    server = new CliServer({ endpoint: cliEndpoint(folder), token, translate: message => message,
      handle: (request, signal, progress) => operations.run(request, signal, progress) });
    await server.start();
    const frames: CliProgressFrame[] = [];
    const response = await appChatClient(folder, undefined).send('Researcher', 'hello', new AbortController().signal, value => {
      frames.push(value);
    });
    expect(response.finished).toBe(true);
    expect(frames.flatMap(value => value.steps.map(activity => activity.state))).toContain('running');
    expect(frames.at(-1)?.steps[0].state).toBe('completed');
    expect(observers.size).toBe(0);
    expect(await call(folder, { op: 'send', to: 'Researcher', message: 'legacy', files: [], wait: true, timeoutSeconds: 2 })).toMatchObject({ ok: true });
    const controller = new AbortController();
    const waiting = appChatClient(folder, undefined).send('Researcher', 'stop waiting', controller.signal, () => controller.abort());
    await expect(waiting).rejects.toBeInstanceOf(StoppedError);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(observers.size).toBe(0);
    const unauthorizedFrames: CliProgressFrame[] = [];
    expect(await exchange(cliEndpoint(folder), { op: 'send', token: createCliToken(), progress: true }, undefined,
      value => unauthorizedFrames.push(value))).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(unauthorizedFrames).toEqual([]);
  });

  it('retries a legacy schema refusal before dispatch, without duplicating a user message', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-legacy-'));
    const token = createCliToken();
    await writeCliToken(folder, token);
    let sent = 0;
    server = new CliServer({ endpoint: cliEndpoint(folder), token, translate: message => message, handle: async request => {
      if (request.op === 'send' && request.progress) throw new (await import('../../apps/desktop/src/main/cli-operations')).CliFailure('invalid', 'Old schema');
      sent += 1;
      return { chat: { kind: 'worker', id: worker.id, name: worker.name }, taskId: 'task', waited: true, finished: true,
        status: 'completed', answers: [], errors: [] };
    } });
    await server.start();
    expect((await appChatClient(folder, undefined).send('Researcher', 'one message', new AbortController().signal, () => {})).finished).toBe(true);
    expect(sent).toBe(1);
  });

  it('reads split UTF-8 progress frames followed by the final line and rejects malformed frames', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-frames-'));
    const endpoint = cliEndpoint(folder);
    let malformed = false;
    const rawServer = createServer(socket => {
      socket.once('data', () => {
        const progress = malformed ? { type: 'progress', taskId: 'task', steps: [{ bad: true }], omitted: 0 }
          : frame([{ ...step, name: '日本 orglet' }]);
        const bytes = Buffer.from(`${JSON.stringify(progress)}\n${JSON.stringify({ ok: true, value: 'final answer' })}\n`);
        const split = Math.max(1, bytes.indexOf(Buffer.from('日')) + 1);
        socket.write(bytes.subarray(0, split));
        setTimeout(() => socket.end(bytes.subarray(split)), 5);
      });
      socket.on('error', () => {});
    });
    await new Promise<void>(resolve => rawServer.listen(endpoint, resolve));
    try {
      const frames: CliProgressFrame[] = [];
      expect(await exchange(endpoint, { request: 'fixture' }, undefined, value => frames.push(value))).toEqual({ ok: true, value: 'final answer' });
      expect(frames[0].steps[0].name).toBe('日本 orglet');
      malformed = true;
      await expect(exchange(endpoint, { request: 'fixture' }, undefined, () => {})).rejects.toThrow('cannot read');
    } finally {
      await new Promise<void>(resolve => rawServer.close(() => resolve()));
    }
  });
});

describe('CLI timeline rendering', () => {
  it.each(['none', 'truecolor', 'ansi256'] as const)('keeps chronological rows collapsed and expands completed details in %s', mode => {
    const transcript = new Transcript();
    transcript.append('You · check notes');
    const activity = transcript.beginActivity();
    activity.frame = frame([{ ...step, state: 'completed', detail: 'Public summary details' },
      { ...step, id: 'read', kind: 'tool', label: 'workspace_read', detail: 'notes.txt', startedAt: '2026-09-28T10:00:02.000Z' }]);
    const collapsed = transcript.lines(80, mode, 500, false).map(stripAnsi).join('\n');
    expect(collapsed).toContain('00:00 ▸ Model responded');
    expect(collapsed).toContain('00:02 ● Read file · notes.txt');
    expect(collapsed).not.toContain('Public summary details');
    transcript.expanded = true;
    expect(transcript.lines(80, mode).map(stripAnsi).join('\n')).toContain('Public summary details');
    for (const width of [8, 20, 32]) expect(transcript.lines(width, mode).every(line => displayWidth(line) <= width)).toBe(true);
    transcript.clear();
    activity.frame = frame([step]);
    expect(transcript.lines(80, mode)).toEqual([]);
  });

  it('moves emphasis with stable text and holds still under reduced motion or no colour', () => {
    expect(shimmer('Thinking…', 'truecolor', 700, false)).not.toBe(shimmer('Thinking…', 'truecolor', 1100, false));
    expect(stripAnsi(shimmer('Thinking…', 'truecolor', 700, false))).toBe('Thinking…');
    expect(shimmer('Thinking…', 'truecolor', 700, true)).toBe(shimmer('Thinking…', 'truecolor', 1100, true));
    expect(shimmer('Thinking…', 'none', 700, false)).toBe('Thinking…');
    const unsafe = activityLines([{ ...step, detail: '\x1b[2Jpayload', label: 'writing' }],
      { width: 80, mode: 'none', expanded: true, milliseconds: 0, reducedMotion: true }).join('\n');
    expect(unsafe).not.toContain('\x1b');
    const transcript = new Transcript();
    const activity = transcript.beginActivity();
    activity.frame = frame([step]);
    activity.following = false;
    const first = transcript.lines(80, 'truecolor', 700, false);
    expect(first).toEqual(transcript.lines(80, 'truecolor', 1100, false));
    expect(first.map(stripAnsi).join('\n')).toContain('○ Model working… · continues in app');
  });
});
