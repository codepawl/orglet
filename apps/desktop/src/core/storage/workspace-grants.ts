import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { z } from 'zod';
import { GrantWorkspace, NewChatWorkspaceView, WorkspaceGrantSnapshot, WorkspaceGrantView, WorkspacePermissions, type NewChatTarget, type WorkspacePermission } from '../../shared/workspace-access';
import { workspaceAllowed } from '../../shared/capability-status';
import type { Task } from '../../shared/contracts';
import { newChatKey } from '../../shared/live-task';
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
   * nothing has to stop; another folder or fewer permissions is a new grant that invalidates old snapshots.
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
    const grant = StoredGrant.parse(widened
      ? { ...previous, permissions }
      : { id: id(), taskId, revision: (previous?.revision ?? 0) + 1, permissions, name: resolved.name, revoked: false,
        directory: resolved.directory, device: resolved.device, inode: resolved.inode });
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

  /**
   * Checks a waiting folder again right before it becomes a grant: it must still be the directory that was picked,
   * not one moved away or replaced at the same path since.
   */
  async confirmPending(pending: PendingWorkspace): Promise<ResolvedDirectory> {
    let resolved: ResolvedDirectory;
    try {
      resolved = await this.resolve(pending.directory);
    } catch {
      // The filesystem error names the path; the chat only needs to know the folder is not there any more.
      throw new Error('Thư mục không còn trên máy.');
    }
    if (resolved.directory !== pending.directory || resolved.device !== pending.device || resolved.inode !== pending.inode) {
      throw new Error('Thư mục workspace đã bị thay thế. Chọn lại thư mục trước khi tiếp tục.');
    }
    return resolved;
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
    const canonical = await realpath(directory);
    const identity = await stat(directory, { bigint: true });
    this.assert(snapshot, permission);
    if (canonical !== directory || !identity.isDirectory() || identity.dev.toString() !== current.device
      || identity.ino.toString() !== current.inode) {
      throw new Error('Thư mục workspace đã bị thay thế. Chọn lại thư mục trước khi tiếp tục.');
    }
    return directory;
  }
}
