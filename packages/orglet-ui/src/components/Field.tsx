import type { ComponentProps } from 'react';
import { cn } from '../cn';
import { ErrorIcon } from '../icons';
import './Field.css';

/**
 * Marks a field as failing validation. `flash` replays the shake: pass a counter the form increments on every
 * failed submit, so submitting the same bad value twice is visible both times.
 */
type Validation = { invalid?: boolean; flash?: number };

const validationAttributes = ({ invalid, flash }: Validation) => (invalid
  ? { 'aria-invalid': true as const, 'data-flash': flash }
  : {});

/**
 * A single-line text field. Name it with a `<label>` around it or `aria-label`; the kit does not invent a label,
 * because a field without one is a bug the caller has to see.
 */
export function Input({ invalid, flash, className, ...props }: ComponentProps<'input'> & Validation) {
  return <input {...props} {...validationAttributes({ invalid, flash })} className={cn('org-input', className)} />;
}

/** The same field over several lines. It grows downwards only: a field that widens rearranges the form around it. */
export function Textarea({ invalid, flash, className, ...props }: ComponentProps<'textarea'> & Validation) {
  return <textarea {...props} {...validationAttributes({ invalid, flash })} className={cn('org-input', 'org-textarea', className)} />;
}

/**
 * Says what is wrong with a field, directly under it: a mark, then a short sentence, in the error colour. Pair it with
 * `invalid` on the field and point the field's `aria-describedby` at `id`. It is announced when it appears.
 */
export function FieldError({ className, children, ...props }: ComponentProps<'span'>) {
  return <span {...props} role="alert" className={cn('org-field-error', className)}>
    <ErrorIcon size={14} />
    <span>{children}</span>
  </span>;
}
