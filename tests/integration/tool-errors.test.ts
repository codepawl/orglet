import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants } from '../../apps/desktop/src/core/storage/workspace-grants';
import { ToolCalls } from '../../apps/desktop/src/core/storage/tool-calls';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import { withoutCopyPaths } from '../../apps/desktop/src/core/tools/workspace-files-runtime';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { toolCallRefusal } from '../../apps/desktop/src/core/orchestration/permission-hints';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelAdapter, ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import type { Run, Skill, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ToolCapability } from '../../apps/desktop/src/shared/tool-policy';
import { entriesOfEvents } from '../../apps/desktop/src/renderer/turnTrace';
import { isPlanRequest, memberIdsFromPlanPrompt } from './team-plan';

/*
 * COD-289, dogfood round 6. Ordinary tool errors used to end the run: a create over a file applied in an earlier turn
 * failed with a raw EEXIST naming Orglet's private copy, and left an "unknown outcome" that refused the next message
 * although nothing was written; a crew member's EEXIST stopped the others. A tool the chat's folder level did not
 * allow failed the run with "The tool is not allowed by policy." And a chat with four files answered at step five of
 * six, was told to hand in first, and was marked as cut short. These go back to the model now, and only a write that
 * may have happened stays unknown.
 */

const HANDS_IN_AT_ONCE: ToolCapability[] = ['source.read', 'skill.read', 'app.propose', 'workspace.apply'];
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
const usage = { input: 10, output: 10 };

let directory: string;
let source: string;
let store: Store;
let grants: WorkspaceGrants;
let task: Task;
let run: Run;
let applied: string[];
/** When set, the in-process helper fails a write this way instead of running it, like a helper that died mid-write. */
let writeFailure: ((copy: string, path: string) => Error) | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-tool-errors-'));
  source = join(directory, 'project');
  await mkdir(source);
  await writeFile(join(source, 'CHANGELOG.md'), '# Changelog\n\n- 0.1.0\n');
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const };
  const skill = store.all<Skill>('skills')[0];
  task = { id: id(), workerId: worker.id, brief: 'Add 0.2.0 to CHANGELOG.md', consent: true, providerScopes: ['openai'],
    sourceIds: [], budgetMicros: 5_000_000, accepted: false, status: 'queued', createdAt: now(), toolCapabilities: HANDS_IN_AT_ONCE };
  store.put('tasks', task);
  await grants.grant({ taskId: task.id, directory: source, permissions: ['read', 'write'] });
  run = newRun(worker, skill);
  applied = [];
  writeFailure = undefined;
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

function newRun(worker = run.snapshot.worker, skill = run.snapshot.skill): Run {
  const created: Run = { id: id(), taskId: task.id, status: 'queued', startedAt: now(), error: null,
    snapshot: { worker, skill, workspaceGrant: grants.snapshot(task.id), toolCapabilities: HANDS_IN_AT_ONCE } };
  store.put('runs', created, { column: 'task_id', value: task.id });
  return created;
}

/**
 * The real helper operations in process, in copies laid out like Orglet's (`copies/<id>/seed`), so a file-system error
 * names the same kind of path the packaged app's did. The hand-in stand-in copies each written file into the folder.
 */
function runtime() {
  return new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, 'copies', randomUUID(), 'seed');
      await mkdir(copy, { recursive: true });
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request, abort) => {
      abort.throwIfAborted();
      const operation = request as { operation: string; path?: string };
      if (writeFailure && operation.operation === 'write') throw writeFailure(copy, operation.path!);
      return executeWorkspaceOperation(copy, request);
    },
  }, { apply: async options => {
    applied.push(options.path);
    return { status: 'applied', hash: 'b'.repeat(64), backupPath: '', created: false };
  } });
}

const call = (name: string, argumentsValue: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage });
const reply = (message: string) => call('reply', { message, title: null, knowledgeProposals: [] });
const lastResult = (messages: ChatCompletionMessageParam[]) => JSON.parse(String(messages.at(-1)!.content)) as Record<string, unknown>;
const callStates = () => store.db.prepare('SELECT state FROM tool_calls').all().map(row => String(row.state));

/** A run of a scripted model: each step is given the messages so far and returns its call. */
async function runScript(target: Run, steps: ((messages: ChatCompletionMessageParam[]) => ModelReply)[]) {
  let step = 0;
  const adapter: ModelAdapter = { request: async messages => steps[Math.min(step++, steps.length - 1)](messages) };
  const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime());
  await core.runner.run(store.get<Task>('tasks', task.id), target);
  return store.get<Run>('runs', target.id);
}

