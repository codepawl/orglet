/**
 * The one colour the user picks for the app. It draws the @name tags, the switch that is on, a checked box and
 * the primary button — the places where colour means "this is yours". It is deliberately not `--primary`, which
 * is ink rather than a brand colour: near-black in light, near-white in dark, and used for toasts and text.
 *
 * COD-250: the default is the old #4f7fe0 at the same OKLCH hue and chroma, with the lightness taken down from 0.610
 * to 0.572, the smallest step that carries white text at 4.5:1 (4.53:1; the old blue gave 3.86:1).
 */
export const DEFAULT_ACCENT_COLOR = '#4473d3';

/**
 * The default before COD-250. Settings saved any accent the window was showing, so most workspaces hold this value
 * without anyone having picked it; it also sat in the swatch row. It reads as the current default.
 */
export const PREVIOUS_DEFAULT_ACCENT_COLOR = '#4f7fe0';

/** WCAG's bar for body text, which is what a button label, a count badge and a mention are. */
export const READABLE_CONTRAST = 4.5;

export const ACCENT_INK_LIGHT = '#ffffff';
export const ACCENT_INK_DARK = '#171717';
/** Only for the narrow band of accents where neither white nor the near-black reaches 4.5:1. */
export const ACCENT_INK_BLACK = '#000000';

type Rgb = [number, number, number];
export type ThemeName = 'light' | 'dark';

/**
 * The page and text colours of each theme, as `--bg` and `--text` in styles.css. The accent's text colour is worked
 * out against them, because it has to be known before the sheet can use it.
 */
const THEME_COLORS: Record<ThemeName, { page: string; text: string }> = {
  light: { page: '#ffffff', text: '#1f1f1f' },
  dark: { page: '#212121', text: '#ececec' },
};

/** How much of the accent the person's message bubble holds (`--ask-wash` in styles.css). */
const BUBBLE_WASH_SHARE = 0.18;
/** How much of the accent a mention's own background adds on top of whatever it sits on (`.mention`). */
const MENTION_WASH_SHARE = 0.14;
/** How far each try moves the accent's text colour toward the theme's text colour. */
const TEXT_MIX_STEP = 0.05;

/** The three channels of a #rrggbb colour, 0-255. Returns undefined for anything that is not six hex digits. */
function channels(color: string): Rgb | undefined {
  const hex = color.trim().replace('#', '');
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

function toHex(color: Rgb): string {
  const pairs = color.map(channel => channel.toString(16).padStart(2, '0'));
  return `#${pairs.join('')}`;
}

/** WCAG relative luminance: how much light the colour actually carries, not how bright it looks in hex. */
function luminance([red, green, blue]: Rgb) {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrastOf(one: Rgb, two: Rgb) {
  const first = luminance(one);
  const second = luminance(two);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** `share` of `color` over `base`, the way `color-mix(in srgb, color share, base)` mixes them. */
function mix(color: Rgb, base: Rgb, share: number): Rgb {
  return color.map((channel, index) => channel * share + base[index] * (1 - share)) as Rgb;
}

/** The WCAG contrast ratio between two #rrggbb colours, or undefined when either cannot be read. */
export function contrastRatio(one: string, two: string): number | undefined {
  const first = channels(one);
  const second = channels(two);
  if (!first || !second) return undefined;
  return contrastOf(first, second);
}

/** The accent as the app draws it today: the old default blue is the current default, anything else is kept. */
export function currentAccentColor(color: string): string {
  return color.trim().toLowerCase() === PREVIOUS_DEFAULT_ACCENT_COLOR ? DEFAULT_ACCENT_COLOR : color;
}

/**
 * What to draw on top of the accent: white while white reads at 4.5:1, otherwise a dark ink that does. A pale pick
 * would otherwise leave a white arrow on a white send button, and a mid-tone one a label nobody can read.
 *
 * The house near-black is tried first; pure black takes over only for the mid-tones where the near-black falls just
 * short, because between them white and black always reach 4.5:1 on any colour. Falls back to white for anything
 * unparseable.
 */
export function accentInk(color: string): string {
  const accent = channels(color);
  if (!accent) return ACCENT_INK_LIGHT;
  if (contrastOf(accent, channels(ACCENT_INK_LIGHT)!) >= READABLE_CONTRAST) return ACCENT_INK_LIGHT;
  if (contrastOf(accent, channels(ACCENT_INK_DARK)!) >= READABLE_CONTRAST) return ACCENT_INK_DARK;
  return ACCENT_INK_BLACK;
}

/**
 * The colour of accent-coloured text in one theme, such as a @mention: the accent itself where it reads at 4.5:1,
 * otherwise the accent moved toward the theme's text colour just far enough. It is checked on the strongest wash
 * the text can sit on, a mention's background inside the person's own message bubble; every other place has less
 * of the accent behind it. Anything unparseable reads as the default accent.
 */
export function accentText(color: string, theme: ThemeName): string {
  const accent = channels(color) ?? channels(DEFAULT_ACCENT_COLOR)!;
  const page = channels(THEME_COLORS[theme].page)!;
  const text = channels(THEME_COLORS[theme].text)!;
  const bubble = mix(accent, page, BUBBLE_WASH_SHARE);
  const background = mix(accent, bubble, MENTION_WASH_SHARE);
  for (let step = 0; step * TEXT_MIX_STEP < 1; step++) {
    // Rounded before it is measured, so the hex handed to the sheet is the colour that passed.
    const candidate = mix(text, accent, step * TEXT_MIX_STEP).map(Math.round) as Rgb;
    if (contrastOf(candidate, background) >= READABLE_CONTRAST) return toHex(candidate);
  }
  return THEME_COLORS[theme].text;
}
