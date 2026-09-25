import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import { WorkspaceFilesRuntime } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { WindowsSandbox } from '../../apps/desktop/src/core/tools/sandbox';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, memberIdsFromPlanPrompt } from './team-plan';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { HarnessTerminationError } from '../../apps/desktop/src/core/harness/exec';
import { missingHarness } from '../../apps/desktop/src/shared/harness';

let directory: string;
let source: string;
let store: Store;
let run: Run;
let task: Task;
let grants: WorkspaceGrants;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-workspace-runtime-'));
  source = join(directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'note.txt'), 'original');
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.all<Skill>('skills')[0];
  task = { id: id(), workerId: worker.id, brief: 'Update note.txt', consent: true, providerScopes: ['openai'],
    sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now() };
  store.put('tasks', task);
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] });
  run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null,
    snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id) } };
  store.put('runs', run, { column: 'task_id', value: task.id });
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

// These in-process fixtures exercise coordination only. Native cases below establish execution through the sandbox.
function fixture(integrate: WorkspaceIntegration['apply'] = async () => { throw new Error('Unexpected integration'); },
  commands?: Pick<WorkspaceFilesRuntime, 'runCommand'>) {
  return new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, id());
      await mkdir(copy);
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request, abort) => { abort.throwIfAborted(); return executeWorkspaceOperation(copy, request); },
  }, { apply: integrate }, undefined, commands);
}

/** The write fields of a hand-in step; the fixtures that use this only ever integrate file edits. */
function writeOf(options: Parameters<WorkspaceIntegration['apply']>[0]) {
  if (options.operation !== undefined && options.operation !== 'write') throw new Error(`Unexpected ${options.operation} step`);
  return options;
}

async function edit(runtime: WorkspaceRuntime, path = 'note.txt', content = 'updated') {
  const read = await runtime.execute(run, id(), { operation: 'read', path, offset: 0 }, signal()) as { hash: string };
  return runtime.execute(run, id(), { operation: 'write', path, expectedHash: read.hash, content }, signal());
}

it('fails a turn refused by the unknown-outcome guard with a code the chat can point at (COD-191)', async () => {
  const earlier: Run = { ...run, id: id(), status: 'failed', error: 'interrupted' };
  store.put('runs', earlier, { column: 'task_id', value: task.id });
  store.db.prepare("INSERT INTO tool_calls(run_id,call_id,fingerprint,state,output,replay,name,summary,started_at) VALUES(?,?,?,'uncertain',NULL,'never',?,?,?)")
    .run(earlier.id, 'write-1', 'a'.repeat(64), 'workspace_write', 'note.txt', now());
  task = { ...task, providerScopes: ['openai'] };
  store.update('tasks', task);
  const adapter: ModelAdapter = { request: async () => ({
    calls: [{ id: id(), name: 'workspace_write', arguments: JSON.stringify({ path: 'note.txt', expectedHash: null, content: 'retry' }) }],
    usage: { input: 10, output: 10 },
  }) };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, fixture());
  await core.runner.run(task, run);
  const detail = store.detail(task.id);
  const failed = detail.runs.find(item => item.id === run.id)!;
  expect(failed.status).toBe('failed');
  expect(failed.errorCode).toBe('unresolved_attempt');
  expect(failed.error).toContain('chưa rõ kết quả');
  expect(detail.runs.find(item => item.id === earlier.id)!.errorCode).toBeUndefined();
  const view = new WorkspaceRecovery(store).view(task.id);
  expect(view.uncertainCalls).toEqual([{ runId: earlier.id, callId: 'write-1', replay: 'never', tool: 'workspace_write', summary: 'note.txt', at: expect.any(String) }]);
});

it('answers a read or list of a missing path as a tool result instead of failing (COD-190)', async () => {
  const runtime = fixture();
  expect(await runtime.execute(run, id(), { operation: 'read', path: 'lib/missing.js', offset: 0 }, signal()))
    .toMatchObject({ missing: true, path: 'lib/missing.js' });
  expect(await runtime.execute(run, id(), { operation: 'list', path: 'lib' }, signal())).toMatchObject({ missing: true, path: 'lib' });
  expect(await runtime.execute(run, id(), { operation: 'write', path: 'lib/new.js', content: 'ok', expectedHash: null }, signal()))
    .toMatchObject({ path: 'lib/new.js' });
});

it('mints a scoped read ID, reuses its committed result, and rejects forged, cross-run, changed and revoked citations', async () => {
  const runtime = fixture();
  const callId = id();
  const read = await runtime.execute(run, callId, { operation: 'read', path: 'note.txt', offset: 0 }, signal()) as { evidenceId: string; hash: string };
  expect(read.evidenceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await runtime.execute(run, callId, { operation: 'read', path: 'note.txt', offset: 0 }, signal())).toEqual(read);
  await runtime.validateEvidence(run, [read.evidenceId], signal());
  await expect(runtime.validateEvidence(run, [id()], signal())).rejects.toThrow('không tồn tại');
  const otherRun = { ...run, id: id() };
  store.put('runs', otherRun, { column: 'task_id', value: task.id });
  await runtime.execute(otherRun, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal());
  await expect(runtime.validateEvidence(otherRun, [read.evidenceId], signal())).rejects.toThrow('ngoài lượt');
  await runtime.execute(run, id(), { operation: 'write', path: 'note.txt', content: 'changed', expectedHash: read.hash }, signal());
  await expect(runtime.validateEvidence(run, [read.evidenceId], signal())).rejects.toThrow('đã thay đổi');
  const fresh = await runtime.execute(run, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal()) as { evidenceId: string };
  await runtime.validateEvidence(run, [fresh.evidenceId], signal());
  grants.revoke(task.id);
  await expect(runtime.validateEvidence(run, [fresh.evidenceId], signal())).rejects.toThrow('Quyền workspace');
});

