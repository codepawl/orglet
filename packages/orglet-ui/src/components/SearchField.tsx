import type { ComponentProps } from 'react';
import { cn } from '../cn';
import { SearchIcon } from '../icons';
import './SearchField.css';

/**
 * A search box: a magnifier, then the field, inside one box that looks like `Input`. The box carries the border and
 * the focus state, so the magnifier is inside the ring instead of beside it. Name it with `aria-label` or a `<label>`
 * around it. Every other prop reaches the `<input>`; `className` goes on the box.
 */
export function SearchField({ className, type = 'search', ...props }: ComponentProps<'input'>) {
  return <span className={cn('org-search-field', className)}>
    <SearchIcon size={16} />
    <input {...props} type={type} className="org-search-field-input" />
  </span>;
}
