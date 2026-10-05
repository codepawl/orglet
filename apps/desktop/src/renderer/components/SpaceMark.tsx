import type { CSSProperties } from 'react';

/**
 * A space's tile on the rail (user, 2026-10-05): a filled mark with no letter on it, so a space reads as a place of
 * the person's own and not as one of the rail's icons. The fill is a dithered gradient between two colours picked
 * from the space's id, the same ones every time, gathering in one of four corners. The tile's tooltip and accessible name say which space it is. A
 * colour the space carries replaces the pair, and the dither then darkens it.
 */

/** A small stable number from a string, enough to pick one of a few pairs. */
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

/** Which corner the second colour gathers in, one of four, so two spaces of near hues still differ. */
export function spaceDitherFlip(seed: string): readonly [number, number] {
  const corner = Math.floor(seedNumber(seed) / 7) % 4;
  return [corner % 2 === 0 ? 1 : -1, corner < 2 ? 1 : -1];
}

/** The tile is this many dither cells on a side: 3px cells on the rail's 42px tile. */
export const DITHER_CELLS = 14;
/** The 4x4 Bayer matrix: the order in which the cells of each block switch to the second colour. */
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/** Whether a cell takes the second colour: an ordered dither of a gradient from the top left to the bottom right. */
export function ditherCellOn(column: number, row: number): boolean {
  const along = (column + row) / (2 * (DITHER_CELLS - 1));
  const threshold = (BAYER[row % 4][column % 4] + 0.5) / 16;
  return along > threshold;
}

function ditherPath(): string {
  const cells: string[] = [];
  for (let row = 0; row < DITHER_CELLS; row += 1) {
    for (let column = 0; column < DITHER_CELLS; column += 1) {
      if (ditherCellOn(column, row)) cells.push(`M${column} ${row}h1v1h-1z`);
    }
  }
  return cells.join('');
}

/** One path for every mark: the pattern is the same, only the two colours differ. */
const DITHER_PATH = ditherPath();

export function SpaceMark({ seed, color }: { seed: string; color?: string }) {
  const [from, to] = spaceHues(seed);
  const [flipX, flipY] = spaceDitherFlip(seed);
  const colours: Record<string, string | number> = color ? { '--space-mark-from': color, '--space-mark-to': '#0000004d' } : { '--space-hue-from': from, '--space-hue-to': to };
  const style = colours as CSSProperties;
  return <span className="space-mark" style={style} aria-hidden="true">
    <svg className="space-mark-dither" viewBox={`0 0 ${DITHER_CELLS} ${DITHER_CELLS}`} preserveAspectRatio="none" focusable="false" style={{ transform: `scale(${flipX}, ${flipY})` }}><path d={DITHER_PATH} /></svg>
  </span>;
}
