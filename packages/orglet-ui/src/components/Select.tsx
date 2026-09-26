import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import './Select.css';

/**
 * One choice. `detail` is a second, muted line (or the same line with `inlineDetail`); `note` is a small muted word
 * after the label, such as "default", shown in the menu only; `labelStyle` draws the label in what it names, a font
 * family in that font, say. `group` starts a titled group where it changes; `dimmed` greys a choice that still works;
 * `badge` is a small chip at the end of the row.
 */
export type SelectOption = {
  value: string;
  label: string;
  note?: string;
  detail?: string;
  icon?: ReactNode;
  disabled?: boolean;
  dimmed?: boolean;
  group?: string;
  badge?: ReactNode;
  labelStyle?: CSSProperties;
};

type Placement = { style: CSSProperties; above: boolean };

const GAP = 6;
const EDGE = 10;
const MAX_HEIGHT = 360;
const MIN_HEIGHT = 140;
const TYPEAHEAD_RESET_MS = 600;
const hiddenForMeasuring: CSSProperties = { position: 'fixed', visibility: 'hidden', left: 0, top: 0 };

/**
 * A single-choice dropdown (the select-only combobox pattern). The list is portaled next to the open dialog, or the
 * page, so a scrolling container never clips it; it opens upward when there is more room above, fits its height to the
 * space left in the window, only scrolls when it must, and follows the trigger on resize and scroll.
 *
 * Keyboard: the arrows, Page Up and Down, Home and End, typing to jump, Enter or Space to choose, Escape to close.
 * Name it with `labelledBy` (a visible title's id) or `ariaLabel`; `placeholder` shows while nothing is chosen.
 */
