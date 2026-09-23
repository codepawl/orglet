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

/**
 * A chat that has not started yet has no `tasks` row to grant a folder to, so the folder waits under the worker
 * or team (COD-186), keyed like `newChatCapabilities`. The renderer sees only the folder's name and level; the
 * path stays in the core until the first message turns it into a real grant.
 */
export const NewChatWorkspaceView = z.object({ name: z.string(), permissions: WorkspacePermissions }).strict();
export type NewChatWorkspaceView = z.infer<typeof NewChatWorkspaceView>;
/** The orglets of a group chat that has not started yet (COD-215), in the order they were picked. */
export const GroupChatWorkerIds = z.array(z.uuid()).min(2).max(50);
/**
 * Whose empty chat a pending folder belongs to; a team chat is keyed by the team, never by its lead, and a group
 * chat by every orglet in it.
 */
export const NewChatTarget = z.union([
  z.object({ workerId: z.uuid() }).strict(),
  z.object({ teamId: z.uuid() }).strict(),
  z.object({ workerIds: GroupChatWorkerIds }).strict(),
]);
export type NewChatTarget = z.infer<typeof NewChatTarget>;

/** What the renderer may ask the native picker for: a folder for a chat row, or for a chat that has no row yet. */
export const PickWorkspace = z.union([
  z.object({ taskId: z.uuid(), permissions: WorkspacePermissions }).strict(),
  z.object({ workerId: z.uuid(), permissions: WorkspacePermissions }).strict(),
  z.object({ teamId: z.uuid(), permissions: WorkspacePermissions }).strict(),
  z.object({ workerIds: GroupChatWorkerIds, permissions: WorkspacePermissions }).strict(),
]);
export type PickWorkspace = z.infer<typeof PickWorkspace>;

/** Only main may add a native-picker path. Never put this command on the renderer allowlist. */
const Directory = z.string().min(1).max(32768);
export const GrantWorkspace = z.union([
  z.object({ taskId: z.uuid(), permissions: WorkspacePermissions, directory: Directory }).strict(),
  z.object({ workerId: z.uuid(), permissions: WorkspacePermissions, directory: Directory }).strict(),
  z.object({ teamId: z.uuid(), permissions: WorkspacePermissions, directory: Directory }).strict(),
  z.object({ workerIds: GroupChatWorkerIds, permissions: WorkspacePermissions, directory: Directory }).strict(),
]);
export type GrantWorkspace = z.infer<typeof GrantWorkspace>;
