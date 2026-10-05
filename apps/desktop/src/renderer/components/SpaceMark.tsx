import type { CSSProperties } from 'react';

/**
 * A space's tile on the rail (user, 2026-10-05): a filled mark with no letter on it, so a space reads as a place of
 * the person's own and not as one of the rail's icons. The fill is a gradient shaded the way the app's mascots are,
 * lit from the top left, between two colours picked from the space's id, the same ones every time. The tile's name
 * shows beside it under the pointer. A colour the space carries replaces the pair.
 */

/** A small stable number from a string. */
function seedNumber(seed: string): number {
  let total = 0;
  for (const character of seed) total = (total * 31 + character.codePointAt(0)!) % 100_003;
  return total;
}

/**
 * The two hues of a space's fill: any hue of the wheel, and a second one a little further round. With no letter on
 * the tile the fill alone tells spaces apart, so the whole wheel is used and not a short list of pairs.
 */
export function spaceHues(seed: string): readonly [number, number] {
  const number = seedNumber(seed);
  const from = number % 360;
  const step = 28 + (Math.floor(number / 360) % 5) * 9;
  return [from, (from + step) % 360];
}

export function SpaceMark({ seed, color }: { seed: string; color?: string }) {
  const [from, to] = spaceHues(seed);
  const colours: Record<string, string | number> = color
    ? { '--space-mark-from': color, '--space-mark-to': `color-mix(in srgb, ${color} 68%, black)` }
    : { '--space-hue-from': from, '--space-hue-to': to };
  return <span className="space-mark" style={colours as CSSProperties} aria-hidden="true" />;
}
