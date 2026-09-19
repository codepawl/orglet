import { Square } from 'lucide-react';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { t } from '../i18n';
import type { Worker } from '../../shared/contracts';

/*
 * Waiting, on one line (user, 2026-09-19): the worker's own face with a light running around it, what it is doing in
 * words that shimmer, how long it has taken, and a way to stop.
 *
 * One mark, not two. The face already says who is working and which provider it runs on, so the spinner is not a
 * separate object beside it — it is the light travelling the avatar's own edge. That is the Orglet version of a good
 * spinner: the product's own shape moving, rather than a borrowed ring.
 */

/** The worker's avatar with a short arc of light running around its edge while it works. */
export function WorkingMark({ worker }: { worker: Worker }) {
  return <span className="working-mark">
    <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />
    {/* pathLength normalises the outline to 200 units, so the dash lengths below read as percentages of it. */}
    <svg className="working-halo" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <rect className="working-track" x="2" y="2" width="30" height="30" rx="10" pathLength="200" />
      <rect className="working-trace" x="2" y="2" width="30" height="30" rx="10" pathLength="200" />
    </svg>
  </span>;
}

/**
 * One line of waiting. `seconds` is left out where no start time is known, and `onToggleThinking` turns the label
 * into a button that reveals the worker's notes.
 */
export function WorkingLine({ worker, label, seconds, expanded, onToggleThinking, onStop }: {
  worker?: Worker;
  label: string;
  seconds?: number;
  expanded?: boolean;
  onToggleThinking?: () => void;
  onStop: () => void;
}) {
  return <div role="status" className="thinking">
    {worker ? <WorkingMark worker={worker} /> : <span className="working-mark"><span className="orglet-mark small">o</span></span>}
    {worker && <span className="working-who">{worker.name}</span>}
    {onToggleThinking
      ? <button type="button" className="thinking-text thinking-toggle" aria-expanded={expanded} onClick={onToggleThinking}>{label}</button>
      : <span className="thinking-text">{label}</span>}
    {seconds !== undefined && <span className="thinking-seconds">{t('{0}s', [seconds])}</span>}
    <Button size="icon" className="thinking-stop" aria-label={t('Dừng')} title={t('Dừng')} onClick={onStop}><Square size={11} fill="currentColor" /></Button>
  </div>;
}
