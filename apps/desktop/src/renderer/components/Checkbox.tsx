import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * Orglet checkbox: a real, visually hidden `<input type="checkbox">` (keyboard, forms, screen readers and test
 * `check()` keep working) with a drawn box. Everything except `children`, `description` and `labelProps` goes to
 * the input.
 */
export function Checkbox({ children, description, labelProps, className = '', required, ...input }: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  children: ReactNode; description?: ReactNode; labelProps?: Omit<ComponentProps<'label'>, 'children' | 'className'>;
  /**
   * A choice the form cannot be saved without. Marks it with the same red asterisk a required field gets, drawn in
   * CSS so it never lands in the accessible name (user, 2026-09-19: the mark belongs on anything that must be
   * chosen, not only on inputs).
   *
   * It deliberately does not set the native `required` attribute, which would hand the browser its own validation
   * bubble in its own styling. This app says what is wrong in its own words, in its own theme.
   */
  required?: boolean;
}) {
  return <label {...labelProps} className={`checkbox ${input.disabled ? 'disabled' : ''} ${className}`}>
    <input {...input} type="checkbox" aria-required={required || undefined} className="checkbox-input" />
    <span className="checkbox-box" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
    <span className={`checkbox-text${required ? ' required' : ''}`}>{children}{description && <span className="checkbox-description">{description}</span>}</span>
  </label>;
}
