import { z } from 'zod';

export const WorkspacePermission = z.enum(['read', 'write', 'execute']);
export type WorkspacePermission = z.infer<typeof WorkspacePermission>;
export const WorkspacePermissions = z.array(WorkspacePermission).min(1).max(3).refine(
  permissions => new Set(permissions).size === permissions.length && permissions.includes('read')
    && (!permissions.includes('execute') || permissions.includes('write')),
  'Workspace cần quyền đọc; chạy lệnh cũng cần quyền sửa bản làm việc.',
);
export const WorkspaceGrantSnapshot = z.object({
  id: z.uuid(), taskId: z.uuid(), revision: z.number().int().positive(), permissions: WorkspacePermissions,
}).strict();
export type WorkspaceGrantSnapshot = z.infer<typeof WorkspaceGrantSnapshot>;
export const WorkspaceGrantView = WorkspaceGrantSnapshot.extend({ name: z.string(), revoked: z.boolean() }).strict();
export type WorkspaceGrantView = z.infer<typeof WorkspaceGrantView>;
export const PickWorkspace = z.object({ taskId: z.uuid(), permissions: WorkspacePermissions }).strict();

/** Only main may add a native-picker path. Never put this command on the renderer allowlist. */
export const GrantWorkspace = PickWorkspace.extend({ directory: z.string().min(1).max(32768) }).strict();
