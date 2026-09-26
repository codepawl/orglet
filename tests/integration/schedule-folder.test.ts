import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { WorkspaceRuntime } from '../../apps/desktop/src/core/tools/workspace-runtime';
import type { WorkspaceIntegration } from '../../apps/desktop/src/core/tools/workspace-integration';
import { executeWorkspaceOperation } from '../../apps/desktop/src/core/tools/workspace-files';
import { WorkspaceManifest } from '../../apps/desktop/src/shared/workspace-tools';
import type { ModelAdapter } from '../../apps/desktop/src/core/adapters/openai';
import { PREVIOUS_CHANGES_WAIT } from '../../apps/desktop/src/core/orchestration/routines';
import { toolCallRefusal } from '../../apps/desktop/src/core/orchestration/permission-hints';
import { SKIPPED_WHILE_INACTIVE, type Schedule } from '../../apps/desktop/src/shared/schedule';
import type { Routine, Run, Task, Team, Worker } from '../../apps/desktop/src/shared/contracts';
import type { RoutineWorkspace, WatchFolderView } from '../../apps/desktop/src/shared/routine-triggers';
import type { WorkspacePermission } from '../../apps/desktop/src/shared/workspace-access';
import { announcedInWindow, backgroundNotice, blockedSchedules, inAppNotice, type ChatNames } from '../../apps/desktop/src/renderer/chatNotices';
import { lastRunOutcome } from '../../apps/desktop/src/renderer/components/RoutinesPanel';
import { storyEvents } from '../../apps/desktop/src/renderer/components/DetailsPanel';

/*
 * COD-294: a schedule carries its own working folder and level, picked in its form and approved by saving it. Each run
 * gets exactly that folder as its chat's grant; a folder that is gone stops the schedule with a reason on its card; a
 * run's changes wait for review in its chat unless the schedule turned review off, and the next run waits for them.
 */

const schedule: Schedule = { timeZone: 'UTC', time: '09:00', frequency: 'daily', weekday: 1 };
const ANSWER = 'Updated note.txt.';
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

let directory: string;
let project: string;
let store: Store;
let core: CoreService;
let current: Date;
let worker: Worker;
let integrated: string[];

type Call = { name: string; arguments: Record<string, unknown> };
const write = (path: string, content: string, expectedHash: string | null): Call => ({ name: 'workspace_write', arguments: { path, expectedHash, content } });
const reply = (message: string): Call => ({ name: 'reply', arguments: { message, title: null, knowledgeProposals: [] } });

/** A model that makes these calls in order, one new script per run. */
function scriptedModel(runs: Call[][]): () => Promise<ModelAdapter> {
  let runIndex = 0;
  return async () => {
    const calls = runs[Math.min(runIndex++, runs.length - 1)];
    let step = 0;
    return { request: async () => {
      const call = calls[Math.min(step++, calls.length - 1)];
      return { calls: [{ id: id(), name: call.name, arguments: JSON.stringify(call.arguments) }], usage: { input: 10, output: 10 } };
    } };
  };
}

/** A working-copy runtime whose broker writes into the project folder, as the workspace review tests use. */
function runtime() {
  const integrate: WorkspaceIntegration['apply'] = async request => {
    request.authorize();
    if (request.operation !== undefined && request.operation !== 'write') throw new Error(`Unexpected ${request.operation} step`);
    const target = join(project, request.path);
    const existing = await readFile(target).catch(() => null);
    if ((existing ? sha(existing) : null) !== request.expectedHash) {
      return { status: 'conflict', hash: existing ? sha(existing) : null, reason: existing ? 'changed' : 'missing', backupPath: '', created: false };
    }
    await writeFile(target, request.bytes);
    integrated.push(request.path);
    return { status: 'applied', hash: sha(request.bytes), backupPath: 'none', created: existing === null };
  };
  return new WorkspaceRuntime(store, {
    createCopy: async (original, abort) => {
      abort.throwIfAborted();
      const copy = join(directory, id());
      await mkdir(copy);
      return { directory: copy, manifest: WorkspaceManifest.parse(await executeWorkspaceOperation(copy, { operation: 'snapshot', source: original })), kind: 'copy' as const };
    },
    execute: async (copy, request, abort) => { abort.throwIfAborted(); return executeWorkspaceOperation(copy, request); },
  }, { apply: integrate });
}

