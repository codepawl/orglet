import { z } from 'zod';

export const TimeZone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Timezone không hợp lệ.');
/**
 * Why a clock routine's run was held back as a miss: the app was closed, asleep or late, or a miss was already waiting.
 * The Schedules card knows this reason and says it in plain words (COD-283); any other reason is a start that failed.
 */
export const SKIPPED_WHILE_INACTIVE = 'Đã bỏ qua lịch khi app không hoạt động hoặc còn lần chờ xử lý. Có thể chạy bù một lần.';
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const Weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length);
/**
 * How often a clock routine runs (COD-288): once a day, on weekdays (Monday to Friday), once a week, or every few
 * hours. Nothing runs more often than once an hour.
 */
export const ScheduleFrequency = z.enum(['daily', 'weekdays', 'weekly', 'hours']);
export type ScheduleFrequency = z.infer<typeof ScheduleFrequency>;
/** The hours an hourly schedule can wait between runs; each one divides a day evenly. */
export const EVERY_HOURS_CHOICES = [1, 2, 3, 4, 6, 8, 12] as const;
export const EveryHours = z.literal(EVERY_HOURS_CHOICES);
/**
 * The part of the day an hourly schedule runs in: the first run is at `from`, then every few hours while the time is
 * still before `to`. A window never crosses midnight.
 */
export const ScheduleWindow = z.object({ from: ClockTime, to: ClockTime }).strict().refine(window => window.from < window.to, 'Giờ bắt đầu của khung giờ phải trước giờ kết thúc.');
export type ScheduleWindow = z.infer<typeof ScheduleWindow>;
/** The most a schedule's runs may cost in one local day: twenty-four runs at the highest per-run limit. */
export const MAX_DAILY_CAP_MICROS = 2_400_000_000;
/**
 * `everyHours`, `window` and `weekdaysOnly` belong to an hourly schedule only. `dailyCapMicros` is the most the
 * schedule's runs of one local day may cost, whatever starts them (COD-288); absent means runs × the per-run limit.
 */
export const Schedule = z.object({
  timeZone: TimeZone,
  time: ClockTime,
  frequency: ScheduleFrequency,
  weekday: z.number().int().min(0).max(6),
  everyHours: EveryHours.optional(),
  window: ScheduleWindow.optional(),
  weekdaysOnly: z.boolean().optional(),
  dailyCapMicros: z.number().int().min(1000).max(MAX_DAILY_CAP_MICROS).optional(),
}).strict().refine(schedule => schedule.frequency !== 'hours' || schedule.everyHours !== undefined, 'Chọn số giờ giữa hai lần chạy.');
export type Schedule = z.infer<typeof Schedule>;
/**
 * Why a run did not start: the schedule's runs of today already cost as much as its daily cap allows, counting a
 * run still going at its whole limit (COD-288). The card shows it as the cap reached, not as a missed run.
 */
export const DAILY_CAP_REACHED = 'Lịch đã chạm giới hạn chi phí hôm nay, nên các lần chạy còn lại trong ngày được bỏ qua. Lịch chạy lại sau nửa đêm.';
/** An hourly schedule's time came while its previous run was still going or waiting for the person, so it skipped it. */
export const SKIPPED_PREVIOUS_RUNNING = 'Lần chạy trước chưa xong nên lịch bỏ qua các giờ chạy cho đến khi nó xong.';
export const WorkHours = z.object({ timeZone: TimeZone, start: ClockTime, end: ClockTime, days: Weekdays }).strict().refine(value => value.start !== value.end, 'Giờ bắt đầu và kết thúc phải khác nhau.');
export type WorkHours = z.infer<typeof WorkHours>;

function localParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}
function wallTimestamp(date: Date, timeZone: string) {
  const p = localParts(date, timeZone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}
export function inWorkHours(policy: WorkHours | undefined, date: Date): boolean {
  if (!policy) return true;
  const p = localParts(date, policy.timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  if (policy.start < policy.end) return policy.days.includes(weekday) && time >= policy.start && time < policy.end;
  // An overnight shift belongs to its starting day.
  return (time >= policy.start && policy.days.includes(weekday)) || (time < policy.end && policy.days.includes((weekday + 6) % 7));
}
const MINUTES_PER_DAY = 24 * 60;
const MILLISECONDS_PER_MINUTE = 60_000;

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/** Monday to Friday. */
export function isWorkday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * Keeps only the fields the frequency uses, so a schedule switched from hourly back to daily does not carry an hourly
 * window it no longer follows, and two saves of the same schedule approve the same thing.
 */
export function normalizedSchedule(schedule: Schedule): Schedule {
  const { everyHours, window, weekdaysOnly, ...rest } = schedule;
  if (schedule.frequency !== 'hours') return rest;
  return { ...rest, everyHours, ...(window ? { window } : {}), ...(weekdaysOnly ? { weekdaysOnly: true } : {}) };
}

/** The minutes after local midnight a schedule runs at, on a day it runs at all. */
export function runMinutesOfDay(schedule: Schedule): number[] {
  if (schedule.frequency !== 'hours') return [minutesOf(schedule.time)];
  const first = schedule.window ? minutesOf(schedule.window.from) : 0;
  const end = schedule.window ? minutesOf(schedule.window.to) : MINUTES_PER_DAY;
  const step = (schedule.everyHours ?? 1) * 60;
  const minutes: number[] = [];
  for (let minute = first; minute < end; minute += step) minutes.push(minute);
  return minutes;
}

/** The most runs the schedule's clock starts on one day it runs: one, or an hourly schedule's slots. */
export function runsPerDay(schedule: Schedule): number {
  return runMinutesOfDay(schedule).length;
}

function runsOnWeekday(schedule: Schedule, weekday: number): boolean {
  if (schedule.frequency === 'weekly') return weekday === schedule.weekday;
  if (schedule.frequency === 'weekdays') return isWorkday(weekday);
  if (schedule.frequency === 'hours' && schedule.weekdaysOnly) return isWorkday(weekday);
  return true;
}

/**
 * The instants a local wall time falls on, earliest first: none in a daylight-saving gap, two in a repeated hour.
 * Probe nearby offsets, then keep the ones that round-trip to the same wall time.
 */
function instantsOfWallTime(wall: number, timeZone: string): number[] {
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = wall + hours * 3_600_000;
    offsets.add(wallTimestamp(new Date(probe), timeZone) - probe);
  }
  const instants = [...offsets].map(offset => wall - offset).filter(instant => wallTimestamp(new Date(instant), timeZone) === wall);
  return instants.sort((first, second) => first - second);
}

/**
 * The first run after `after`. Days are calendar days, not elapsed 24-hour intervals, and every run is a local wall
 * time: one in a daylight-saving gap is skipped, and a repeated one runs at its first instant only, so an hourly
 * schedule never runs twice in the hour the clocks go back.
 */
export function nextOccurrence(schedule: Schedule, after: Date): string {
  const local = localParts(after, schedule.timeZone);
  const minutes = runMinutesOfDay(schedule);
  for (let day = 0; day < 16; day++) {
    const midnight = Date.UTC(local.year, local.month - 1, local.day + day);
    if (!runsOnWeekday(schedule, new Date(midnight).getUTCDay())) continue;
    for (const minute of minutes) {
      const instants = instantsOfWallTime(midnight + minute * MILLISECONDS_PER_MINUTE, schedule.timeZone);
      if (instants.length && instants[0] > after.getTime()) return new Date(instants[0]).toISOString();
    }
  }
  throw new Error('Không tìm được lần chạy kế tiếp trong timezone này.');
}

/** The local calendar day an instant falls on in a time zone, as "YYYY-MM-DD": the day a daily cap counts (COD-288). */
export function scheduleDay(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}
