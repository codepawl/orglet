import { useId, type CSSProperties, type ReactNode } from 'react';
import type { MascotId as SharedMascotId } from '../../shared/mascot-suggest';
import { t } from '../i18n';
import { BODY_BOX, bodyPath, bodyShapes, eyeShift, mascotShapes, type BodyShape, type BodyShapeId, type FaceId } from './orgletShapes';

/*
 * Orglet mascots, the Grok reading (owner's reference, 2026-09-21): the Orglet logo bubble in the worker's colour,
 * with two small white capsule eyes set high and a touch to one side, and no mouth (dark only on a very light
 * body, see `eyeColor`). Matte, naive 3D: one soft shade across the body and a faint contact shadow, nothing glossy.
 *
 * One orglet differs from another by the shape of its body and by its eyes, and by nothing worn (owner,
 * 2026-10-05): the hats, ties and headsets are gone, because a hat in the body's own colour needed a white rim and
 * the rim read as a mistake. The bodies are all the logo's speech bubble, with the small corner in another place or
 * with other proportions (`orgletShapes.ts`, which the 3D solid reads too). Expressions live in the eyes alone:
 * closed in a smile, one shut, half shut, narrowed, opened wide.
 *
 * 64×64 grid, viewed from y -1. `Mascot` sets --mascot-fill to a per-instance gradient in the avatar colour
 * (COD-131), so the body reads as a solid little object rather than a flat cut-out. The tones are mixed from
 * currentColor at render time, so a colour the user picked, near-white or near-black included, still shades in
 * both directions.
 */
// The eyes are white on every body, in both themes, the way Grok's are (owner, 2026-09-21), and only on a very light
// body (a near-white worker colour, or the brand mark in the dark theme) do they turn dark so they still show. The
// switch is a step on the body colour's lightness: above 0.78 the eye lightness is 0.25, below it 0.98.
export const eyeColor = 'oklch(from currentColor calc(0.25 + 0.73 * clamp(0, (0.78 - l) * 1000, 1)) 0 0)';
// The body paint: the shaded gradient inside `Mascot`, the flat avatar colour anywhere the art is drawn bare.
const body = 'var(--mascot-fill, currentColor)';
/** The logo's own bubble as a stroked outline, which the desktop cursor draws (`OrgletCursor.tsx`). */
export const bubbleOutline = 'M23.7 13h16.6a11.7 11.7 0 0 1 11.7 11.7v16.6a11.7 11.7 0 0 1-11.7 11.7H16.5a4.5 4.5 0 0 1-4.5-4.5V24.7a11.7 11.7 0 0 1 11.7-11.7z';