export function Select({
  value, options, onChange, ariaLabel, labelledBy, describedBy, placeholder, disabled, size = 'md', className, menuMinWidth = 0,
  showDetail = true, showIcon = true, inlineDetail = false, invalid, flash, field, ref,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'md' | 'sm';
  /** Classes for the trigger button. */
  className?: string;
  /** The menu is at least this wide, and grows toward the middle of the window when wider than its trigger. */
  menuMinWidth?: number;
  /** Show the chosen option's detail next to its label inside the trigger. */
  showDetail?: boolean;
  /** Show the chosen option's icon inside the trigger. The menu keeps its icons either way. */
  showIcon?: boolean;
  /** Put each option's detail on the same line as its label instead of below it. */
  inlineDetail?: boolean;
  /** A red border, and a short flash each time `flash` changes. */
  invalid?: boolean;
  flash?: number;
  /** Set as the trigger's `data-field`, the name a form uses to find and focus a field. */
  field?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex(option => option.value === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const [placement, setPlacement] = useState<Placement>();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', timer: 0 });
  const current = options[selectedIndex];

  const setTrigger = (button: HTMLButtonElement | null) => {
    trigger.current = button;
    if (typeof ref === 'function') ref(button);
    else if (ref) ref.current = button;
  };
  const close = () => {
    setOpen(false);
    setPlacement(undefined);
  };
  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };
  /** The next choice that is not disabled, from `from` in the direction of `step`, or `from` when there is none. */
  const move = (from: number, step: number) => {
    for (let index = from + step; index >= 0 && index < options.length; index += step) {
      if (!options[index].disabled) return index;
    }
    return from;
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
    trigger.current?.focus();
  };
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;

  useLayoutEffect(() => {
    if (!open) return;
    const update = (event?: Event) => {
      const button = trigger.current;
      const menu = list.current;
      if (!button || !menu) return;
      if (event?.target instanceof Node && menu.contains(event.target)) return;
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) {
        close();
        return;
      }
      // The full height of every option plus the menu's own padding and border; the menu only scrolls when it must.
      const full = Math.ceil(menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
      const natural = Math.min(full, MAX_HEIGHT);
      const below = innerHeight - rect.bottom - GAP - EDGE;
      const above = rect.top - GAP - EDGE;
      const placeAbove = below < natural && above > below;
      const maxHeight = Math.floor(Math.max(Math.min(natural, placeAbove ? above : below), Math.min(natural, MIN_HEIGHT)));
      const scrolls = maxHeight < full;
      const width = Math.min(Math.max(rect.width, menuMinWidth), innerWidth - EDGE * 2);
      // A menu wider than its trigger grows toward the middle of the window, so right-hand controls keep it inside their dialog.
      const preferred = rect.left + rect.width / 2 > innerWidth / 2 ? rect.right - width : rect.left;
      const left = Math.min(Math.max(preferred, EDGE), innerWidth - width - EDGE);
      const top = placeAbove ? rect.top - GAP - maxHeight : rect.bottom + GAP;
      const host = container();
      // A fixed-position dialog is the containing block for the menu, so the menu is placed relative to it.
      const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
      const overflow: CSSProperties = scrolls ? { maxHeight, overflowY: 'auto' } : { overflowY: 'hidden' };
      setPlacement({
        above: placeAbove,
        style: { position: host === document.body ? 'fixed' : 'absolute', left: left - origin.left, top: top - origin.top, width, ...overflow },
      });
    };
    update();
    // Some environments (a test DOM, an old embedded browser) have no ResizeObserver; the window events still apply.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => update());
    if (trigger.current) observer?.observe(trigger.current);
    addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [open, options.length, menuMinWidth]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [open]);

  // The active choice stays in view as the keys move it.
  useEffect(() => {
    const menu = list.current;
    const item = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !menu || !item) return;
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop - 6;
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight + 6;
  }, [open, active, placement]);

  /** Jumps to the next choice starting with what was typed in the last moment; closed, it chooses it at once. */
  const typeahead = (key: string) => {
    window.clearTimeout(typed.current.timer);
    typed.current.text += key.toLocaleLowerCase();
    typed.current.timer = window.setTimeout(() => { typed.current.text = ''; }, TYPEAHEAD_RESET_MS);
    const start = open ? active : Math.max(0, selectedIndex);
    const firstLetter = typed.current.text.length === 1 ? 1 : 0;
    const order = [...options.keys()].map(offset => (start + firstLetter + offset) % options.length);
    const match = order.find(index => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(typed.current.text));
    if (match === undefined) return;
    if (open) setActive(match);
    else if (options[match].value !== value) onChange(options[match].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(event.key);
      return;
    }
    if (!open) return;
    const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 300) / 40));
    const handled = ['Escape', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Enter', ' '];
    if (!handled.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      // Escape closes the list, not the dialog around it.
      event.stopPropagation();
      close();
    }
    else if (event.key === 'ArrowDown') setActive(index => move(index, 1));
    else if (event.key === 'ArrowUp') setActive(index => move(index, -1));
    else if (event.key === 'PageDown') setActive(index => move(Math.min(options.length - 1, index + page) - 1, 1));
    else if (event.key === 'PageUp') setActive(index => move(Math.max(0, index - page) + 1, -1));
    else if (event.key === 'Home') setActive(move(-1, 1));
    else if (event.key === 'End') setActive(move(options.length, -1));
    else choose(active);
  };

  const button = <button ref={setTrigger} type="button" role="combobox"
    className={cn('org-select-trigger', size === 'sm' && 'org-select-sm', className)} disabled={disabled} data-value={value} data-field={field}
    aria-label={labelledBy ? undefined : ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
    aria-invalid={invalid || undefined} data-flash={invalid ? flash : undefined}
    aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
    onClick={() => open ? close() : openList()}
    onBlur={event => { if (!list.current?.contains(event.relatedTarget as Node | null)) close(); }}
    onKeyDown={onKeyDown}>
    {showIcon && current?.icon && <span className="org-select-icon">{current.icon}</span>}
    <span className="org-select-value">
      {current
        ? <><span style={current.labelStyle}>{current.label}</span>{showDetail && current.detail && <span className="org-select-detail"> · {current.detail}</span>}</>
        : <span className="org-select-placeholder">{placeholder}</span>}
    </span>
    <ChevronGlyph />
  </button>;

  let lastGroup: string | undefined;
  const menu = open && createPortal(<ul ref={list} id={`${id}-list`} role="listbox" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : ariaLabel}
    className={cn('org-select-menu', placement?.above && 'org-select-menu-above', inlineDetail && 'org-select-inline-detail')}
    style={placement?.style ?? hiddenForMeasuring}>
    {options.map((option, index) => {
      const header = option.group && option.group !== lastGroup
        ? <li key={`group-${option.group}`} role="presentation" className="org-select-group">{option.group}</li>
        : null;
      lastGroup = option.group;
      return [header, <li key={option.value} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        className={cn('org-select-option', index === active && 'org-select-option-active', option.dimmed && 'org-select-option-dimmed')}
        onPointerMove={() => { if (!option.disabled && index !== active) setActive(index); }}
        onPointerDown={event => event.preventDefault()}
        onClick={() => choose(index)}>
        {option.icon && <span className="org-select-icon">{option.icon}</span>}
        <span className="org-select-option-text">
          <span><span style={option.labelStyle}>{option.label}</span>{option.note && <span className="org-select-note"> ({option.note})</span>}</span>
          {option.detail && <span className="org-select-detail" title={option.detail}>{option.detail}</span>}
        </span>
        {option.badge && <span className="org-select-option-badge">{option.badge}</span>}
        <CheckGlyph />
      </li>];
    })}
  </ul>, container());

  return <>{button}{menu}</>;
}

/** The trigger's chevron and the chosen option's tick, drawn here so the kit needs no icon library. */
function ChevronGlyph() {
  return <svg className="org-select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>;
}

function CheckGlyph() {
  return <svg className="org-select-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>;
}
