import type { TaskStatus } from '../../shared/contracts';

export type StatusMarkVariant = 'empty' | 'dashed' | 'filled' | 'busy';
export type StatusMarkTone = 'muted' | 'success' | 'error' | 'working';
export type StatusMarkState = { variant: StatusMarkVariant; tone: StatusMarkTone };

/*
 * The glyph inside the mark, so a state says what it is instead of only what colour it is (user, 2026-09-19).
 * Every one is drawn on the same 16 grid with the same stroke, so a column of rows lines up.
 */
const ring = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' } as const;
const glyphs = {
  // Nothing to report: an open, dotted ring, the quietest thing that is still a shape.
  idle: <circle cx="8" cy="8" r="5.4" {...ring} strokeDasharray="0.1 3.4" />,
  // Waiting on something: the same dotted ring in its own colour, so paused and idle are not the same mark.
  waiting: <circle cx="8" cy="8" r="5.4" {...ring} strokeWidth={2.1} strokeDasharray="0.1 3.4" />,
  // Working: a ring with a gap, turning.
  busy: <circle cx="8" cy="8" r="5.4" {...ring} strokeWidth={2.2} strokeDasharray="21 13" />,
  // There is an answer waiting to be read.
  done: <path d="M4.8 8.3 7 10.5l4.2-4.6" {...ring} strokeWidth={2.2} strokeLinejoin="round" />,
  // Something needs a person: the one mark that is not a ring, so it stands out in a list.
  attention: <path d="M8 4.4v4.4M8 11.4v.2" {...ring} strokeWidth={2.2} />,
} as const;

function glyphFor(variant: StatusMarkVariant, tone: StatusMarkTone) {
  if (variant === 'busy') return glyphs.busy;
  if (variant === 'filled') return tone === 'error' ? glyphs.attention : glyphs.done;
  if (variant === 'dashed') return tone === 'error' ? glyphs.attention : glyphs.waiting;
  return glyphs.idle;
}

/**
 * Shared status mark (left of titles): a small glyph on the Orglet tokens — dotted ring idle, dotted ring in its own
 * colour waiting, turning ring busy, a check when an answer is unread, and a stroke that is not a ring when something
 * needs a person. States that carry news sit on a soft tint of their own colour; an idle row stays plain.
 * Pass `decorative` when the mark sits inside a named control so it does not steal the accessible name.
 */
export function StatusMark({ variant, tone = 'muted', label, decorative, className }: {
  variant: StatusMarkVariant;
  tone?: StatusMarkTone;
  label: string;
  decorative?: boolean;
  className?: string;
}) {
  return <span className={`status-mark ${variant} ${tone}${className ? ` ${className}` : ''}`} title={label} {...(decorative ? { 'aria-hidden': true as const } : { role: 'status' as const, 'aria-label': label })}>
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">{glyphFor(variant, tone)}</svg>
  </span>;
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