it.each(['openai', 'claude-code', 'codex', 'cursor'] as const)('keeps a cited workspace finding through the %s tool loop', async provider => {
  task = { ...task, brief: 'Report on note.txt', providerScopes: [provider] };
  run = { ...run, snapshot: { ...run.snapshot, worker: { ...run.snapshot.worker, provider } } };
  store.update('tasks', task);
  store.update('runs', run);
  const adapter: ModelAdapter = { request: async messages => {
    const last = messages.at(-1);
    const lastResult = last?.role === 'tool' ? JSON.parse(String(last.content)) : null;
    const name = lastResult?.evidenceId ? 'submit_report' : 'workspace_read';
    const args = name === 'workspace_read' ? { path: 'note.txt', offset: 0 } : {
      title: 'Workspace finding', summary: 'The file contains the original text.', limitations: [],
      findings: [{ title: 'Original text', severity: 'info', detail: 'note.txt contains original.',
        coverage: 'note.txt', sourceIds: [], workspaceEvidenceIds: [lastResult.evidenceId],
        category: 'other', recommendation: null, checkerIds: [], locations: [] }],
    };
    return { calls: [{ id: id(), name, arguments: JSON.stringify(args) }], usage: { input: 10, output: 10 } };
  } };
  const harness = provider === 'openai' ? undefined : {
    detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in' as const,
      status: 'signed_in' as const, version: 'fixture' }],
    execute: async (request: import('../../apps/desktop/src/core/harness/exec').HarnessRequest) => {
      const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
      const response = await adapter.request(context.messages, context.tools, request.signal, () => {});
      const selected = response.calls[0];
      return { output: { call: { name: selected.name, arguments: JSON.parse(selected.arguments) } }, costUsd: null };
    },
  };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, harness,
    undefined, undefined, fixture());
  await core.runner.run(task, run);
  const detail = store.detail(task.id);
  expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
  expect(detail.artifacts[0].report.findings).toMatchObject([{ title: 'Original text', sourceIds: [],
    workspaceEvidenceIds: [detail.workspaceEvidence[0].id] }]);
});

it.each((['claude-code', 'codex', 'cursor'] as const).flatMap(provider =>
  (['read', 'edit', 'conflict', 'cancel-integration'] as const).map(mode => ({ provider, mode }))))('routes $provider workspace operations through core (mode=$mode)', async ({ provider, mode }) => {
  const parent = new AbortController();
  run.snapshot.worker.provider = provider;
  task.providerScopes = [provider];
  store.update('runs', run);
  store.update('tasks', task);
  let calls = 0;
  const directories: string[] = [];
  const core = new CoreService(store, () => {}, async () => { throw new Error('Must not call the API adapter'); }, undefined, undefined, {
    detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
    execute: async request => {
      expect(request.coreToolsOnly).toBe(true);
      expect(request.cwd).not.toBe(source);
      directories.push(request.cwd);
      if (calls++ === 0) return { output: { call: { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } } }, costUsd: null };
      expect(request.prompt).toContain('original');
      if (mode !== 'read' && calls === 2) {
        const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
        const read = JSON.parse(context.messages.at(-1).content);
        return { output: { call: { name: 'workspace_write', arguments: { path: 'note.txt', expectedHash: read.hash, content: 'CLI edit' } } }, costUsd: null };
      }
      expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
      if (mode === 'conflict') await writeFile(join(source, 'note.txt'), 'user edit');
      return { output: { call: { name: 'reply', arguments: { message: 'Read the granted file', title: null, knowledgeProposals: [] } } }, costUsd: null };
    },
  }, undefined, undefined, fixture(async options => {
    options.authorize();
    if (mode === 'cancel-integration') {
      parent.abort(new Error('Parent deadline during integration'));
      options.signal.throwIfAborted();
    }
    const step = writeOf(options);
    const current = await readFile(join(step.root, step.path));
    const hash = createHash('sha256').update(current).digest('hex');
    if (hash !== step.expectedHash) return { status: 'conflict', hash, backupPath: '', created: false };
    await writeFile(join(step.root, step.path), step.bytes);
    return { status: 'applied', hash: createHash('sha256').update(step.bytes).digest('hex'), backupPath: '', created: false };
  }));
  await core.runner.run(task, run, { signal: parent.signal });
  const detail = store.detail(task.id);
  expect(detail.runs[0].error).toBe(mode === 'cancel-integration' ? 'Đã hủy. Request đã gửi có thể vẫn bị tính phí.'
    : mode === 'conflict' ? 'Workspace có xung đột; các tệp đã tích hợp được giữ lại.' : null);
  expect(detail.task.status).toBe(mode === 'cancel-integration' ? 'cancelled' : mode === 'conflict' ? 'failed' : 'completed');
  expect(detail.artifacts).toHaveLength(['conflict', 'cancel-integration'].includes(mode) ? 0 : 1);
  expect(calls).toBe(mode === 'read' ? 2 : 3);
  // Codex and Cursor write files into a fresh directory per call. Claude Code writes nothing and has no native tools,
  // and its working directory is part of the fixed prompt it sends, so a run keeps one directory (COD-183).
  expect(new Set(directories).size).toBe(provider === 'claude-code' ? 1 : calls);
  expect(store.db.prepare('SELECT state FROM tool_calls').all()).toEqual(Array.from({ length: calls - 1 }, () => ({ state: 'completed' })));
  expect(store.db.prepare('SELECT * FROM reservations').all()).toEqual([]);
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe(mode === 'edit' ? 'CLI edit' : mode === 'conflict' ? 'user edit' : 'original');
});

it('isolates writes until integration and refuses injected internal operations', async () => {
  const runtime = fixture();
  await edit(runtime);
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
  await expect(runtime.execute(run, id(), { operation: 'snapshot', source: directory }, signal())).rejects.toThrow('policy');
  await expect(runtime.execute(run, id(), { operation: 'blob', path: 'note.txt', offset: 0 }, signal())).rejects.toThrow('policy');
});

it('lets a planner inspect the granted workspace without write, command or web tools', async () => {
  const planRun: Run = { ...run, stage: 'plan' };
  store.update('runs', planRun);
  const names = toolsFor(planRun, task).map(tool => tool.type === 'function' ? tool.function.name : '');
  expect(names).toEqual(expect.arrayContaining(['submit_plan', 'workspace_list', 'workspace_read', 'workspace_search']));
  expect(names).not.toEqual(expect.arrayContaining(['workspace_write', 'workspace_start_process', 'web_search']));
  const runtime = fixture();
  const content = await runtime.execute(planRun, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal());
  expect(content).toMatchObject({ content: 'original' });
  grants.revoke(task.id);
  await expect(runtime.execute(planRun, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal())).rejects.toThrow();
});

