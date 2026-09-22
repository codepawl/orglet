import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { t } from '../i18n';

/** `labelStyle` draws the label in what it names — a font family shown in that font, say — in the menu and in the trigger. */
export type SelectOption = { value: string; label: string; detail?: string; icon?: ReactNode; disabled?: boolean; dimmed?: boolean; group?: string; badge?: ReactNode; labelStyle?: CSSProperties };

type Placement = { style: CSSProperties; above: boolean };
const GAP = 6, EDGE = 10, MAX_HEIGHT = 360, MIN_HEIGHT = 140;

/**
 * App-wide single-choice dropdown (select-only combobox pattern).
 * The list is portaled next to the open dialog (or the body) so scroll containers never clip it, opens upward when
 * there is more room above, fits its height to the space left in the window, and follows the trigger on resize/scroll.
 * Keyboard: arrows, Home/End, typing to jump, Enter/Space to choose, Escape to close.
 */
export function Select({ value, options, onChange, label, ariaLabel, disabled, size = 'md', className = '', menuMinWidth = 0, showDetail = true, showIcon = true, inlineDetail = false, describedBy, invalid, flash }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
  /** Visible label above the trigger; otherwise pass ariaLabel. */
  label?: ReactNode; ariaLabel?: string; disabled?: boolean; size?: 'md' | 'sm'; className?: string; menuMinWidth?: number;
  /** Show the option's detail next to its label inside the trigger. */
  showDetail?: boolean; describedBy?: string;
  /** Show the chosen option's icon inside the trigger. The menu keeps its icons either way. */
  showIcon?: boolean;
  /** Put each option's detail on the same line as its label instead of below it. */
  inlineDetail?: boolean;
  /** Validation: red border + brief flash when `flash` changes. */
  invalid?: boolean; flash?: number;
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

  const close = () => { setOpen(false); setPlacement(undefined); };
  const openList = () => { if (disabled) return; setActive(Math.max(0, selectedIndex)); setOpen(true); };
  const move = (from: number, step: number) => {
    for (let index = from + step; index >= 0 && index < options.length; index += step) if (!options[index].disabled) return index;
    return from;
  };
  const choose = (index: number) => {
    const option = options[index]; if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(); trigger.current?.focus();
  };
  const container = () => (trigger.current?.closest('[role=dialog]') as HTMLElement | null) ?? document.body;

  useLayoutEffect(() => {
    if (!open) return;
    const update = (event?: Event) => {
      const button = trigger.current, menu = list.current; if (!button || !menu) return;
      if (event?.target instanceof Node && menu.contains(event.target)) return;
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { close(); return; }
      // Full height of every option plus the menu's own padding and border; the menu only scrolls when it must.
      const full = Math.ceil(menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
      const natural = Math.min(full, MAX_HEIGHT);
      const below = innerHeight - rect.bottom - GAP - EDGE, above = rect.top - GAP - EDGE;
      const placeAbove = below < natural && above > below;
      const maxHeight = Math.floor(Math.max(Math.min(natural, placeAbove ? above : below), Math.min(natural, MIN_HEIGHT)));
      const scrolls = maxHeight < full;
      const width = Math.min(Math.max(rect.width, menuMinWidth), innerWidth - EDGE * 2);
      // A menu wider than its trigger grows toward the middle of the window, so right-hand controls keep it inside their dialog.
      const preferred = rect.left + rect.width / 2 > innerWidth / 2 ? rect.right - width : rect.left;
      const left = Math.min(Math.max(preferred, EDGE), innerWidth - width - EDGE);
      const top = placeAbove ? rect.top - GAP - maxHeight : rect.bottom + GAP;
      const host = container();
      // A fixed-position dialog is the containing block for the menu, so position relative to it instead of the window.
      const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
      setPlacement({ above: placeAbove, style: { position: host === document.body ? 'fixed' : 'absolute', left: left - origin.left, top: top - origin.top, width, ...(scrolls ? { maxHeight, overflowY: 'auto' } : { overflowY: 'hidden' }) } });
    };
    update();
    const observer = new ResizeObserver(() => update()); if (trigger.current) observer.observe(trigger.current);
    addEventListener('resize', update); document.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [open, options.length, menuMinWidth]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !list.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  useEffect(() => {
    const menu = list.current, item = menu?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !menu || !item) return;
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop - 6;
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight + 6;
  }, [open, active, placement]);

  const typeahead = (key: string) => {
    window.clearTimeout(typed.current.timer);
    typed.current.text += key.toLocaleLowerCase('vi');
    typed.current.timer = window.setTimeout(() => { typed.current.text = ''; }, 600);
    const start = open ? active : Math.max(0, selectedIndex);
    const order = [...options.keys()].map(offset => (start + (typed.current.text.length === 1 ? 1 : 0) + offset) % options.length);
    const match = order.find(index => !options[index].disabled && options[index].label.toLocaleLowerCase('vi').startsWith(typed.current.text));
    if (match === undefined) return;
    if (open) setActive(match); else if (options[match].value !== value) onChange(options[match].value);
  };

  const labelId = `${id}-label`;
  const button = <button ref={trigger} type="button" role="combobox" className={`select-trigger ${size} ${className}`} disabled={disabled} data-value={value}
    aria-label={label ? undefined : ariaLabel} aria-labelledby={label ? labelId : undefined} aria-describedby={describedBy}
    aria-invalid={invalid || undefined} data-flash={invalid ? flash : undefined}
    aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
    onClick={() => open ? close() : openList()}
    onBlur={event => { if (!list.current?.contains(event.relatedTarget as Node | null)) close(); }}
    onKeyDown={event => {
      if (event.key === 'Tab') { close(); return; }
      if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openList(); return; }
      if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); typeahead(event.key); return; }
      if (!open) return;
      const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 300) / 40));
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => move(index, 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => move(index, -1)); }
      else if (event.key === 'PageDown') { event.preventDefault(); setActive(index => move(Math.min(options.length - 1, index + page) - 1, 1)); }
      else if (event.key === 'PageUp') { event.preventDefault(); setActive(index => move(Math.max(0, index - page) + 1, -1)); }
      else if (event.key === 'Home') { event.preventDefault(); setActive(move(-1, 1)); }
      else if (event.key === 'End') { event.preventDefault(); setActive(move(options.length, -1)); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
    }}>
    {showIcon && current?.icon && <span className="select-icon">{current.icon}</span>}
    <span className="select-value">{current ? <><span style={current.labelStyle}>{current.label}</span>{showDetail && current.detail && <span className="select-detail"> · {current.detail}</span>}</> : <span className="select-placeholder">{t('Chọn')}</span>}</span>
    <ChevronDown size={16} className="select-chevron" aria-hidden="true" />
  </button>;

  let lastGroup: string | undefined;
  const menu = open && createPortal(<ul ref={list} id={`${id}-list`} role="listbox" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel}
    className={`select-menu ${placement?.above ? 'above' : ''} ${inlineDetail ? 'inline-detail' : ''}`} style={placement?.style ?? { position: 'fixed', visibility: 'hidden', left: 0, top: 0 }}>
    {options.map((option, index) => {
      const header = option.group && option.group !== lastGroup ? <li key={`group-${option.group}`} role="presentation" className="select-group">{option.group}</li> : null;
      lastGroup = option.group;
      return [header, <li key={option.value} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        className={`select-option${index === active ? ' active' : ''}${option.dimmed ? ' dimmed' : ''}`}
        onPointerMove={() => { if (!option.disabled && index !== active) setActive(index); }} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {option.icon && <span className="select-icon">{option.icon}</span>}
        <span className="select-option-text"><span style={option.labelStyle}>{option.label}</span>{option.detail && <span className="select-detail">{option.detail}</span>}</span>
        {option.badge && <span className="select-option-badge">{option.badge}</span>}
        <Check size={16} className="select-check" aria-hidden="true" />
      </li>];
    })}
  </ul>, container());

  if (!label) return <>{button}{menu}</>;
  return <div className="field">
    <span className="field-title" id={labelId} onClick={() => trigger.current?.focus()}>{label}</span>
    {button}{menu}
  </div>;
}
