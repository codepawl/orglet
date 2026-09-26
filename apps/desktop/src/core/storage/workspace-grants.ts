import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { z } from 'zod';
import { GrantWorkspace, NewChatWorkspaceView, WorkspaceGrantSnapshot, WorkspaceGrantView, WorkspacePermissions, type NewChatTarget, type WorkspacePermission } from '../../shared/workspace-access';
import { workspaceAllowed } from '../../shared/capability-status';
import type { Task } from '../../shared/contracts';
import { newChatKey, newChatKeyNames } from '../../shared/live-task';
import { Store, id } from './database';

/** A folder as the picker resolved it: its canonical path and the identity that detects a swap at the same path. */
const ResolvedDirectory = z.object({ directory: z.string().min(1), device: z.string(), inode: z.string(), name: z.string().min(1) }).strict();
export type ResolvedDirectory = z.infer<typeof ResolvedDirectory>;

const StoredGrant = WorkspaceGrantView.extend({
  directory: z.string().min(1), device: z.string(), inode: z.string(),
}).strict();

/** The folder chosen for a chat before its first message, waiting under the worker or team (COD-186). */
const PendingWorkspace = ResolvedDirectory.extend({ permissions: WorkspacePermissions }).strict();
export type PendingWorkspace = z.infer<typeof PendingWorkspace>;
const PENDING_SETTING = 'newChatWorkspace';

const FOLDER_ERROR = 'Workspace phải là thư mục đã chọn trên máy.';
const NO_FOLDER_YET = 'Chat này chưa có thư mục làm việc. Chọn thư mục trước.';
/** A diff of a copy made from a folder the chat no longer has; said plainly because it is shown as the viewer's only line. */
export const OTHER_FOLDER = 'Thay đổi này làm trên thư mục mà chat không còn dùng (đã gỡ hoặc đổi sang thư mục khác), nên không mở lại được.';

