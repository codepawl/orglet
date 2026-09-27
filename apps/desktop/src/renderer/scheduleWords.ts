import type { Schedule } from '../shared/schedule';
import { currentLanguage, currentLocale, t, translated } from './i18n';

const weekdayNames = translated(['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']);

/** Keeps "9:00 AM" on one line: the space before the day period becomes a no-break space, whatever the runtime used. */
export const keepTimeTogether = (text: string) => text.replace(/\s(?=[AP]M\b)/g, '\u00a0');

/**
 * A schedule's saved "HH:mm" on the interface's clock, the same way the card writes the next run beside it:
 * "01:36" in Vietnamese, "1:36 AM" in US English (COD-283; the card used to mix the two).
 */
export function formatClockTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const wallClock = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return keepTimeTogether(wallClock.toLocaleTimeString(currentLocale(), { timeZone: 'UTC', timeStyle: 'short' }));
}

/** "Every hour" or "Every 3 hours". */
export function everyHoursInWords(everyHours: number): string {
  if (everyHours === 1) return t('Mỗi giờ');
  return t('Mỗi {0} giờ', [everyHours]);
}

/**
 * How often a clock schedule runs, in a few words (COD-288): "Daily at 09:00", "Weekdays at 09:00", "Every Monday at
 * 09:00", or "Every 2 hours, 09:00–18:00, weekdays only".
 */
export function cadenceInWords(schedule: Pick<Schedule, 'frequency' | 'time' | 'weekday' | 'everyHours' | 'window' | 'weekdaysOnly'>): string {
  if (schedule.frequency === 'hours') {
    let words = everyHoursInWords(schedule.everyHours ?? 1);
    if (schedule.window) words = t('{0}, {1}–{2}', [words, formatClockTime(schedule.window.from), formatClockTime(schedule.window.to)]);
    if (schedule.weekdaysOnly) words = t('{0}, chỉ ngày thường', [words]);
    return words;
  }
  const time = formatClockTime(schedule.time);
  if (schedule.frequency === 'daily') return t('{0} lúc {1}', [t('Hằng ngày'), time]);
  if (schedule.frequency === 'weekdays') return t('Ngày thường lúc {0}', [time]);
  // Vietnamese writes the day in lower case mid-sentence ("Mỗi thứ hai"); English keeps "Every Monday".
  const dayName = weekdayNames[schedule.weekday];
  const day = currentLanguage() === 'vi' ? dayName.toLowerCase() : dayName;
  return t('{0} lúc {1}', [t('Mỗi {0}', [day]), time]);
}
