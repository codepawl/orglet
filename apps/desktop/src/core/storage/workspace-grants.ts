import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { z } from 'zod';
import { GrantWorkspace, WorkspaceGrantSnapshot, WorkspaceGrantView, type WorkspacePermission } from '../../shared/workspace-access';
import type { Task } from '../../shared/contracts';
import { Store, id } from './database';

const StoredGrant = WorkspaceGrantView.extend({
  directory: z.string().min(1), device: z.string(), inode: z.string(),
}).strict();

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

  async grant(raw: unknown): Promise<WorkspaceGrantView> {
    const input = GrantWorkspace.parse(raw);
    this.assertTask(input.taskId);
    if (!isAbsolute(input.directory)) throw new Error('Workspace phải là thư mục đã chọn trên máy.');
    const directory = await realpath(input.directory);
    const identity = await stat(directory, { bigint: true });
    if (!identity.isDirectory()) throw new Error('Workspace phải là thư mục đã chọn trên máy.');
    return this.store.transaction(() => {
      this.assertTask(input.taskId);
      const previous = this.current(input.taskId);
      const grant = StoredGrant.parse({ id: id(), taskId: input.taskId, revision: (previous?.revision ?? 0) + 1,
        permissions: input.permissions, name: basename(directory) || directory, revoked: false,
        directory, device: identity.dev.toString(), inode: identity.ino.toString() });
      this.store.db.prepare(`INSERT INTO workspace_grants(task_id,data) VALUES(?,?)
        ON CONFLICT(task_id) DO UPDATE SET data=excluded.data`).run(input.taskId, JSON.stringify(grant));
      return this.view(input.taskId)!;
    });
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

  assert(snapshot: WorkspaceGrantSnapshot, permission: WorkspacePermission): string {
    const frozen = WorkspaceGrantSnapshot.parse(snapshot);
    this.assertTask(frozen.taskId);
    const current = this.current(frozen.taskId);
    if (!current || current.revoked || current.id !== frozen.id || current.revision !== frozen.revision
      || !current.permissions.includes(permission) || !frozen.permissions.includes(permission)) {
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
