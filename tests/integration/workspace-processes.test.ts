import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceProcesses } from '../../apps/desktop/src/core/tools/workspace-processes';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WindowsSandbox, type SandboxResult } from '../../apps/desktop/src/core/tools/sandbox';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

let directory: string;
let workingDirectory: string;
let store: Store;
let run: Run;
let processes: WorkspaceProcesses | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-processes-'));
  workingDirectory = directory;
  store = new Store(join(directory, 'state.sqlite'));
  const worker = store.all<Worker>('workers')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Command test', sourceIds: [], consent: true,
    accepted: false, budgetMicros: 100_000, status: 'running', createdAt: now() };
  store.put('tasks', task);
  run = { id: id(), taskId: task.id, snapshot: { worker, skill: store.all<Skill>('skills')[0] },
    status: 'running', startedAt: now(), error: null };
  store.put('runs', run, { column: 'task_id', value: task.id });
});
afterEach(async () => {
  await processes?.stopRun(run.id);
  processes = undefined;
  store.close();
  await rm(directory, { recursive: true, force: true });
});
const command = { program: 'node', arguments: ['-e', 'console.log("ok")'], timeoutMs: 5000 };
const success: SandboxResult = { exitCode: 0, stdout: 'ok\n', stderr: '', termination: 'exited' };
const signal = () => new AbortController().signal;
function start(callId = id(), input = command, lifetime = signal()) {
  return processes!.start({ runId: run.id, callId, directory: workingDirectory, command: input, signal: lifetime, authorize: () => {} });
}

it('records a handle once, streams bounded pages and rejects foreign run access', async () => {
  let launched = 0;
  let finish: (result: SandboxResult) => void = () => {};
  processes = new WorkspaceProcesses(store, { runCommand: async (_directory, _command, abort, onOutput) => {
    launched++;
    onOutput?.({ stdout: '🦦'.repeat(20000), stderr: '' });
    return new Promise<SandboxResult>(resolve => {
      finish = resolve;
      abort.addEventListener('abort', () => resolve({ ...success, termination: 'cancelled' }), { once: true });
    });
  } });
  const callId = id();
  const first = await start(callId);
  expect(await start(callId)).toEqual(first);
  expect(launched).toBe(1);
  expect(() => processes!.assertIdle(run.id)).toThrow('còn chạy');
  const page = processes.output(run.id, first.processId, 'stdout', 0);
  expect(Array.from(page.content)).toHaveLength(16000);
  expect(page.nextOffset).toBe(16000);
  expect(() => processes!.output(id(), first.processId, 'stdout', 0)).toThrow('không thuộc');
  finish(success);
  expect(await processes.status(run.id, first.processId, 1000, signal(), () => {})).toMatchObject({ state: 'exited', exitCode: 0 });
  expect(() => processes!.assertSuccessful(run.id)).not.toThrow();
});

it('waits for cancellation and does not present a cancelled check as success', async () => {
  let stopped = false;
  processes = new WorkspaceProcesses(store, { runCommand: async (_directory, _command, abort) =>
    new Promise<SandboxResult>(resolve => { abort.addEventListener('abort', () => {
      stopped = true;
      resolve({ ...success, exitCode: null, termination: 'cancelled' });
    }, { once: true }); }) });
  const started = await start();
  expect(await processes.cancel(run.id, started.processId)).toMatchObject({ state: 'cancelled' });
  expect(stopped).toBe(true);
  expect(() => processes!.assertSuccessful(run.id)).toThrow('chưa hoàn tất thành công');
});

it('keeps a failed check visible until that same command passes', async () => {
  let exitCode = 1;
  processes = new WorkspaceProcesses(store, { runCommand: async () => ({ ...success, exitCode }) });
  const failed = await start();
  await processes.status(run.id, failed.processId, 1000, signal(), () => {});
  expect(() => processes!.assertSuccessful(run.id)).toThrow('chưa hoàn tất thành công');
  exitCode = 0;
  const unrelated = await start(id(), { ...command, arguments: ['--version'] });
  await processes.status(run.id, unrelated.processId, 1000, signal(), () => {});
  expect(() => processes!.assertSuccessful(run.id)).toThrow('chưa hoàn tất thành công');
  const retry = await start();
  await processes.status(run.id, retry.processId, 1000, signal(), () => {});
  expect(() => processes!.assertSuccessful(run.id)).not.toThrow();
});

it('recovers a persisted running command as uncertain and never relaunches its handle', async () => {
  let launches = 0;
  processes = new WorkspaceProcesses(store, { runCommand: async () => { launches++; return success; } });
  const callId = id();
  const started = await start(callId);
  await processes.status(run.id, started.processId, 1000, signal(), () => {});
  store.db.prepare("UPDATE workspace_processes SET data=json_set(data,'$.state','running')").run();
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
  processes = new WorkspaceProcesses(store, { runCommand: async () => { launches++; return success; } });
  expect(await start(callId)).toEqual(started);
  expect(launches).toBe(1);
  expect(() => processes!.assertKnown(run.taskId)).toThrow('chưa rõ kết quả');
  expect(await processes.status(run.id, started.processId, 0, signal(), () => {})).toMatchObject({ state: 'uncertain' });
});

describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('packaged command helper', () => {
  beforeEach(async () => {
    const helper = new WorkspaceFilesRuntime({ sandbox: new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE!),
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      runtimeExecutable: resolve('out/Orglet-win32-x64/Orglet.exe'), stateDirectory: join(directory, 'state') });
    processes = new WorkspaceProcesses(store, helper);
    workingDirectory = join(directory, 'copy');
    await mkdir(workingDirectory);
  });

  it.each(['node', 'shell'])('captures real %s output and exit status', async program => {
    const started = await start(id(), { program, arguments: program === 'node' ? ['-e', 'console.log("command worked")'] : ['echo command worked'], timeoutMs: 5000 });
    const result = await processes!.status(run.id, started.processId, 10000, signal(), () => {});
    expect(result).toMatchObject({ state: 'exited', exitCode: 0 });
    expect(processes!.output(run.id, started.processId, 'stdout', 0).content.trim()).toBe('command worked');
  });

  it('cancels a real descendant before returning', async () => {
    const heartbeat = join(workingDirectory, 'heartbeat.txt');
    const child = 'setInterval(()=>require("node:fs").appendFileSync("heartbeat.txt","."),20)';
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});console.log('started');setInterval(()=>{},1000)`;
    const started = await start(id(), { ...command, arguments: ['-e', parent], timeoutMs: 10000 });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(heartbeat).then(bytes => bytes.length > 0).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    expect(await readFile(heartbeat).then(bytes => bytes.length)).toBeGreaterThan(0);
    expect(await processes!.cancel(run.id, started.processId)).toMatchObject({ state: 'cancelled' });
    const stopped = await readFile(heartbeat, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await readFile(heartbeat, 'utf8')).toBe(stopped);
  });

  it.each(['timeout', 'output_limit'] as const)('retains the real %s outcome', async outcome => {
    const source = outcome === 'timeout' ? 'setInterval(()=>{},1000)' : 'process.stdout.write("x".repeat(600000))';
    const started = await start(id(), { ...command, arguments: ['-e', source], timeoutMs: outcome === 'timeout' ? 500 : 5000 });
    expect(await processes!.status(run.id, started.processId, 10000, signal(), () => {})).toMatchObject({ state: outcome });
    expect(() => processes!.assertSuccessful(run.id)).toThrow('chưa hoàn tất thành công');
  });
});
