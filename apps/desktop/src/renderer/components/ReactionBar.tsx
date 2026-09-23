import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from './ui';
import { t } from '../i18n';

/** What can be thrown: `name` is what is stored, `emoji` is what is drawn, `meaning` names it for assistive technology. */
export type ReactionOption<Name extends string> = { name: Name; emoji: string; meaning: string };

/**
 * A row of reactions thrown at one message, the way one would be thrown at a colleague's.
 *
 * The row opens on demand and floats above the trigger rather than sitting in the flow: opened inline it pushed
 * the rest of the actions sideways, which moved the thing the pointer was aiming at (user, 2026-09-20). The
 * trigger always opens the row (COD-219): with a reaction already on the message it used to take that reaction
 * off, which the owner read as the emoji being cancelled. The one that is on shows as picked, and picking it
 * again is what takes it off.
 *
 * Knows nothing about where reactions are stored or what they mean to a worker; it takes the set to offer, what
 * is picked, and a callback.
 */
export function ReactionBar<Name extends string>({ options, picked, onPick, label }: {
  options: readonly ReactionOption<Name>[];
  /** The reaction this person already left on the message, shown as picked in the row. */
  picked?: Name;
  /** Called with the picked name, or with the picked one again to take it off. */
  onPick: (name: Name) => void;
  /** Names the trigger and the row for assistive technology. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const name = label ?? t('Thả react');
  const close = () => {
    setOpen(false);
    // The row unmounts under the keyboard user's focus; the trigger is where they came from.
    trigger.current?.focus();
  };
  return <div className="reaction-bar" ref={root} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
    <Button ref={trigger} size="icon" aria-label={name} title={name} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(value => !value)}><SmilePlus size={15} /></Button>
    {open && <ReactionPicker options={options} picked={picked} label={name} onPick={option => { onPick(option); close(); }} />}
  </div>;
}

/** The floating row itself: one button per option, the one already left shown pressed. */
export function ReactionPicker<Name extends string>({ options, picked, label, onPick }: {
  options: readonly ReactionOption<Name>[];
  picked?: Name;
  label: string;
  onPick: (name: Name) => void;
}) {
  return <div className="reaction-row" role="group" aria-label={label}>
    {options.map(option => <button key={option.name} type="button" className={option.name === picked ? 'picked' : undefined}
      aria-pressed={option.name === picked} aria-label={option.meaning} title={option.meaning}
      onClick={() => onPick(option.name)}>{option.emoji}</button>)}
  </div>;
}

/** One emoji on a message: how many left it, whether this person is among them, and a label naming everyone. */
export type ReactionBadge<Name extends string> = { name: Name; emoji: string; count: number; mine: boolean; label: string };

/**
 * The reactions a message wears, on its own corner the way Messenger and iMessage draw them (COD-219, the owner
 * circled the corner: "why doesn't the emote show on the chat bubble?"). The pill overlaps the bubble's lower edge by half its height,
 * so it belongs to that message and to no other; the parent bubble needs `position:relative`, and `align`
 * picks the corner: the start (left) corner for the person's own right-aligned bubble, the end (right) corner
 * for an answer. `inline` sits in the flow, for a list that has no bubble.
 *
 * Each badge is a button: one this person left takes it off, any other adds or switches to it, the same rule
 * as the picker. A badge that just appeared pops in.
 */
export function ReactionBadges<Name extends string>({ badges, align, onPick }: {
  badges: readonly ReactionBadge<Name>[];
  align: 'start' | 'end' | 'inline';
  onPick: (name: Name) => void;
}) {
  if (badges.length === 0) return null;
  return <div className={`reaction-badges reaction-badges-${align}`}>
    {badges.map(badge => <button key={badge.name} type="button" className="reaction-badge" aria-pressed={badge.mine}
      aria-label={badge.label} title={badge.label} onClick={() => onPick(badge.name)}>
      <span className="reaction-badge-emoji" aria-hidden="true">{badge.emoji}</span>
      {badge.count > 1 && <span className="reaction-badge-count" aria-hidden="true">{badge.count}</span>}
    </button>)}
  </div>;
}
