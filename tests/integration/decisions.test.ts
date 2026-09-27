import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Decisions, type DecisionRuntime } from '../../apps/desktop/src/core/decisions/service';
import { decisionsDirectory, filesFrom, TACET_FILES, type DecisionFiles } from '../../apps/desktop/src/core/decisions/manifest';
import { downloadFile } from '../../apps/desktop/src/core/decisions/download';
import { NOTEWORTHY_QUESTION, quietRunState } from '../../apps/desktop/src/core/orchestration/quiet-runs';
import { attendedRuns, noteworthyBackgroundNotice, noteworthyNotice, noteworthyRuns, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { setLanguage } from '../../apps/desktop/src/renderer/i18n';
import type { DecisionModelState, DecisionQuestions, DecisionState } from '../../apps/desktop/src/shared/decisions';
import type { Routine, Task } from '../../apps/desktop/src/shared/contracts';
import { ERASE_CONFIRMATION } from '../../apps/desktop/src/shared/erase';
import type { Schedule } from '../../apps/desktop/src/shared/schedule';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Two small stand-ins for the model and the tokenizer, served by a local server that can misbehave on purpose. */
const modelBytes = Buffer.alloc(256 * 1024, 7);
const tokenizerBytes = Buffer.from('{"stand-in":"tokenizer"}');

type Mode = { cutModelAfter?: number; ignoreRange?: boolean; hangModelAfter?: number; corruptModel?: boolean };

let server: Server;
let base: string;
let mode: Mode;
let ranges: (string | undefined)[];
let hanging: ServerResponse[];
let directory: string;

function pinned(): DecisionFiles {
  return filesFrom(base, {
    model: { ...TACET_FILES.model, sha256: sha256(modelBytes), bytes: modelBytes.length },
    tokenizer: { ...TACET_FILES.tokenizer, sha256: sha256(tokenizerBytes), bytes: tokenizerBytes.length },
  });
}

beforeEach(async () => {
  mode = {};
  ranges = [];
  hanging = [];
  directory = await mkdtemp(join(tmpdir(), 'orglet-decisions-'));
  server = createServer((request, response) => {
    const isModel = request.url!.endsWith('.onnx');
    let body = isModel ? modelBytes : tokenizerBytes;
    if (isModel && mode.corruptModel) body = Buffer.alloc(modelBytes.length, 9);
    if (isModel) ranges.push(request.headers.range);
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    let start = 0;
    if (range && !mode.ignoreRange) {
      start = Number(range[1]);
      response.writeHead(206, { 'Content-Length': body.length - start, 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` });
    } else {
      response.writeHead(200, { 'Content-Length': body.length });
    }
    const rest = body.subarray(start);
    if (isModel && mode.cutModelAfter !== undefined && start === 0) {
      response.write(rest.subarray(0, mode.cutModelAfter), () => response.socket?.destroy());
      return;
    }
    if (isModel && mode.hangModelAfter !== undefined) {
      response.write(rest.subarray(0, mode.hangModelAfter));
      hanging.push(response);
      return;
    }
    response.end(rest);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterEach(async () => {
  for (const response of hanging) response.destroy();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function settled(decisions: Decisions): Promise<DecisionModelState> {
  for (let index = 0; index < 500; index++) {
    const state = decisions.state();
    if (state.status !== 'downloading' && state.status !== 'verifying') return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('the download never settled');
}

describe('downloading Tacet (COD-303)', () => {
  it('fetches both files, reports progress and ends ready with the verified files in place', async () => {
    const seen: DecisionModelState[] = [];
    const decisions = new Decisions({ directory, files: pinned(), progressMs: 0 });
    decisions.onState = state => seen.push(state);
    expect(decisions.state()).toEqual({ status: 'absent', receivedBytes: 0, totalBytes: modelBytes.length + tokenizerBytes.length });
    expect(decisions.install().status).toBe('downloading');
    expect((await settled(decisions)).status).toBe('ready');
    expect(readFileSync(join(directory, TACET_FILES.model.name)).equals(modelBytes)).toBe(true);
    expect(existsSync(join(directory, `${TACET_FILES.model.name}.part`))).toBe(false);
    expect(seen.some(state => state.status === 'downloading' && state.receivedBytes > 0 && state.receivedBytes < state.totalBytes)).toBe(true);
    expect(seen.at(-1)?.status).toBe('ready');
  });

  it('deletes a download whose hash does not match and never marks it ready', async () => {
    mode.corruptModel = true;
    const decisions = new Decisions({ directory, files: pinned() });
    decisions.install();
    const state = await settled(decisions);
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Tệp tải về không khớp với bản đã ghim, nên đã bị xóa.');
    expect(existsSync(join(directory, TACET_FILES.model.name))).toBe(false);
    expect(existsSync(join(directory, `${TACET_FILES.model.name}.part`))).toBe(false);
    expect(decisions.isInstalled()).toBe(false);
    expect(await decisions.decide('text', NOTEWORTHY_QUESTION)).toBeUndefined();
  });

  it('keeps the bytes of a cut download and resumes them with a range request', async () => {
    mode.cutModelAfter = 100_000;
    const decisions = new Decisions({ directory, files: pinned() });
    decisions.install();
    const cut = await settled(decisions);
    expect(cut.status).toBe('failed');
    expect(cut.receivedBytes).toBe(tokenizerBytes.length + 100_000);
    expect((await stat(join(directory, `${TACET_FILES.model.name}.part`))).size).toBe(100_000);
    mode.cutModelAfter = undefined;
    decisions.install();
    expect((await settled(decisions)).status).toBe('ready');
    expect(ranges).toEqual([undefined, 'bytes=100000-']);
    expect(readFileSync(join(directory, TACET_FILES.model.name)).equals(modelBytes)).toBe(true);
  });

  it('starts again from the first byte when the server ignores the range', async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${TACET_FILES.model.name}.part`), modelBytes.subarray(0, 5000));
    mode.ignoreRange = true;
    const decisions = new Decisions({ directory, files: pinned() });
    decisions.install();
    expect((await settled(decisions)).status).toBe('ready');
    expect(readFileSync(join(directory, TACET_FILES.model.name)).equals(modelBytes)).toBe(true);
  });

  it('gives up on a stalled connection and keeps what arrived', async () => {
    mode.hangModelAfter = 64 * 1024;
    const file = pinned().model;
    await expect(downloadFile(file, join(directory, file.name), { fetch: (url, init) => fetch(url, init), signal: new AbortController().signal, onBytes: () => {}, stallMs: 200 }))
      .rejects.toThrow('Kết nối bị ngắt giữa chừng.');
    expect((await stat(join(directory, `${file.name}.part`))).size).toBe(64 * 1024);
  });

  it('cancels a running download and deletes what it fetched', async () => {
    mode.hangModelAfter = 32 * 1024;
    const decisions = new Decisions({ directory, files: pinned(), progressMs: 0 });
    decisions.install();
    for (let index = 0; index < 200 && decisions.state().receivedBytes < tokenizerBytes.length + 32 * 1024; index++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(decisions.state().status).toBe('downloading');
    const state = await decisions.cancel();
    expect(state).toEqual({ status: 'absent', receivedBytes: tokenizerBytes.length, totalBytes: modelBytes.length + tokenizerBytes.length });
    expect(existsSync(join(directory, `${TACET_FILES.model.name}.part`))).toBe(false);
  });

  it('removes the model folder and unloads the model', async () => {
    let closed = 0;
    const decisions = new Decisions({ directory, files: pinned(), runtime: async () => ({ decide: async () => ({ model: 'stub', answers: {}, usage: { inputTokens: 1 } }), close: async () => { closed++; } }) });
    decisions.install();
    await settled(decisions);
    await decisions.decide('text', NOTEWORTHY_QUESTION);
    const state = await decisions.remove();
    expect(state.status).toBe('absent');
    expect(existsSync(directory)).toBe(false);
    expect(closed).toBe(1);
  });

  it('takes only a loopback address as the test source, and keeps the pinned hashes', () => {
    expect(filesFrom('http://127.0.0.1:48340/').model.url).toBe(`http://127.0.0.1:48340/${TACET_FILES.model.name}`);
    expect(filesFrom('http://127.0.0.1:48340/').model.sha256).toBe(TACET_FILES.model.sha256);
    expect(filesFrom('http://localhost:48341/files').tokenizer.url).toBe(`http://localhost:48341/files/${TACET_FILES.tokenizer.name}`);
    for (const outside of ['https://example.com/', 'http://192.168.1.5/', 'file:///C:/model', 'not a url']) expect(filesFrom(outside)).toBe(TACET_FILES);
    expect(TACET_FILES.model.url).toMatch(/^https:\/\/huggingface\.co\/codepawl\/tacet-sonata\/resolve\/[^/]+\/onnx\//);
    expect(TACET_FILES.tokenizer.url).toContain('/10877b45570dcd3e86f841e47c6dec49488037a2/');
  });
});

const hourly: Schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'hours', weekday: 1, everyHours: 1 };
const daily: Schedule = { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 };

describe('a quiet schedule run that Tacet finds noteworthy (COD-303)', () => {
  let store: Store;
  let core: CoreService;
  let answer: string;
  let level: number;
  let asked: { state: DecisionState; questions: DecisionQuestions; maxLength: number }[];
  /** How far the core's clock runs ahead of the real one, to age a run past Tacet's window. */
  let clockAhead: number;

  beforeEach(async () => {
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
  afterEach(() => store.close());

  function installStub() {
    const runtime: DecisionRuntime = {
      decide: async (state, questions, maxLength) => {
        asked.push({ state, questions, maxLength });
        return { model: 'tacet-sonata', answers: { attention: { type: 'score', score: level, probabilities: {}, confidence: 0.5, legend: {} } }, usage: { inputTokens: 40 } };
      },
      close: async () => {},
    };
    const files = pinned();
    core.decisions = new Decisions({ directory: decisionsDirectory(directory), files, runtime: async () => runtime });
    return files;
  }
  async function placeFiles(files: DecisionFiles) {
    const folder = decisionsDirectory(directory);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, files.model.name), modelBytes);
    await writeFile(join(folder, files.tokenizer.name), tokenizerBytes);
  }
  async function run(schedule: Schedule): Promise<Task> {
    const workerId = store.workspace().workers[0].id;
    const routine = await core.command('saveRoutine', { name: 'Backup check', enabled: true, schedule, task: { workerId, sourceIds: [], brief: 'Check last night\'s backup log.', consent: true, providerScopes: ['openai'], budgetMicros: 100_000 } }) as Routine;
    const taskId = await core.routines.runCalled(routine.id, []);
    for (let index = 0; index < 300 && core.runner.isActive(taskId); index++) await new Promise(resolve => setTimeout(resolve, 10));
    return store.get<Task>('tasks', taskId);
  }

  it('asks how much the answer needs the person, with the request, and marks a high one to announce', async () => {
    await placeFiles(installStub());
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
    await placeFiles(installStub());
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toMatchObject({ score: 0.3, notified: false });
  });

  it('leaves a run alone once its answer is older than the window, so turning Tacet on never announces history', async () => {
    const files = installStub();
    const task = await run(hourly);
    clockAhead = 16 * 60_000;
    await placeFiles(files);
    await core.tick();
    expect(asked).toHaveLength(0);
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('changes nothing while Tacet is not on this computer', async () => {
    installStub();
    const task = await run(hourly);
    await core.tick();
    expect(asked).toHaveLength(0);
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('keeps today\'s behaviour when the model fails to answer', async () => {
    const files = pinned();
    core.decisions = new Decisions({ directory: decisionsDirectory(directory), files, runtime: async () => { throw new Error('Không mở được Tacet.'); } });
    await placeFiles(files);
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('leaves a daily schedule\'s run alone: it is announced anyway', async () => {
    await placeFiles(installStub());
    const task = await run(daily);
    await core.tick();
    expect(asked).toHaveLength(0);
    expect(store.get<Task>('tasks', task.id).attention).toBeUndefined();
  });

  it('keeps the verdict through a backup', async () => {
    await placeFiles(installStub());
    const task = await run(hourly);
    await core.tick();
    expect(store.get<Task>('tasks', task.id).attention?.notified).toBe(true);
    expect(core.backups.export()).toContain('"attention"');
  });

  it('deletes Tacet\'s folder with Erase everything', async () => {
    await placeFiles(installStub());
    expect(core.decisions.isInstalled()).toBe(true);
    await core.command('eraseData', { scope: 'everything', confirm: ERASE_CONFIRMATION });
    expect(existsSync(decisionsDirectory(directory))).toBe(false);
    expect(core.decisions.state().status).toBe('absent');
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
});
