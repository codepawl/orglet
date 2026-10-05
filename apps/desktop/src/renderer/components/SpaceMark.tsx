import type { CSSProperties } from 'react';

/**
 * A space's tile on the rail (user, 2026-10-05): a filled mark with the space's initials, so a space reads as a place
 * of the person's own and not as one of the rail's icons. The fill is a gradient picked from the space's id, the same
 * one every time, with no yellow pair because the initials are white. A colour the space carries replaces it.
 */

/** Hue pairs of the gradients, start and end. Each keeps white initials readable at the lightness in `styles.css`. */
const HUE_PAIRS: readonly (readonly [number, number])[] = [
  [262, 296], [224, 262], [200, 232], [172, 204], [146, 176], [12, 344], [338, 300], [24, 2], [288, 328], [208, 170],
];

/** A small stable number from a string, enough to pick one of a few pairs. */
function seedNumber(seed: string): number {
  let total = 0;
  for (const character of seed) total = (total * 31 + character.codePointAt(0)!) % 100_003;
  return total;
}

export function spaceHues(seed: string): readonly [number, number] {
  return HUE_PAIRS[seedNumber(seed) % HUE_PAIRS.length];
}

/** Up to two initials: the first letters of the first two words, or the first two letters of a single word. */
export function spaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join('').toLocaleUpperCase();
}

export function SpaceMark({ name, seed, color }: { name: string; seed: string; color?: string }) {
  const [from, to] = spaceHues(seed);
  const style = color ? { background: color } : { '--space-hue-from': from, '--space-hue-to': to } as CSSProperties;
  return <span className="space-mark" style={style} aria-hidden="true">{spaceInitials(name)}</span>;
}
