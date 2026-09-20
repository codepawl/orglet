import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { executeReadTool, hasCapability } from '../../apps/desktop/src/core/tools/policy';
import { assertToolCall, toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { snapshotCapabilities, ToolCapabilities } from '../../apps/desktop/src/shared/tool-policy';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { missingHarness } from '../../apps/desktop/src/shared/harness';
import { Backups } from '../../apps/desktop/src/core/storage/backup';

let store: Store;
let directory: string;
beforeEach(async () => {
  store = new Store(':memory:');
  directory = await mkdtemp(join(tmpdir(), 'orglet-tool-policy-'));
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

function fixture() {
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: 'Read the note', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000, status: 'queued', accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, status: 'queued', snapshot: { worker, skill }, startedAt: now(), error: null };
  store.put('tasks', task);
  store.put('runs', run, { column: 'task_id', value: task.id });
  return { task, run };
}

describe('tool policy boundary', () => {
  it('rejects unknown capabilities and keeps new harness capabilities opt-in', () => {
    expect(ToolCapabilities.safeParse(['shell']).success).toBe(false);
    expect(ToolCapabilities.safeParse(['source.read', 'source.read']).success).toBe(false);
    for (const provider of ['claude-code', 'codex', 'cursor']) {
      expect(snapshotCapabilities(provider, ['dataset.check'])).toEqual(['dataset.check']);
      expect(snapshotCapabilities(provider)).toEqual(['source.read', 'skill.read']);
    }
  });

  it('intersects frozen and current permissions without upgrading a run', () => {
    const { task, run } = fixture();
    run.snapshot.toolCapabilities = [];
    task.toolCapabilities = ['source.read'];
    expect(hasCapability(run, task, 'source.read')).toBe(false);
    run.snapshot.toolCapabilities = ['source.read'];
    task.toolCapabilities = [];
    expect(hasCapability(run, task, 'source.read')).toBe(false);
    expect(() => assertToolCall(run, task, 'read_source', JSON.stringify({ sourceId: id() }))).toThrow('policy');
    expect(toolsFor(run, task).map(tool => tool.type === 'function' && tool.function.name)).toEqual(['record_work_frame', 'request_user_decision', 'submit_report', 'reply']);
  });

  it('rejects invalid arguments and calls outside the run stage', () => {
    const { task, run } = fixture();
    expect(() => assertToolCall(run, task, 'read_source', '{"sourceId":"../file"}')).toThrow();
    expect(() => assertToolCall(run, task, '__proto__', '{}')).toThrow('policy');
    run.stage = 'plan';
    expect(() => assertToolCall(run, task, 'reply', '{"message":"skip plan"}')).toThrow('policy');
  });

  it('blocks a model calling a denied tool despite its instructions', async () => {
    const { task, run } = fixture();
    task.toolCapabilities = [];
    store.update('tasks', task);
    const reply: ModelReply = { calls: [{ id: id(), name: 'read_source', arguments: JSON.stringify({ sourceId: id() }) }], usage: { input: 1, output: 1 } };
    const core = new CoreService(store, () => {}, async () => ({ request: async () => reply }));
    await core.runner.run(task, run);
    expect(store.detail(task.id).task.status).toBe('failed');
    expect(store.detail(task.id).artifacts).toEqual([]);
    expect(store.detail(task.id).runs[0].snapshot.toolCapabilities).toEqual([]);
  });

  it('does not expose a read result when permission is revoked during IO', async () => {
    let allowed = true;
    await expect(executeReadTool({ signal: new AbortController().signal, timeoutMs: 1000,
      authorize: () => { if (!allowed) throw new Error('revoked'); },
      execute: async () => { allowed = false; return 'private result'; },
    })).rejects.toThrow('revoked');
  });

  it('restores history without restoring task grants', () => {
    const { task, run } = fixture();
    task.toolCapabilities = ['source.read'];
    run.snapshot.toolCapabilities = ['source.read'];
    store.update('tasks', task);
    store.update('runs', run);
    const backup = new Backups(store, () => false, () => {}).export();
    const restored = new Store(':memory:');
    try {
      const manager = new Backups(restored, () => false, () => {});
      manager.restore(manager.preview(backup).token);
      expect(restored.get<Task>('tasks', task.id).toolCapabilities).toEqual([]);
      expect(restored.get<Run>('runs', run.id).snapshot.toolCapabilities).toEqual(['source.read']);
    } finally {
      restored.close();
    }
  });

  it('cancels an active API request when capabilities are reduced', async () => {
    const { task, run } = fixture();
    let announceStarted: () => void = () => {};
    const started = new Promise<void>(resolve => { announceStarted = resolve; });
    const core = new CoreService(store, () => {}, async () => ({ request: async (_messages, _tools, signal) => {
      announceStarted();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } }));
    const running = core.runner.run(task, run);
    await started;
    await core.command('setToolCapabilities', { taskId: task.id, capabilities: [] });
    await running;
    expect(store.detail(task.id).task.status).toBe('cancelled');
    expect(store.detail(task.id).artifacts).toEqual([]);
    expect(store.detail(task.id).task.toolCapabilities).toEqual([]);
  });

  it('times out and cancels an unresponsive tool without waiting for its result', async () => {
    await expect(executeReadTool({ signal: new AbortController().signal, timeoutMs: 5,
      authorize: () => {}, execute: () => new Promise(() => {}),
    })).rejects.toThrow('thời gian');
    const controller = new AbortController();
    const pending = executeReadTool({ signal: controller.signal, timeoutMs: 1000,
      authorize: () => {}, execute: () => new Promise(() => {}),
    });
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it.each(['claude-code', 'codex', 'cursor'] as const)('does not give denied source bytes to %s', async provider => {
    const { task, run } = fixture();
    run.snapshot.worker.provider = provider;
    task.providerScopes = [provider];
    task.toolCapabilities = [];
    let executed = false;
    const core = new CoreService(store, () => {}, async () => { throw new Error('Unexpected API'); }, undefined, undefined, {
      detect: async () => [{ ...missingHarness(provider, process.platform), executable: 'fixture.exe', auth: 'logged_in', status: 'signed_in' }],
      execute: async request => {
        executed = true;
        expect(await readdir(join(request.cwd, 'sources'))).toEqual([]);
        expect(request.prompt).not.toContain('unique-private-bytes');
        return { output: { message: 'No source access', title: null, report: null }, costUsd: null };
      },
    });
    const sourcePath = join(directory, 'note.txt');
    await writeFile(sourcePath, 'unique-private-bytes');
    const [source] = await core.sources.import([sourcePath]);
    task.sourceIds = [source.id];
    store.update('tasks', task);
    store.update('runs', run);
    await core.runner.run(task, run);
    expect(executed).toBe(true);
    expect(store.detail(task.id).task.status).toBe('completed');
  });
});
