import { describe, expect, it } from 'vitest';
import { needsTimeMark, timeMarkLabel, TIME_MARK_GAP_MS } from '../../apps/desktop/src/renderer/components/TimeMark';

const iso = (date: Date) => date.toISOString();
// The wording follows whichever language is active, so these assert the shape rather than the words.
const clockOf = (label: string) => label.match(/\d{1,2}[:.]\d{2}(?:\s?[AP]M)?/i)?.[0];

describe('time mark', () => {
  it('marks a gap longer than fifteen minutes and nothing shorter', () => {
    const first = '2026-09-22T08:00:00.000Z';
    expect(needsTimeMark(first, '2026-09-22T08:14:00.000Z')).toBe(false);
    expect(needsTimeMark(first, '2026-09-22T08:15:00.000Z')).toBe(false);
    expect(needsTimeMark(first, '2026-09-22T08:15:01.000Z')).toBe(true);
    expect(TIME_MARK_GAP_MS).toBe(900_000);
    // The first turn has nothing before it, so it is never marked.
    expect(needsTimeMark(undefined, first)).toBe(false);
  });

  it('says only as much as it needs to', () => {
    const now = new Date(2026, 8, 22, 20, 30);

    // Today is the time alone: no day, no date.
    const today = timeMarkLabel(iso(new Date(2026, 8, 22, 9, 5)), now);
    expect(clockOf(today)).toBeDefined();
    expect(today).toBe(clockOf(today));

    // Yesterday keeps the time and puts a word in front of it.
    const yesterday = timeMarkLabel(iso(new Date(2026, 8, 21, 9, 5)), now);
    expect(yesterday).toContain(clockOf(yesterday)!);
    expect(yesterday.length).toBeGreaterThan(clockOf(yesterday)!.length);

    // Earlier this year is the date, without the year.
    const earlier = timeMarkLabel(iso(new Date(2026, 7, 3, 9, 5)), now);
    expect(earlier).toContain('03');
    expect(earlier).toContain('08');
    expect(earlier).not.toContain('2026');

    // Another year has to say which one.
    expect(timeMarkLabel(iso(new Date(2025, 7, 3, 9, 5)), now)).toContain('2025');
  });

  it('counts calendar days, not elapsed hours', () => {
    const now = new Date(2026, 8, 22, 0, 30);
    // Four hours earlier, but the day before: worded as the previous day, not as today.
    const label = timeMarkLabel(iso(new Date(2026, 8, 21, 20, 30)), now);
    expect(label).not.toBe(clockOf(label));
  });
});
