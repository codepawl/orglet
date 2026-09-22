import type { ToolCapability } from './tool-policy';
import type { ProviderId } from './contracts';
import { snapshotCapabilities } from './tool-policy';
import type { WorkspaceGrantSnapshot, WorkspaceGrantView, WorkspacePermission } from './workspace-access';

/**
 * How much of the working folder a chat may touch. The levels are cumulative because the grant schema
 * (`WorkspacePermissions`) refuses `write` without `read` and `execute` without `write`, so the only grants that can
 * exist are read, read+write and read+write+execute. `none` is no folder at all.
 */
export type WorkspaceLevel = 'none' | 'read' | 'write' | 'execute';
export const workspaceLevels: readonly WorkspaceLevel[] = ['none', 'read', 'write', 'execute'];

export function workspaceLevelOf(permissions: readonly WorkspacePermission[]): WorkspaceLevel {
  if (permissions.includes('execute')) return 'execute';
  if (permissions.includes('write')) return 'write';
  if (permissions.includes('read')) return 'read';
  return 'none';
}

export function permissionsForLevel(level: WorkspaceLevel): WorkspacePermission[] {
  if (level === 'execute') return ['read', 'write', 'execute'];
  if (level === 'write') return ['read', 'write'];
  if (level === 'read') return ['read'];
  return [];
}

/** Why a worker cannot use any tool permission right now: Demo runs no tools, and a model with no connection cannot run. */
export type PermissionBlocker = 'unsupported' | 'connection';

export function permissionBlocker(provider: ProviderId, connected: boolean): PermissionBlocker | undefined {
  if (provider === 'demo') return 'unsupported';
  if (!connected) return 'connection';
  return undefined;
}

/** What the permission controls show for one chat: the current task policy and folder grant, never a frozen run. */
export type PermissionState = {
  sources: boolean;
  dataset: boolean;
  web: boolean;
  workspace: WorkspaceLevel;
  folder?: string;
};

/**
 * The same values core reads when it dispatches the next turn. A grant counts only while it is current: not revoked
 * and made for this task. Runtime still intersects these with the frozen run before every tool call.
 */
export function permissionState(input: {
  provider: ProviderId;
  capabilities?: ToolCapability[];
  grant?: WorkspaceGrantView | null;
  taskId?: string;
}): PermissionState {
  const capabilities = input.capabilities ?? snapshotCapabilities(input.provider);
  const grant = input.grant;
  const current = !!grant && !grant.revoked && (!input.taskId || grant.taskId === input.taskId);
  return {
    sources: capabilities.includes('source.read'),
    dataset: capabilities.includes('dataset.check'),
    web: capabilities.includes('network.web'),
    workspace: current ? workspaceLevelOf(grant.permissions) : 'none',
    ...(current ? { folder: grant.name } : {}),
  };
}

/** The same frozen/current intersection used by the execution policy. */
export function capabilityAllowed(provider: ProviderId, capability: ToolCapability,
  current?: ToolCapability[], frozen?: ToolCapability[]): boolean {
  return (frozen ?? snapshotCapabilities(provider)).includes(capability)
    && (current ?? snapshotCapabilities(provider)).includes(capability);
}

export function workspaceAllowed(taskId: string, permission: WorkspacePermission,
  frozen?: WorkspaceGrantSnapshot, current?: WorkspaceGrantView | null): boolean {
  return !!frozen && frozen.taskId === taskId && frozen.permissions.includes(permission)
    && !!current && !current.revoked && current.taskId === taskId && current.id === frozen.id
    && current.revision === frozen.revision && current.permissions.includes(permission);
}