describe('a write that did not happen is the tool\'s answer, never an unknown outcome', () => {
  it('answers a create over an existing file with its current hash, and the next message runs', async () => {
    let refusal: Record<string, unknown> = {};
    const finished = await runScript(run, [
      () => call('workspace_write', { path: 'CHANGELOG.md', expectedHash: null, content: '# Changelog\n\n- 0.2.0\n- 0.1.0\n' }),
      messages => {
        refusal = lastResult(messages);
        return call('workspace_write', { path: 'CHANGELOG.md', expectedHash: refusal.currentHash, content: '# Changelog\n\n- 0.2.0\n- 0.1.0\n' });
      },
      () => reply('Added 0.2.0 to the changelog.'),
    ]);
    expect(finished.status, finished.error ?? '').toBe('completed');
    expect(refusal).toMatchObject({ refused: true, path: 'CHANGELOG.md', currentHash: hashOf('# Changelog\n\n- 0.1.0\n') });
    expect(applied).toEqual(['CHANGELOG.md']);
    expect(callStates().every(state => state === 'completed')).toBe(true);
    const events = store.detail(task.id).events.map(event => event.message);
    expect(events).toContain('Không ghi được tệp: CHANGELOG.md');
    expect(events.some(message => /copies|seed|EEXIST/.test(message))).toBe(false);
    // Nothing is left for the unknown-outcome guard, so the next message edits again.
    const next = newRun();
    expect(() => new ToolCalls(store).assertEffectsResolved(next.id)).not.toThrow();
    const followed = await runScript(next, [
      () => call('workspace_write', { path: 'NOTES.md', expectedHash: null, content: 'Release notes\n' }),
      () => reply('Wrote the notes.'),
    ]);
    expect(followed.status, followed.error ?? '').toBe('completed');
  });

  it('answers a write against a stale hash with the current one, and changes nothing', async () => {
    let refusal: Record<string, unknown> = {};
    const finished = await runScript(run, [
      () => call('workspace_write', { path: 'CHANGELOG.md', expectedHash: 'a'.repeat(64), content: 'overwritten' }),
      messages => {
        refusal = lastResult(messages);
        return reply('The file changed; I will read it first next time.');
      },
    ]);
    expect(finished.status, finished.error ?? '').toBe('completed');
    expect(refusal).toMatchObject({ refused: true, currentHash: hashOf('# Changelog\n\n- 0.1.0\n') });
    expect(applied).toEqual([]);
    expect(callStates()).toEqual(['completed']);
  });

  it('keeps the unknown-outcome guard for a write that may have happened, and names no private path', async () => {
    // The helper opened the file and then failed: some bytes may be in the copy.
    writeFailure = (copy, path) => new Error(`EIO: i/o error, write '${join(copy, path)}'`);
    const failed = await runScript(run, [() => call('workspace_write', { path: 'CHANGELOG.md', expectedHash: null, content: 'x' })]);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe("EIO: i/o error, write 'CHANGELOG.md'");
    expect(callStates()).toEqual(['uncertain']);
    writeFailure = undefined;
    const next = newRun();
    const refused = await runScript(next, [() => call('workspace_write', { path: 'NOTES.md', expectedHash: null, content: 'x' })]);
    expect(refused.status).toBe('failed');
    expect(refused.errorCode).toBe('unresolved_attempt');
  });

  it('cuts a private copy path to the path inside the copy', () => {
    const id = '0b6f1a3e-2c4d-4e5f-8a9b-1c2d3e4f5a6b';
    expect(withoutCopyPaths(`EEXIST: file already exists, open 'C:\\Users\\Person Name\\AppData\\Roaming\\Orglet\\workspaces\\copies\\${id}\\worktree\\docs\\CHANGELOG.md'`))
      .toBe("EEXIST: file already exists, open 'docs/CHANGELOG.md'");
    expect(withoutCopyPaths(`ENOTDIR: not a directory, scandir '/Users/person/Library/Orglet/workspaces/copies/${id}/seed'`))
      .toBe("ENOTDIR: not a directory, scandir '.'");
    expect(withoutCopyPaths('No such file or folder in the working copy: lib/a.js')).toBe('No such file or folder in the working copy: lib/a.js');
  });
});

