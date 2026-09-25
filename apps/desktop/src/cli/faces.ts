import { eyeColorFor, isHexColor, NEUTRAL_COLOR, paint, type ColorMode } from './terminal';

/**
 * Orglets drawn in a terminal (COD-236): the Orglet logo bubble of the app's small glyphs (`smallGlyphs` in
 * renderer/components/mascots.tsx) redrawn by hand on a pixel grid. Each text row holds two pixel rows through the
 * half blocks ▀ and ▄, so a pixel is about square. The body is a square with round corners and a small, square corner
 * at the bottom left (the speech bubble's tail); two upright capsule eyes sit high and half a pixel right of centre;
 * there is no mouth. Expressions live in the eyes alone, as in the app.
 */

/**
 * open: looking ahead. blink: shut to a line through the middle, as the app's blink squashes the eyes. left, right: a
 * glance. happy: the squint when an answer lands.
 */
export type FaceFrame = 'open' | 'blink' | 'left' | 'right' | 'happy';

const EMPTY = 0;
const BODY = 1;
const EYE = 2;
type Pixel = typeof EMPTY | typeof BODY | typeof EYE;

/**
 * The 10x10 body. Top corners and the bottom right are rounded two pixels deep; the bottom left stays square, which
 * is how the logo's small corner reads at this size.
 */
const BODY_ROWS = [
  '..######..',
  '.########.',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '##########',
  '#########.',
  '########..',
];

export const FACE_WIDTH = BODY_ROWS[0].length;
export const FACE_HEIGHT = BODY_ROWS.length / 2;

/** Eye columns for each gaze. Looking ahead they sit at 4 and 6 of 0..9, half a pixel right of the body's middle. */
const EYE_COLUMNS: Record<Exclude<FaceFrame, 'blink' | 'happy'>, readonly [number, number]> = {
  open: [4, 6],
  left: [3, 5],
  right: [5, 7],
};
/** The eyes take pixel rows 2 and 3, the second text row: high on the body. */
const EYE_TOP = 2;
const EYE_BOTTOM = 3;
/**
 * Closed eyes are finer than a pixel, so they are glyphs in the eye colour on the body: a line through the middle for
 * a blink, a caret for the smile.
 */
const CLOSED_EYES: Partial<Record<FaceFrame, string>> = { blink: '─', happy: '^' };

function bodyPixels(): Pixel[][] {
  return BODY_ROWS.map(row => [...row].map(mark => (mark === '#' ? BODY : EMPTY)));
}

function eyeColumns(frame: FaceFrame): readonly [number, number] {
  if (frame === 'blink' || frame === 'happy') return EYE_COLUMNS.open;
  return EYE_COLUMNS[frame];
}

/** The pixel grid of one frame. Closed eyes are not pixels; `faceCells` draws them as glyphs. */
export function facePixels(frame: FaceFrame): Pixel[][] {
  const pixels = bodyPixels();
  if (CLOSED_EYES[frame]) return pixels;
  for (const column of eyeColumns(frame)) {
    for (let row = EYE_TOP; row <= EYE_BOTTOM; row += 1) pixels[row][column] = EYE;
  }
  return pixels;
}

/** One character cell: its glyph, the colours of its foreground and background, if any, and whether it is bold. */
export type FaceCell = { character: string; foreground?: string; background?: string; bold?: boolean };

type Palette = { body: string; eye: string };

function paletteFor(color: string | undefined): Palette {
  const body = isHexColor(color) ? color : NEUTRAL_COLOR;
  return { body, eye: eyeColorFor(body) };
}

function pixelColor(pixel: Pixel, palette: Palette): string | undefined {
  if (pixel === BODY) return palette.body;
  if (pixel === EYE) return palette.eye;
  return undefined;
}

/**
 * Two stacked pixels as one cell. A full cell is a space on a coloured background rather than █, so no terminal
 * leaves a seam between rows; a half is ▀ or ▄ in the pixel's colour over the other pixel's colour.
 */
