import { z } from 'zod';

export const TimeZone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Timezone không hợp lệ.');
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const Weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length);
export const Schedule = z.object({ timeZone: TimeZone, time: ClockTime, frequency: z.enum(['daily', 'weekly']), weekday: z.number().int().min(0).max(6) }).strict();
export type Schedule = z.infer<typeof Schedule>;
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
export function nextOccurrence(schedule: Schedule, after: Date): string {
  const local = localParts(after, schedule.timeZone);
  const [hour, minute] = schedule.time.split(':').map(Number);
  // Search calendar days, not elapsed 24-hour intervals. Probe nearby offsets then
  // round-trip the wall time: gaps are skipped; overlaps choose the first instant.
  for (let day = 0; day < 16; day++) {
    const wall = Date.UTC(local.year, local.month - 1, local.day + day, hour, minute);
    if (schedule.frequency === 'weekly' && new Date(wall).getUTCDay() !== schedule.weekday) continue;
    const offsets = new Set<number>();
    for (const hours of [-36, -12, 0, 12, 36]) {
      const probe = wall + hours * 3_600_000;
      offsets.add(wallTimestamp(new Date(probe), schedule.timeZone) - probe);
    }
    const instants = [...offsets].map(offset => wall - offset).filter(instant => wallTimestamp(new Date(instant), schedule.timeZone) === wall).sort((a, b) => a - b);
    if (instants.length && instants[0] > after.getTime()) return new Date(instants[0]).toISOString();
  }
  throw new Error('Không tìm được lần chạy kế tiếp trong timezone này.');
}
