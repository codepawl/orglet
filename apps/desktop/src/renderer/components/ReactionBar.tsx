import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from './ui';
import { t } from '../i18n';

/**
 * A row of reactions thrown at one message, the way one would be thrown at a colleague's.
 *
 * The row opens on demand and floats above the trigger rather than sitting in the flow: opened inline it pushed
 * the rest of the actions sideways, which moved the thing the pointer was aiming at (user, 2026-09-20). Once one
 * is picked it stays on the message as the face itself, which is what anyone reading the thread looks for.
 *
 * Knows nothing about where reactions are stored or what they mean to a worker; it takes the set to offer, what
 * is picked, and a callback.
 */
export function ReactionBar<Name extends string>({ options, picked, onPick, label }: {
  /** What can be thrown, in the order shown. `name` is what is stored; `emoji` is what is drawn. */
  options: readonly { name: Name; emoji: string; meaning: string }[];
  picked?: Name;
  /** Called with the picked name, or with the same name again to take it off. */
  onPick: (name: Name) => void;
  /** Names the trigger and the row for assistive technology. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const name = label ?? t('Thả react');
  const current = picked ? options.find(option => option.name === picked) : undefined;
  return <div className="reaction-bar" ref={root} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    {current
      ? <button type="button" className="reaction-picked" aria-label={t('Bỏ {0}', [current.meaning])} title={current.meaning} onClick={() => onPick(current.name)}>{current.emoji}</button>
      : <Button size="icon" aria-label={name} title={name} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(value => !value)}><SmilePlus size={15} /></Button>}
    {open && <div className="reaction-row" role="group" aria-label={name}>
      {options.map(option => <button key={option.name} type="button" aria-label={option.meaning} title={option.meaning}
        onClick={() => { onPick(option.name); setOpen(false); }}>{option.emoji}</button>)}
    </div>}
  </div>;
}
