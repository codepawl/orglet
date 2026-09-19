import { useId, type ReactNode } from 'react';

/**
 * Orglet on/off switch for a setting that applies immediately. Name it with `labelledBy` (the setting's title) or
 * `label`; the row's description explains what changes.
 */
export function Switch({ checked, onChange, disabled, label, labelledBy, describedBy }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label?: string; labelledBy?: string; describedBy?: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}

/**
 * One on/off setting inside a form: its title on the left, the switch on the right. Anything with exactly two
 * states, on and off, wears a switch rather than a tick (user, 2026-09-19), so the shape alone says what the
 * control does. A tick is for choosing items out of a list, or for confirming something once.
 */
export function SwitchField({ checked, onChange, disabled, description, children }: {
  checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; description?: ReactNode; children: ReactNode;
}) {
  const titleId = useId();
  return <div className={`switch-field${disabled ? ' disabled' : ''}`}>
    <span className="switch-field-text">
      <span id={titleId} className="switch-field-title">{children}</span>
      {description && <span className="switch-field-description">{description}</span>}
    </span>
    <Switch checked={checked} onChange={onChange} disabled={disabled} labelledBy={titleId} />
  </div>;
}
