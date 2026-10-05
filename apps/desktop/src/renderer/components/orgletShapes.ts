import type { MascotId } from '../../shared/mascot-suggest';

/*
 * What tells one orglet from another (owner, 2026-10-05): the shape of its body and its eyes, and nothing worn. The
 * hats, ties and headsets the faces used to carry are gone: a hat in the body's colour needed a white rim to read,
 * and the rim read as a mistake. Every body is the logo's speech bubble (family A of the owner's three choices), so
 * each orglet is still the mark's kin; they differ in which corner is the small one and in their proportions.
 *
 * The flat drawings (`mascots.tsx`), the 3D solid (`orgletSolid.ts`) and their small pixel glyphs all read this one
 * table, so a body has the same shape wherever it is drawn.
 */

/** The 64-unit grid's body box: the logo bubble spans x 10..54 and y 11..55, centred on (32, 33). */
export const BODY_BOX = { left: 10, top: 11, size: 44, centreX: 32, centreY: 33 } as const;

/**
 * A body on the 64 grid: its box, and a radius for each corner clockwise from the top left. Every box ends at y 55,
 * so all orglets stand on one line.
 */
export type BodyShape = { left: number; top: number; width: number; height: number; corners: readonly [number, number, number, number] };

export const bodyShapes = {
  /** The logo itself: three big corners and the small one at the bottom left. */
  base: { left: 10, top: 11, width: 44, height: 44, corners: [13.7, 13.7, 13.7, 6.5] },
  tailRight: { left: 10, top: 11, width: 44, height: 44, corners: [13.7, 13.7, 6.5, 13.7] },
  tailTop: { left: 10, top: 11, width: 44, height: 44, corners: [6.5, 13.7, 13.7, 13.7] },
  round: { left: 10, top: 11, width: 44, height: 44, corners: [16.5, 16.5, 16.5, 16.5] },
  tall: { left: 15, top: 7, width: 34, height: 48, corners: [15, 15, 15, 6] },
  wide: { left: 5, top: 17, width: 54, height: 38, corners: [14.5, 14.5, 14.5, 6] },
  leaf: { left: 10, top: 11, width: 44, height: 44, corners: [20, 6.5, 20, 6.5] },
  soft: { left: 10, top: 11, width: 44, height: 44, corners: [21, 21, 21, 9] },
} as const satisfies Record<string, BodyShape>;
export type BodyShapeId = keyof typeof bodyShapes;
export const bodyShapeIds = Object.keys(bodyShapes) as BodyShapeId[];

/** The eyes' expressions, all of them in the eyes alone: nothing is worn on the face either. */
export type FaceId = 'plain' | 'happy' | 'curious' | 'wink' | 'sleepy' | 'narrow' | 'delighted';

/**
 * Every mascot as a body and a face. The ids are the ones orglets already carry (`MASCOT_IDS`), so nothing saved
 * has to change; an id that used to name a hat now names a shape. No two share both a body and a face.
 */
export const mascotShapes: Record<MascotId, { body: BodyShapeId; face: FaceId }> = {
  classic: { body: 'base', face: 'plain' },
  happy: { body: 'round', face: 'happy' },
  curious: { body: 'tall', face: 'curious' },
  wink: { body: 'tailRight', face: 'wink' },
  sleepy: { body: 'wide', face: 'sleepy' },
  focused: { body: 'soft', face: 'narrow' },
  antenna: { body: 'tailTop', face: 'plain' },
  sprout: { body: 'leaf', face: 'plain' },
  idea: { body: 'round', face: 'plain' },
  headset: { body: 'wide', face: 'plain' },
  delighted: { body: 'leaf', face: 'delighted' },
  cool: { body: 'tailTop', face: 'narrow' },
  tie: { body: 'tall', face: 'plain' },
  bowtie: { body: 'soft', face: 'plain' },
  briefcase: { body: 'tailRight', face: 'plain' },
  calendar: { body: 'base', face: 'happy' },
  mail: { body: 'tailRight', face: 'happy' },
  finance: { body: 'tall', face: 'happy' },
  search: { body: 'base', face: 'curious' },
  chart: { body: 'wide', face: 'curious' },
  target: { body: 'round', face: 'curious' },
  writer: { body: 'soft', face: 'happy' },
  notes: { body: 'leaf', face: 'happy' },
  megaphone: { body: 'tailTop', face: 'delighted' },
  checker: { body: 'round', face: 'delighted' },
  guard: { body: 'base', face: 'narrow' },
  coder: { body: 'tailRight', face: 'curious' },
  automation: { body: 'tall', face: 'wink' },
  care: { body: 'wide', face: 'happy' },
};

/** The body as one closed SVG path on the 64 grid. */
export function bodyPath(shape: BodyShape): string {
  const { left, top, width, height } = shape;
  const [topLeft, topRight, bottomRight, bottomLeft] = shape.corners;
  const right = left + width;
  const bottom = top + height;
  return [
    `M${left + topLeft} ${top}`, `H${right - topRight}`, `A${topRight} ${topRight} 0 0 1 ${right} ${top + topRight}`,
    `V${bottom - bottomRight}`, `A${bottomRight} ${bottomRight} 0 0 1 ${right - bottomRight} ${bottom}`,
    `H${left + bottomLeft}`, `A${bottomLeft} ${bottomLeft} 0 0 1 ${left} ${bottom - bottomLeft}`,
    `V${top + topLeft}`, `A${topLeft} ${topLeft} 0 0 1 ${left + topLeft} ${top}`, 'Z',
  ].join('');
}

/**
 * Where the eyes sit on a body: the logo's place on the square bodies, moved with the box on the tall and the wide
 * one so the eyes keep the same distance from the top edge.
 */
export function eyeShift(shape: BodyShape): { dx: number; dy: number } {
  return { dx: 0, dy: shape.top - BODY_BOX.top };
}
