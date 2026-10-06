import type { ComponentProps } from 'react';
import { cn } from '../cn';
import './Progress.css';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * A determinate bar for work whose size is known: 3 of 12 files, 40% uploaded. `label` is the accessible name and is
 * required; `valueText` is what the bar says in words (`3 of 12`), shown beside it and announced instead of the bare
 * number. A value outside `0` to `max` is held to it.
 *
 * It has no indeterminate mode on purpose. A wait of unknown length is not progress, and its shape is a `Skeleton`.
 */
export function Progress({ label, value, max = 100, valueText, className, ...props }: Omit<ComponentProps<'div'>, 'children' | 'role'> & {
  label: string;
  value: number;
  /** The value that means done. */
  max?: number;
  valueText?: string;
}) {
  const current = clamp(value, 0, max);
  const percent = max > 0 ? (current / max) * 100 : 0;
  return <div {...props} className={cn('org-progress', className)}>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={current}
      aria-valuetext={valueText} className="org-progress-track">
      <div className="org-progress-fill" style={{ width: `${percent}%` }} />
    </div>
    {valueText && <span className="org-progress-text" aria-hidden="true">{valueText}</span>}
  </div>;
}