describe('a tool the chat does not allow is answered, not a failed run', () => {
  beforeEach(async () => {
    // The person narrowed the folder to reading, then asked for an edit.
    await grants.grant({ taskId: task.id, directory: source, permissions: ['read'] });
    store.db.prepare('DELETE FROM runs WHERE id=?').run(run.id);
    run = newRun();
  });

  it('tells the model what it may use and the person what to change and where', async () => {
    let refusal: Record<string, unknown> = {};
    const finished = await runScript(run, [
      () => call('workspace_write', { path: 'CHANGELOG.md', expectedHash: null, content: 'x' }),
      messages => {
        refusal = lastResult(messages);
        return reply('I can only read this folder. To let me edit, set Details → Tool permissions → Working folder to “Read and edit files”.');
      },
    ]);
    expect(finished.status, finished.error ?? '').toBe('completed');
    expect(refusal).toMatchObject({ toolError: 'not_offered', tool: 'workspace_write' });
    expect(refusal.available).toEqual(expect.arrayContaining(['workspace_read', 'workspace_list', 'workspace_search', 'reply']));
    expect(refusal.available).not.toContain('workspace_write');
    // English is the default language; the person's line is in it.
    expect(refusal.next).toContain('Set Details → Tool permissions → Working folder to “Read and edit files”, then send the message again.');
    const line = 'Chưa sửa được tệp vì thư mục làm việc chỉ cho đọc. Đổi thành “Đọc và sửa file” ở Chi tiết → Quyền công cụ → Thư mục làm việc, rồi gửi lại tin nhắn.';
    const detail = store.detail(task.id);
    expect(detail.events.map(event => event.message)).toContain(line);
    expect(entriesOfEvents(detail.events, run.id)).toContainEqual(expect.objectContaining({ kind: 'failed', note: line }));
    expect(callStates()).toEqual([]);
    expect(await readFile(join(source, 'CHANGELOG.md'), 'utf8')).toBe('# Changelog\n\n- 0.1.0\n');
  });

  it('answers arguments off the schema and a tool no chat has, so the model can correct them', async () => {
    const results: Record<string, unknown>[] = [];
    const finished = await runScript(run, [
      () => call('workspace_read', { path: '../outside.txt', offset: 0 }),
      messages => { results.push(lastResult(messages)); return call('read_file', { path: 'CHANGELOG.md' }); },
      messages => { results.push(lastResult(messages)); return call('workspace_read', { path: 'CHANGELOG.md', offset: 0 }); },
      () => reply('The changelog lists 0.1.0.'),
    ]);
    expect(finished.status, finished.error ?? '').toBe('completed');
    expect(results[0]).toMatchObject({ toolError: 'invalid_arguments', tool: 'workspace_read' });
    expect((results[0].issues as string[])[0]).toMatch(/^path: /);
    expect(results[1]).toMatchObject({ toolError: 'unknown', tool: 'read_file' });
    const events = store.detail(task.id).events.map(event => event.message);
    expect(events).toContain('Tham số công cụ không hợp lệ: workspace_read');
    expect(events).toContain('Công cụ không có trong chat này: read_file');
  });

  it('stops a model that keeps calling what it cannot use, with the line that says what to change', async () => {
    let requests = 0;
    const finished = await runScript(run, [() => { requests++; return call('workspace_write', { path: 'CHANGELOG.md', expectedHash: null, content: 'x' }); }]);
    expect(requests).toBe(3);
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('Chưa sửa được tệp vì thư mục làm việc chỉ cho đọc. Đổi thành “Đọc và sửa file” ở Chi tiết → Quyền công cụ → Thư mục làm việc, rồi gửi lại tin nhắn.');
  });

  it('points a side thread at its main chat, and names a switch that is off', () => {
    const offered = ['reply'];
    const side = toolCallRefusal({ problem: { kind: 'not_offered', tool: 'workspace_start_process', workspacePermission: 'execute' },
      offered, workspacePermissions: ['read', 'write'], language: 'vi', sideThread: true });
    expect(side.event).toBe('Chưa chạy được lệnh vì thư mục làm việc chưa cho chạy lệnh. Đổi thành “Đọc, sửa file và chạy lệnh” ở Chat chính: Chi tiết → Quyền công cụ → Thư mục làm việc, rồi gửi lại tin nhắn.');
    const web = toolCallRefusal({ problem: { kind: 'not_offered', tool: 'web_search', capability: 'network.web' },
      offered, workspacePermissions: undefined, language: 'en', sideThread: false });
    expect(web.event).toBe('Chưa dùng được “Đọc và tìm kiếm web” vì quyền này đang tắt. Bật ở Chi tiết → Quyền công cụ, rồi gửi lại tin nhắn.');
    expect(web.result.next).toContain('Could not use “Read and search the web”: it is off in this chat. Turn it on in Details → Tool permissions, then send the message again.');
    const noFolder = toolCallRefusal({ problem: { kind: 'not_offered', tool: 'workspace_list', workspacePermission: 'read' },
      offered, workspacePermissions: undefined, language: 'en', sideThread: false });
    expect(noFolder.result.next).toContain('Could not use a folder: this chat has no working folder. Choose one in Details → Tool permissions → Working folder');
  });
});

