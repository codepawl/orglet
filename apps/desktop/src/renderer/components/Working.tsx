import { t } from '../i18n';

/**
 * The line under a turn while its worker runs: what it is doing and how long it has taken.
 *
 * Stopping is not here. It moved onto the prompt bar, in the send button’s place (user, 2026-09-19), where the
 * hand already is and where a turning ring makes it hard to miss.
 *
 * It does not name the worker, and carries no face. The byline above the turn already does both, and for a while
 * this line repeated them, so a streaming answer showed the same worker twice and the byline appeared mid-stream,
 * shoving the text down (user, 2026-09-19). One name per turn, in one place, from the moment the turn starts.
 *
 * The face that thinks is the byline's: `.message-byline.working` turns it from side to side.
 *
 * `seconds` is left out where no start time is known, and `onToggleThinking` turns the label into a button that
 * reveals the worker's notes.
 */
export function WorkingLine({ label, seconds, expanded, onToggleThinking }: {
  label: string;
  seconds?: number;
  expanded?: boolean;
  onToggleThinking?: () => void;
}) {
  return <div role="status" className="thinking">
    {onToggleThinking
      ? <button type="button" className="thinking-text thinking-toggle" aria-expanded={expanded} onClick={onToggleThinking}>{label}</button>
      : <span className="thinking-text">{label}</span>}
    {seconds !== undefined && <span className="thinking-seconds">{t('{0}s', [seconds])}</span>}
  </div>;
}