function startCore(model: () => Promise<ModelAdapter> = scriptedModel([[write('note.txt', 'edited', sha('original')), reply(ANSWER)]])) {
  return new CoreService(store, () => {}, model, undefined, () => current, undefined, undefined, undefined, runtime());
}

beforeEach(async () => {
  current = new Date('2026-01-05T01:00:00Z');
  directory = await mkdtemp(join(tmpdir(), 'orglet-schedule-folder-'));
  project = join(directory, 'project');
  await mkdir(project);
  await writeFile(join(project, 'note.txt'), 'original');
  store = new Store(join(directory, 'state.sqlite'));
  integrated = [];
  core = startCore();
  worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
});

afterEach(async () => {
  core.folderTriggers.stop();
  store.close();
  await rm(directory, { recursive: true, force: true });
});

/** What main does after its picker opened at `permissions`: the core resolves the folder and hands back an id and a name. */
async function pickFolder(permissions: WorkspacePermission[] = ['read', 'write', 'execute'], path = project): Promise<WatchFolderView> {
  return await core.grantWorkspace({ routine: true, permissions, directory: path }) as WatchFolderView;
}

function folderOf(picked: WatchFolderView, permissions: WorkspacePermission[] = ['read', 'write', 'execute'], review = true): RoutineWorkspace {
  // The window sends any name; the core writes the folder's own.
  return { folderId: picked.folderId, folderName: 'whatever the window says', permissions, review };
}

async function save(workspace?: RoutineWorkspace | null, overrides: Record<string, unknown> = {}): Promise<Routine> {
  return await core.command('saveRoutine', {
    name: 'Daily repo check', enabled: true, schedule, trigger: { kind: 'called' },
    ...(workspace !== undefined ? { workspace } : {}),
    task: { workerId: worker.id, sourceIds: [], brief: 'Check the repo', consent: true, providerScopes: ['openai'], budgetMicros: 5_000_000 },
    ...overrides,
  }) as Routine;
}

async function idle() {
  for (let attempt = 0; attempt < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id) || core.teams.isActive(task.id)); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function runNow(routine: Routine): Promise<string> {
  const taskId = await core.command('runRoutineNow', { id: routine.id }) as string;
  await idle();
  return taskId;
}

const copyOf = (runId: string) => JSON.parse(String(store.db.prepare('SELECT data FROM workspace_copies WHERE run_id=?').get(runId)!.data));
const runsOf = (taskId: string) => store.all<Run>('runs').filter(run => run.taskId === taskId);
const folderNote = () => readFile(join(project, 'note.txt'), 'utf8');

