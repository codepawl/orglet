/**
 * Orglet on/off switch for a setting that applies immediately. Name it with `labelledBy` (the setting's title) or
 * `label`; the row's description explains what changes.
 */
export function Switch({ checked, onChange, disabled, label, labelledBy, describedBy }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label?: string; labelledBy?: string; describedBy?: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>;
}
