import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import { commands, type Run, type Skill, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskThread } from '../../apps/desktop/src/renderer/components/TaskThread';
import { askToFixText } from '../../apps/desktop/src/renderer/components/BlockedHandIn';

/*
 * COD-270: a hand-in refused because a command failed after the last edit keeps the orglet's answer and the command
 * that blocked it, and only the person can apply the copy anyway, through the typed command.
 */

let directory: string;
let source: string;
let store: Store;
let run: Run;
let task: Task;
let grants: WorkspaceGrants;
let exitCode: number;
let integrated: string[];

const ANSWER = 'Added test/sum.test.js and ran npm test.';
const ACCEPTED_LIMITATION = 'Người dùng đã áp dụng thay đổi dù lệnh npm test thất bại (mã thoát 1).';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-blocked-hand-in-'));
  source = join(directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'package.json'), '{"scripts":{"test":"node --test"}}');
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  exitCode = 1;
  integrated = [];
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.all<Skill>('skills')[0];
  task = { id: id(), workerId: worker.id, brief: 'Add tests in test/ and run npm test', consent: true, providerScopes: ['openai'],
    sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now() };
  store.put('tasks', task);
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
  run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null,
    snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id) } };
  store.put('runs', run, { column: 'task_id', value: task.id });
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

/** A working-copy runtime whose broker writes into the person's folder, and whose commands exit with `exitCode`. */
function runtime() {
  const integrate: WorkspaceIntegration['apply'] = async request => {
    request.authorize();
    integrated.push(request.path);
    if (request.operation === 'create_folder') {
      await mkdir(join(source, request.path), { recursive: true });
      return { status: 'applied', hash: null, backupPath: '', created: true };
    }
    if (request.operation !== undefined && request.operation !== 'write') throw new Error(`Unexpected ${request.operation} step`);
    await mkdir(join(source, request.path, '..'), { recursive: true });
    await writeFile(join(source, request.path), request.bytes);
    return { status: 'applied', hash: createHash('sha256').update(request.bytes).digest('hex'), backupPath: 'none', created: true };
  };
  return new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, id());
      await mkdir(copy);
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request, abort) => { abort.throwIfAborted(); return executeWorkspaceOperation(copy, request); },
  }, { apply: integrate }, undefined, {
    runCommand: async () => ({ termination: 'exited', exitCode, stdout: '> node --test\n', stderr: "'npm' is not recognized as an internal or external command.\n" }),
  });
}

/** The model a Codex orglet stood in for: writes a test, runs `npm test` after it, then answers. */
function model(): ModelAdapter {
  const calls = [
    { name: 'workspace_write', arguments: { path: 'test/sum.test.js', expectedHash: null, content: "require('node:test');\n" } },
    { name: 'workspace_start_process', arguments: { program: 'shell', arguments: ['npm test'], timeoutMs: 10000 } },
    { name: 'reply', arguments: { message: ANSWER, title: null, knowledgeProposals: [] } },
  ];
  let step = 0;
  return { request: async () => {
    const call = calls[step++];
    return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
  } };
}

async function blockedRun(adapter: ModelAdapter = model()) {
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime());
  await core.runner.run(task, run);
  return core;
}

const savedRun = () => store.get<Run>('runs', run.id);
const copyRecord = () => JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(run.id)!.data));