it('does not complete a file assignment when its report claims success without any file changes', async () => {
  const memberRun: Run = { ...run, stage: 'member', snapshot: { ...run.snapshot, assignment: {
    workerId: run.snapshot.worker.id, brief: 'Update note.txt', expectedOutput: 'Changed note.txt', dependsOn: [], writeResources: ['note.txt'],
  } } };
  store.update('runs', memberRun);
  const adapter: ModelAdapter = { request: async () => ({ calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({
    title: 'Done', summary: 'I updated the note.', findings: [], limitations: [], assignmentOutcome: 'completed',
  }) }], usage: { input: 20, output: 20 } }) };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, fixture());
  await core.runner.run(task, memberRun, { keepTaskOpen: true });
  const detail = store.detail(task.id);
  expect(detail.runs[0].status).toBe('failed');
  expect(detail.artifacts[0].report.limitations).toContain('Phần việc được giao sửa tệp nhưng không tạo hoặc thay đổi tệp nào.');
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
});

it('lets Codex correct an invalid report without repeating a committed workspace write', async () => {
  run = { ...run, stage: 'member', snapshot: { ...run.snapshot,
    worker: { ...run.snapshot.worker, provider: 'codex' },
    assignment: { workerId: run.snapshot.worker.id, brief: 'Update note.txt', expectedOutput: 'Changed note.txt',
      dependsOn: [], writeResources: ['note.txt'] },
  } };
  task = { ...task, providerScopes: ['codex'] };
  store.update('runs', run);
  store.update('tasks', task);
  let requests = 0;
  const runtime = fixture(async options => {
    options.authorize();
    const step = writeOf(options);
    const current = await readFile(join(step.root, step.path));
    const hash = createHash('sha256').update(current).digest('hex');
    if (hash !== step.expectedHash) return { status: 'conflict', hash, backupPath: '', created: false };
    await writeFile(join(step.root, step.path), step.bytes);
    return { status: 'applied', hash: createHash('sha256').update(step.bytes).digest('hex'), backupPath: '', created: false };
  });
  const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected API dispatch'); },
    undefined, undefined, {
      detect: async () => [{ ...missingHarness('codex', 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
      execute: async request => {
        requests++;
        const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
        if (requests === 1) return { output: { call: { name: 'workspace_read', arguments: JSON.stringify({ path: 'note.txt', offset: 0 }) } }, costUsd: null };
        if (requests === 2) {
          const read = JSON.parse(context.messages.at(-1).content);
          return { output: { call: { name: 'workspace_write', arguments: JSON.stringify({ path: 'note.txt', expectedHash: read.hash, content: 'updated' }) } }, costUsd: null };
        }
        if (requests === 3) return { output: { call: { name: 'submit_report', arguments: JSON.stringify({
          title: 'UNSAFE_INVALID_BODY', findings: [], limitations: [], assignmentOutcome: 'completed',
        }) } }, costUsd: null };
        expect(context.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['submit_report']);
        expect(request.prompt).not.toContain('UNSAFE_INVALID_BODY');
        expect(String(store.db.prepare('SELECT data FROM checkpoints WHERE id=?').get(run.id)!.data)).not.toContain('UNSAFE_INVALID_BODY');
        return { output: { call: { name: 'submit_report', arguments: JSON.stringify({
          title: 'Updated note', summary: 'Updated note.txt.', findings: [], limitations: [], assignmentOutcome: 'completed',
        }) } }, costUsd: null };
      },
    }, undefined, undefined, runtime);
  await core.runner.run(task, run);
  const detail = store.detail(task.id);
  expect(requests).toBe(4);
  expect(detail.task.status).toBe('completed');
  expect(detail.events.some(event => event.message.includes('summary (invalid_type'))).toBe(true);
  expect(JSON.stringify(detail.events)).not.toContain('UNSAFE_INVALID_BODY');
  expect(store.db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE run_id=? AND replay='never'").get(run.id)!.count).toBe(1);
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('updated');
});

it.each(['claude-code', 'codex', 'cursor'] as const)('blocks cached workspace context after revocation for %s', async provider => {
  run.snapshot.worker.provider = provider;
  task.providerScopes = [provider];
  store.update('runs', run);
  store.update('tasks', task);
  const runtime = fixture();
  const execute = runtime.execute.bind(runtime);
  runtime.execute = async (...argumentsValue) => {
    const result = await execute(...argumentsValue);
    grants.revoke(task.id);
    return result;
  };
  let requests = 0;
  const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected API dispatch'); },
    undefined, undefined, {
      detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
      execute: async request => {
        requests++;
        expect(request.prompt).not.toContain('original');
        return { output: { call: { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } } }, costUsd: null };
      },
    }, undefined, undefined, runtime);
  await core.runner.run(task, run);
  expect(requests).toBe(1);
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('failed');
  expect(detail.artifacts).toHaveLength(0);
  expect(detail.runs[0].error).toMatch(/quyền|Quyền/);
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
});

it('inspects a conflicting private file without applying it and rechecks read permission', async () => {
  const runtime = fixture(async () => ({ status: 'conflict', hash: 'b'.repeat(64), backupPath: '', created: false }));
  await edit(runtime);
  await expect(runtime.finish(run, signal())).rejects.toThrow('xung đột');
  const input = { taskId: task.id, runId: run.id, path: 'note.txt', offset: 0 };
  const result = await runtime.inspectFile(input, () => false);
  expect(result.content).toBe('updated');
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
  await expect(runtime.inspectFile({ ...input, taskId: id() }, () => false)).rejects.toThrow('quyền');
  await expect(runtime.inspectFile(input, () => true)).rejects.toThrow('Dừng công việc');
  await expect(runtime.inspectFile({ ...input, path: '../outside' }, () => false)).rejects.toThrow();
  grants.revoke(task.id);
  await expect(runtime.inspectFile(input, () => false)).rejects.toThrow();
});

it('releases runner state even when stopping workspace processes fails', async () => {
  const runtime = fixture();
  runtime.stopRun = async () => { throw new Error('Fixture process cleanup failed'); };
  const core = new CoreService(store, () => {}, async () => { throw new Error('Fixture model unavailable'); },
    undefined, undefined, undefined, undefined, undefined, runtime);
  await expect(core.runner.run(task, run)).rejects.toThrow('Fixture process cleanup failed');
  expect(core.runner.isActive(task.id)).toBe(false);
  expect(store.detail(task.id).runs[0].status).toBe('failed');
  expect(store.detail(task.id).artifacts).toHaveLength(0);
});

it('exposes task-scoped recovery metadata without local directories, backups or cached file contents', async () => {
  const runtime = fixture(async () => ({ status: 'conflict', hash: 'b'.repeat(64), backupPath: join(directory, 'private-backup'), created: false }));
  await edit(runtime);
  await expect(runtime.finish(run, signal())).rejects.toThrow('xung đột');
  const recovery = new WorkspaceRecovery(store);
  const view = recovery.view(task.id);
  expect(view.copies).toHaveLength(1);
  expect(view.copies[0]).toMatchObject({ runId: run.id, state: 'conflict', changeCount: 1,
    changes: [{ path: 'note.txt', status: 'conflict' }] });
  expect(JSON.stringify(view)).not.toContain(directory.replaceAll('\\', '\\\\'));
  expect(JSON.stringify(view)).not.toContain('private-backup');
  expect(JSON.stringify(view)).not.toContain('original');
  const otherTask = { ...task, id: id() };
  store.put('tasks', otherTask);
  expect(recovery.view(otherTask.id)).toEqual({ taskId: otherTask.id, attempts: [], copies: [], processes: [], uncertainCalls: [], truncated: false });
  expect(() => recovery.view(id())).toThrow();
});

it('retires a reviewed conflict without changing files and permits only a fresh attempt', async () => {
  const runtime = fixture(async () => ({ status: 'conflict', hash: 'b'.repeat(64), backupPath: 'retained-backup', created: false }));
  await edit(runtime);
  await expect(runtime.finish(run, signal())).rejects.toThrow('xung đột');
  store.update('tasks', { ...task, status: 'failed' });
  store.update('runs', { ...run, status: 'failed' });
  const recovery = new WorkspaceRecovery(store);
  const input = { taskId: task.id, runId: run.id, reviewToken: recovery.view(task.id).attempts[0].reviewToken, keepCurrentFiles: true };
  expect(() => recovery.retire(input, () => true)).toThrow('Dừng công việc');
  expect(() => recovery.retire({ ...input, reviewToken: '0'.repeat(64) }, () => false)).toThrow('đã thay đổi');
  recovery.retire(input, () => false);
  recovery.retire(input, () => false);
  expect(recovery.view(task.id).attempts[0].retired).toBe(true);
  expect(store.get<Run>('runs', run.id).status).toBe('failed');
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
  await expect(runtime.execute(run, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal())).rejects.toThrow('đã kết thúc');
  const next: Run = { ...run, id: id(), status: 'queued' };
  store.put('runs', next, { column: 'task_id', value: task.id });
  const read = await runtime.execute(next, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal()) as { hash: string };
  await expect(runtime.execute(next, id(), { operation: 'write', path: 'note.txt', expectedHash: read.hash, content: 'fresh attempt' }, signal())).resolves.toBeDefined();
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
});

it('enforces assignment ownership and task identity independently of model arguments', async () => {
  const runtime = fixture();
  run.snapshot.team = { id: id(), name: 'Team', revision: 1, memberIds: [run.snapshot.worker.id], synthesizerId: run.snapshot.worker.id,
    workflow: 'parallel', instructions: '', monthlyBudgetMicros: 5_000_000 };
  run.snapshot.assignment = { workerId: run.snapshot.worker.id, brief: 'Only another file', writeResources: ['another.txt'] };
  store.update('runs', run);
  await expect(edit(runtime)).rejects.toThrow('phạm vi được giao');
  const forged = { ...run, taskId: id() };
  await expect(runtime.execute(forged, id(), { operation: 'list', path: '' }, signal())).rejects.toThrow('quyền workspace');
  grants.revoke(task.id);
  await expect(runtime.execute(run, id(), { operation: 'list', path: '' }, signal())).rejects.toThrow('đã thay đổi');
});

it('serializes writes and never applies conflicts or unknown results as success', async () => {
  const runtime = fixture(async () => ({ status: 'conflict', hash: 'b'.repeat(64), backupPath: 'unused', created: false }));
  await edit(runtime);
  await expect(runtime.finish(run, signal())).rejects.toThrow('xung đột');
  const copy = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies').get()!.data));
  expect(copy.state).toBe('conflict');
  expect(copy.changes[0].status).toBe('conflict');
  expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
});

it('keeps partial integration records and prevents reapplication after restart', async () => {
  await writeFile(join(source, 'second.txt'), 'original');
  let attempts = 0;
  const runtime = fixture(async () => {
    if (++attempts === 2) throw new Error('broker crashed');
    return { status: 'applied', hash: 'b'.repeat(64), backupPath: 'retained-original', created: false };
  });
  await edit(runtime);
  await edit(runtime, 'second.txt');
  await expect(runtime.finish(run, signal())).rejects.toThrow('broker crashed');
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
  const copy = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies').get()!.data));
  expect(copy.state).toBe('uncertain');
  expect(copy.changes.map((change: { status: string }) => change.status)).toEqual(['applied', 'pending']);
  await expect(fixture().finish(run, signal())).rejects.toThrow('bị gián đoạn');
  const retry = { ...run, id: id() };
  store.put('runs', retry, { column: 'task_id', value: task.id });
  await expect(fixture().execute(retry, id(), { operation: 'write', path: 'new.txt', expectedHash: null, content: 'retry' }, signal()))
    .rejects.toThrow('bị gián đoạn');
  await expect(fixture().finish(retry, signal())).rejects.toThrow('bị gián đoạn');
  expect(attempts).toBe(2);
});

it.each(['claude-code', 'codex', 'cursor'] as const)('advertises only granted workspace tools to %s', provider => {
  run.snapshot.worker.provider = provider;
  const names = toolsFor(run, task).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
  expect(names).toContain('workspace_read');
  expect(names).toContain('workspace_write');
  expect(names).not.toContain('workspace_start_process');
  run.snapshot.workspaceGrant = undefined;
  expect(toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name.startsWith('workspace_'))).toBe(false);
});

