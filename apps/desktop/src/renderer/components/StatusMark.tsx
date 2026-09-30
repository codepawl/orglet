// The mark itself moved into the kit (COD-274); what a task's status looks like stays with the app.
import type { TaskStatus } from '../../shared/contracts';
import type { ChatTabState } from '../chatTabs';
import type { StatusMarkState } from '@codepawl/orglet-ui';

export { StatusMark } from '@codepawl/orglet-ui';
export type { StatusMarkState, StatusMarkTone, StatusMarkVariant } from '@codepawl/orglet-ui';

/** Map a task's run state to the circle. Finished work stays filled until the user opens it (`seen`). */
export function taskStatusMark(status: TaskStatus, seen: boolean): StatusMarkState {
  if (status === 'queued' || status === 'running' || status === 'pausing') return { variant: 'busy', tone: 'working' };
  if (status === 'paused' || status === 'waiting_budget') return { variant: 'paused', tone: 'muted' };
  // A question, an approval or evidence the person owes: the same mark a chat tab shows for it (COD-340).
  if (status === 'waiting_input') return { variant: 'asking', tone: 'accent' };
  if (status === 'failed' || status === 'interrupted') return { variant: 'filled', tone: 'error' };
  if ((status === 'completed' || status === 'partial') && !seen) return { variant: 'filled', tone: 'success' };
  return { variant: 'empty', tone: 'muted' };
}

/** Pick the strongest mark from a subset (waiting for you > busy > error > unread > waiting > idle). */
export function rollupStatusMarks(marks: StatusMarkState[]): StatusMarkState {
  return marks.reduce<StatusMarkState>((best, mark) => statusRank(mark) > statusRank(best) ? mark : best, { variant: 'empty', tone: 'muted' });
}

/** Roll up several tasks into one mark for a worker or team row. */
export function tasksStatusMark(tasks: ReadonlyArray<{ status: TaskStatus; seen: boolean }>): StatusMarkState {
  return rollupStatusMarks(tasks.map(task => taskStatusMark(task.status, task.seen)));
}

function statusRank(mark: StatusMarkState): number {
  if (mark.variant === 'asking') return 70;
  if (mark.variant === 'busy') return 60;
  if (mark.variant === 'filled' && mark.tone === 'error') return 50;
  if (mark.variant === 'filled') return 40;
  if (mark.variant === 'dashed' && mark.tone === 'error') return 30;
  if (mark.variant === 'paused' || mark.variant === 'dashed') return 20;
  return 0;
}

/**
 * The mark of a chat tab's one state (COD-340), drawn with the sidebar's marks so a chat reads the same in both
 * places. A chat paused at a checkpoint or its budget also waits for the person, so a tab shows it as that.
 */
export function chatTabMark(state: ChatTabState): StatusMarkState {
  if (state === 'needs-you') return { variant: 'asking', tone: 'accent' };
  if (state === 'error') return { variant: 'filled', tone: 'error' };
  if (state === 'running') return { variant: 'busy', tone: 'working' };
  if (state === 'unread') return { variant: 'filled', tone: 'success' };
  return { variant: 'empty', tone: 'muted' };
}