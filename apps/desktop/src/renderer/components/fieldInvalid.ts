/** Attrs that turn a field red and briefly flash when validation fails. Change `flash` to replay the animation. */
export function fieldInvalid(active: boolean, flash: number): { 'aria-invalid'?: true; 'data-flash'?: number } {
  return active ? { 'aria-invalid': true, 'data-flash': flash } : {};
}