it('blocks file access while a command owns the copy and waits for its cancellation', async () => {
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
  run.snapshot.workspaceGrant = grants.snapshot(task.id);
  store.update('runs', run);
  let stopped = false;
  const runtime = fixture(undefined, { runCommand: async (_directory, _input, abort) => new Promise(resolve => {
    abort.addEventListener('abort', () => {
      stopped = true;
      resolve({ termination: 'cancelled', exitCode: null, stdout: '', stderr: '' });
    }, { once: true });
  }) });
  try {
    const started = await runtime.processTool(run, id(), 'workspace_start_process', {
      program: 'node', arguments: ['check.cjs'], timeoutMs: 10000,
    }, signal(), signal()) as { processId: string };
    await expect(runtime.execute(run, id(), { operation: 'read', path: 'note.txt', offset: 0 }, signal())).rejects.toThrow('còn chạy');
    await expect(runtime.finish(run, signal())).rejects.toThrow('còn chạy');
    expect(await runtime.processTool(run, id(), 'workspace_cancel_process', { processId: started.processId }, signal(), signal())).toMatchObject({ state: 'cancelled' });
    expect(stopped).toBe(true);
    await expect(runtime.finish(run, signal())).rejects.toThrow('chưa hoàn tất thành công');
  } finally { await runtime.stopRun(run.id); }
});

