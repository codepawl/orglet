import type { ComponentProps } from 'react';
import { cn } from '../cn';
import './Button.css';

export type ButtonVariant = 'primary' | 'ghost' | 'outline';
export type ButtonSize = 'default' | 'icon';

/**
 * A button. `ghost` (the default) is quiet text that takes a soft background on hover, `outline` is a soft filled
 * pill for a secondary action, and `primary` is the one filled action of a place. `size="icon"` is a square for a
 * single icon; give it an `aria-label`. An icon-only button answers the pointer with its icon's colour, not a tile.
 *
 * Every button prop passes through, `ref` included. `type` is not set for you: inside a form a button submits, as
 * HTML has it, so a button that only acts says `type="button"`.
 */
export function Button({ className, variant = 'ghost', size = 'default', ...props }: ComponentProps<'button'> & {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
}) {
  const classes = cn('org-button', `org-button-${variant ?? 'ghost'}`, size === 'icon' && 'org-button-icon', className);
  return <button className={classes} {...props} />;
}