it('keeps the answer, the blocking command and a ready copy when a failed command refuses hand-in', async () => {
  const core = await blockedRun();
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('failed');
  expect(detail.artifacts).toHaveLength(0);
  const failed = savedRun();
  expect(failed.errorCode).toBe('hand_in_blocked');
  expect(failed.error).toBe('Có lệnh chưa hoàn tất thành công. Xem đầu ra và kiểm tra lại trước khi tích hợp.');
  const blocked = failed.blockedHandIn!;
  expect(blocked.commands).toEqual([{ processId: expect.any(String), program: 'shell', arguments: ['npm test'], state: 'exited', exitCode: 1 }]);
  expect(blocked.answer?.report.summary).toBe(ANSWER);
  expect(blocked.answer?.report.format).toBe('chat');
  expect(blocked.copyFingerprint).toMatch(/^[a-f0-9]{64}$/);
  // Nothing reached the folder, and the copy waits with its counts so the chat can open the diff.
  expect(integrated).toEqual([]);
  await expect(readFile(join(source, 'test', 'sum.test.js'))).rejects.toThrow();
  expect(copyRecord().state).toBe('ready');
  expect(copyRecord().diff).toMatchObject({ files: 1 });
  // The recorded process id reads the command's output through the existing recovery command.
  const output = await core.command('recoveryProcessOutput', { taskId: task.id, processId: blocked.commands[0].processId, stream: 'stderr', offset: 0 });
  expect(output).toMatchObject({ content: expect.stringContaining("'npm' is not recognized"), nextOffset: null });
});

it('publishes the answer with a limitation when a failed command left nothing to hand in', async () => {
  // A read-only question: "run npm test and tell me if everything passes; do not change any files".
  exitCode = 2;
  const reply = 'npm test fails: eslint could not load a module, so the lint step exits with 2 before the tests run.';
  const calls = [
    { name: 'workspace_start_process', arguments: { program: 'shell', arguments: ['npm test'], timeoutMs: 10000 } },
    { name: 'reply', arguments: { message: reply, title: null, knowledgeProposals: [] } },
  ];
  let step = 0;
  const adapter: ModelAdapter = { request: async () => {
    const call = calls[step++];
    return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
  } };
  await blockedRun(adapter);
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('completed');
  expect(detail.artifacts).toHaveLength(1);
  expect(detail.artifacts[0].report.summary).toBe(reply);
  expect(detail.artifacts[0].report.limitations).toEqual(['Lệnh đã thất bại và không có thay đổi tệp nào để áp dụng: npm test (mã thoát 2).']);
  const finished = savedRun();
  expect(finished.status).toBe('completed');
  expect(finished.errorCode).toBeUndefined();
  expect(finished.blockedHandIn).toBeUndefined();
  expect(copyRecord().state).toBe('integrated');
  expect(integrated).toEqual([]);
  // The turn reads as an ordinary answer: no held reply, no Apply anyway.
  const html = renderThread();
  expect(html).toContain('A command failed and there were no file changes to apply: npm test (exit code 2).');
  expect(html).not.toContain('held-reply');
  expect(html).not.toContain('Apply anyway');
});

it('applies the copy anyway through the broker, records the event and adds the limitation', async () => {
  const core = await blockedRun();
  await core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id });
  expect(integrated).toEqual(['test', 'test/sum.test.js']);
  expect(await readFile(join(source, 'test', 'sum.test.js'), 'utf8')).toBe("require('node:test');\n");
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('completed');
  expect(detail.artifacts).toHaveLength(1);
  expect(detail.artifacts[0].report.summary).toBe(ANSWER);
  expect(detail.artifacts[0].report.limitations).toEqual([ACCEPTED_LIMITATION]);
  expect(detail.events.map(event => event.message)).toContain('Người dùng chấp nhận lệnh thất bại và áp dụng thay đổi: npm test (mã thoát 1)');
  const applied = savedRun();
  expect(applied.status).toBe('completed');
  expect(applied.errorCode).toBeUndefined();
  expect(applied.error).toBeNull();
  expect(applied.blockedHandIn?.acceptedAt).toEqual(expect.any(String));
  expect(applied.blockedHandIn?.answer).toBeUndefined();
  expect(copyRecord().state).toBe('integrated');
  // Once applied there is nothing left to apply.
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ áp dụng');
});

it.each([
  ['revoked', () => grants.revoke(task.id)],
  ['narrowed to read', () => grants.grant({ taskId: task.id, directory: source, permissions: ['read'] })],
  ['narrowed to read and edit', () => grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] })],
])('refuses to apply anyway after the folder was %s', async (_label, change) => {
  const core = await blockedRun();
  await change();
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('Quyền sửa thư mục đã bị thu hồi hoặc thay đổi');
  expect(integrated).toEqual([]);
  expect(copyRecord().state).toBe('ready');
  expect(store.detail(task.id).artifacts).toHaveLength(0);
});

