import { BookOpen, CalendarClock, ChartColumn, Code, ListChecks, PenLine, RotateCcw, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { t } from '../i18n';
import type { Starter, StarterIcon } from '../../shared/starters';

const starterIcons: Record<StarterIcon, LucideIcon> = {
  documents: BookOpen, review: Sparkles, write: PenLine, data: ChartColumn,
  plan: ListChecks, code: Code, people: Users, repeat: RotateCcw,
};

/** A starter's own words are the person's writing and are shown as written; everything else is source text. */
const starterText = (starter: Starter, field: 'label' | 'prompt') => starter.ownWords ? starter[field] : t(starter[field]);

/**
 * The openers under the greeting in an empty chat. They come from `suggestStarters`, so this component only draws
 * them: picking one fills the composer for editing and never sends.
 * `onSchedule` is a control rather than an opener, so it sits after the starters and waits for a written message.
 */
export function Starters({ starters, onPick, onSchedule, canSchedule }: {
  starters: readonly Starter[];
  onPick: (prompt: string) => void;
  onSchedule?: () => void;
  canSchedule?: boolean;
}) {
  if (!starters.length && !onSchedule) return null;
  return <ul className="suggestions" aria-label={t('Gợi ý')}>
    {starters.map(starter => {
      const Icon = starterIcons[starter.icon];
      return <li key={starter.id}>
        <button type="button" onClick={() => onPick(starterText(starter, 'prompt'))}>
          <Icon size={18} aria-hidden="true" />{starterText(starter, 'label')}
        </button>
      </li>;
    })}
    {onSchedule && <li>
      <button type="button" disabled={!canSchedule} title={canSchedule ? undefined : t('Viết tin nhắn trước')} onClick={onSchedule}>
        <CalendarClock size={18} aria-hidden="true" />{t('Lên lịch cho tin này')}
      </button>
    </li>}
  </ul>;
}