describe('judges the code the run hands in, not every command it ever ran (COD-189)', () => {
  let exitCode = 0;
  let applied: string[] = [];
  const staleFailure = 'Lệnh chạy trước lần sửa tệp cuối đã thất bại và chưa được chạy lại: node test --grep thumbnails (mã thoát 1).';
  beforeEach(async () => {
    exitCode = 0;
    applied = [];
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
    run.snapshot.workspaceGrant = grants.snapshot(task.id);
    store.update('runs', run);
  });
  const judged = () => fixture(async request => {
    applied.push(request.path);
    return { status: 'applied', hash: 'b'.repeat(64), backupPath: 'retained-original', created: false };
  }, { runCommand: async () => ({ termination: 'exited', exitCode, stdout: '', stderr: '' }) });
  async function command(runtime: WorkspaceRuntime, argumentsValue: string[], code: number) {
    exitCode = code;
    const status = await runtime.processTool(run, id(), 'workspace_start_process',
      { program: 'node', arguments: argumentsValue, timeoutMs: 10000 }, signal(), signal()) as { state: string; exitCode: number };
    expect(status).toMatchObject({ state: 'exited', exitCode: code });
  }
  const copyState = () => JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies').get()!.data)).state;

  it('integrates when the same command passes after the edit', async () => {
    const runtime = judged();
    await command(runtime, ['test'], 1);
    await edit(runtime);
    await command(runtime, ['test'], 0);
    expect(await runtime.finish(run, signal())).toEqual([]);
    expect(copyState()).toBe('integrated');
    expect(applied).toEqual(['note.txt']);
  });

  it('integrates when a different command passes after the edit and reports the stale failure', async () => {
    const runtime = judged();
    await command(runtime, ['test', '--grep', 'thumbnails'], 1);
    await edit(runtime);
    await command(runtime, ['test'], 0);
    expect(await runtime.finish(run, signal())).toEqual([staleFailure]);
    expect(copyState()).toBe('integrated');
    expect(applied).toEqual(['note.txt']);
  });

  it('still blocks a failure after the last edit, and a write that changed nothing does not move it', async () => {
    const runtime = judged();
    await edit(runtime);
    await command(runtime, ['test'], 1);
    await expect(runtime.finish(run, signal())).rejects.toThrow('chưa hoàn tất thành công');
    await edit(runtime, 'note.txt', 'updated');
    await expect(runtime.finish(run, signal())).rejects.toThrow('chưa hoàn tất thành công');
    expect(copyState()).toBe('ready');
    expect(applied).toEqual([]);
  });

  it('still blocks a failed command when no file changed', async () => {
    const runtime = judged();
    await command(runtime, ['test'], 1);
    await command(runtime, ['--version'], 0);
    await expect(runtime.finish(run, signal())).rejects.toThrow('chưa hoàn tất thành công');
    expect(applied).toEqual([]);
  });

  it('carries the stale failure into the report through Runner', async () => {
    task = { ...task, providerScopes: ['openai'] };
    store.update('tasks', task);
    let step = 0;
    const adapter: ModelAdapter = { request: async () => {
      const calls = [
        { name: 'workspace_write', arguments: { path: 'store.js', expectedHash: null, content: 'first' } },
        { name: 'workspace_start_process', arguments: { program: 'node', arguments: ['test', '--grep', 'thumbnails'], timeoutMs: 10000 } },
        { name: 'workspace_write', arguments: { path: 'store.js', expectedHash: createHash('sha256').update('first').digest('hex'), content: 'second' } },
        { name: 'workspace_start_process', arguments: { program: 'node', arguments: ['test'], timeoutMs: 10000 } },
        { name: 'reply', arguments: { message: 'Store fixed and tests pass.', title: null, knowledgeProposals: [] } },
      ];
      const call = calls[step++];
      if (call.name === 'workspace_start_process') exitCode = step === 2 ? 1 : 0;
      return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
    } };
    const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, judged());
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
    expect(detail.artifacts[0].report.limitations).toEqual([staleFailure]);
    expect(applied).toEqual(['store.js']);
  });
});

describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1')('API fixture using packaged workspace executors', () => {
  it.each(['openai', 'claude-code', 'codex', 'cursor'] as const)('plans, edits, checks, hands off, integrates and synthesizes one %s team request', async provider => {
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE!),
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      stateDirectory: join(directory, 'state'), runtimeExecutable: resolve('out/Orglet-win32-x64/Orglet.exe'),
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, process.env.ORGLET_TEST_INTEGRATION_EXECUTABLE!, join(directory, 'state')), undefined, files);
    let writerStep = 0;
    let reviewerStep = 0;
    let reviewerId = '';
    let processId = '';
    let handoffId = '';
    let synthesized = false;
    let reviewerEvidenceId = '';
    const adapter: ModelAdapter = { request: async (messages, tools) => {
      const call = (name: string, argumentsValue: unknown) => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 10, output: 10 } });
      // A member's report says whether its assignment is done (COD-125); the synthesis report has no assignment.
      const report = (summary: string, evidenceId?: string, member = true) => call('submit_report', { title: 'Workspace result', summary,
        findings: evidenceId ? [{ title: 'Integrated file checked', severity: 'info', detail: 'note.txt contains the integrated edit.',
          coverage: 'note.txt', sourceIds: [], workspaceEvidenceIds: [evidenceId], category: 'other', recommendation: null,
          checkerIds: [], locations: [] }] : [], limitations: [], ...(member ? { assignmentOutcome: 'completed' } : {}) });
      if (isPlanRequest(tools)) {
        const [writerId, recipient] = memberIdsFromPlanPrompt(messages);
        reviewerId = recipient;
        return call('submit_plan', { assignments: [
          { workerId: writerId, brief: 'e2e-writer', expectedOutput: 'Checked note.txt', writeResources: ['note.txt'], dependsOn: [] },
          { workerId: reviewerId, brief: 'e2e-reviewer', expectedOutput: 'Review saved note.txt', writeResources: [], dependsOn: [writerId] },
        ] });
      }
      const context = messages.map(message => String(message.content)).join('\n');
      if (context.includes('"assignment":"e2e-writer')) {
        const step = writerStep++;
        if (step === 0) return call('workspace_read', { path: 'note.txt', offset: 0 });
        if (step === 1) return call('workspace_write', { path: 'note.txt', content: 'team checked edit', expectedHash: JSON.parse(String(messages.at(-1)!.content)).hash });
        if (step === 2) return call('workspace_start_process', { program: 'node', timeoutMs: 5000,
          arguments: ['-e', "if(require('node:fs').readFileSync('note.txt','utf8')!=='team checked edit')throw Error('bad edit');console.log('team-check-ok')"] });
        if (step === 3) {
          processId = JSON.parse(String(messages.at(-1)!.content)).processId;
          return call('workspace_process_status', { processId, waitMs: 10000 });
        }
        if (step === 4) {
          expect(JSON.parse(String(messages.at(-1)!.content))).toMatchObject({ state: 'exited', exitCode: 0 });
          return call('workspace_process_output', { processId, stream: 'stdout', offset: 0 });
        }
        if (step === 5) {
          expect(JSON.parse(String(messages.at(-1)!.content)).content).toContain('team-check-ok');
          expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
          return call('send_team_message', { recipientId: reviewerId, kind: 'handoff', body: `note.txt checked; process ${processId}`, replyTo: null });
        }
        expect(step).toBe(6);
        handoffId = JSON.parse(String(messages.at(-1)!.content)).id;
        return report('Writer checked note.txt');
      }
      if (context.includes('"assignment":"e2e-reviewer')) {
        const step = reviewerStep++;
        if (step === 0) {
          expect(context).toContain(processId);
          expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('team checked edit');
          return call('acknowledge_team_messages', { messageIds: [handoffId] });
        }
        if (step === 1) return call('workspace_read', { path: 'note.txt', offset: 0 });
        const read = JSON.parse(String(messages.at(-1)!.content));
        expect(read.content).toBe('team checked edit');
        reviewerEvidenceId = read.evidenceId;
        return report('Reviewer confirmed integrated note.txt', reviewerEvidenceId);
      }
      expect(context).toContain('Writer checked note.txt');
      expect(context).toContain('Reviewer confirmed integrated note.txt');
      synthesized = true;
      return report('Team finished checked note.txt', undefined, false);
    } };
    const harness = provider === 'openai' ? undefined : {
      detect: async () => [{ ...missingHarness(provider, 'win32'), executable: 'fixture', auth: 'logged_in' as const,
        status: 'signed_in' as const, version: 'fixture' }],
      execute: async (request: import('../../apps/desktop/src/core/harness/exec').HarnessRequest) => {
        expect(request.coreToolsOnly).toBe(true);
        const context = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
        const reply = await adapter.request(context.messages, context.tools, request.signal, () => {});
        const selected = reply.calls[0];
        return { output: { call: { name: selected.name, arguments: JSON.parse(selected.arguments) } }, costUsd: null };
      },
    };
    const core = new CoreService(store, () => {}, async () => {
      expect(provider).toBe('openai');
      return adapter;
    }, undefined, undefined, harness, undefined, undefined, runtime);
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    for (const workerId of [...team.memberIds, team.synthesizerId]) {
      const worker = store.get<Worker>('workers', workerId);
      await core.command('saveWorker', { ...worker, provider });
    }
    task = { ...task, providerScopes: [provider], teamId: team.id, teamSnapshot: team, workerId: team.synthesizerId };
    store.update('tasks', task);
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
    await core.teams.run(task, team);
    const detail = store.detail(task.id);
    expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
    expect(synthesized).toBe(true);
    expect(detail.artifacts).toHaveLength(3);
    expect(detail.artifacts.find(artifact => artifact.report.summary === 'Reviewer confirmed integrated note.txt')?.report.findings[0].workspaceEvidenceIds).toEqual([reviewerEvidenceId]);
    expect(detail.events.find(event => event.id === handoffId)?.teamMessage?.state).toBe('acknowledged');
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('team checked edit');
  });
  it.each([false, true])('tidies an inbox through Runner, the packaged helper and broker: folders, moves, a deletion and a restore (COD-254, person edits a file meanwhile: %s)', async personEdits => {
    const photo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10]);
    await writeFile(join(source, 'IMG_0412.png'), photo);
    await writeFile(join(source, 'contract-final.pdf'), 'contract v2');
    await writeFile(join(source, 'contract (1).pdf'), 'contract v1');
    await writeFile(join(source, 'receipt 3.pdf'), 'receipt march');
    await mkdir(join(source, 'old scans'));
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE!),
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      stateDirectory: join(directory, 'state'), runtimeExecutable: resolve('out/Orglet-win32-x64/Orglet.exe'),
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, process.env.ORGLET_TEST_INTEGRATION_EXECUTABLE!, join(directory, 'state')), undefined, files);
    const calls = [
      { name: 'workspace_list', arguments: { path: '' } },
      { name: 'workspace_create_folder', arguments: { path: 'receipts' } },
      { name: 'workspace_create_folder', arguments: { path: 'contracts' } },
      { name: 'workspace_move', arguments: { from: 'receipt 3.pdf', to: 'receipts/2026-03 receipt.pdf' } },
      { name: 'workspace_move', arguments: { from: 'contract-final.pdf', to: 'contracts/lease 2026.pdf' } },
      { name: 'workspace_move', arguments: { from: 'IMG_0412.png', to: 'images/office photo.png' } },
      { name: 'workspace_move', arguments: { from: 'note.txt', to: 'notes/note.txt' } },
      { name: 'workspace_delete', arguments: { path: 'contract (1).pdf' } },
      { name: 'workspace_delete', arguments: { path: 'old scans' } },
      { name: 'workspace_write', arguments: { path: 'notes/index.md', expectedHash: null, content: '# Inbox\n' } },
      { name: 'reply', arguments: { message: 'Sorted the inbox.', title: null, knowledgeProposals: [] } },
    ];
    let step = 0;
    const adapter: ModelAdapter = { request: async (_messages, tools) => {
      const call = calls[step++];
      expect(tools.some(tool => tool.type === 'function' && tool.function.name === call.name)).toBe(true);
      if (call.name === 'reply') {
        // Nothing reached the person's folder before the answer.
        expect(await readFile(join(source, 'receipt 3.pdf'), 'utf8')).toBe('receipt march');
        if (personEdits) await writeFile(join(source, 'IMG_0412.png'), 'the person replaced the photo');
      }
      return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
    } };
    const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    const copy = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies').get()!.data));
    const statuses = copy.changes.map((change: { kind: string; path: string; status: string }) => `${change.kind} ${change.path} ${change.status}`);
    if (personEdits) {
      expect(detail.task.status).toBe('failed');
      expect(detail.artifacts).toHaveLength(0);
      expect(copy.state).toBe('conflict');
      expect(statuses).toContain('move images/office photo.png conflict');
      expect(copy.changes.find((change: { kind: string; path: string }) => change.path === 'images/office photo.png').conflict).toBe('changed');
      expect(await readFile(join(source, 'IMG_0412.png'), 'utf8')).toBe('the person replaced the photo');
      // Everything the person had is still in the folder: the steps after the conflict never ran.
      expect(await readFile(join(source, 'contract (1).pdf'), 'utf8')).toBe('contract v1');
      expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
      expect(await readdir(join(source, 'old scans'))).toEqual([]);
      return;
    }
    expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
    expect(copy.state).toBe('integrated');
    expect(statuses).toEqual([
      'folder contracts applied', 'folder images applied', 'folder notes applied', 'folder receipts applied',
      'move contracts/lease 2026.pdf applied', 'move images/office photo.png applied', 'move notes/note.txt applied',
      'move receipts/2026-03 receipt.pdf applied',
      'write notes/index.md applied', 'delete contract (1).pdf applied', 'remove_folder old scans applied',
    ]);
    expect((await readdir(source)).sort()).toEqual(['contracts', 'images', 'notes', 'receipts']);
    expect(await readFile(join(source, 'images', 'office photo.png'))).toEqual(photo);
    expect(await readFile(join(source, 'contracts', 'lease 2026.pdf'), 'utf8')).toBe('contract v2');
    expect(await readFile(join(source, 'notes', 'index.md'), 'utf8')).toBe('# Inbox\n');
    const deleted = copy.changes.find((change: { kind: string }) => change.kind === 'delete');
    expect(await readFile(deleted.backupPath, 'utf8')).toBe('contract v1');
    const diff = await runtime.diff({ taskId: task.id, runId: run.id });
    expect(diff.lines).toBe(false);
    expect(diff.files.find(file => file.path === 'images/office photo.png')).toMatchObject({ status: 'renamed', previousPath: 'IMG_0412.png' });
    expect(diff.folders).toEqual(expect.arrayContaining([{ path: 'old scans', status: 'deleted' }]));
    await runtime.restore({ taskId: task.id, runId: run.id, path: 'contract (1).pdf' }, () => false);
    expect(await readFile(join(source, 'contract (1).pdf'), 'utf8')).toBe('contract v1');
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE state!='completed'").get()!.count).toBe(0);
  });

  it.each([{ conflict: false, checkFails: false }, { conflict: true, checkFails: false }, { conflict: false, checkFails: true }])(
    'edits, runs a check and integrates through Runner: %j', async ({ conflict, checkFails }) => {
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write', 'execute'] });
    run.snapshot.workspaceGrant = grants.snapshot(task.id);
    store.update('runs', run);
    const files = new WorkspaceFilesRuntime({
      sandbox: new WindowsSandbox(process.env.ORGLET_TEST_SANDBOX_EXECUTABLE!),
      helperPath: resolve('out/Orglet-win32-x64/resources/workspace-helper.cjs'),
      stateDirectory: join(directory, 'state'), runtimeExecutable: resolve('out/Orglet-win32-x64/Orglet.exe'),
    });
    const runtime = new WorkspaceRuntime(store, files,
      new WorkspaceIntegration(store, process.env.ORGLET_TEST_INTEGRATION_EXECUTABLE!, join(directory, 'state')), undefined, files);
    let step = 0;
    let processId = '';
    const adapter: ModelAdapter = { request: async (messages, tools) => {
      expect(tools.some(tool => tool.type === 'function' && tool.function.name === 'workspace_write')).toBe(true);
      let name: string;
      let argumentsValue: unknown;
      if (step === 0) { name = 'workspace_read'; argumentsValue = { path: 'note.txt', offset: 0 }; }
      else if (step === 1) {
        const result = JSON.parse(String(messages.at(-1)!.content));
        expect(result.content).toBe('original');
        name = 'workspace_write'; argumentsValue = { path: 'note.txt', content: 'agent edit', expectedHash: result.hash };
      } else if (step === 2) {
        name = 'workspace_start_process';
        argumentsValue = { program: 'node', timeoutMs: 5000, arguments: ['-e',
          `if(require('node:fs').readFileSync('note.txt','utf8')!=='agent edit')throw Error('wrong copy');console.log('checked private edit');process.exit(${checkFails ? 1 : 0})`] };
      } else if (step === 3) {
        processId = JSON.parse(String(messages.at(-1)!.content)).processId;
        name = 'workspace_process_status'; argumentsValue = { processId, waitMs: 10000 };
      } else if (step === 4) {
        expect(JSON.parse(String(messages.at(-1)!.content))).toMatchObject({ state: 'exited', exitCode: checkFails ? 1 : 0 });
        name = 'workspace_process_output'; argumentsValue = { processId, stream: 'stdout', offset: 0 };
      } else {
        expect(JSON.parse(String(messages.at(-1)!.content)).content).toContain('checked private edit');
        expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe('original');
        if (conflict) await writeFile(join(source, 'note.txt'), 'user edit');
        name = 'reply'; argumentsValue = { message: 'Updated note.txt', title: null, knowledgeProposals: [] };
      }
      step++;
      return { calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 10, output: 10 } };
    } };
    const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime);
    await core.runner.run(task, run);
    const detail = store.detail(task.id);
    expect(detail.runs[0].error).toBe(checkFails ? 'Có lệnh chưa hoàn tất thành công. Xem đầu ra và kiểm tra lại trước khi tích hợp.'
      : conflict ? 'Workspace có xung đột; các tệp đã tích hợp được giữ lại.' : null);
    expect(detail.task.status).toBe(conflict || checkFails ? 'failed' : 'completed');
    expect(detail.artifacts).toHaveLength(conflict || checkFails ? 0 : 1);
    expect(await readFile(join(source, 'note.txt'), 'utf8')).toBe(checkFails ? 'original' : conflict ? 'user edit' : 'agent edit');
    const copy = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies').get()!.data));
    expect(copy.state).toBe(checkFails ? 'ready' : conflict ? 'conflict' : 'integrated');
    if (!conflict && !checkFails) expect(await readFile(copy.changes[0].backupPath, 'utf8')).toBe('original');
  });
});