describe('a crew', () => {
  it('lets a member correct a create over an existing file while the others finish, and combines both', async () => {
    const writes: Record<string, number> = {};
    let refusalSeen: Record<string, unknown> | undefined;
    let combined = false;
    const adapter: ModelAdapter = { request: async (messages, tools) => {
      if (isPlanRequest(tools)) {
        const [first, second] = memberIdsFromPlanPrompt(messages);
        return call('submit_plan', { assignments: [
          { workerId: first, brief: 'writer-changelog', expectedOutput: 'CHANGELOG.md has 0.2.0', writeResources: ['CHANGELOG.md'], dependsOn: [] },
          { workerId: second, brief: 'writer-notes', expectedOutput: 'NOTES.md exists', writeResources: ['NOTES.md'], dependsOn: [] },
        ] });
      }
      const context = messages.map(message => String(message.content)).join('\n');
      const report = (summary: string) => call('submit_report', { title: summary, summary, findings: [], limitations: [], knowledgeProposals: [], assignmentOutcome: 'completed' });
      if (context.includes('"assignment":"writer-changelog')) {
        const step = writes.changelog = (writes.changelog ?? -1) + 1;
        if (step === 0) return call('workspace_write', { path: 'CHANGELOG.md', expectedHash: null, content: '# Changelog\n\n- 0.2.0\n- 0.1.0\n' });
        if (step === 1) {
          refusalSeen = lastResult(messages);
          return call('workspace_write', { path: 'CHANGELOG.md', expectedHash: refusalSeen.currentHash, content: '# Changelog\n\n- 0.2.0\n- 0.1.0\n' });
        }
        return report('Changelog updated');
      }
      if (context.includes('"assignment":"writer-notes')) {
        const step = writes.notes = (writes.notes ?? -1) + 1;
        if (step === 0) return call('workspace_write', { path: 'NOTES.md', expectedHash: null, content: 'Release notes\n' });
        return report('Notes written');
      }
      expect(context).toContain('Changelog updated');
      expect(context).toContain('Notes written');
      combined = true;
      return call('submit_report', { title: 'Release files', summary: 'Both files are ready.', findings: [], limitations: [], knowledgeProposals: [] });
    } };
    const core = new CoreService(store, () => {}, async () => adapter, undefined, undefined, undefined, undefined, undefined, runtime());
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    task = { ...task, teamId: team.id, teamSnapshot: team, workerId: team.synthesizerId };
    store.update('tasks', task);
    store.db.prepare('DELETE FROM runs WHERE id=?').run(run.id);
    await core.teams.run(task, team);
    const detail = store.detail(task.id);
    expect(detail.task.status, JSON.stringify(detail.runs.map(item => item.error))).toBe('completed');
    expect(detail.runs.every(item => item.status === 'completed')).toBe(true);
    expect(refusalSeen).toMatchObject({ refused: true, path: 'CHANGELOG.md' });
    expect(combined).toBe(true);
    expect(applied.sort()).toEqual(['CHANGELOG.md', 'NOTES.md']);
    expect(callStates().every(state => state === 'completed')).toBe(true);
  });
});

describe('the step budget', () => {
  it('does not mark an answer out of steps when the run answered before its steps were used', async () => {
    const sent: ChatCompletionMessageParam[][] = [];
    const files: string[] = [];
    for (const name of ['q1.txt', 'q2.txt', 'q3.txt', 'q4.txt']) {
      const path = join(directory, name);
      await writeFile(path, `${name}: revenue 120`);
      files.push(path);
    }
    const adapter: ModelAdapter = { request: async messages => {
      sent.push([...messages]);
      const read = messages.filter(message => message.role === 'tool').length;
      if (read < sourceIds.length) return call('read_source', { sourceId: sourceIds[read] });
      return reply(`Read ${read} files.`);
    } };
    const core = new CoreService(store, () => {}, async () => adapter);
    const sourceIds = (await core.sources.import(files)).map(imported => imported.id);
    const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
    const taskId = await core.command('createTask', { workerId: team.memberIds[0], brief: 'Compare the four quarters.', sourceIds, consent: true,
      providerScopes: ['openai'], budgetMicros: 5_000_000 }) as string;
    for (let attempt = 0; attempt < 500 && !['completed', 'failed'].includes(store.detail(taskId).task.status); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await core.runner.shutdown();
    const answered = store.detail(taskId).runs[0];
    expect(answered.status, answered.error ?? '').toBe('completed');
    // Four reads and the answer at step five: it finished on its own, so it was neither told to hand in nor marked cut short.
    expect(sent).toHaveLength(5);
    expect(sent.some(messages => messages.some(message => message.role === 'user' && String(message.content).includes('almost out of steps')))).toBe(false);
    expect(answered.outOfSteps).toBeUndefined();
    expect(store.detail(taskId).artifacts[0].report.summary).toBe('Read 4 files.');
  });
});