describe("a schedule's own working folder", () => {
  it('gives each run exactly the folder and level picked in the schedule, and names it from the grant', async () => {
    const routine = await save(folderOf(await pickFolder()));
    expect(routine.workspace).toMatchObject({ folderName: 'project', permissions: ['read', 'write', 'execute'], review: true });
    const taskId = await runNow(routine);
    const grant = core.workspaceGrants.view(taskId);
    expect(grant).toMatchObject({ name: 'project', permissions: ['read', 'write', 'execute'], revoked: false });
    expect(runsOf(taskId)[0].snapshot.workspaceGrant?.permissions).toEqual(['read', 'write', 'execute']);
    // The orglet's empty chat keeps nothing from this: a schedule's folder is its own.
    expect(store.workspace().newChatWorkspace).toEqual({});
  });

  it('is never wider than the level the picker was opened at, and a narrower level keeps the folder', async () => {
    const readOnly = await pickFolder(['read']);
    await expect(save(folderOf(readOnly, ['read', 'write']))).rejects.toThrow('rộng hơn lúc chọn thư mục');
    // A watched folder is read-only too, so it can never become a folder a schedule edits.
    const watched = await core.grantWorkspace({ watch: true, permissions: ['read'], directory: project }) as WatchFolderView;
    await expect(save(folderOf(watched, ['read', 'write', 'execute']))).rejects.toThrow('rộng hơn lúc chọn thư mục');
    const routine = await save(folderOf(await pickFolder(), ['read']));
    const taskId = await runNow(routine);
    expect(core.workspaceGrants.view(taskId)?.permissions).toEqual(['read']);
  });

  it('refuses a folder the picker never granted', async () => {
    await expect(save(folderOf({ folderId: id(), name: 'elsewhere' }))).rejects.toThrow('chưa được cấp quyền');
  });

  it('keeps the folder when a save leaves it out, and drops it with null', async () => {
    const routine = await save(folderOf(await pickFolder()));
    const toggled = await core.command('saveRoutine', { id: routine.id, name: routine.name, enabled: false, schedule, trigger: routine.trigger, task: routine.task }) as Routine;
    expect(toggled.workspace?.folderId).toBe(routine.workspace?.folderId);
    const dropped = await save(null, { id: routine.id });
    expect(dropped.workspace).toBeUndefined();
  });
});

describe('what saving approves', () => {
  it('makes the folder identity, its level and review part of the fingerprint, leaving a schedule without a folder as it was', async () => {
    const picked = await pickFolder();
    const without = await save();
    const withFolder = await save(folderOf(picked));
    const reviewOff = await save(folderOf(picked, ['read', 'write', 'execute'], false));
    const narrower = await save(folderOf(picked, ['read', 'write']));
    const other = await save(folderOf(await pickFolder()));
    const fingerprints = [without, withFolder, reviewOff, narrower].map(routine => routine.approvedConfig);
    expect(new Set(fingerprints).size).toBe(4);
    // The same folder picked twice is the same folder on disk, so the approval is the same.
    expect(other.approvedConfig).toBe(withFolder.approvedConfig);
    expect(core.routines.configuration(without.task, without.trigger)).toBe(without.approvedConfig);
  });

  it('refuses a run when the folder part changed without a save, as in a hand-edited row', async () => {
    const routine = await save(folderOf(await pickFolder(), ['read']));
    store.update('routines', { ...store.get<Routine>('routines', routine.id), workspace: { ...routine.workspace!, permissions: ['read', 'write', 'execute'] } });
    await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow('lưu lại quyền chạy');
    expect(store.all<Task>('tasks')).toHaveLength(0);
  });

  it('never restores a working folder from a backup', async () => {
    const routine = await save(folderOf(await pickFolder()));
    expect(routine.workspace).toBeDefined();
    const backup = core.backups.export();
    const restoredStore = new Store(join(directory, 'restored.sqlite'));
    try {
      const restoredCore = new CoreService(restoredStore, () => {}, async () => { throw new Error('No provider'); });
      restoredCore.backups.restore(restoredCore.backups.preview(backup).token);
      const restored = restoredStore.all<Routine>('routines');
      expect(restored).toHaveLength(1);
      expect(restored[0].workspace).toBeUndefined();
      expect(restored[0].enabled).toBe(false);
    } finally { restoredStore.close(); }
  });
});

