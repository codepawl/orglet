import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import './Switch.css';

/**
 * An on/off switch for a setting that applies the moment it changes. Name it with `labelledBy` (the setting's own
 * title) or `label`; a description belongs on the row, not on the control.
 *
 * Anything with exactly two states wears a switch rather than a tick, so the shape alone says what the control
 * does. A tick is for choosing items out of a list, or for confirming something once.
 */
export function Switch({ checked, onChange, disabled, label, labelledBy, describedBy, className }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
}) {
  return <button
    type="button"
    role="switch"
    className={cn('org-switch', className)}
    aria-checked={checked}
    aria-label={label}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  ><span aria-hidden="true" /></button>;
}

/** One on/off setting inside a form: its title on the left, the switch on the right. */
export function SwitchField({ checked, onChange, disabled, description, className, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return <div className={cn('org-switch-field', disabled && 'org-switch-field-disabled', className)}>
    <span className="org-switch-field-text">
      <span id={titleId} className="org-switch-field-title">{children}</span>
      {description && <span className="org-switch-field-description">{description}</span>}
    </span>
    <Switch checked={checked} onChange={onChange} disabled={disabled} labelledBy={titleId} />
  </div>;
}