/** A path that is not there any more: deleted, or one of its parents renamed or replaced by a file. */
function isMissingPath(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Whether a new grant replaces what active runs were working on. Widening the level on the same folder keeps the
 * grant's id and revision (see `apply`), so only another folder, a narrower level or a fresh grant after a revoke
 * counts as a replacement; a first grant on a chat that had none replaces nothing.
 */
export function replacesGrant(previous: WorkspaceGrantView | null, next: WorkspaceGrantView): boolean {
  return !!previous && !previous.revoked && (previous.id !== next.id || previous.revision !== next.revision);
}

export class WorkspaceGrants {
  constructor(private store: Store) {}

  private current(taskId: string): z.infer<typeof StoredGrant> | null {
    const row = this.store.db.prepare('SELECT data FROM workspace_grants WHERE task_id=?').get(taskId);
    return row ? StoredGrant.parse(JSON.parse(String(row.data))) : null;
  }

  private assertTask(taskId: string) {
    const task = this.store.get<Task>('tasks', taskId);
    if (task.deletedAt || task.archivedAt) throw new Error('Task đã đóng; không thể sử dụng workspace.');
  }

  view(taskId: string): WorkspaceGrantView | null {
    this.assertTask(taskId);
    const grant = this.current(taskId);
    if (!grant) return null;
    const { directory: _directory, device: _device, inode: _inode, ...view } = grant;
    return WorkspaceGrantView.parse(view);
  }

  snapshot(taskId: string): WorkspaceGrantSnapshot | undefined {
    const grant = this.view(taskId);
    if (!grant || grant.revoked) return undefined;
    return { id: grant.id, taskId, revision: grant.revision, permissions: [...grant.permissions] };
  }

  /** Canonicalises a picked folder and records what identifies it; the path must come from main's picker. */
  async resolve(picked: string): Promise<ResolvedDirectory> {
    if (!isAbsolute(picked)) throw new Error(FOLDER_ERROR);
    const directory = await realpath(picked);
    const identity = await stat(directory, { bigint: true });
    if (!identity.isDirectory()) throw new Error(FOLDER_ERROR);
    return { directory, device: identity.dev.toString(), inode: identity.ino.toString(), name: basename(directory) || directory };
  }

  /**
   * Stores a resolved folder as the task's grant. Adding permissions on the folder already granted keeps the
   * grant's id and revision, so runs that froze the old grant stay valid with the permissions they froze and
   * nothing has to stop; fewer permissions on the same folder keep the id but take a new revision, which invalidates
   * old snapshots; another folder is a new grant with a new id. The id therefore names one folder for as long as the
   * chat keeps it, which is what lets its old diffs keep opening at any level (COD-291).
   */
  apply(taskId: string, resolved: ResolvedDirectory, permissions: WorkspacePermission[]): WorkspaceGrantView {
    return this.store.transaction(() => this.applyInsideTransaction(taskId, resolved, permissions));
  }

  /** `apply` for a caller that already holds the store transaction, such as the one creating the chat row. */
  applyInsideTransaction(taskId: string, resolved: ResolvedDirectory, permissions: WorkspacePermission[]): WorkspaceGrantView {
    this.assertTask(taskId);
    const previous = this.current(taskId);
    const sameFolder = !!previous && !previous.revoked && previous.directory === resolved.directory
      && previous.device === resolved.device && previous.inode === resolved.inode;
    const widened = sameFolder && previous.permissions.every(permission => permissions.includes(permission));
    let grant: z.infer<typeof StoredGrant>;
    if (widened) grant = StoredGrant.parse({ ...previous, permissions });
    else if (sameFolder) grant = StoredGrant.parse({ ...previous, revision: previous.revision + 1, permissions });
    else {
      grant = StoredGrant.parse({ id: id(), taskId, revision: (previous?.revision ?? 0) + 1, permissions, name: resolved.name, revoked: false,
        directory: resolved.directory, device: resolved.device, inode: resolved.inode });
    }
    this.store.db.prepare(`INSERT INTO workspace_grants(task_id,data) VALUES(?,?)
      ON CONFLICT(task_id) DO UPDATE SET data=excluded.data`).run(taskId, JSON.stringify(grant));
    return this.view(taskId)!;
  }

  async grant(raw: unknown): Promise<WorkspaceGrantView> {
    const input = GrantWorkspace.parse(raw);
    if (!('taskId' in input)) throw new Error('Thư mục cho chat chưa bắt đầu được giữ riêng; không cấp trực tiếp.');
    this.assertTask(input.taskId);
    const resolved = await this.resolve(input.directory);
    return this.apply(input.taskId, resolved, input.permissions);
  }

  /**
   * Changes only the level on the folder the chat already has, without asking for the folder again (COD-291). The
   * folder is checked the way a waiting one is before it becomes a grant: still there, and still the same directory.
   */
  async changeLevel(taskId: string, permissions: WorkspacePermission[]): Promise<WorkspaceGrantView> {
    this.assertTask(taskId);
    const current = this.current(taskId);
    if (!current || current.revoked) throw new Error(NO_FOLDER_YET);
    const resolved = await this.confirmSame(current, current.name);
    return this.apply(taskId, resolved, WorkspacePermissions.parse(permissions));
  }

  revoke(taskId: string) {
    this.assertTask(taskId);
    this.store.transaction(() => {
      const grant = this.current(taskId);
      if (!grant || grant.revoked) return;
      this.store.db.prepare('UPDATE workspace_grants SET data=? WHERE task_id=?')
        .run(JSON.stringify({ ...grant, revoked: true, revision: grant.revision + 1 }), taskId);
    });
  }

  private pendingAll(): Record<string, PendingWorkspace> {
    return this.store.setting<Record<string, PendingWorkspace>>(PENDING_SETTING, {});
  }

  /** The folder waiting for this chat's first message, if one was chosen. */
  /**
   * Gives a new side thread the folder its main chat has, at the same level (COD-247). It is the side thread's own
   * grant, so its runs are checked against it, but it is never wider than the main chat's: `narrowTo` keeps it so.
   * For a caller that already holds the store transaction, the one creating the side thread's row.
   */
  copyInsideTransaction(fromTaskId: string, toTaskId: string) {
    const source = this.current(fromTaskId);
    if (!source || source.revoked) return;
    const grant = StoredGrant.parse({ ...source, id: id(), taskId: toTaskId, revision: 1, permissions: [...source.permissions] });
    this.store.db.prepare('INSERT INTO workspace_grants(task_id,data) VALUES(?,?)').run(toTaskId, JSON.stringify(grant));
  }

  /**
   * Keeps a side thread's folder inside its main chat's (COD-247). Another folder or none on the main chat revokes
   * the side thread's; fewer permissions on the same folder narrow it to the ones both have, keeping the grant's id
   * like `apply` does (COD-291). Either is a new revision, so every run that froze the old grant is refused its next
   * file operation. Widening the main chat changes nothing here. Archived side threads are narrowed too, so restoring
   * one never brings back more than the main chat has. Returns true when the side thread's grant changed.
   */
  narrowTo(sideTaskId: string, mainTaskId: string): boolean {
    return this.store.transaction(() => {
      const side = this.current(sideTaskId);
      if (!side || side.revoked) return false;
      const main = this.current(mainTaskId);
      const sameFolder = !!main && !main.revoked && main.directory === side.directory && main.device === side.device && main.inode === side.inode;
      const kept = sameFolder ? side.permissions.filter(permission => main.permissions.includes(permission)) : [];
      if (kept.length === side.permissions.length) return false;
      const next = kept.length
        ? StoredGrant.parse({ ...side, revision: side.revision + 1, permissions: kept })
        : { ...side, revoked: true, revision: side.revision + 1 };
      this.store.db.prepare('UPDATE workspace_grants SET data=? WHERE task_id=?').run(JSON.stringify(next), sideTaskId);
      return true;
    });
  }

  pending(chat: NewChatTarget): PendingWorkspace | undefined {
    const entry = this.pendingAll()[newChatKey(chat)];
    return entry ? PendingWorkspace.parse(entry) : undefined;
  }

  /** Keeps a picked folder for a chat that has no row yet; the renderer gets back only its name and level. */
  async setPending(chat: NewChatTarget, picked: string, permissions: WorkspacePermission[]): Promise<NewChatWorkspaceView> {
    const resolved = await this.resolve(picked);
    const pending = { ...this.pendingAll() };
    pending[newChatKey(chat)] = PendingWorkspace.parse({ ...resolved, permissions });
    this.store.setSetting(PENDING_SETTING, pending);
    return NewChatWorkspaceView.parse({ name: resolved.name, permissions });
  }

  /** Drops the waiting folder: the chat row took it, the user chose no folder, or the worker or team is gone. */
  takePending(chat: NewChatTarget) {
    const pending = { ...this.pendingAll() };
    const key = newChatKey(chat);
    if (!(key in pending)) return;
    delete pending[key];
    this.store.setSetting(PENDING_SETTING, pending);
  }

  /** Drops the folders waiting for every group chat this worker was part of: without the worker, that group cannot start. */
  takePendingOfGroupsWith(workerId: string) {
    const pending = this.pendingAll();
    const kept = Object.fromEntries(Object.entries(pending).filter(([key]) => !newChatKeyNames(key, workerId)));
    if (Object.keys(kept).length === Object.keys(pending).length) return;
    this.store.setSetting(PENDING_SETTING, kept);
  }

  /**
   * Checks a waiting folder again right before it becomes a grant: it must still be the directory that was picked,
   * not one moved away or replaced at the same path since.
   */
  async confirmPending(pending: PendingWorkspace): Promise<ResolvedDirectory> {
    return this.confirmSame(pending);
  }

  /** A kept folder resolved again: it must still exist and be the same directory, not one replaced at the same path. */
  private async confirmSame(kept: Omit<ResolvedDirectory, 'name'>, name?: string): Promise<ResolvedDirectory> {
    let resolved: ResolvedDirectory;
    try {
      resolved = await this.resolve(kept.directory);
    } catch {
      // The filesystem error names the path; the chat only needs to know the folder is not there any more.
      if (name) throw new Error(`Thư mục làm việc ${name} không còn trên máy. Chọn lại thư mục trong Chi tiết.`);
      throw new Error('Thư mục không còn trên máy.');
    }
    if (resolved.directory !== kept.directory || resolved.device !== kept.device || resolved.inode !== kept.inode) {
      throw new Error('Thư mục workspace đã bị thay thế. Chọn lại thư mục trước khi tiếp tục.');
    }
    return resolved;
  }

  /** Changes the level of the folder waiting for a chat's first message, keeping the folder (COD-291). */
  setPendingLevel(chat: NewChatTarget, permissions: WorkspacePermission[]): NewChatWorkspaceView {
    const key = newChatKey(chat);
    const waiting = this.pending(chat);
    if (!waiting) throw new Error(NO_FOLDER_YET);
    const pending = { ...this.pendingAll() };
    pending[key] = PendingWorkspace.parse({ ...waiting, permissions });
    this.store.setSetting(PENDING_SETTING, pending);
    return NewChatWorkspaceView.parse({ name: waiting.name, permissions });
  }

  /**
   * Whether a run's copy still belongs to the folder the chat has (COD-291): the grant it was made under, at any level
   * since, never one revoked or replaced by another folder. A diff is history, so this is all it needs.
   */
  assertSameFolder(snapshot: WorkspaceGrantSnapshot) {
    const frozen = WorkspaceGrantSnapshot.parse(snapshot);
    this.assertTask(frozen.taskId);
    const current = this.current(frozen.taskId);
    if (!current || current.revoked || current.id !== frozen.id || !current.permissions.includes('read')) {
      throw new Error(OTHER_FOLDER);
    }
  }

  assert(snapshot: WorkspaceGrantSnapshot, permission: WorkspacePermission): string {
    const frozen = WorkspaceGrantSnapshot.parse(snapshot);
    this.assertTask(frozen.taskId);
    const current = this.current(frozen.taskId);
    if (!current || !workspaceAllowed(frozen.taskId, permission, frozen, current)) {
      throw new Error('Quyền workspace đã thay đổi hoặc không cho phép thao tác này.');
    }
    return current.directory;
  }

  async directory(snapshot: WorkspaceGrantSnapshot, permission: WorkspacePermission): Promise<string> {
    const directory = this.assert(snapshot, permission);
    const current = this.current(snapshot.taskId)!;
    const canonical = await realpath(directory).catch(error => {
      // The filesystem's error names the full path in English; the chat says which folder and what to do (COD-257).
      if (isMissingPath(error)) throw new Error(`Thư mục làm việc ${current.name} không còn trên máy. Chọn lại thư mục trong Chi tiết.`);
      throw error;
    });
    const identity = await stat(directory, { bigint: true });
    this.assert(snapshot, permission);
    if (canonical !== directory || !identity.isDirectory() || identity.dev.toString() !== current.device
      || identity.ino.toString() !== current.inode) {
      throw new Error('Thư mục workspace đã bị thay thế. Chọn lại thư mục trước khi tiếp tục.');
    }
    return directory;
  }
}
