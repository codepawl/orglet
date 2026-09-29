import type { PermissionState, WorkspaceLevel } from './capability-status';

/**
 * What Tacet reads a message as needing before it is sent (COD-305): the web, Orglet's browser, or the working folder at
 * a level (read files, edit them, run commands). The core lists what cleared its threshold, strongest first; the
 * composer offers the first one the chat does not have yet.
 */
export type PermissionNeed = 'web' | 'browser' | Exclude<WorkspaceLevel, 'none'>;
export type PermissionNeedsAnswer = { needs: PermissionNeed[] };

/** The start of a message is what Tacet reads; a long paste beyond this changes nothing about what it needs. */
export const PERMISSION_NEEDS_MAX_CHARS = 2000;
/** Shorter than this, a message says too little to read a need from ("hi", "ok thanks"). */
export const PERMISSION_NEEDS_MIN_CHARS = 12;

const folderRank: Record<WorkspaceLevel, number> = { none: 0, read: 1, write: 2, execute: 3 };

export function isFolderNeed(need: PermissionNeed): need is Exclude<WorkspaceLevel, 'none'> {
  return need === 'read' || need === 'write' || need === 'execute';
}

/** Whether the chat already allows what the need asks for; a folder at a higher level covers a lower one. */
export function chatAllows(need: PermissionNeed, permissions: PermissionState): boolean {
  if (need === 'web') return permissions.web;
  if (need === 'browser') return permissions.browser !== 'none';
  return folderRank[permissions.workspace] >= folderRank[need];
}

/** Which control a need belongs to; waving a hint away hides every hint for that control in the chat. */
export type PermissionHintKind = 'web' | 'browser' | 'folder';

export function hintKind(need: PermissionNeed): PermissionHintKind {
  if (isFolderNeed(need)) return 'folder';
  return need;
}

/** The one need to offer: the strongest the chat lacks and the person has not waved away in this chat. */
export function missingNeed(needs: readonly PermissionNeed[], permissions: PermissionState, dismissed: ReadonlySet<PermissionHintKind> = new Set()): PermissionNeed | undefined {
  return needs.find(need => !dismissed.has(hintKind(need)) && !chatAllows(need, permissions));
}
