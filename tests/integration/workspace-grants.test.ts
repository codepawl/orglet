import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { WorkspaceGrants, sameFolder } from '../../apps/desktop/src/core/storage/workspace-grants';
import { FOLDER_UNAVAILABLE, RoutineFolders } from '../../apps/desktop/src/core/storage/routine-folders';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { commands, type Run, type Skill, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';
import { PickWorkspace } from '../../apps/desktop/src/shared/workspace-access';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

let directory: string;
let workspace: string;
let store: Store;
let grants: WorkspaceGrants;
let task: Task;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-grants-'));
  workspace = join(directory, 'workspace');
  await mkdir(workspace);
  workspace = await realpath(workspace);
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  task = { id: id(), workerId: store.all<Worker>('workers')[0].id, brief: 'Workspace task', sourceIds: [],
    consent: true, accepted: false, budgetMicros: 100_000, status: 'queued', createdAt: now() };
  store.put('tasks', task);
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

it('keeps native paths out of renderer grants and rejects renderer-selected paths', async () => {
  expect(Object.hasOwn(commands, 'grantWorkspace')).toBe(false);
  expect(PickWorkspace.safeParse({ taskId: task.id, permissions: ['read'], directory: workspace }).success).toBe(false);
  const view = await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  expect(JSON.stringify(view)).not.toContain(directory);
  expect(view.name).toBe('workspace');
  expect(await grants.directory(grants.snapshot(task.id)!, 'read')).toBe(workspace);
});

it('requires both frozen and current permissions and does not upgrade old runs', async () => {
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  const before = grants.snapshot(task.id)!;
  expect(() => grants.assert(before, 'write')).toThrow('không cho phép');
  expect(() => grants.assert({ ...before, permissions: ['read', 'write'] }, 'write')).toThrow('không cho phép');
  // Widening on the same folder keeps the grant (COD-186): the old snapshot stays valid with what it froze.
  const widened = await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read', 'write', 'execute'] });
  expect(widened).toMatchObject({ id: before.id, revision: before.revision });
  expect(grants.assert(before, 'read')).toBe(workspace);
  expect(() => grants.assert(before, 'write')).toThrow('không cho phép');
  expect(await grants.directory(grants.snapshot(task.id)!, 'execute')).toBe(workspace);
  // Narrowing is a new revision: nothing frozen on the wider one may continue. It keeps the id, which names the same
  // folder for as long as the chat has it, so the chat's old diffs still open (COD-291).
  const wide = grants.snapshot(task.id)!;
  const narrowed = await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  expect(narrowed).toMatchObject({ id: wide.id, revision: wide.revision + 1 });
  expect(() => grants.assert(wide, 'read')).toThrow('đã thay đổi');
  grants.revoke(task.id);
  expect(grants.snapshot(task.id)).toBeUndefined();
  expect(() => grants.assert(before, 'read')).toThrow('đã thay đổi');
});

it('changes folder with a new grant even at the same permissions', async () => {
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read', 'write'] });
  const before = grants.snapshot(task.id)!;
  const other = join(directory, 'other');
  await mkdir(other);
  const moved = await grants.grant({ taskId: task.id, directory: other, permissions: ['read', 'write'] });
  expect(moved.name).toBe('other');
  expect(moved.id).not.toBe(before.id);
  expect(() => grants.assert(before, 'read')).toThrow('đã thay đổi');
});

it('rejects a directory replaced at the same pathname', async () => {
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  const snapshot = grants.snapshot(task.id)!;
  await rename(workspace, join(directory, 'original'));
  await mkdir(workspace);
  await expect(grants.directory(snapshot, 'read')).rejects.toThrow('bị thay thế');
});

/** Rewrites the stored grant, the way a folder made again at the same path looks on Linux or an older row looks. */
function editStoredGrant(change: (grant: Record<string, unknown>) => Record<string, unknown>) {
  const row = store.db.prepare('SELECT data FROM workspace_grants WHERE task_id=?').get(task.id)!;
  store.db.prepare('UPDATE workspace_grants SET data=? WHERE task_id=?').run(JSON.stringify(change(JSON.parse(String(row.data)))), task.id);
}

it('tells a folder from one made again at the same path and file id by its birth time (COD-300)', async () => {
  // Linux can hand a new folder the deleted one's inode; the birth time is what differs. Made deterministic here by
  // giving the stored grant another birth time while the path, volume and file id still match.
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  const snapshot = grants.snapshot(task.id)!;
  const onDisk = await stat(workspace, { bigint: true });
  const stored = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_grants WHERE task_id=?').get(task.id)!.data));
  editStoredGrant(grant => ({ ...grant, birth: '1' }));
  if (onDisk.birthtimeNs === 0n) {
    // A file system that reports no birth time cannot tell them apart: the documented limit, asserted, not skipped.
    expect(await grants.directory(snapshot, 'read')).toBe(workspace);
    return;
  }
  expect(stored.birth).toBe(onDisk.birthtimeNs.toString());
  await expect(grants.directory(snapshot, 'read')).rejects.toThrow('bị thay thế');
  await expect(grants.changeLevel(task.id, ['read', 'write'])).rejects.toThrow('bị thay thế');
});

it('keeps accepting a grant stored before birth times, and learns the birth time the next time it is applied', async () => {
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  editStoredGrant(({ birth: _birth, ...grant }) => grant);
  const snapshot = grants.snapshot(task.id)!;
  expect(await grants.directory(snapshot, 'read')).toBe(workspace);
  const widened = await grants.changeLevel(task.id, ['read', 'write']);
  expect(widened).toMatchObject({ id: snapshot.id, revision: snapshot.revision });
  const onDisk = await stat(workspace, { bigint: true });
  const stored = JSON.parse(String(store.db.prepare('SELECT data FROM workspace_grants WHERE task_id=?').get(task.id)!.data));
  if (onDisk.birthtimeNs > 0n) expect(stored.birth).toBe(onDisk.birthtimeNs.toString());
});

it('compares birth times only when both records know one', () => {
  const folder = { directory: '/work', device: '1', inode: '2' };
  expect(sameFolder({ ...folder, birth: '5' }, { ...folder, birth: '5' })).toBe(true);
  expect(sameFolder({ ...folder, birth: '5' }, { ...folder, birth: '6' })).toBe(false);
  expect(sameFolder(folder, { ...folder, birth: '6' })).toBe(true);
  expect(sameFolder({ ...folder, birth: '5' }, { ...folder, inode: '3', birth: '5' })).toBe(false);
});

it('refuses a watched folder made again at the same path and file id (COD-300)', async () => {
  const folders = new RoutineFolders(store);
  const view = folders.add(await grants.resolve(workspace));
  expect(await folders.directory(view.folderId)).toBe(workspace);
  const row = store.db.prepare('SELECT data FROM routine_folders WHERE id=?').get(view.folderId)!;
  store.db.prepare('UPDATE routine_folders SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(String(row.data)), birth: '1' }), view.folderId);
  const onDisk = await stat(workspace, { bigint: true });
  if (onDisk.birthtimeNs === 0n) expect(await folders.directory(view.folderId)).toBe(workspace);
  else await expect(folders.directory(view.folderId)).rejects.toThrow(FOLDER_UNAVAILABLE);
});

it('says the working folder is gone, by its name and without its path, when it was deleted', async () => {
  // COD-257: the chat banner showed "ENOENT: no such file or directory, realpath '<full path>'".
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read'] });
  const snapshot = grants.snapshot(task.id)!;
  await rm(workspace, { recursive: true });
  const failure = await grants.directory(snapshot, 'read').then(() => undefined, (error: Error) => error.message);
  expect(failure).toBe('Thư mục làm việc workspace không còn trên máy. Chọn lại thư mục trong Chi tiết.');
  expect(failure).not.toContain(directory);
  expect(translateMessage(en, failure!)).toBe('The working folder workspace is no longer on this computer. Choose the folder again in Details.');
});

it('persists grants locally but never restores them from a backup', async () => {
  await grants.grant({ taskId: task.id, directory: workspace, permissions: ['read', 'write'] });
  const snapshot = grants.snapshot(task.id)!;
  const run: Run = { id: id(), taskId: task.id, status: 'completed', startedAt: now(), error: null,
    snapshot: { workspaceGrant: snapshot, worker: store.all<Worker>('workers')[0], skill: store.all<Skill>('skills')[0] } };
  store.put('runs', run, { column: 'task_id', value: task.id });
  const backup = new Backups(store, () => false, () => {}).export();
  expect(backup).not.toContain(directory.replaceAll('\\', '\\\\'));
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
  grants = new WorkspaceGrants(store);
  expect(await grants.directory(snapshot, 'write')).toBe(workspace);
  const restored = new Store(':memory:');
  try {
    const backups = new Backups(restored, () => false, () => {});
    backups.restore(backups.preview(backup).token);
    expect(new WorkspaceGrants(restored).snapshot(task.id)).toBeUndefined();
    expect(() => new WorkspaceGrants(restored).assert(snapshot, 'read')).toThrow('đã thay đổi');
  } finally {
    restored.close();
  }
});

it('cancels current work when the user revokes a workspace', async () => {
  const core = new CoreService(store, () => {}, async () => { throw new Error('No provider needed'); });
  await core.grantWorkspace({ taskId: task.id, directory: workspace, permissions: ['read', 'write'] });
  const snapshot = core.workspaceGrants.snapshot(task.id)!;
  const cancel = vi.spyOn(core.teams, 'cancel');
  await core.command('revokeWorkspace', { taskId: task.id });
  expect(cancel).toHaveBeenCalledWith(task.id);
  expect(() => core.workspaceGrants.assert(snapshot, 'read')).toThrow('đã thay đổi');
  await expect(core.command('workspaceAccess', { taskId: task.id, directory: workspace })).rejects.toThrow();
});
