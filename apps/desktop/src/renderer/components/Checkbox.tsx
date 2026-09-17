import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * Orglet checkbox: a real, visually hidden `<input type="checkbox">` (keyboard, forms, screen readers and test
 * `check()` keep working) with a drawn box. Everything except `children`, `description` and `labelProps` goes to
 * the input.
 */
export function Checkbox({ children, description, labelProps, className = '', ...input }: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  children: ReactNode; description?: ReactNode; labelProps?: Omit<ComponentProps<'label'>, 'children' | 'className'>;
}) {
  return <label {...labelProps} className={`checkbox ${input.disabled ? 'disabled' : ''} ${className}`}>
    <input {...input} type="checkbox" className="checkbox-input" />
    <span className="checkbox-box" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
    <span className="checkbox-text">{children}{description && <span className="checkbox-description">{description}</span>}</span>
  </label>;
}
