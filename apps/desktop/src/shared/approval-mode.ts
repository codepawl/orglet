import { withCapability, type ToolCapability } from './tool-policy';
import type { WorkspaceLevel } from './capability-status';
import type { Run } from './contracts';

/**
 * The approval mode under the prompt bar (COD-367). Two of the three are the chat's `workspace.apply` capability, the
 * same value the Details switch "Review before applying" shows inverted, so the two controls can never disagree:
 * `ask` is the chat without it (a solo run's changes wait for review), `apply` the chat with it. `plan` is not a
 * permission at all: it is Plan first for the next message, sent with that message (`RunInput.planFirst`), and the
 * chat keeps whichever of the other two it had.
 */
export type ApprovalMode = 'ask' | 'apply' | 'plan';
export const approvalModes: readonly ApprovalMode[] = ['ask', 'apply', 'plan'];

/** Where a chat's changes go, read off its permissions; `appliesAtOnce` is a crew or a channel, which never holds them. */
export function changesMode(capabilities: readonly ToolCapability[], appliesAtOnce: boolean): Exclude<ApprovalMode, 'plan'> {
  if (appliesAtOnce) return 'apply';
  return capabilities.includes('workspace.apply') ? 'apply' : 'ask';
}

/** The mode the picker shows: Plan first while it is set for the next message, otherwise where changes go. */
export function approvalModeOf(input: { capabilities: readonly ToolCapability[]; planFirst: boolean; appliesAtOnce: boolean }): ApprovalMode {
  if (input.planFirst) return 'plan';
  return changesMode(input.capabilities, input.appliesAtOnce);
}

/** The chat's permissions for `ask` or `apply`; every other permission stays as it was. */
export function capabilitiesForMode(previous: readonly ToolCapability[], mode: Exclude<ApprovalMode, 'plan'>): ToolCapability[] {
  return withCapability(previous, 'workspace.apply', mode === 'apply');
}

/**
 * What choosing `ask` or `apply` needs first: a working folder the orglets may edit. Without one the two modes have
 * nothing to hold or apply, so the picker says so and choosing one asks for a folder (`pick`) or for edit access to
 * the folder already chosen (`edit`). Plan first needs neither: it can plan from the conversation and its files.
 */
export type FolderNeed = 'pick' | 'edit' | undefined;

export function folderNeedFor(mode: ApprovalMode, level: WorkspaceLevel): FolderNeed {
  if (mode === 'plan') return undefined;
  if (level === 'none') return 'pick';
  if (level === 'read') return 'edit';
  return undefined;
}

/** The run whose answer is a Plan first answer (COD-367): a solo, group or crew lead's answer, never a crew member's part. */
export function answersWithPlan(author: Pick<Run, 'stage' | 'snapshot'> | undefined): boolean {
  return author?.snapshot.input?.planFirst === true && author.stage !== 'member';
}

/**
 * Whether Follow the plan is offered under this answer: only on the latest turn, while nothing runs or waits to start,
 * since it sends the next message of the chat.
 */
export function canFollowPlan(author: Pick<Run, 'stage' | 'snapshot'> | undefined, chat: { latest: boolean; busy: boolean; pendingStart: boolean }): boolean {
  return answersWithPlan(author) && chat.latest && !chat.busy && !chat.pendingStart;
}
