import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { mascotIds } from './mascots';
import { Orglet3D } from './Orglet3D';
import type { Moment } from './orgletStage';
import { Button } from './ui';

/*
 * What a main panel shows when it has nothing to list (owner, 2026-10-11: the no-orglet page, everywhere a panel is
 * empty). A monochrome orglet stands in the middle, a different one each time the panel appears (owner, 2026-10-12:
 * its shape and its manner are drawn at random), with one line saying what is missing, an
 * optional line saying how it fills, and an optional button. It hops in, turns after the pointer, smiles when the
 * panel is tapped, stretches while the pointer rests on the button, and dozes when left alone. The motion is the
 * orglet's own; the panel never fades or slides.
 */

// The startup face's size, so it reads as one of the same family.
const FACE_SIZE = 80;

/** Which orglet stands in the panel: any shape, with a seed for how it moves. Drawn once for each time the panel appears. */
function randomFace() {
  return { id: mascotIds[Math.floor(Math.random() * mascotIds.length)], seed: Math.floor(Math.random() * 1000) };
}
// Left alone this long, the orglet dozes.
const DOZE_AFTER_SECONDS = 25;

type Cue = { kind: Moment; count: number };

const nextCue = (kind: Moment) => (previous: Cue | undefined): Cue => ({ kind, count: (previous?.count ?? 0) + 1 });

export type EmptyPanelAction = { label: string; icon?: ReactNode; onSelect: () => void };

export function EmptyPanel({ title, hint, action, fill = true, className }: {
  /** What is missing, as one short sentence. */
  title: string;
  /** How it fills, when that is not obvious. */
  hint?: string;
  action?: EmptyPanelAction;
  /** Takes the panel's free height and sits in its middle. Off for an empty list that has more of the page under it. */
  fill?: boolean;
  className?: string;
}) {
  const [face] = useState(randomFace);
  const [cheer, setCheer] = useState(0);
  const [cue, setCue] = useState<Cue>();
  const [lastTouch, setLastTouch] = useState(0);

  useEffect(() => {
    const doze = setTimeout(() => setCue(nextCue('doze')), DOZE_AFTER_SECONDS * 1000);
    return () => clearTimeout(doze);
  }, [lastTouch]);

  const touch = () => setLastTouch(count => count + 1);
  // A tap anywhere on the panel makes the orglet smile; the button keeps its own click.
  const tap = (event: PointerEvent<HTMLDivElement>) => {
    touch();
    if ((event.target as Element).closest('button')) return;
    setCheer(count => count + 1);
  };
  const eager = () => {
    touch();
    setCue(nextCue('stretch'));
  };

  return <div className={`empty-panel${fill ? ' empty-panel-fill' : ''}${className ? ` ${className}` : ''}`} role="status" onPointerDown={tap}>
    <div className="startup-face">
      <Orglet3D id={face.id} seed={face.seed} size={FACE_SIZE} color="mono" motion={{ lead: true, greet: true, cheer, moment: cue }} />
    </div>
    <p className="empty-panel-title">{title}</p>
    {hint && <p className="empty-panel-hint">{hint}</p>}
    {action && <Button className="empty-panel-action" variant="primary" onPointerEnter={eager} onFocus={eager} onClick={action.onSelect}>{action.icon}{action.label}</Button>}
  </div>;
}
