import { describe, expect, it } from 'vitest';
import { accentInk, ACCENT_INK_DARK, ACCENT_INK_LIGHT, DEFAULT_ACCENT_COLOR } from '../../apps/desktop/src/shared/accent';

describe('accentInk', () => {
  it('keeps white on the colours a dark accent is made of', () => {
    for (const colour of ['#171717', '#4f7fe0', '#2e7a32', '#a82626', DEFAULT_ACCENT_COLOR]) {
      expect(accentInk(colour)).toBe(ACCENT_INK_LIGHT);
    }
  });

  it('turns dark on a pale accent, where white would disappear', () => {
    for (const colour of ['#ffffff', '#ffe08a', '#c8f7c5', '#f6c7dd']) {
      expect(accentInk(colour)).toBe(ACCENT_INK_DARK);
    }
  });

  it('reads luminance rather than the hex digits: a saturated yellow is pale, a navy is not', () => {
    expect(accentInk('#ffd500')).toBe(ACCENT_INK_DARK);
    expect(accentInk('#0000ff')).toBe(ACCENT_INK_LIGHT);
  });

  it('falls back to white for anything it cannot parse', () => {
    for (const value of ['', 'blue', '#fff', '#12345', 'rgb(0,0,0)']) {
      expect(accentInk(value)).toBe(ACCENT_INK_LIGHT);
    }
  });
});