it('keeps reported CLI costs across tool steps and resume without charging the API ledger', async () => {
  run.snapshot.worker.provider = 'claude-code';
  task.providerScopes = ['claude-code'];
  store.update('runs', run);
  store.update('tasks', task);
  const budgets: number[] = [];
  const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected API dispatch'); },
    undefined, undefined, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
      execute: async request => {
        budgets.push(request.maxBudgetUsd);
        if (budgets.length <= 2) return {
          output: { call: { name: 'workspace_read', arguments: { path: 'note.txt', offset: 0 } } },
          costUsd: budgets.length === 1 ? 3 : 2,
        };
        return { output: { call: { name: 'reply', arguments: { message: 'Read complete', title: null, knowledgeProposals: [] } } }, costUsd: 1 };
      },
    }, undefined, undefined, fixture());
  await core.runner.run(task, run);
  expect(budgets).toEqual([5, 2]);
  expect(store.detail(task.id).task.status).toBe('waiting_budget');
  const checkpoint = JSON.parse(String(store.db.prepare('SELECT data FROM checkpoints WHERE id=?').get(run.id)!.data));
  expect(checkpoint.phase).toBe('ready');
  expect(checkpoint.harnessCostMicros).toBe(5_000_000);
  task = { ...store.get<Task>('tasks', task.id), budgetMicros: 7_000_000 };
  store.update('tasks', task);
  await core.runner.run(task, store.get<Run>('runs', run.id));
  expect(budgets).toEqual([5, 2, 2]);
  expect(store.detail(task.id).task.status).toBe('completed');
  expect(store.detail(task.id).artifacts).toHaveLength(1);
  expect(store.db.prepare('SELECT * FROM reservations').all()).toEqual([]);
});

