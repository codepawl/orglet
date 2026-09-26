import type { ComponentProps } from 'react';
import { cn } from '../cn';
import './MoneyInput.css';

/**
 * An amount of money: the currency's symbol before the number and its code after it, both drawn quietly and hidden
 * from assistive technology (name the field with a label). It keeps the text as typed; converting it is the caller's.
 * `invalid` marks it as failing validation, and `flash` replays the form's shake (a counter the form increments).
 */
export function MoneyInput({ value, onChange, invalid, flash, symbol, code, className, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  flash?: number;
  /** Shown before the number, such as "$" or "₫". */
  symbol: string;
  /** Shown after the number, such as "USD". */
  code: string;
}) {
  return <span className={cn('org-money-input', invalid && 'org-money-input-invalid', className)} data-flash={invalid ? flash : undefined}>
    <span aria-hidden="true">{symbol}</span>
    <input {...props} inputMode="decimal" value={value} aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} />
    <span className="org-money-input-currency" aria-hidden="true">{code}</span>
  </span>;
}
