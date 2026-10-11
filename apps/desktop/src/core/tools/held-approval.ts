import type { Run, Task } from '../../shared/contracts';
import type { ApprovedBy } from '../../shared/tool-policy';
import type { ActionToJudge, AutoApproval } from '../decisions/action-risk';
import { hasCapability } from './policy';

/** The mode a run's held actions are approved by without asking the person, read off its permissions; none in Manual and Accept edits. */
export type StandingApproval = 'auto' | 'bypass';

export function standingApprovalOf(run: Run, task: Task): StandingApproval | undefined {
  if (hasCapability(run, task, 'approval.bypass')) return 'bypass';
  if (hasCapability(run, task, 'approval.auto')) return 'auto';
  return undefined;
}

/**
 * Who approves a held action without the person, or undefined when the person must be asked. Bypass approves it. Auto
 * approves it only when the decision model finds the action low risk; an action that cannot be described, a missing
 * decision model and a late answer all leave it to the person.
 */
export async function approvedWithoutAsking(input: {
  standing: StandingApproval | undefined;
  autoApproval: AutoApproval | undefined;
  action: ActionToJudge | undefined;
  taskId: string;
}): Promise<Exclude<ApprovedBy, 'person'> | undefined> {
  if (input.standing === 'bypass') return 'bypass';
  if (input.standing !== 'auto' || !input.autoApproval || !input.action) return undefined;
  const verdict = await input.autoApproval.mayGoAhead(input.action, { taskId: input.taskId });
  return verdict === 'approve' ? 'auto' : undefined;
}