it('keeps the CLI call directory and reports failure when cancellation cannot confirm termination', async () => {
  const parent = new AbortController();
  let callDirectory = '';
  run.snapshot.worker.provider = 'codex';
  task.providerScopes = ['codex'];
  store.update('runs', run);
  store.update('tasks', task);
  const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected API dispatch'); },
    undefined, undefined, {
      detect: async () => [{ ...missingHarness('codex', 'win32'), executable: 'fixture', auth: 'logged_in', status: 'signed_in', version: 'fixture' }],
      execute: async request => {
        callDirectory = request.cwd;
        await writeFile(join(callDirectory, 'retained.txt'), 'Inspect before retrying');
        parent.abort();
        throw new HarnessTerminationError();
      },
    }, undefined, undefined, fixture());
  try {
    await core.runner.run(task, run, { signal: parent.signal });
    const detail = store.detail(task.id);
    expect(detail.task.status).toBe('failed');
    expect(detail.runs[0].error).toContain('Không xác nhận được harness đã dừng');
    expect(detail.artifacts).toHaveLength(0);
    expect(await readFile(join(callDirectory, 'retained.txt'), 'utf8')).toBe('Inspect before retrying');
    expect(() => core.runner.assertResumable(detail.runs[0])).toThrow('chưa rõ kết quả');
  } finally {
    if (callDirectory) {
      const retainedRoot = resolve(dirname(callDirectory));
      expect(dirname(retainedRoot).toLowerCase()).toBe(resolve(tmpdir()).toLowerCase());
      expect(basename(retainedRoot)).toMatch(/^orglet-tool-harness-/);
      await rm(retainedRoot, { recursive: true, force: true });
    }
  }
});
