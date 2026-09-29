import { describe, expect, it } from 'vitest';
import {
  centreOffset,
  clusterValues,
  gapsBetween,
  groupLines,
  isClippedWithoutEllipsis,
  isShortLabel,
  outliers,
  unevenGaps,
  type Box,
} from '../../scripts/alignment/rules';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });

describe('alignment check maths (COD-333)', () => {
  it('groups a text run into lines by vertical centre', () => {
    const lines = groupLines([box(10, 100, 40, 16), box(52, 101, 30, 15), box(10, 120, 60, 16)]);
    expect(lines).toEqual([box(10, 100, 72, 16), box(10, 120, 60, 16)]);
  });

  it('measures a mark against the centre of the text beside it', () => {
    const text = box(30, 100, 80, 16);
    expect(centreOffset(box(10, 101, 14, 14), text, [text])).toBe(0);
    expect(centreOffset(box(10, 103, 14, 14), text, [text])).toBe(2);
    expect(centreOffset(box(10, 99, 14, 14), text, [text])).toBe(-2);
  });

  it('accepts a mark on the first line, the whole block or the top of a two-line text', () => {
    const first = box(30, 100, 80, 16);
    const second = box(30, 120, 80, 16);
    expect(centreOffset(box(10, 101, 14, 14), first, [first, second])).toBe(0);
    expect(centreOffset(box(10, 111, 14, 14), first, [first, second])).toBe(0);
    expect(centreOffset(box(10, 100, 32, 32), first, [first, second])).toBe(0);
    expect(Math.abs(centreOffset(box(10, 105, 14, 14), first, [first, second]))).toBe(4);
  });

  it('flags the item whose text starts off the column the others share', () => {
    // The schedule card before the fix: 14px icons with an 8px gap, and the orglet's 16px face.
    const items = [
      { name: 'time zone', left: 280, textStart: 302 },
      { name: 'next run', left: 280, textStart: 302 },
      { name: 'Researcher', left: 280, textStart: 304 },
    ];
    expect(outliers(items, item => item.textStart, 1)).toEqual([{ item: items[2], offset: 2 }]);
  });

  it('measures the second of two items against the first', () => {
    const items = [{ textStart: 302 }, { textStart: 304 }];
    expect(outliers(items, item => item.textStart, 1)).toEqual([{ item: items[1], offset: 2 }]);
    expect(outliers([{ textStart: 302 }, { textStart: 303 }], item => item.textStart, 1)).toEqual([]);
  });

  it('splits items into columns by their left edge', () => {
    const columns = clusterValues([280, 498.7, 280.4, 717.3, 499], value => value, 1);
    expect(columns).toEqual([[280, 280.4], [498.7, 499], [717.3]]);
  });

  it('finds the one uneven gap among siblings and ignores a deliberate push', () => {
    const buttons = [box(0, 0, 28, 28), box(34, 0, 28, 28), box(68, 0, 28, 28), box(106, 0, 28, 28), box(140, 0, 28, 28)];
    const gaps = gapsBetween(buttons, 'row');
    expect(gaps).toEqual([6, 6, 10, 6]);
    expect(unevenGaps(gaps, 2)).toEqual([2]);
    expect(unevenGaps([6, 6, 200, 6], 2)).toEqual([]);
    expect(unevenGaps([6, 10], 2)).toEqual([]);
  });

  it('calls text clipped only when it is cut with no ellipsis', () => {
    expect(isClippedWithoutEllipsis({ scrollWidth: 180, clientWidth: 120, overflowX: 'hidden', textOverflow: 'clip' })).toBe(true);
    expect(isClippedWithoutEllipsis({ scrollWidth: 180, clientWidth: 120, overflowX: 'hidden', textOverflow: 'ellipsis' })).toBe(false);
    expect(isClippedWithoutEllipsis({ scrollWidth: 121, clientWidth: 120, overflowX: 'hidden', textOverflow: 'clip' })).toBe(false);
    expect(isClippedWithoutEllipsis({ scrollWidth: 180, clientWidth: 120, overflowX: 'visible', textOverflow: 'clip' })).toBe(false);
  });

  it('treats only short labels as meant for one line', () => {
    expect(isShortLabel('Kết nối model')).toBe(true);
    expect(isShortLabel('Chỉ chạy khi Orglet đang mở; lịch theo giờ bị lỡ thì chạy bù một lần.')).toBe(false);
    expect(isShortLabel('   ')).toBe(false);
  });
});
