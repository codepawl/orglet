import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import './Checkbox.css';

/**
 * A tick for picking items out of a list, or for confirming something once. It is a real, visually hidden
 * `<input type="checkbox">`, so the keyboard, forms, screen readers and a test's `check()` all keep working, with a
 * drawn box beside the label. Everything except `children`, `description` and `labelProps` goes to the input.
 *
 * A setting that is simply on or off wears a `Switch` instead.
 */
export function Checkbox({ children, description, labelProps, className, required, ...input }: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  children: ReactNode;
  description?: ReactNode;
  labelProps?: Omit<ComponentProps<'label'>, 'children' | 'className'>;
  /**
   * A choice the form cannot be saved without. It draws the same red asterisk a required field gets, in CSS so it
   * never lands in the accessible name. It does not set the native `required` attribute, which would bring the
   * browser's own validation bubble; the form says what is wrong in its own words.
   */
  required?: boolean;
}) {
  return <label {...labelProps} className={cn('org-checkbox', input.disabled && 'org-checkbox-disabled', className)}>
    <input {...input} type="checkbox" aria-required={required || undefined} className="org-checkbox-input" />
    <span className="org-checkbox-box" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
    <span className={cn('org-checkbox-text', required && 'org-checkbox-required')}>
      {children}
      {description && <span className="org-checkbox-description">{description}</span>}
    </span>
  </label>;
}