describe('a folder that is gone or replaced', () => {
  it('stops Run now with the reason on the card, and starts no chat', async () => {
    const routine = await save(folderOf(await pickFolder()));
    await rename(project, join(directory, 'moved'));
    await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow('project');
    const noted = store.get<Routine>('routines', routine.id);
    expect(noted.notice?.reason).toContain('không còn hoặc đã bị thay thế');
    expect(noted.notice?.reason).toContain('project');
    expect(store.all<Task>('tasks')).toHaveLength(0);
  });

  it('refuses a new folder made at the same path', async () => {
    const routine = await save(folderOf(await pickFolder()));
    await rm(project, { recursive: true, force: true });
    await mkdir(project);
    await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow('không còn hoặc đã bị thay thế');
  });

  it('moves a clock schedule on to its next time with the note, instead of offering a catch-up that would fail again', async () => {
    const routine = await save(folderOf(await pickFolder()), { trigger: { kind: 'schedule' } });
    await rm(project, { recursive: true, force: true });
    current = new Date('2026-01-05T08:59:50Z');
    await core.tick();
    current = new Date('2026-01-05T09:00:00Z');
    await core.tick();
    const after = store.get<Routine>('routines', routine.id);
    expect(after.pending).toBeNull();
    expect(after.notice?.reason).toContain('không còn hoặc đã bị thay thế');
    expect(after.nextDueAt).toBe('2026-01-06T09:00:00.000Z');
    expect(store.all<Task>('tasks')).toHaveLength(0);
  });
});

describe("a scheduled run's changes", () => {
  it('wait for review in the run\'s chat, leave the folder alone and hold back the next run until they are settled', async () => {
    const routine = await save(folderOf(await pickFolder()));
    const taskId = await runNow(routine);
    const [run] = runsOf(taskId);
    expect(store.get<Task>('tasks', taskId).status).toBe('completed');
    expect(copyOf(run.id).review.state).toBe('pending');
    expect(integrated).toEqual([]);
    expect(await folderNote()).toBe('original');
    expect(store.workspace().heldForReview).toEqual([taskId]);
    await expect(core.command('runRoutineNow', { id: routine.id })).rejects.toThrow(PREVIOUS_CHANGES_WAIT);
    await core.command('applyWorkspaceReview', { taskId, runId: run.id });
    expect(await folderNote()).toBe('edited');
    expect(store.workspace().heldForReview).toEqual([]);
    core = startCore(scriptedModel([[reply('Nothing to change.')]]));
    const next = await runNow(routine);
    expect(store.get<Task>('tasks', next).status).toBe('completed');
  });

  it('reach the folder as the run finishes when the schedule turned review off', async () => {
    const routine = await save(folderOf(await pickFolder(), ['read', 'write'], false));
    const taskId = await runNow(routine);
    expect(integrated).toEqual(['note.txt']);
    expect(await folderNote()).toBe('edited');
    expect(copyOf(runsOf(taskId)[0].id).review).toBeUndefined();
    expect(store.get<Task>('tasks', taskId).toolCapabilities).toContain('workspace.apply');
  });

  it('are never held for a crew, whose next member works from them', async () => {
    const team = await core.command('createTemplate', { templateId: 'eris-review', provider: 'demo' }) as Team;
    const routine = await save(folderOf(await pickFolder()), { enabled: false, task: { workerId: team.synthesizerId, teamId: team.id, sourceIds: [], brief: 'Crew check', consent: false, budgetMicros: 1000 } });
    expect(routine.workspace?.review).toBe(false);
  });
});

