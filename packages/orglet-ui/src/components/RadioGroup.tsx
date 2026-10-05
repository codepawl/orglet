import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';
import './RadioGroup.css';

export type RadioOption = {
  value: string;
  label: ReactNode;
  /** A second line under the label. */
  description?: ReactNode;
  disabled?: boolean;
};

/**
 * One choice out of a few labelled options, each with an optional `description`. Every option is a real, visually
 * hidden `<input type="radio">` with a drawn mark beside it, so forms, the arrow keys and screen readers work as the
 * browser has them; the `<fieldset>` is named by its `<legend>`, which is `label`. `required` draws the red asterisk
 * in CSS so it stays out of the accessible name, and marks the group `aria-required` without the browser's own
 * validation bubble.
 *
 * It is controlled: `value` is the picked option's value (or an empty string for none) and `onChange` gets the value
 * of the one chosen. Two or three options that read as a row of buttons belong to a `ToolbarToggleGroup` instead.
 */
export function RadioGroup({ label, options, value, onChange, name, required, disabled, className, ...props }: Omit<ComponentProps<'fieldset'>, 'onChange' | 'value' | 'children' | 'role' | 'name'> & {
  label: ReactNode;
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
  /** The form field name; one is made up when there is none. */
  name?: string;
  required?: boolean;
}) {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  return <fieldset {...props} role="radiogroup" aria-required={required || undefined} disabled={disabled} className={cn('org-radio-group', className)}>
    <legend className={cn('org-radio-group-label', required && 'org-radio-group-required')}>{label}</legend>
    {options.map(option => <label key={option.value} className={cn('org-radio', (disabled || option.disabled) && 'org-radio-disabled')}>
      <input type="radio" name={groupName} value={option.value} checked={option.value === value}
        disabled={option.disabled} className="org-radio-input" onChange={() => onChange(option.value)} />
      <span className="org-radio-mark" aria-hidden="true" />
      <span className="org-radio-text">
        {option.label}
        {option.description && <span className="org-radio-description">{option.description}</span>}
      </span>
    </label>)}
  </fieldset>;
}
