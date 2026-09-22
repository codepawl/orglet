import { currentLocale, t } from '../i18n';

/** A back-and-forth stays unbroken; a chat picked up later says when it was picked up. */
export const TIME_MARK_GAP_MS = 15 * 60_000;

/** True when enough time passed between two turns that the later one should say when it was sent. */
export function needsTimeMark(previous: string | undefined, at: string) {
  if (!previous) return false;
  return new Date(at).getTime() - new Date(previous).getTime() > TIME_MARK_GAP_MS;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * How the moment reads, from how far back it is: the time alone today, "yesterday" and the time the day before,
 * the date within this year, and the year as well before that.
 */
export function timeMarkLabel(at: string, now = new Date()) {
  const moment = new Date(at);
  const locale = currentLocale();
  const clock = moment.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(moment)) / 86_400_000);
  if (days <= 0) return clock;
  if (days === 1) return t('Hôm qua {0}', [clock]);
  const sameYear = moment.getFullYear() === now.getFullYear();
  return `${moment.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) })}, ${clock}`;
}

/** The seam between a chat and its continuation: a quiet centred label, separated by space and never by a line. */
export function TimeMark({ at }: { at: string }) {
  return <div className="time-mark"><time dateTime={at}>{timeMarkLabel(at)}</time></div>;
}
