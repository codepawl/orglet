import { describe, expect, it } from 'vitest';
import {
  ACCENT_INK_BLACK, ACCENT_INK_DARK, ACCENT_INK_LIGHT, accentInk, accentText, contrastRatio, currentAccentColor,
  DEFAULT_ACCENT_COLOR, PREVIOUS_DEFAULT_ACCENT_COLOR, READABLE_CONTRAST,
} from '../../apps/desktop/src/shared/accent';
import { avatarPalette } from '../../apps/desktop/src/shared/mascot-suggest';

/** Every colour on a coarse grid of the sRGB cube, 17 steps a channel, as #rrggbb. */
function colourGrid(): string[] {
  const steps = Array.from({ length: 16 }, (_, index) => index * 17);
  const colours: string[] = [];
  for (const red of steps) {
    for (const green of steps) {
      for (const blue of steps) {
        colours.push(`#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`);
      }
    }
  }
  return colours;
}

/** The strongest wash a mention sits on in `theme`: its own background inside the person's message bubble. */
function mentionBackground(accent: string, theme: 'light' | 'dark'): string {
  const page = theme === 'light' ? [255, 255, 255] : [33, 33, 33];
  const accentChannels = [1, 3, 5].map(at => parseInt(accent.slice(at, at + 2), 16));
  const bubble = accentChannels.map((channel, index) => channel * 0.18 + page[index] * 0.82);
  const background = accentChannels.map((channel, index) => channel * 0.14 + bubble[index] * 0.86);
  return `#${background.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

describe('the default accent', () => {
  it('is the old blue a step darker, and carries white text at 4.5:1', () => {
    expect(DEFAULT_ACCENT_COLOR).toBe('#4473d3');
    expect(contrastRatio(DEFAULT_ACCENT_COLOR, '#ffffff')).toBeGreaterThanOrEqual(READABLE_CONTRAST);
    expect(contrastRatio(PREVIOUS_DEFAULT_ACCENT_COLOR, '#ffffff')).toBeLessThan(READABLE_CONTRAST);
    expect(accentInk(DEFAULT_ACCENT_COLOR)).toBe(ACCENT_INK_LIGHT);
  });

  it('replaces the old default wherever it was saved, and keeps any other pick', () => {
    expect(currentAccentColor('#4f7fe0')).toBe(DEFAULT_ACCENT_COLOR);
    expect(currentAccentColor('#4F7FE0')).toBe(DEFAULT_ACCENT_COLOR);
    expect(currentAccentColor('#3f9a68')).toBe('#3f9a68');
    expect(currentAccentColor(DEFAULT_ACCENT_COLOR)).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('leaves the orglets\' own palette alone: its blue is an identity colour, not the accent', () => {
    expect(avatarPalette).toContain(PREVIOUS_DEFAULT_ACCENT_COLOR);
  });
});

describe('accentInk', () => {
  it('keeps white on an accent white reads on', () => {
    for (const colour of ['#171717', '#2e7a32', '#a82626', '#0000ff', DEFAULT_ACCENT_COLOR]) {
      expect(accentInk(colour)).toBe(ACCENT_INK_LIGHT);
    }
  });

  it('turns dark on an accent where white falls short of 4.5:1, including the old default', () => {
    for (const colour of ['#ffffff', '#ffe08a', '#c8f7c5', '#f6c7dd', '#ffd500', PREVIOUS_DEFAULT_ACCENT_COLOR, '#d97757']) {
      expect(accentInk(colour)).toBe(ACCENT_INK_DARK);
    }
  });

  it('uses pure black only in the band where the near-black falls short too', () => {
    expect(contrastRatio('#7b7b7b', ACCENT_INK_LIGHT)).toBeLessThan(READABLE_CONTRAST);
    expect(contrastRatio('#7b7b7b', ACCENT_INK_DARK)).toBeLessThan(READABLE_CONTRAST);
    expect(accentInk('#7b7b7b')).toBe(ACCENT_INK_BLACK);
  });

  it('always reaches 4.5:1, whatever the accent', () => {
    for (const colour of colourGrid()) {
      expect(contrastRatio(colour, accentInk(colour)), colour).toBeGreaterThanOrEqual(READABLE_CONTRAST);
    }
  });

  it('falls back to white for anything it cannot parse', () => {
    for (const value of ['', 'blue', '#fff', '#12345', 'rgb(0,0,0)']) {
      expect(accentInk(value)).toBe(ACCENT_INK_LIGHT);
    }
  });
});

describe('accentText', () => {
  it('draws a mention readable on its wash in both themes, for the default accent', () => {
    for (const theme of ['light', 'dark'] as const) {
      const text = accentText(DEFAULT_ACCENT_COLOR, theme);
      expect(contrastRatio(text, mentionBackground(DEFAULT_ACCENT_COLOR, theme)), theme).toBeGreaterThanOrEqual(READABLE_CONTRAST);
    }
  });

  it('stays readable in both themes for every accent on the grid', () => {
    for (const colour of colourGrid()) {
      for (const theme of ['light', 'dark'] as const) {
        expect(contrastRatio(accentText(colour, theme), mentionBackground(colour, theme)), `${colour} ${theme}`).toBeGreaterThanOrEqual(READABLE_CONTRAST);
      }
    }
  });

  it('keeps the accent itself when it already reads, and moves only as far as it must', () => {
    expect(accentText('#1f3f8f', 'light')).toBe('#1f3f8f');
    expect(accentText('#ffd500', 'dark')).toBe('#ffd500');
    const moved = accentText(DEFAULT_ACCENT_COLOR, 'light');
    expect(moved).not.toBe(DEFAULT_ACCENT_COLOR);
    expect(contrastRatio(moved, '#1f1f1f')).toBeGreaterThan(1.5);
  });

  it('reads anything it cannot parse as the default accent', () => {
    expect(accentText('blue', 'light')).toBe(accentText(DEFAULT_ACCENT_COLOR, 'light'));
  });
});
