import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { collapseNotices, isUnreadNotice, newNoticesFirst, noticeGroupLabels, useNotices, type Notice } from '../../apps/desktop/src/renderer/components/notifications';
import { toast } from '../../apps/desktop/src/renderer/components/toast';
import { calendarDaysAgo, clockLabel, dayLabel } from '../../apps/desktop/src/renderer/components/TimeMark';

let nextId = 1;
const notice = (text: string, at: string, extra: Partial<Notice> = {}): Notice => ({ id: nextId++, at, kind: 'done', text, ...extra });

/**
 * The centre folds a run of identical notices into one row and groups rows by day with the chat's own day words
 * (COD-174): the owner opened it to six "Saved" rows and six "Command not allowed." rows, one under the other.
 */
describe('notice centre rows', () => {
  it('folds consecutive identical notices into one row that keeps the latest time and every time', () => {
    const newestFirst = [
      notice('Đã lưu', '2026-09-23T10:03:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã lưu', '2026-09-23T10:02:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã lưu', '2026-09-23T10:01:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã xóa', '2026-09-23T09:00:00.000Z', { about: 'Researcher' }),
    ];
    const rows = collapseNotices(newestFirst);
    expect(rows.map(row => [row.notice.text, row.count])).toEqual([['Đã lưu', 3], ['Đã xóa', 1]]);
    expect(rows[0].notice.at).toBe('2026-09-23T10:03:00.000Z');
    expect(rows[0].times).toEqual(['2026-09-23T10:03:00.000Z', '2026-09-23T10:02:00.000Z', '2026-09-23T10:01:00.000Z']);
  });

  it('keeps notices apart when they are about different things, or when something else came between', () => {
    const newestFirst = [
      notice('Đã lưu', '2026-09-23T10:03:00.000Z', { about: 'Giao diện' }),
      notice('Đã lưu', '2026-09-23T10:02:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã lưu', '2026-09-23T10:01:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã xóa', '2026-09-23T10:00:30.000Z'),
      notice('Đã lưu', '2026-09-23T10:00:00.000Z', { about: 'Ngôn ngữ' }),
      notice('Đã lưu', '2026-09-23T09:59:00.000Z', { kind: 'error' }),
      notice('Đã lưu', '2026-09-23T09:58:00.000Z'),
    ];
    expect(collapseNotices(newestFirst).map(row => `${row.notice.kind}:${row.notice.text}:${row.notice.about ?? ''}×${row.count}`)).toEqual([
      'done:Đã lưu:Giao diện×1',
      'done:Đã lưu:Ngôn ngữ×2',
      'done:Đã xóa:×1',
      'done:Đã lưu:Ngôn ngữ×1',
      'error:Đã lưu:×1',
      'done:Đã lưu:×1',
    ]);
  });

  it('renders a notice stored before it carried context', () => {
    // A row saved by the earlier version has no `about`; it still folds and still reads.
    const legacy = { id: 1, at: '2026-09-23T10:00:00.000Z', kind: 'done', text: 'Đã lưu' } as Notice;
    const rows = collapseNotices([legacy, { ...legacy, id: 2 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].notice.about).toBeUndefined();
  });
});

describe('day labels shared with the chat', () => {
  const now = new Date(2026, 8, 23, 20, 30);
  const iso = (date: Date) => date.toISOString();

  it('counts calendar days, not elapsed hours', () => {
    expect(calendarDaysAgo(iso(new Date(2026, 8, 23, 0, 5)), now)).toBe(0);
    expect(calendarDaysAgo(iso(new Date(2026, 8, 22, 23, 55)), now)).toBe(1);
    expect(calendarDaysAgo(iso(new Date(2026, 8, 1, 12, 0)), now)).toBe(22);
  });

  it('names today and yesterday, then gives the date, with the year only when it differs', () => {
    const today = dayLabel(iso(new Date(2026, 8, 23, 9, 5)), now);
    const yesterday = dayLabel(iso(new Date(2026, 8, 22, 9, 5)), now);
    const earlier = dayLabel(iso(new Date(2026, 7, 3, 9, 5)), now);
    const otherYear = dayLabel(iso(new Date(2025, 7, 3, 9, 5)), now);
    expect(today).not.toBe(yesterday);
    expect(today).not.toMatch(/\d/);
    expect(yesterday).not.toMatch(/\d/);
    expect(earlier).toContain('03');
    expect(earlier).toContain('08');
    expect(earlier).not.toContain('2026');
    expect(otherYear).toContain('2025');
  });

  it('gives the time of day on its own', () => {
    expect(clockLabel(iso(new Date(2026, 8, 23, 9, 5)))).toMatch(/9[:.]05/);
  });
});

describe('new notices in the centre', () => {
  it('puts what arrived since the centre was last opened under "new", before the day groups', () => {
    const older = notice('Đã lưu', '2026-09-23T09:00:00.000Z');
    const newer = notice('Đã tạo hội', '2026-09-23T10:00:00.000Z');
    const newest = notice('Đã sao chép', '2026-09-23T11:00:00.000Z');
    const rows = collapseNotices([newest, newer, older]);
    expect(noticeGroupLabels(rows, older.id, 'New', () => 'Today')).toEqual(['New', 'New', 'Today']);
    expect(noticeGroupLabels(rows, newest.id, 'New', () => 'Today')).toEqual(['Today', 'Today', 'Today']);
    expect(noticeGroupLabels(rows, null, 'New', () => 'Today')).toEqual(['Today', 'Today', 'Today']);
  });
});

/** The notices recorded so far, read through the same hook the centre uses. */
function recordedNotices(): Notice[] {
  let recorded: Notice[] = [];
  const Probe = () => {
    recorded = useNotices();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return recorded;
}

/**
 * COD-255: saving an orglet left an unread "Orglet saved" and a badge on Notifications. A confirmation of what the
 * person just did is kept but already read; a problem and news that arrived on its own still wait for them.
 */
describe('what counts as unread', () => {
  it('keeps a plain confirmation in the list without counting it, and counts problems, notes and news', () => {
    const before = recordedNotices().at(-1)?.id ?? 0;
    toast('Đã lưu Tí', 'success', 'Researcher');
    toast('Đã tạo hội', 'success', 'Review crew', { action: { label: 'Mở', onSelect: () => undefined } });
    toast('Không lưu được Tí', 'error', 'Researcher');
    toast('Liên kết trỏ tới Tí không còn', 'info');
    toast('Researcher đã trả lời trong chat phụ', 'success', 'Side thread', { unread: true });
    const added = recordedNotices().filter(notice => notice.id > before);
    expect(added.map(notice => [notice.text, isUnreadNotice(notice, before)])).toEqual([
      ['Đã lưu Tí', false],
      ['Đã tạo hội', false],
      ['Không lưu được Tí', true],
      ['Liên kết trỏ tới Tí không còn', true],
      ['Researcher đã trả lời trong chat phụ', true],
    ]);
  });

  it('never files a confirmation under "new", even when it arrived after the centre was last opened', () => {
    const seen = notice('Đã sao chép', '2026-09-23T09:00:00.000Z');
    const confirmation = notice('Đã lưu Tí', '2026-09-23T10:00:00.000Z', { confirmation: true });
    const problem = notice('Không lưu được Tí', '2026-09-23T11:00:00.000Z', { kind: 'error' });
    const rows = collapseNotices([problem, confirmation, seen]);
    expect(noticeGroupLabels(rows, seen.id, 'New', () => 'Today')).toEqual(['New', 'Today', 'Today']);
    expect(isUnreadNotice(confirmation, seen.id)).toBe(false);
    expect(isUnreadNotice(problem, seen.id)).toBe(true);
  });

  it('lists a new answer before newer confirmations, so "new" and the day each head the list once', () => {
    const seen = notice('Đã tạo Tí', '2026-09-26T12:30:00.000Z', { confirmation: true });
    const answer = notice('Dev đã trả lời trong chat phụ', '2026-09-26T12:37:00.000Z');
    const created = notice('Đã tạo Tí', '2026-09-26T12:38:00.000Z', { confirmation: true });
    const saved = notice('Đã lưu', '2026-09-26T12:50:00.000Z', { confirmation: true });
    const rows = newNoticesFirst(collapseNotices([saved, created, answer, seen]), seen.id);
    expect(rows.map(row => row.notice.text)).toEqual(['Dev đã trả lời trong chat phụ', 'Đã lưu', 'Đã tạo Tí', 'Đã tạo Tí']);
    expect(noticeGroupLabels(rows, seen.id, 'New', () => 'Today')).toEqual(['New', 'Today', 'Today', 'Today']);
    // Before the centre knows what was seen, nothing moves.
    expect(newNoticesFirst(collapseNotices([saved, created, answer, seen]), null).map(row => row.notice.text))
      .toEqual(['Đã lưu', 'Đã tạo Tí', 'Dev đã trả lời trong chat phụ', 'Đã tạo Tí']);
  });
});