it('refuses to apply a copy that changed since it was blocked, or that is no longer ready', async () => {
  const core = await blockedRun();
  const copy = copyRecord();
  await writeFile(join(copy.directory, 'late.txt'), 'written after the person looked');
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('Bản làm việc đã thay đổi');
  await rm(join(copy.directory, 'late.txt'));
  store.db.prepare('UPDATE workspace_copies SET data=? WHERE run_id=?').run(JSON.stringify({ ...copyRecord(), state: 'conflict' }), run.id);
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('Bản làm việc bị gián đoạn');
  expect(integrated).toEqual([]);
  expect(store.detail(task.id).artifacts).toHaveLength(0);
});

it('offers no tool that applies a blocked hand-in, so a model cannot trigger it', async () => {
  await blockedRun();
  const offered = toolsFor(savedRun(), store.get<Task>('tasks', task.id)).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
  expect(offered).toContain('workspace_start_process');
  expect(offered.filter(name => /hand.?in|apply|accept/i.test(name))).toEqual([]);
  // A model that names the command as a tool in the next turn is refused, and the blocked copy is left alone.
  const nextRun: Run = { ...run, id: id(), status: 'queued', startedAt: now(), error: null, errorCode: undefined, blockedHandIn: undefined };
  store.put('runs', nextRun, { column: 'task_id', value: task.id });
  const adapter: ModelAdapter = { request: async () => ({
    calls: [{ id: id(), name: 'applyBlockedHandIn', arguments: JSON.stringify({ taskId: task.id, runId: run.id }) }],
    usage: { input: 10, output: 10 },
  }) };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime());
  await core.runner.run(store.get<Task>('tasks', task.id), nextRun);
  expect(store.get<Run>('runs', nextRun.id).error).toBe('Tool không được policy cho phép.');
  expect(integrated).toEqual([]);
  expect(copyRecord().state).toBe('ready');
  expect(savedRun().blockedHandIn?.acceptedAt).toBeUndefined();
  // The blocked run is no longer the chat's latest, so even the person's command refuses it now.
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('Chỉ áp dụng được lượt mới nhất');
  // The command takes the chat and the run only; nothing a caller adds can widen it.
  expect(() => commands.applyBlockedHandIn.parse({ taskId: task.id, runId: run.id, acceptedBy: 'model' })).toThrow();
});

/** The chat as the window draws it, from the store the core wrote. */
function renderThread() {
  const detail = store.detail(task.id);
  const worker = detail.runs[0].snapshot.worker;
  return renderToStaticMarkup(createElement(TaskThread, {
    detail, recovery: new WorkspaceRecovery(store).view(task.id), workspace: { workers: [worker], skills: [detail.runs[0].snapshot.skill], tasks: [detail.task] },
    action: () => {}, showSources: () => {}, openMessage: () => {}, proposals: [], openKnowledge: () => {}, reviewKnowledge: () => {}, askToFix: () => {},
    proposalActions: { busy: false, onApply: () => {}, onApplyAll: () => {}, onDismiss: () => {}, onDismissAll: () => {}, onUndo: () => {}, onOpen: () => {}, onOpenChat: () => {} },
  }));
}