describe('what the person is told', () => {
  const standup = { id: 'routine', name: 'Daily repo check' } as Routine;
  const names: ChatNames = { workers: [{ id: 'dev', name: 'Dev' } as Worker], teams: [], routines: [standup], heldForReview: ['held'] };
  const run = (taskId: string, status: Task['status']): Task => ({ id: taskId, status, brief: 'Check the repo', workerId: 'dev', routineId: 'routine',
    createdAt: '2026-09-27T00:00:00.000Z', budgetMicros: 1000, sourceIds: [], consent: true, accepted: false });

  it('says a run\'s changes wait for review, inside the window and on the desktop', () => {
    expect(inAppNotice({ task: run('held', 'completed'), outcome: 'done' }, names)?.text).toBe('Daily repo check is ready; its changes wait for your review');
    expect(inAppNotice({ task: run('plain', 'completed'), outcome: 'done' }, names)?.text).toBe('Daily repo check is ready');
    expect(backgroundNotice({ task: run('held', 'completed'), outcome: 'done' }, names).body).toBe('Changes wait for your review');
  });

  it('announces a failed or waiting schedule run even while it is the chat on screen, as Run now leaves it', () => {
    const failed = run('failed', 'failed');
    expect(announcedInWindow({ task: failed, outcome: 'needs_look' }, failed)).toBe(true);
    const waiting = run('waiting', 'waiting_input');
    expect(announcedInWindow({ task: waiting, outcome: 'needs_you' }, waiting)).toBe(true);
    const done = run('done', 'completed');
    expect(announcedInWindow({ task: done, outcome: 'done' }, done)).toBe(false);
    const ordinaryChat = { ...failed, routineId: undefined };
    expect(announcedInWindow({ task: ordinaryChat, outcome: 'needs_look' }, ordinaryChat)).toBe(false);
    expect(announcedInWindow({ task: failed, outcome: 'needs_look' }, undefined)).toBe(true);
  });

  it('turns a schedule that could not start into a problem once, and leaves a miss while the app was closed alone', () => {
    const base = { ...standup, pending: null } as Routine;
    const noted = { ...base, notice: { at: '2026-09-27T01:00:00.000Z', reason: 'The folder is gone.' } };
    const missed = { ...base, pending: { dueAt: '2026-09-27T01:00:00.000Z', reason: SKIPPED_WHILE_INACTIVE } };
    const refused = { ...base, pending: { dueAt: '2026-09-27T01:00:00.000Z', reason: PREVIOUS_CHANGES_WAIT } };
    expect(blockedSchedules([base], [noted]).map(item => item.reason)).toEqual(['The folder is gone.']);
    expect(blockedSchedules([noted], [noted])).toEqual([]);
    expect(blockedSchedules([base], [missed])).toEqual([]);
    expect(blockedSchedules([base], [refused]).map(item => item.reason)).toEqual([PREVIOUS_CHANGES_WAIT]);
    expect(blockedSchedules([refused], [refused])).toEqual([]);
  });

  it("shows the newest run's outcome on the schedule's card", () => {
    expect(lastRunOutcome(run('failed', 'failed'), [])).toMatchObject({ label: 'Needs attention', mark: { tone: 'error' } });
    expect(lastRunOutcome(run('held', 'completed'), ['held'])).toMatchObject({ label: 'Changes wait for your review', mark: { variant: 'dashed', tone: 'error' } });
    expect(lastRunOutcome(run('done', 'completed'), [])).toMatchObject({ label: 'Done', mark: { tone: 'success' } });
    expect(lastRunOutcome(run('busy', 'running'), []).label).toBe('Running');
    expect(lastRunOutcome(run('waiting', 'waiting_input'), []).label).toBe('Needs you');
  });

  it('writes an error line once in What happened, however many times the run recorded it', () => {
    const line = 'Could not use a folder: this schedule has no working folder.';
    const events = [line, line, 'Đang gọi model · bước 2/40', line, line].map((message, index) => ({ id: String(index), message, createdAt: '2026-09-27T00:00:00.000Z' }));
    expect(storyEvents(events).map(event => event.id)).toEqual(['0']);
  });

  it("points a schedule's run at the schedule for its folder, not at the run's own Details", () => {
    const refusal = (workspacePermissions: WorkspacePermission[] | undefined, workspacePermission: WorkspacePermission) => toolCallRefusal({
      problem: { kind: 'not_offered', tool: 'workspace_start_process', workspacePermission }, offered: [], workspacePermissions, language: 'vi', sideThread: false, schedule: true,
    }).event;
    expect(refusal(undefined, 'read')).toContain('Lịch chạy → Sửa lịch → Thư mục làm việc');
    expect(refusal(['read'], 'write')).toContain('thư mục làm việc của lịch chỉ cho đọc');
    expect(refusal(['read', 'write'], 'execute')).toContain('rồi lưu lịch');
  });
});
