import { describe, expect, it } from 'vitest';
import { durationLabel, elapsedLabel, runWorkEndedAt, workedMilliseconds } from '../../apps/desktop/src/renderer/components/DetailsPanel';

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
  // Whole days read like the other units, so one day is never "1 days" (COD-292).
  expect(elapsedLabel(start, after(86400))).toBe('1d');
  expect(elapsedLabel(start, after(86400 * 2))).toBe('2d');
});

describe('the time a chat worked (COD-291)', () => {
  const event = (runId: string, seconds: number, message = 'Đang gọi model · bước 1/6') => ({ runId, message, createdAt: after(seconds) });
  const run = (id: string, seconds: number) => ({ id, startedAt: after(seconds) });

  it('adds up each run from its start to its own end, not the first start to the last finish', () => {
    // Two turns 25 minutes apart, 10 s and 20 s of work: the old measure read 25m 20s.
    const runs = [run('first', 0), run('second', 1500)];
    const events = [event('first', 4), event('first', 10, 'Đã lưu câu trả lời.'), event('second', 1510), event('second', 1520, 'Đã lưu câu trả lời.')];
    expect(workedMilliseconds(runs, events)).toBe(30_000);
    expect(durationLabel(workedMilliseconds(runs, events))).toBe('30s');
  });

  it('counts crew members working side by side once, as the time that passed', () => {
    const runs = [run('lead', 0), run('writer', 2), run('reviewer', 3), run('report', 20)];
    const events = [event('lead', 2), event('writer', 12), event('reviewer', 15), event('report', 25, 'Đã lưu câu trả lời.')];
    // 0 to 15 while the lead and members overlap, then 20 to 25 for the report.
    expect(workedMilliseconds(runs, events)).toBe(20_000);
  });

  it('ends a run at its answer, before the person applied its held changes minutes later', () => {
    const events = [
      event('held', 5, 'Thay đổi đang chờ bạn xem trước khi vào thư mục.'),
      event('held', 6, 'Đã lưu câu trả lời.'),
      event('held', 300, 'Đã tích hợp workspace: note.txt'),
      event('held', 300, 'Người dùng đã xem và áp dụng 1 thay đổi.'),
    ];
    expect(runWorkEndedAt(events)).toBe(after(6));
    expect(workedMilliseconds([run('held', 0)], events)).toBe(6_000);
    // Apply anyway: the person's decision comes before the answer is saved, so the run ends before it.
    const blocked = [
      event('blocked', 8, 'Lệnh npm test thoát với mã 1'),
      event('blocked', 400, 'Người dùng chấp nhận lệnh thất bại và áp dụng thay đổi: npm test (mã thoát 1)'),
      event('blocked', 401, 'Đã lưu câu trả lời.'),
    ];
    expect(runWorkEndedAt(blocked)).toBe(after(8));
  });
});
