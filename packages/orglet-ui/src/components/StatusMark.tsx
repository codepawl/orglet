import { cn } from '../cn';
import './StatusMark.css';

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
 * A small status glyph for the left of a title: a dotted ring when idle, the dotted ring in its own colour when
 * waiting, a turning ring when busy, a tick when there is something new to read, and a stroke that is not a ring
 * when something needs a person. States that carry news sit on a soft tint of their own colour; idle stays plain.
 * `label` is what a screen reader hears; pass `decorative` when the mark sits inside a control that already has a
 * name, so the mark does not take it over.
 */
export function StatusMark({ variant, tone = 'muted', label, decorative, className }: {
  variant: StatusMarkVariant;
  tone?: StatusMarkTone;
  label: string;
  decorative?: boolean;
  className?: string;
}) {
  const naming = decorative ? { 'aria-hidden': true as const } : { role: 'status' as const, 'aria-label': label };
  return <span className={cn('org-status-mark', `org-status-mark-${variant}`, `org-status-mark-${tone}`, className)} title={label} {...naming}>
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">{glyphFor(variant, tone)}</svg>
  </span>;
}
