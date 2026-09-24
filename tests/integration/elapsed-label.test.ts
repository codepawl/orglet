import { expect, it } from 'vitest';
import { elapsedLabel } from '../../apps/desktop/src/renderer/components/DetailsPanel';

const start = '2026-09-18T00:00:00.000Z';
const after = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();

it('names a duration in at most two units, up to days', () => {
  expect(elapsedLabel(start, after(0))).toBeUndefined();
  expect(elapsedLabel(start, after(42))).toBe('42s');
  expect(elapsedLabel(start, after(125))).toBe('2m 5s');
  expect(elapsedLabel(start, after(3600))).toBe('1h');
  expect(elapsedLabel(start, after(3600 * 5 + 60 * 7))).toBe('5h 7m');
  // A chat open for days used to read "8625m 31s".
  expect(elapsedLabel(start, after(8625 * 60 + 31))).toBe('5d 23h');
  expect(elapsedLabel(start, after(86400 * 2))).toBe('2 days');
});
