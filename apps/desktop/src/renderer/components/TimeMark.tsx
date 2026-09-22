import { currentLocale, t } from '../i18n';

/** A back-and-forth stays unbroken; a chat picked up later says when it was picked up. */
export const TIME_MARK_GAP_MS = 15 * 60_000;

/** True when enough time passed between two turns that the later one should say when it was sent. */
export function needsTimeMark(previous: string | undefined, at: string) {
  if (!previous) return false;
  return new Date(at).getTime() - new Date(previous).getTime() > TIME_MARK_GAP_MS;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole calendar days between a moment and now: 0 today, 1 yesterday, and so on. */
export function calendarDaysAgo(at: string, now = new Date()) {
  return Math.round((startOfDay(now) - startOfDay(new Date(at))) / 86_400_000);
}

/** The time of day alone, in the interface language. */
export function clockLabel(at: string) {
  return new Date(at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** The date, and the year only when it is not this one. */
function dateLabel(at: string, now: Date) {
  const moment = new Date(at);
  const sameYear = moment.getFullYear() === now.getFullYear();
  return moment.toLocaleDateString(currentLocale(), { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * The day a moment falls on, as a heading reads: today, yesterday, then the date. The notice centre groups its
 * rows under this, so it says the day the same way the chat's time marks do.
 */
export function dayLabel(at: string, now = new Date()) {
  const days = calendarDaysAgo(at, now);
  if (days <= 0) return t('Hôm nay');
  if (days === 1) return t('Hôm qua');
  return dateLabel(at, now);
}

/**
 * How the moment reads, from how far back it is: the time alone today, "yesterday" and the time the day before,
 * the date within this year, and the year as well before that.
 */
export function timeMarkLabel(at: string, now = new Date()) {
  const clock = clockLabel(at);
  const days = calendarDaysAgo(at, now);
  if (days <= 0) return clock;
  if (days === 1) return t('Hôm qua {0}', [clock]);
  return `${dateLabel(at, now)}, ${clock}`;
}

/** The seam between a chat and its continuation: a quiet centred label, separated by space and never by a line. */
export function TimeMark({ at }: { at: string }) {
  return <div className="time-mark"><time dateTime={at}>{timeMarkLabel(at)}</time></div>;
}
