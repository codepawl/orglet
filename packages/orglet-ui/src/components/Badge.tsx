import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import './Badge.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error';

/** What a badge shows: a short word as `children`, or a number as `count`, which reads `99+` past `max`. */
function badgeText(count: number | undefined, max: number, children: ReactNode) {
  if (count === undefined) return children;
  return count > max ? `${max}+` : count;
}

/**
 * A small pill for a count or a short state word, on a pale tint of its tone's colour. Colour is a hint and never the
 * whole message: a state badge says its state in words, or sits beside a `StatusMark`, so it still reads without
 * colour. It is a plain `<span>`; a count that matters to a screen reader needs its context in the surrounding text.
 */
export function Badge({ tone = 'neutral', count, max = 99, className, children, ...props }: Omit<ComponentProps<'span'>, 'children'> & {
  tone?: BadgeTone;
  /** A number to show instead of `children`; above `max` it reads `99+`. */
  count?: number;
  /** The most a count shows exactly. */
  max?: number;
  children?: ReactNode;
}) {
  return <span {...props} className={cn('org-badge', `org-badge-${tone}`, className)}>
    {badgeText(count, max, children)}
  </span>;
}
