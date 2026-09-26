import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from '../cn';
import './ReactionBar.css';

/** What can be thrown: `name` is what is stored, `emoji` is what is drawn, `meaning` names it for assistive technology. */
export type ReactionOption<Name extends string> = { name: Name; emoji: string; meaning: string };

/**
 * A row of reactions thrown at one message, the way one is thrown at a colleague's.
 *
 * The row opens on demand and floats above the trigger rather than sitting in the flow: opened inline, it pushes the
 * other actions sideways and moves the thing the pointer was aiming at. The trigger always opens the row; the reaction
 * already left shows as picked, and picking it again is what takes it off.
 *
 * It knows nothing about where reactions are stored or what they mean: it takes the set to offer, what is picked, and
 * a callback. `label` names the trigger and the row; `icon` is what the trigger shows.
 */
export function ReactionBar<Name extends string>({ options, picked, onPick, label, icon }: {
  options: readonly ReactionOption<Name>[];
  /** The reaction this person already left on the message, shown as picked in the row. */
  picked?: Name;
  /** Called with the picked name, or with the picked one again to take it off. */
  onPick: (name: Name) => void;
  label: string;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);
  const close = () => {
    setOpen(false);
    // The row unmounts under the keyboard user's focus; the trigger is where they came from.
    trigger.current?.focus();
  };
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    close();
  };
  return <div className="org-reaction-bar" ref={root} onKeyDown={closeOnEscape}>
    <Button ref={trigger} size="icon" aria-label={label} title={label} aria-haspopup="true" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>{icon}</Button>
    {open && <ReactionPicker options={options} picked={picked} label={label} onPick={option => { onPick(option); close(); }} />}
  </div>;
}

/** The floating row itself: one button per option, the one already left shown pressed. */
export function ReactionPicker<Name extends string>({ options, picked, label, onPick }: {
  options: readonly ReactionOption<Name>[];
  picked?: Name;
  label: string;
  onPick: (name: Name) => void;
}) {
  return <div className="org-reaction-row" role="group" aria-label={label}>
    {options.map(option => <button key={option.name} type="button" className={option.name === picked ? 'org-reaction-picked' : undefined}
      aria-pressed={option.name === picked} aria-label={option.meaning} title={option.meaning}
      onClick={() => onPick(option.name)}>{option.emoji}</button>)}
  </div>;
}

/** One emoji on a message: how many left it, whether this person is among them, and a label naming everyone. */
export type ReactionBadge<Name extends string> = { name: Name; emoji: string; count: number; mine: boolean; label: string };

/**
 * The reactions a message wears, on its own corner the way messengers draw them: the pill overlaps the bubble's lower
 * edge by half its height, so it belongs to that message and no other. The parent needs `position: relative`, and
 * `align` picks the corner: `start` (left) for the person's own right-aligned bubble, `end` for an answer, `inline`
 * in the flow for a list with no bubble.
 *
 * Each badge is a button: one this person left takes it off, any other adds or switches to it, the same rule as the
 * picker. A badge that just appeared pops in.
 */
export function ReactionBadges<Name extends string>({ badges, align, onPick }: {
  badges: readonly ReactionBadge<Name>[];
  align: 'start' | 'end' | 'inline';
  onPick: (name: Name) => void;
}) {
  if (badges.length === 0) return null;
  return <div className={cn('org-reaction-badges', `org-reaction-badges-${align}`)}>
    {badges.map(badge => <button key={badge.name} type="button" className="org-reaction-badge" aria-pressed={badge.mine}
      aria-label={badge.label} title={badge.label} onClick={() => onPick(badge.name)}>
      <span className="org-reaction-badge-emoji" aria-hidden="true">{badge.emoji}</span>
      {badge.count > 1 && <span className="org-reaction-badge-count" aria-hidden="true">{badge.count}</span>}
    </button>)}
  </div>;
}
