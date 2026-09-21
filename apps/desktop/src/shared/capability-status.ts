import type { ToolCapability } from './tool-policy';
import type { ProviderId } from './contracts';
import { snapshotCapabilities } from './tool-policy';
import type { WorkspaceGrantSnapshot, WorkspaceGrantView, WorkspacePermission } from './workspace-access';

export type WorkAbility = 'sources' | 'dataset' | 'workspace-read' | 'workspace-write' | 'workspace-execute' | 'web';
export type AbilityState = 'available' | 'connection' | 'permission' | 'source' | 'unsupported' | 'loading';
export type AbilityStatus = { ability: WorkAbility; state: AbilityState };

/** A preview for the next turn. Runtime still validates the frozen run and current task before every tool call. */
export function abilityStatuses(input: {
  provider: ProviderId;
  connected: boolean;
  capabilities?: ToolCapability[];
  grant?: WorkspaceGrantView | null;
  taskId?: string;
  grantLoaded?: boolean;
  sourceCount: number;
}): AbilityStatus[] {
  const { provider, connected, grant, sourceCount } = input;
  const capabilities = input.capabilities ?? snapshotCapabilities(provider);
  const state = (capability?: ToolCapability, permission?: WorkspacePermission, source = false): AbilityState => {
    if (provider === 'demo') return 'unsupported';
    if (!connected) return 'connection';
    if (capability && !capabilities.includes(capability)) return 'permission';
    if (permission && input.grantLoaded === false) return 'loading';
    if (permission && (!grant || grant.revoked || (input.taskId && grant.taskId !== input.taskId)
      || !grant.permissions.includes(permission))) return 'permission';
    if (source && sourceCount === 0) return 'source';
    return 'available';
  };
  return [
    { ability: 'sources', state: state('source.read', undefined, true) },
    { ability: 'dataset', state: state('dataset.check', undefined, true) },
    { ability: 'workspace-read', state: state(undefined, 'read') },
    { ability: 'workspace-write', state: state(undefined, 'write') },
    { ability: 'workspace-execute', state: state(undefined, 'execute') },
    { ability: 'web', state: state('network.web') },
  ];
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
