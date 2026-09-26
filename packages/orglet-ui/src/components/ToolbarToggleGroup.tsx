import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { cn } from '../cn';
import './ToolbarToggleGroup.css';

export type ToolbarToggleItem = {
  value: string;
  /** What a screen reader hears and the tooltip shows. */
  label: string;
  icon: ReactNode;
  /** The key that picks it, such as `P`, shown in the tooltip and announced as `aria-keyshortcuts`. */
  shortcut?: string;
};

/**
 * One choice out of a few, as a row of small icon buttons: the tool of a drawing bar, a colour, a stroke width. It is a
 * radio group, so it is one Tab stop; the arrow keys, Home and End move the choice and the focus together. The picked
 * button sits on a pale tint; the others answer hover with their icon's colour only. Keyboard shortcuts that pick an
 * item from elsewhere belong to the caller, which passes them in `shortcut` so they are shown and announced.
 */
export function ToolbarToggleGroup({ label, items, value, onValueChange, className }: {
  label: string;
  items: readonly ToolbarToggleItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const pickedIndex = items.findIndex(item => item.value === value);
  const focusableIndex = pickedIndex >= 0 ? pickedIndex : 0;
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === undefined) return;
    event.preventDefault();
    onValueChange(items[next].value);
    group.current?.querySelectorAll<HTMLButtonElement>('.org-toolbar-toggle')[next]?.focus();
  }
  return <div ref={group} role="radiogroup" aria-label={label} className={cn('org-toolbar-group', className)}>
    {items.map((item, index) => {
      const picked = item.value === value;
      const tooltip = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
      return <button key={item.value} type="button" role="radio" aria-checked={picked} aria-label={item.label} title={tooltip}
        aria-keyshortcuts={item.shortcut} tabIndex={index === focusableIndex ? 0 : -1}
        className="org-toolbar-toggle" onClick={() => onValueChange(item.value)} onKeyDown={event => move(event, index)}>
        {item.icon}
      </button>;
    })}
  </div>;
}
