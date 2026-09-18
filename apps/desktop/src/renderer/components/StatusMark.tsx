import type { TaskStatus } from '../../shared/contracts';

export type StatusMarkVariant = 'empty' | 'dashed' | 'filled' | 'busy';
export type StatusMarkTone = 'muted' | 'success' | 'error' | 'working';
export type StatusMarkState = { variant: StatusMarkVariant; tone: StatusMarkTone };

/**
 * Shared status circle (left of titles): hollow idle, dashed waiting, filled unread/ready,
 * busy = soft spinner. Colours stay on Orglet tokens (success / error / muted / working).
 * Pass `decorative` when the mark sits inside a named control so it does not steal the accessible name.
 */
export function StatusMark({ variant, tone = 'muted', label, decorative, className }: {
  variant: StatusMarkVariant;
  tone?: StatusMarkTone;
  label: string;
  decorative?: boolean;
  className?: string;
}) {
  return <span className={`status-mark ${variant} ${tone}${className ? ` ${className}` : ''}`} title={label} {...(decorative ? { 'aria-hidden': true as const } : { role: 'status' as const, 'aria-label': label })} />;
}

/** Map a task's run state to the circle. Finished work stays filled until the user opens it (`seen`). */
export function taskStatusMark(status: TaskStatus, seen: boolean): StatusMarkState {
  if (status === 'queued' || status === 'running' || status === 'pausing') return { variant: 'busy', tone: 'working' };
  if (status === 'paused' || status === 'waiting_budget') return { variant: 'dashed', tone: 'muted' };
  if (status === 'waiting_input') return { variant: 'dashed', tone: 'error' };
  if (status === 'failed' || status === 'interrupted') return { variant: 'filled', tone: 'error' };
  if ((status === 'completed' || status === 'partial') && !seen) return { variant: 'filled', tone: 'success' };
  return { variant: 'empty', tone: 'muted' };
}

/** Pick the strongest mark from a subset (busy > error > unread > waiting > idle). */
export function rollupStatusMarks(marks: StatusMarkState[]): StatusMarkState {
  return marks.reduce<StatusMarkState>((best, mark) => statusRank(mark) > statusRank(best) ? mark : best, { variant: 'empty', tone: 'muted' });
}

/** Roll up several tasks into one mark for a worker or team row. */
export function tasksStatusMark(tasks: ReadonlyArray<{ status: TaskStatus; seen: boolean }>): StatusMarkState {
  return rollupStatusMarks(tasks.map(task => taskStatusMark(task.status, task.seen)));
}

function statusRank(mark: StatusMarkState): number {
  if (mark.variant === 'busy') return 60;
  if (mark.variant === 'filled' && mark.tone === 'error') return 50;
  if (mark.variant === 'filled') return 40;
  if (mark.variant === 'dashed' && mark.tone === 'error') return 30;
  if (mark.variant === 'dashed') return 20;
  return 0;
}
