import { describe, expect, it } from 'vitest';
import {
  BASELINE_TOLERANCE,
  baselineOffsets,
  strandedGap,
  centreOffset,
  clusterValues,
  commonValue,
  familyFindings,
  gapsBetween,
  groupLines,
  isClippedWithoutEllipsis,
  islandSeamFindings,
  isShortLabel,
  nearMisses,
  nextWordWouldFit,
  outliers,
  paintsColour,
  trailingShortfall,
  unevenGaps,
  type Box,
  type IslandCornerMetrics,
  type ScreenMetrics,
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

  it('flags rows that almost share a left edge, and leaves real indents alone', () => {
    // A crew job 4px right of the trace row and the changed-files row under it: a slip.
    expect(nearMisses([376, 376, 380], value => value, 1)).toEqual([{ item: 380, offset: 4 }]);
    // Rows nested one level in (24px) are an indent, not a slip; rows on the same edge are fine.
    expect(nearMisses([376, 376, 400], value => value, 1)).toEqual([]);
    expect(nearMisses([376, 376.5, 377], value => value, 1)).toEqual([]);
    // Two rows and no majority: the one further right is measured against the other.
    expect(nearMisses([372, 380], value => value, 1)).toEqual([{ item: 380, offset: 8 }]);
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

describe('panel headings and screen families', () => {
  it('measures how far a heading action stops short of the content edge', () => {
    // Settings → Local harnesses before the fix: a transparent Rescan whose label ended at 433 in a 484px column.
    expect(trailingShortfall(484, 433.2)).toBe(50.8);
    expect(trailingShortfall(484, 484)).toBe(0);
    expect(trailingShortfall(484, 490)).toBe(-6);
  });

  it('tells a painting colour from a see-through one', () => {
    expect(paintsColour('rgba(0, 0, 0, 0)')).toBe(false);
    expect(paintsColour('transparent')).toBe(false);
    expect(paintsColour('rgb(0 0 0 / 0)')).toBe(false);
    expect(paintsColour('rgb(244, 244, 245)')).toBe(true);
    expect(paintsColour('rgba(68, 115, 211, 0.9)')).toBe(true);
    expect(paintsColour('color(srgb 0.1 0.2 0.3)')).toBe(true);
    expect(paintsColour('color(srgb 0.1 0.2 0.3 / 0)')).toBe(false);
  });

  it('flags a wrapped description only when an action box shows less than it takes', () => {
    // "Demo." needed 45px; the transparent button left 63px of its box empty.
    expect(nextWordWouldFit(3, 62.8, 45.2)).toBe(true);
    expect(nextWordWouldFit(3, 20, 45.2)).toBe(false);
    // A filled button shows its whole box: nothing beside the description is empty, whatever the slack.
    expect(nextWordWouldFit(40, 0, 45.2)).toBe(false);
  });

  it('takes the most common whole-pixel value', () => {
    expect(commonValue([62, 62.4, 60, 61.6])).toBe(62);
    expect(commonValue([])).toBeUndefined();
  });

  it('flags the screens of a family whose heading, edges or lead column disagree with the rest', () => {
    const contentBox = box(24, 0, 460, 500);
    const screen = (screen: string, overrides: Partial<ScreenMetrics>) => ({
      screen,
      metrics: { headingTop: 28, contentLeft: 24, contentRight: 484, contentBox, ...overrides } as ScreenMetrics,
    });
    const findings = familyFindings([
      screen('general', { headingTop: 35.5 }),
      screen('connections', { leadMark: 37, leadText: 62 }),
      screen('harness', { leadMark: 37, leadText: 60 }),
      screen('mcp', { contentRight: 496 }),
      screen('browser', { contentRight: 496, leadMark: 36, leadText: 58 }),
      screen('data', {}),
    ], 1);
    expect(findings.map(finding => [finding.kind, finding.screen, finding.offset])).toEqual([
      ['family-heading', 'general', 7.5],
      ['family-edge', 'mcp', 12],
      ['family-edge', 'browser', 12],
      ['family-lead', 'harness', -2],
      ['family-lead', 'browser', -4],
    ]);
    expect(findings[0].message).toBe('heading starts 7.5px lower than on the other screens of its family');
  });

  it('finds nothing when every screen of a family agrees', () => {
    const metrics: ScreenMetrics = { headingTop: 28, contentLeft: 24, contentRight: 496, leadMark: 37, leadText: 62, contentBox: box(24, 0, 472, 500) };
    expect(familyFindings([{ screen: 'a', metrics }, { screen: 'b', metrics: { ...metrics, leadMark: undefined, leadText: undefined } }, { screen: 'c', metrics }], 1)).toEqual([]);
  });
});

describe('the island seam on the prompt bar', () => {
  // At 125% Chromium draws a 1px border 0.8px wide; the corner has to use the same width and edge as the bar and tab.
  const sound: IslandCornerMetrics = { side: 'left', cornerLineBottom: 661.5, barLineBottom: 661.5, cornerLineWidth: 0.8, barLineWidth: 0.8, cornerSideWidth: 0.8, tabSideWidth: 0.8, cornerInnerEdge: 618, tabPaddingEdge: 618, tabReach: 3 };

  it("passes a corner whose lines are the bar's and the tab's", () => {
    expect(islandSeamFindings([sound, { ...sound, side: 'right' }])).toEqual([]);
  });

  it('flags the old gradient corner, a whole pixel thick and a pixel low, and a tab that barely reaches the bar', () => {
    const gradient = { ...sound, cornerLineBottom: 662.5, cornerLineWidth: 1, cornerSideWidth: 1, cornerInnerEdge: 617.8, tabReach: 1 };
    const messages = islandSeamFindings([gradient]).map(finding => finding.message);
    expect(messages).toEqual([
      "the left corner's line ends 1px below the bar's top line",
      "the left corner's line is 1px where the bar's top line is 0.8px",
      "the left corner's side is 1px where the tab's side is 0.8px",
      "the left corner meets the tab's side 0.2px off its border",
      "the tab reaches 1px into the bar, so the bar's line or its typing ring shows under it",
    ]);
  });

  it('finds text on one line that does not stand on the lead text\'s baseline (2026-10-07)', () => {
    // A name, its connection and the time: centred at three sizes, the smaller two stood a pixel above the name's line.
    expect(baselineOffsets([366.28, 365.28, 365.28], BASELINE_TOLERANCE)).toEqual([{ index: 1, offset: -1 }, { index: 2, offset: -1 }]);
    expect(baselineOffsets([366.28, 366.28, 366.1], BASELINE_TOLERANCE)).toEqual([]);
    expect(baselineOffsets([120], 1)).toEqual([]);
  });

  it('finds a picture-only piece left far past the end of the text above it (2026-10-07)', () => {
    // Read faces pushed to the end of an 80-character box under a one-line message.
    expect(strandedGap(box(1068, 400, 14, 14), [box(376, 376, 517, 20)])).toBe(175);
    expect(strandedGap(box(900, 400, 14, 14), [box(376, 376, 517, 20)])).toBeUndefined();
    expect(strandedGap(box(1068, 400, 14, 14), [])).toBeUndefined();
  });
});