// The eyes: two upright capsules, high on the body and a little to the right, the way Grok's bots look. One group
// so a blink squashes both and a glance moves both (`.mascot-eyes`).
const eyeWidth = 4.4;
const eyeHeight = 9.5;
const eyeY = 27;
const eyeLeft = 30.5;
const eyeRight = 37.5;
const capsule = (x: number, y: number, height = eyeHeight) => <rect x={x - eyeWidth / 2} y={y - height / 2} width={eyeWidth} height={height} rx={eyeWidth / 2} fill={eyeColor} />;
const eyes = (dy = 0, height = eyeHeight) => <g className="mascot-eyes">{capsule(eyeLeft, eyeY + dy, height)}{capsule(eyeRight, eyeY + dy, height)}</g>;
const eyeStroke = { fill: 'none', stroke: eyeColor, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// Eyes closed in a smile: two small arches.
const smilingEyes = <path d={`M${eyeLeft - 3.25} ${eyeY + 1.5}q2.25-4 4.5 0M${eyeRight - 1.25} ${eyeY + 1.5}q2.25-4 4.5 0`} {...eyeStroke} />;
// A shut eye: a short flat capsule.
const shutEye = (x: number, y = eyeY) => <rect x={x - 3.5} y={y - 1.5} width={7} height={3} rx={1.5} fill={eyeColor} />;
const blush = (y = 35) => <><ellipse cx="22" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /><ellipse cx="45" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /></>;

/** Each expression, drawn for the logo's own body; `plain` is the default pair of eyes. */
const faces: Record<FaceId, ReactNode> = {
  plain: eyes(),
  happy: <>{smilingEyes}{blush(34)}</>,
  // Curious: one eye opens wider than the other, the way a raised eyebrow reads.
  curious: <g className="mascot-eyes">{capsule(eyeLeft + 1.5, eyeY - 1)}{capsule(eyeRight + 1.5, eyeY - 2.5, 12.5)}</g>,
  wink: <><g className="mascot-eyes">{capsule(eyeLeft, eyeY)}</g>{shutEye(eyeRight)}</>,
  sleepy: <>{shutEye(eyeLeft, eyeY + 2)}{shutEye(eyeRight, eyeY + 2)}</>,
  // Narrowed in attention: the same eyes, shorter.
  narrow: eyes(0.5, 6.5),
  delighted: <>{eyes(0.5, 12)}{blush(36)}</>,
};

/** A face moved to where its body's eyes sit: the tall body's eyes are higher, the wide one's lower. */
function faceOn(face: FaceId, shape: BodyShape): ReactNode {
  const { dx, dy } = eyeShift(shape);
  return dx || dy ? <g transform={`translate(${dx} ${dy})`}>{faces[face]}</g> : faces[face];
}

/* What a body and a face are called, for the picker's tooltip and its accessible name. */
const bodyNames: Record<BodyShapeId, () => string> = {
  base: () => t('Dáng gốc'),
  tailRight: () => t('Góc nhỏ bên phải'),
  tailTop: () => t('Góc nhỏ phía trên'),
  round: () => t('Tròn đều'),
  tall: () => t('Dáng cao'),
  wide: () => t('Dáng rộng'),
  leaf: () => t('Dáng lá'),
  soft: () => t('Dáng mềm'),
};
const faceNames: Record<FaceId, (() => string) | undefined> = {
  plain: undefined,
  happy: () => t('mắt cười'),
  curious: () => t('mắt tò mò'),
  wink: () => t('nháy mắt'),
  sleepy: () => t('mắt nhắm'),
  narrow: () => t('mắt chăm chú'),
  delighted: () => t('mắt mở to'),
};

type MascotEntry = { body: BodyShapeId; face: FaceId; art: ReactNode };
function define(id: SharedMascotId): MascotEntry {
  const { body: bodyId, face } = mascotShapes[id];
  const shape = bodyShapes[bodyId];
  return { body: bodyId, face, art: <><path d={bodyPath(shape)} fill={body} />{faceOn(face, shape)}</> };
}

export const mascots = Object.fromEntries((Object.keys(mascotShapes) as SharedMascotId[]).map(id => [id, define(id)])) as Record<SharedMascotId, MascotEntry>;

export type MascotId = keyof typeof mascots;
export const mascotIds = Object.keys(mascots) as MascotId[];
export const isMascot = (value: string | undefined): value is MascotId => !!value && Object.hasOwn(mascots, value);

/** A mascot's name in the app's language: its body, then its eyes when they are not the plain pair. */
export function mascotName(id: MascotId): string {
  const entry = mascots[id];
  const face = faceNames[entry.face];
  return face ? `${bodyNames[entry.body]()}, ${face()}` : bodyNames[entry.body]();
}

/*
 * The light on a mascot: matte and naive, after the owner's Grok Bot reference (2026-09-21). One broad, gentle
 * shade from a slightly lighter top left to a slightly darker bottom right, no gloss spot and no hard rim, and a
 * faint contact shadow underneath. Every tone is mixed from currentColor here rather than baked into the art,
 * because the colour is the user's choice; the mixes go both ways (towards white above, towards black below), so
 * a near-white colour still gains a darker bottom and a near-black one still gains a lit top.
 */
const lit = 'color-mix(in srgb, currentColor 86%, white)';
const shaded = 'color-mix(in srgb, currentColor 84%, black)';
const ground = 'color-mix(in srgb, currentColor 55%, black)';

function Light({ id }: { id: string }) {
  return <defs>
    <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={lit} />
      <stop offset=".5" stopColor="currentColor" />
      <stop offset="1" stopColor={shaded} />
    </linearGradient>
    <radialGradient id={`${id}-ground`}>
      <stop offset="0" stopColor={ground} stopOpacity=".22" />
      <stop offset="1" stopColor={ground} stopOpacity="0" />
    </radialGradient>
  </defs>;
}

/*
 * The small drawing (COD-154): in the sidebar, the roster and a byline the orglets are 16 to 20 pixels tall, and a
 * 64-unit drawing scaled down that far lands every edge and both eyes between pixels, which reads as a smudge at
 * device scale 1. So at those sizes the body and the plain eyes are drawn straight in pixels, on a canvas of a
 * fixed whole size, with the body's edges, the eye capsules and the gap between them on whole pixels, and the body
 * is flat (the matte shade only lowers the edge contrast at this size). Every body shape is placed the same way:
 * its box is scaled, rounded to whole pixels, centred, and stood on the same bottom line. An expressive face is
 * the large drawing scaled into place: its curves were never going to be pixel-aligned and they read fine. The
 * canvas is placed in the avatar box by the stylesheet with whole-pixel offsets.
 */
type SmallGlyph = { canvas: number; body: number; top: number; corner: number; tail: number; eye: { width: number; height: number; left: number; right: number; top: number } };
export const smallGlyphs = {
  // 16-pixel avatars (read receipts): a 12-pixel body with one-pixel eyes.
  tiny: { canvas: 16, body: 12, top: 3, corner: 4, tail: 2, eye: { width: 1, height: 3, left: 7, right: 9, top: 6 } },
  // Avatars of 20 to 24 pixels: a 16-pixel body with 2x4 eyes one pixel apart.
  small: { canvas: 24, body: 16, top: 5, corner: 5, tail: 2.5, eye: { width: 2, height: 4, left: 10, right: 13, top: 9 } },
  // 26-pixel avatars (a byline): a 20-pixel body with 2x5 eyes.
  medium: { canvas: 30, body: 20, top: 6, corner: 6, tail: 3, eye: { width: 2, height: 5, left: 13, right: 16, top: 11 } },
} satisfies Record<string, SmallGlyph>;
export type MascotGlyph = 'large' | keyof typeof smallGlyphs;

/** The logo's two radii on the 64 grid, which each glyph draws at the whole or half pixel it was tuned to. */
const LOGO_CORNER = bodyShapes.base.corners[0];
const LOGO_TAIL = bodyShapes.base.corners[3];

/** A body's box in a small glyph: whole pixels, centred on the canvas, its bottom on the line every body stands on. */
export function smallBodyBox(glyph: SmallGlyph, shape: BodyShape): { left: number; top: number; width: number; height: number; corners: number[] } {
  const scale = glyph.body / BODY_BOX.size;
  // The canvas is an even number of pixels wide, so an even width centres on whole pixels.
  const width = Math.round(shape.width * scale / 2) * 2;
  const top = glyph.top + Math.round((shape.top - BODY_BOX.top) * scale);
  const height = glyph.top + glyph.body - top;
  const corners = shape.corners.map(radius => {
    if (radius === LOGO_CORNER) return glyph.corner;
    if (radius === LOGO_TAIL) return glyph.tail;
    return Math.min(Math.round(radius * scale * 2) / 2, width / 2, height / 2);
  });
  return { left: (glyph.canvas - width) / 2, top, width, height, corners };
}

function smallBodyPath(glyph: SmallGlyph, shape: BodyShape) {
  const box = smallBodyBox(glyph, shape);
  const [topLeft, topRight, bottomRight, bottomLeft] = box.corners;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return [
    `M${box.left + topLeft} ${box.top}`, `H${right - topRight}`, `a${topRight} ${topRight} 0 0 1 ${topRight} ${topRight}`,
    `V${bottom - bottomRight}`, `a${bottomRight} ${bottomRight} 0 0 1 -${bottomRight} ${bottomRight}`,
    `H${box.left + bottomLeft}`, `a${bottomLeft} ${bottomLeft} 0 0 1 -${bottomLeft} -${bottomLeft}`,
    `V${box.top + topLeft}`, `a${topLeft} ${topLeft} 0 0 1 ${topLeft} -${topLeft}`, 'z',
  ].join('');
}

function smallArt(entry: MascotEntry, glyph: SmallGlyph) {
  const shape = bodyShapes[entry.body];
  const scale = glyph.body / BODY_BOX.size;
  const left = (glyph.canvas - glyph.body) / 2;
  // The large drawing's body box spans x 10..54 and y 11..55; this maps that box onto the small one.
  const placed = (node: ReactNode) => <g transform={`translate(${left - BODY_BOX.left * scale} ${glyph.top - BODY_BOX.top * scale}) scale(${scale})`}>{node}</g>;
  const eye = glyph.eye;
  // The plain eyes move with the body's box by whole pixels.
  const eyeTop = eye.top + Math.round(eyeShift(shape).dy * scale);
  const plainEyes = <g className="mascot-eyes">
    <rect x={eye.left} y={eyeTop} width={eye.width} height={eye.height} rx={eye.width / 2} fill={eyeColor} />
    <rect x={eye.right} y={eyeTop} width={eye.width} height={eye.height} rx={eye.width / 2} fill={eyeColor} />
  </g>;
  return <>
    <path d={smallBodyPath(glyph, shape)} fill="currentColor" />
    {entry.face === 'plain' ? plainEyes : placed(faceOn(entry.face, shape))}
  </>;
}

/**
 * One mascot as an inline SVG. `glyph` picks the drawing: `large` is the 64-unit art with the matte light (the
 * picker, a chat heading, the avatar editor), `small` and `medium` are the pixel-snapped drawings for the list
 * sizes. The gradient ids come from `useId`, because many mascots sit on one page and a `url(#…)` shared between
 * them would paint every face in the colour of the first one rendered.
 */
export function Mascot({ id, glyph = 'large' }: { id: MascotId; glyph?: MascotGlyph }) {
  // The id is reduced to word characters: React's ids carry punctuation that a url() fragment may not survive.
  const lightId = `mascot-${useId().replace(/\W/g, '')}`;
  if (glyph !== 'large') {
    const small = smallGlyphs[glyph];
    return <svg className={`mascot mascot-${glyph}`} overflow="visible" viewBox={`0 0 ${small.canvas} ${small.canvas}`} aria-hidden="true" focusable="false">
      {smallArt(mascots[id], small)}
    </svg>;
  }
  const style = { '--mascot-fill': `url(#${lightId}-body)` } as CSSProperties;
  return <svg className="mascot mascot-large" overflow="visible" viewBox="0 -1 64 66" style={style} aria-hidden="true" focusable="false">
    <Light id={lightId} />
    <ellipse className="mascot-ground" cx="32" cy="57.5" rx="17" ry="3" fill={`url(#${lightId}-ground)`} />
    {mascots[id].art}
  </svg>;
}
