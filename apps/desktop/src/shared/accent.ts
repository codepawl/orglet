/**
 * The one colour the user picks for the app. It draws the @name tags, the switch that is on, a checked box and
 * the primary button — the places where colour means "this is yours". It is deliberately not `--primary`, which
 * is ink rather than a brand colour: near-black in light, near-white in dark, and used for toasts and text.
 */
export const DEFAULT_ACCENT_COLOR = '#4f7fe0';

/** One channel of a #rrggbb colour, 0-255. Returns undefined for anything that is not six hex digits. */
function channels(color: string): [number, number, number] | undefined {
  const hex = color.trim().replace('#', '');
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance: how much light the colour actually carries, not how bright it looks in hex. */
function luminance([red, green, blue]: [number, number, number]) {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

const contrast = (one: number, two: number) => (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);

export const ACCENT_INK_LIGHT = '#ffffff';
export const ACCENT_INK_DARK = '#171717';

/**
 * What to draw on top of the accent: white while white still reads, near-black once it stops. Without this a pale
 * pick leaves a white arrow on a white send button.
 *
 * The bar is 3:1, WCAG's threshold for large text and for graphics, which is what sits on the accent — a send
 * arrow, a tick, a button label. Picking whichever of the two has *more* contrast would be the stricter-sounding
 * rule and the wrong one: it puts black on the default blue, where white is both legible and what the app has
 * always drawn. Falls back to white for anything unparseable, which is what the default accent uses.
 */
export function accentInk(color: string): string {
  const parsed = channels(color);
  if (!parsed) return ACCENT_INK_LIGHT;
  const onWhite = contrast(luminance(parsed), luminance([255, 255, 255]));
  return onWhite >= 3 ? ACCENT_INK_LIGHT : ACCENT_INK_DARK;
}
