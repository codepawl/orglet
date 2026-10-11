import { withCapability, type ToolCapability } from './tool-policy';
import type { WorkspaceLevel } from './capability-status';
import type { Run } from './contracts';

/**
 * The mode under the prompt bar, which works like Claude Code's permission modes. Four of the five are stored as the
 * chat's permissions, so run snapshots, side threads (never wider), new-chat pending sets, backup and sync carry them
 * with no second mechanism:
 * - `manual` is the chat without `workspace.apply`: a solo run's changes wait for review and every held action asks.
 * - `acceptEdits` is the chat with `workspace.apply`: changes reach the folder, every other approval still asks.
 * - `auto` adds `approval.auto`: a light decision model approves the held actions it finds low risk.
 * - `bypass` adds `approval.bypass`: every held action is approved.
 * `plan` is not a permission at all: it is Plan first for the next message, sent with that message
 * (`RunInput.planFirst`), and the chat keeps whichever of the other four it had.
 */
export type ApprovalMode = 'auto' | 'manual' | 'acceptEdits' | 'plan' | 'bypass';
export const approvalModes: readonly ApprovalMode[] = ['auto', 'manual', 'acceptEdits', 'plan', 'bypass'];

export type ChangesMode = Exclude<ApprovalMode, 'plan'>;

/** Where a chat's changes and approvals go, read off its permissions; `appliesAtOnce` is a crew or a channel, which never holds them. */
export function changesMode(capabilities: readonly ToolCapability[], appliesAtOnce: boolean): ChangesMode {
  if (capabilities.includes('approval.bypass')) return 'bypass';
  if (capabilities.includes('approval.auto')) return 'auto';
  if (appliesAtOnce) return 'acceptEdits';
  return capabilities.includes('workspace.apply') ? 'acceptEdits' : 'manual';
}

/** The mode the picker shows: Plan first while it is set for the next message, otherwise where changes go. */
export function approvalModeOf(input: { capabilities: readonly ToolCapability[]; planFirst: boolean; appliesAtOnce: boolean }): ApprovalMode {
  if (input.planFirst) return 'plan';
  return changesMode(input.capabilities, input.appliesAtOnce);
}

/** The chat's permissions for a mode other than Plan first; every other permission stays as it was. */
export function capabilitiesForMode(previous: readonly ToolCapability[], mode: ChangesMode): ToolCapability[] {
  const withApply = withCapability(previous, 'workspace.apply', mode !== 'manual');
  const withAuto = withCapability(withApply, 'approval.auto', mode === 'auto');
  return withCapability(withAuto, 'approval.bypass', mode === 'bypass');
}

/**
 * What choosing `manual` or `acceptEdits` needs first: a working folder the orglets may edit. Without one the two modes
 * have nothing to hold or apply, so the picker says so and choosing one asks for a folder (`pick`) or for edit access to
 * the folder already chosen (`edit`). Plan first, Auto and Bypass need neither: Plan can plan from the conversation and
 * its files, and the other two also govern the approvals of MCP, browser and desktop steps.
 */
export type FolderNeed = 'pick' | 'edit' | undefined;

export function folderNeedFor(mode: ApprovalMode, level: WorkspaceLevel): FolderNeed {
  if (mode !== 'manual' && mode !== 'acceptEdits') return undefined;
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
