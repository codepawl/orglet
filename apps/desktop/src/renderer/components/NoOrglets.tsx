import { useEffect, useState, type PointerEvent } from 'react';
import { t } from '../i18n';
import { Orglet3D } from './Orglet3D';
import type { Moment } from './orgletStage';
import { Button } from './ui';

/*
 * The main pane once every orglet is gone (COD-350, COD-356). The same monochrome orglet that waits on the startup
 * screen stands here, so the empty app still has someone in it: it hops in, turns after the pointer, smiles and hops
 * when the pane is tapped, stretches while the pointer rests on New orglet, and dozes off when nobody touches it for a
 * while. Any tap wakes it. The motion is the orglet's own; the pane itself never fades or slides.
 */

// The startup face's size and personality, so it reads as the same orglet.
const FACE_SIZE = 80;
const FACE_SEED = 29;
// Left alone this long, the orglet dozes.
const DOZE_AFTER_SECONDS = 25;

type Cue = { kind: Moment; count: number };

const nextCue = (kind: Moment) => (previous: Cue | undefined): Cue => ({ kind, count: (previous?.count ?? 0) + 1 });

export function NoOrglets({ onCreate }: { onCreate: () => void }) {
  const [cheer, setCheer] = useState(0);
  const [cue, setCue] = useState<Cue>();
  const [lastTouch, setLastTouch] = useState(0);

  useEffect(() => {
    const doze = setTimeout(() => setCue(nextCue('doze')), DOZE_AFTER_SECONDS * 1000);
    return () => clearTimeout(doze);
  }, [lastTouch]);

  const touch = () => setLastTouch(count => count + 1);
  // A tap anywhere on the pane makes the orglet smile; the button keeps its own click.
  const tap = (event: PointerEvent<HTMLDivElement>) => {
    touch();
    if ((event.target as Element).closest('button')) return;
    setCheer(count => count + 1);
  };
  const eager = () => {
    touch();
    setCue(nextCue('stretch'));
  };

  return <div className="team-chat team-chat-fresh" onPointerDown={tap}>
    <div className="fresh-chat team-chat-empty no-orglets">
      <div className="fresh-faces">
        <div className="startup-face">
          <Orglet3D id="classic" seed={FACE_SEED} size={FACE_SIZE} color="mono" motion={{ lead: true, greet: true, cheer, moment: cue }} />
        </div>
      </div>
      <h1 className="welcome">{t('Chưa có Tí nào.')}</h1>
      <p className="no-orglets-hint">{t('Tạo một Tí để bắt đầu. Bạn nhắn, Tí làm.')}</p>
      <Button className="no-orglets-create" variant="primary" onPointerEnter={eager} onFocus={eager} onClick={onCreate}>{t('Tạo Tí')}</Button>
    </div>
  </div>;
}
