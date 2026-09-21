import { useEffect, useState, type PointerEvent } from 'react';
import { t } from '../i18n';
import { Orglet3D } from './Orglet3D';
import type { Moment } from './orgletStage';
import { Button } from './ui';

/*
 * The startup screen: what the window shows while SQLite opens, usually under a second and a few seconds on a
 * cold start. The owner found the old one boring (2026-09-22: the mark only glanced side to side, nothing moved,
 * nothing answered). Now the logo is the 3D orglet itself (COD-156), monochrome like the brand mark: it hops in,
 * turns to follow the pointer, blinks, and smiles when the screen is tapped. The wait is told in stages rather
 * than one frozen line: after a few seconds the copy admits it is taking longer and the face glances aside; after
 * a long spell it says what to do and the face dozes off. Nothing here holds the app back: the workspace arriving
 * unmounts the screen mid-hop, and the face never demands to finish.
 */

// The size of the 64-unit drawing in pixels; its canvas is twice that, out of layout.
const FACE_SIZE = 80;
// The face's personality is fixed, so the app opens with the same orglet every time.
const FACE_SEED = 29;
// After this many seconds the copy admits the wait is longer than usual, and after that many it says what to do.
const SLOW_AFTER_SECONDS = 3;
const STUCK_AFTER_SECONDS = 15;

type Wait = 'opening' | 'slow' | 'stuck';
type Cue = { kind: Moment; count: number };

const nextCue = (kind: Moment) => (previous: Cue | undefined): Cue => ({ kind, count: (previous?.count ?? 0) + 1 });

export function Startup({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  const [wait, setWait] = useState<Wait>('opening');
  const [cheer, setCheer] = useState(0);
  const [cue, setCue] = useState<Cue>();
  useEffect(() => {
    if (error) return;
    const slow = setTimeout(() => { setWait('slow'); setCue(nextCue('glance')); }, SLOW_AFTER_SECONDS * 1000);
    const stuck = setTimeout(() => { setWait('stuck'); setCue(nextCue('doze')); }, STUCK_AFTER_SECONDS * 1000);
    return () => { clearTimeout(slow); clearTimeout(stuck); };
  }, [error]);
  // An error lands as a wince.
  useEffect(() => { if (error) setCue(nextCue('squint')); }, [error]);
  // A tap anywhere on the screen makes the face smile; the retry button keeps its own click.
  const tap = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return;
    setCheer(count => count + 1);
  };
  const waiting = wait === 'stuck' ? t('Mở lâu hơn bình thường. Nếu vẫn không xong, đóng rồi mở lại Orglet.') : wait === 'slow' ? t('Vẫn đang mở, chờ chút…') : t('Đang mở workspace…');
  return <div className="startup" onPointerDown={tap}>
    <div className="startup-face">
      <Orglet3D id="classic" seed={FACE_SEED} size={FACE_SIZE} color="mono" motion={{ lead: true, greet: true, cheer, moment: cue }} />
    </div>
    <div className="startup-copy">
      <h1>Orglet</h1>
      <p role={error ? 'alert' : 'status'}>{error || waiting}</p>
      {error && onRetry && <Button variant="outline" onClick={onRetry}>{t('Thử lại')}</Button>}
    </div>
  </div>;
}