it('shows the held answer, why it was not applied, the changed files and the three decisions on the turn', async () => {
  const core = await blockedRun();
  const html = renderThread();
  const reply = html.slice(html.indexOf('class="chat-reply held-reply"'));
  const bubble = reply.indexOf(ANSWER);
  const reason = reply.indexOf('<code>npm test</code> exited with 1, so the changes were not applied');
  const changes = reply.indexOf('class="activity-summary changed-files"');
  expect(bubble).toBeGreaterThan(-1);
  expect(reason).toBeGreaterThan(bubble);
  expect(changes).toBeGreaterThan(reason);
  expect(reply).toContain('View output');
  expect(reply).toContain('Files changed: 1');
  // The reason sits under the answer, so the generic error card is not drawn as well.
  expect(html).not.toContain('class="run-error"');
  const actions = html.slice(html.lastIndexOf('class="actions"'));
  expect(actions.indexOf('Apply anyway')).toBeGreaterThan(-1);
  expect(actions.indexOf('Ask to fix')).toBeGreaterThan(actions.indexOf('Apply anyway'));
  expect(actions.indexOf('Retry with current settings')).toBeGreaterThan(actions.indexOf('Ask to fix'));
  expect(askToFixText(savedRun().blockedHandIn!.commands))
    .toBe('`npm test` exited with 1, so the changes were not applied. Check its output, fix what makes it fail, then do the work again.');
  // Applied, the turn reads like any answer, with the line saying what was accepted and nothing left to decide.
  await core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id });
  const applied = renderThread();
  expect(applied).toContain(ANSWER);
  expect(applied).toContain('The user applied the changes even though npm test failed (exit code 1).');
  expect(applied).not.toContain('held-reply');
  expect(applied).not.toContain('Apply anyway');
});

it('keeps the held answer and its reason on the turn after the person sends another message', async () => {
  const core = await blockedRun();
  const brief = 'Thanks, what else is left?';
  store.update('tasks', { ...store.get<Task>('tasks', task.id), inputRevision: 1, brief, currentInput: { brief, sourceIds: [] }, status: 'queued' });
  const nextRun: Run = { ...run, id: id(), status: 'queued', startedAt: now(), error: null, errorCode: undefined, blockedHandIn: undefined,
    snapshot: { ...run.snapshot, inputRevision: 1, input: { brief, sourceIds: [] } } };
  store.put('runs', nextRun, { column: 'task_id', value: task.id });
  const adapter: ModelAdapter = { request: async () => ({
    calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message: 'Only the README is left.', title: null, knowledgeProposals: [] }) }],
    usage: { input: 10, output: 10 },
  }) };
  await new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime())
    .runner.run(store.get<Task>('tasks', task.id), nextRun);
  expect(store.detail(task.id).task.status).toBe('completed');
  const html = renderThread();
  const earlierTurn = html.slice(0, html.indexOf('Only the README is left.'));
  expect(earlierTurn).toContain(ANSWER);
  expect(earlierTurn).toContain('<code>npm test</code> exited with 1, so the changes were not applied');
  expect(earlierTurn).not.toContain('No reply to this message yet.');
  // Deciding belongs to the latest turn only, and the core refuses the earlier one as well.
  expect(html).not.toContain('Apply anyway');
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('Chỉ áp dụng được lượt mới nhất');
});

it('keeps only the reason for a group reply, which the person cannot apply on its own', async () => {
  run = { ...run, stage: 'group' };
  store.update('runs', run);
  const core = new CoreService(store, () => {}, async () => model(), undefined, undefined, undefined, undefined, undefined, runtime());
  await core.runner.run(task, run, { keepTaskOpen: true });
  const failed = savedRun();
  expect(failed.errorCode).toBe('hand_in_blocked');
  expect(failed.blockedHandIn?.commands).toHaveLength(1);
  expect(failed.blockedHandIn?.answer).toBeUndefined();
  await expect(core.command('applyBlockedHandIn', { taskId: task.id, runId: run.id })).rejects.toThrow('không có thay đổi đang chờ áp dụng');
  // Its card names the member and the command in place of the generic message, and offers no apply.
  store.update('tasks', { ...store.get<Task>('tasks', task.id), status: 'failed' });
  const html = renderThread();
  const card = html.slice(html.indexOf('class="run-error"'));
  expect(card).toContain(`${failed.snapshot.worker.name}: <code>npm test</code> exited with 1, so the changes were not applied`);
  expect(card).not.toContain('A command has not completed successfully');
  expect(html).not.toContain('Apply anyway');
});
