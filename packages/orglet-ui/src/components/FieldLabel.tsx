import type { ComponentType, ReactNode } from 'react';
import { cn } from '../cn';
import './FieldLabel.css';

/** Any icon component that takes a size, such as one from lucide-react. */
export type FieldLabelIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/**
 * A field's title with a small leading icon. The icon is decorative, so the accessible name stays the text. `required`
 * marks a field the form cannot be saved without: the asterisk is drawn in CSS with empty alternative text, so it never
 * becomes part of the field's name.
 */
export function FieldLabel({ icon: Icon, required, className, children }: {
  icon: FieldLabelIcon;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn('org-field-label', required && 'org-field-label-required', className)}>
    <Icon size={15} aria-hidden="true" />
    {children}
  </span>;
}