function cellOf(top: Pixel, bottom: Pixel, palette: Palette): FaceCell {
  const topColor = pixelColor(top, palette);
  const bottomColor = pixelColor(bottom, palette);
  if (!topColor && !bottomColor) return { character: ' ' };
  if (topColor === bottomColor) return { character: ' ', background: topColor };
  if (!topColor) return { character: '▄', foreground: bottomColor };
  if (!bottomColor) return { character: '▀', foreground: topColor };
  return { character: '▀', foreground: topColor, background: bottomColor };
}

/** The big face as rows of cells in the given body colour; a missing or malformed colour draws the neutral face. */
export function faceCells(color: string | undefined, frame: FaceFrame = 'open'): FaceCell[][] {
  const palette = paletteFor(color);
  const pixels = facePixels(frame);
  const rows: FaceCell[][] = [];
  for (let row = 0; row < FACE_HEIGHT; row += 1) {
    const top = pixels[row * 2];
    const bottom = pixels[row * 2 + 1];
    rows.push(top.map((pixel, column) => cellOf(pixel, bottom[column], palette)));
  }
  const closed = CLOSED_EYES[frame];
  if (closed) {
    const eyeRow = EYE_TOP / 2;
    for (const column of EYE_COLUMNS.open) rows[eyeRow][column] = { character: closed, foreground: palette.eye, background: palette.body, bold: true };
  }
  return rows;
}

function paintCell(cell: FaceCell, mode: ColorMode): string {
  return paint(cell.character, { foreground: cell.foreground, background: cell.background, bold: cell.bold }, mode);
}

/** The big face as text lines, FACE_WIDTH columns each. Faces are only drawn in colour; callers skip them otherwise. */
export function renderFace(color: string | undefined, frame: FaceFrame, mode: ColorMode): string[] {
  return faceCells(color, frame).map(row => row.map(cell => paintCell(cell, mode)).join(''));
}

/** Eye glyphs of the one-row face: dots looking ahead, the same closed eyes as the big face otherwise. */
const MINI_EYES: Record<FaceFrame, string> = { open: '•', left: '•', right: '•', blink: '─', happy: '^' };

export const MINI_FACE_WIDTH = 4;

/** The one-row face for lists and bylines: ▐••▌, the body in its colour with the two eyes on it. */
export function miniFaceCells(color: string | undefined, frame: FaceFrame = 'open'): FaceCell[] {
  const palette = paletteFor(color);
  const eye: FaceCell = { character: MINI_EYES[frame], foreground: palette.eye, background: palette.body, bold: true };
  return [
    { character: '▐', foreground: palette.body },
    eye,
    { ...eye },
    { character: '▌', foreground: palette.body },
  ];
}

export function renderMiniFace(color: string | undefined, mode: ColorMode, frame: FaceFrame = 'open'): string {
  return miniFaceCells(color, frame).map(cell => paintCell(cell, mode)).join('');
}

/** Several one-row faces side by side, a crew's members; the half blocks leave a gap between neighbours. */
export function renderMiniFaces(colors: readonly (string | undefined)[], mode: ColorMode): string {
  return colors.map(color => renderMiniFace(color, mode)).join('');
}

/**
 * One loop of the waiting face, a frame per tick: mostly still, a blink, a glance to the left and to the right, and a
 * second blink, so the face looks alive without fidgeting.
 */
export const WAITING_FRAMES: readonly FaceFrame[] = [
  'open', 'open', 'open', 'open', 'open', 'open', 'open', 'open', 'blink', 'open', 'open', 'open', 'open',
  'left', 'left', 'left', 'left', 'open', 'open', 'right', 'right', 'right', 'right', 'open', 'open', 'open',
  'open', 'open', 'blink', 'open', 'open', 'open',
];
/** One tick of the waiting face: a blink lasts one tick, as short as the app's. */
export const FRAME_MILLISECONDS = 150;
