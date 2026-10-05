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

/*
 * How round a body is (owner, 2026-10-05: the bodies read as boxes; make them blobs, with the top, the bottom and
 * the sides curved). A body is a rounded box drawn part of the way towards the ellipse that fits the same box:
 * at 0 it is the box, at 1 the ellipse. The ellipse touches the box at the middle of each side, so on the way the
 * straight sides bow and the corners round, while the body still fills its box and still stands on its bottom
 * line. The small corner stays the squarest one, which is what keeps a body the logo's kin.
 */
export const BODY_ROUNDNESS = 0.3;

/** How many points draw one side between two corners, so it can bow. */
const SIDE_STEPS = 7;

/**
 * A body's outline on the 64 grid, clockwise from the top left corner: the points of its four corner arcs and,
 * when the body is rounded, of each side between them. `inset` shrinks the whole outline by that distance, which
 * the 3D solid uses for the rings of its rolled edge. Both drawings take their body from here.
 */
export function bodyOutlinePoints(shape: BodyShape, inset = 0, roundness = BODY_ROUNDNESS): [number, number][] {
  const left = shape.left + inset;
  const top = shape.top + inset;
  const right = shape.left + shape.width - inset;
  const bottom = shape.top + shape.height - inset;
  const halfWidth = (right - left) / 2;
  const halfHeight = (bottom - top) / 2;
  const centreX = left + halfWidth;
  const centreY = top + halfHeight;
  // A corner smaller than the inset keeps a sliver of a radius, and none is bigger than the box allows.
  const [topLeft, topRight, bottomRight, bottomLeft] = shape.corners.map(radius => Math.min(Math.max(radius - inset, 0.6), halfWidth, halfHeight));
  const arcs: [number, number, number, number][] = [
    [left + topLeft, top + topLeft, topLeft, Math.PI],
    [right - topRight, top + topRight, topRight, Math.PI * 1.5],
    [right - bottomRight, bottom - bottomRight, bottomRight, 0],
    [left + bottomLeft, bottom - bottomLeft, bottomLeft, Math.PI / 2],
  ];
  const corners = arcs.map(([arcX, arcY, radius, startAngle]) => {
    const steps = radius > 9 ? 10 : 6;
    return Array.from({ length: steps + 1 }, (_, index): [number, number] => {
      const angle = startAngle + (Math.PI / 2) * (index / steps);
      return [arcX + radius * Math.cos(angle), arcY + radius * Math.sin(angle)];
    });
  });
  if (roundness <= 0) return corners.flat();
  const points: [number, number][] = [];
  corners.forEach((corner, index) => {
    points.push(...corner);
    // The straight side from this corner's end to the next corner's start, as points that can bow.
    const from = corner[corner.length - 1];
    const to = corners[(index + 1) % corners.length][0];
    for (let step = 1; step < SIDE_STEPS; step++) points.push([from[0] + (to[0] - from[0]) * step / SIDE_STEPS, from[1] + (to[1] - from[1]) * step / SIDE_STEPS]);
  });
  return points.map(([x, y]) => {
    const across = (x - centreX) / halfWidth;
    const down = (y - centreY) / halfHeight;
    const distance = Math.hypot(across, down);
    if (distance === 0) return [x, y];
    // The point of the fitted ellipse on the same ray from the centre.
    const ellipseX = centreX + (x - centreX) / distance;
    const ellipseY = centreY + (y - centreY) / distance;
    return [x + (ellipseX - x) * roundness, y + (ellipseY - y) * roundness];
  });
}

const rounded = (value: number) => Math.round(value * 100) / 100;

/** The body as one closed SVG path on the 64 grid: the outline's points joined, which at these sizes is the curve. */
export function bodyPath(shape: BodyShape): string {
  return `M${bodyOutlinePoints(shape).map(([x, y]) => `${rounded(x)} ${rounded(y)}`).join('L')}Z`;
}

/**
 * Where the eyes sit on a body: the logo's place on the square bodies, moved with the box on the tall and the wide
 * one so the eyes keep the same distance from the top edge.
 */
export function eyeShift(shape: BodyShape): { dx: number; dy: number } {
  return { dx: 0, dy: shape.top - BODY_BOX.top };
}
