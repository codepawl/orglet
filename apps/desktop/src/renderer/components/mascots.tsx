import { useId, type CSSProperties, type ReactNode } from 'react';
import type { MascotId as SharedMascotId } from '../../shared/mascot-suggest';

/*
 * Orglet mascots, the Grok reading (owner's reference, 2026-09-21): the Orglet logo bubble, the rounded speech
 * bubble with a small bottom-left corner at the logo's proportions, in the worker's colour, with two small
 * white capsule eyes set high and a touch to one side, and no mouth (dark only on a very light body, see `eyeColor`). Matte, naive 3D: one soft shade
 * across the body and a faint contact shadow, nothing glossy. Expressions are sparing and live in the eyes
 * alone: closed in a smile, one shut, half shut, ringed by glasses, covered by a visor. Each mascot adds at most
 * one small accessory. 64×64 grid, viewed from y -1 so a hat worn on the head fits above the body. Strokes
 * outside the body use currentColor (the avatar colour); the body and anything worn on it are painted with
 * --mascot-fill, and everything inside the body is drawn in --mascot-ink.
 *
 * `Mascot` sets --mascot-fill to a per-instance gradient in the avatar colour (COD-131), so the body reads as a
 * solid little object rather than a flat cut-out. The tones are mixed from currentColor at render time, so a
 * colour the user picked, near-white or near-black included, still shades in both directions.
 */
const ink = 'var(--mascot-ink, #fff)';
// The eyes are white on every body, in both themes, the way Grok's are (owner, 2026-09-21), and only on a very light
// body (a near-white worker colour, or the brand mark in the dark theme) do they turn dark so they still show. The
// switch is a step on the body colour's lightness: above 0.78 the eye lightness is 0.25, below it 0.98.
export const eyeColor = 'oklch(from currentColor calc(0.25 + 0.73 * clamp(0, (0.78 - l) * 1000, 1)) 0 0)';
const stroke = { fill: 'none', stroke: ink, strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// A stroke that belongs to the eyes (an arch, a lens ring) takes the eye colour.
const eyeStroke = { ...stroke, stroke: eyeColor } as const;
// Outside the body the ink colour is the page colour, so an antenna or a headband drawn with `stroke` is
// invisible. Anything that leaves the body is drawn in the mascot colour instead (COD-106).
const outside = { ...stroke, stroke: 'currentColor' } as const;
// The body paint: the shaded gradient inside `Mascot`, the flat avatar colour anywhere the art is drawn bare.
const body = 'var(--mascot-fill, currentColor)';
// The logo bubble scaled onto the 64 grid at the logo's proportions: a square, a 31% corner radius and a 15%
// corner at the bottom left, 44 wide from x 10 to 54 and y 11 to 55 once the stroke is on.
// Where the body sits on the 64 grid once its stroke is on: x 10..54, y 11..55.
const bodyLeft = 10;
const bodyTop = 11;
const bodyWidth = 44;
export const bubbleOutline = 'M23.7 13h16.6a11.7 11.7 0 0 1 11.7 11.7v16.6a11.7 11.7 0 0 1-11.7 11.7H16.5a4.5 4.5 0 0 1-4.5-4.5V24.7a11.7 11.7 0 0 1 11.7-11.7z';
const bubble = <path d={bubbleOutline} fill={body} stroke={body} strokeWidth="4" strokeLinejoin="round" />;

// The eyes: two upright capsules, high on the body and a little to the right, the way Grok's bots look. One group
// so a blink squashes both and a glance moves both (`.mascot-eyes`). `dx`/`dy` set where a mascot looks by default.
const eyeWidth = 4.4;
const eyeHeight = 9.5;
const eyeY = 27;
const eyeLeft = 30.5;
const eyeRight = 37.5;
const capsule = (x: number, y: number, height = eyeHeight) => <rect x={x - eyeWidth / 2} y={y - height / 2} width={eyeWidth} height={height} rx={eyeWidth / 2} fill={eyeColor} />;
const eyes = (dx = 0, dy = 0, height = eyeHeight) => <g className="mascot-eyes">{capsule(eyeLeft + dx, eyeY + dy, height)}{capsule(eyeRight + dx, eyeY + dy, height)}</g>;
const face = eyes();
// Eyes closed in a smile: two small arches.
const smilingEyes = <path d={`M${eyeLeft - 3.25} ${eyeY + 1.5}q2.25-4 4.5 0M${eyeRight - 1.25} ${eyeY + 1.5}q2.25-4 4.5 0`} {...eyeStroke} strokeWidth={3} />;
// A shut eye: a short flat capsule.
const shutEye = (x: number, y = eyeY) => <rect x={x - 3.5} y={y - 1.5} width={7} height={3} rx={1.5} fill={eyeColor} />;
// Anything worn on the head: the shape in the body paint, rimmed with the page ground so it reads over the body.
const worn = { fill: body, stroke: ink, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
const blush = (y = 35) => <><ellipse cx="22" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /><ellipse cx="45" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /></>;
// Sunglasses: a dark band over the eyes, rimmed in ink so it reads on any body colour.
const shades = <rect x="20" y={eyeY - 6} width="28" height="12" rx="5" fill="color-mix(in srgb, currentColor 40%, black)" stroke={ink} strokeWidth="2" />;

/*
 * A mascot is drawn in parts so it can be composed twice: `behind` sits behind the body (a headset band), `face`
 * replaces the default eyes, `wear` is the accessory. `art` is the large drawing on the 64 grid; the small,
 * pixel-snapped drawing is composed in `Mascot` from the same parts.
 */
type MascotParts = { behind?: ReactNode; face?: ReactNode; wear?: ReactNode };
type MascotEntry = MascotParts & { name: string; art: ReactNode };
const define = (name: string, parts: MascotParts): MascotEntry => ({ name, ...parts, art: <>{parts.behind}{bubble}{parts.face ?? face}{parts.wear}</> });

export const mascots = {
  classic: define('Cổ điển', {  }),
  happy: define('Vui vẻ', { face: <>{smilingEyes}{blush(34)}</> }),
  // Curious: one eye opens wider than the other, the way a raised eyebrow reads.
  curious: define('Tò mò', { face: <><g className="mascot-eyes">{capsule(eyeLeft + 1.5, eyeY - 1)}{capsule(eyeRight + 1.5, eyeY - 2.5, 12.5)}</g></> }),
  wink: define('Nháy mắt', { face: <><g className="mascot-eyes">{capsule(eyeLeft, eyeY)}</g>{shutEye(eyeRight)}</> }),
  sleepy: define('Buồn ngủ', { face: <>{shutEye(eyeLeft, eyeY + 2)}{shutEye(eyeRight, eyeY + 2)}</>, wear: <><path d="M49 6h5l-5 5h5" {...outside} strokeWidth={2.4} /></> }),
  focused: define('Đeo kính', { face: <>{eyes(0, 0, 7.5)}<circle cx={eyeLeft} cy={eyeY} r="6.2" {...eyeStroke} strokeWidth={2.2} /><circle cx={eyeRight} cy={eyeY} r="6.2" {...eyeStroke} strokeWidth={2.2} /></> }),
  antenna: define('Ăng-ten', { wear: <><path d="M32 13V6" {...outside} /><circle cx="32" cy="5" r="3" fill="#ff8fa3" /></> }),
  sprout: define('Mầm cây', { wear: <><path d="M32 13V7" {...outside} strokeWidth={3} /><path d="M32 8c-2-4-7-5-9-3 2 4 6 5 9 3zM32 8c2-4 7-5 9-3-2 4-6 5-9 3z" fill="#5fb878" /></> }),
  idea: define('Ý tưởng', { wear: <><path d="M52 4v7M48.5 7.5h7" {...stroke} strokeWidth={2.6} stroke="#f2b33d" /></> }),
  headset: define('Tai nghe', { behind: <><path d="M9 34a23 23 0 0 1 46 0" {...outside} strokeWidth={3.2} /></>, wear: <><rect x="4" y="30" width="7" height="12" rx="3.5" {...worn} /><rect x="53" y="30" width="7" height="12" rx="3.5" {...worn} /></> }),
  delighted: define('Thích thú', { face: <>{eyes(0, 0.5, 12)}{blush(36)}</> }),
  cool: define('Ngầu', { face: <>{shades}</> }),
  // Office and roles: a hat or accessory worn on the head.
  tie: define('Cà vạt', { wear: <><path d="M29.5 42h5l-1.2 2.4 1.9 6.6L32 54l-3.2-3 1.9-6.6z" fill={ink} /></> }),
  bowtie: define('Nơ', { wear: <><path d="M23.5 41.5 31 45l-7.5 3.5zM40.5 41.5 33 45l7.5 3.5z" fill={ink} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" /><circle cx="32" cy="45" r="2.4" fill={ink} /></> }),
  briefcase: define('Mũ phớt', { wear: <><path d="M22 13.5c0-6.5 3-9 10-9s10 2.5 10 9" {...worn} /><path d="M15.5 13.5h33" {...worn} /></> }),
  calendar: define('Mũ lưỡi trai', { wear: <><path d="M21.5 13.5a10.5 10 0 0 1 21 0z" {...worn} /><path d="M42.5 13.5h8.5a2.2 2.2 0 0 0 0-4.4H41" {...worn} /></> }),
  mail: define('Mũ giấy', { wear: <><path d="M17.5 13.5 32 3l14.5 10.5z" {...worn} /><path d="M24 13.5 32 7l8 6.5" {...worn} strokeWidth={1.6} /></> }),
  finance: define('Mũ chóp', { wear: <><path d="M23.5 13.5V3.5h17v10z" {...worn} /><path d="M16 13.5h32" {...worn} /></> }),

  search: define('Mũ thám tử', { wear: <><path d="M21 13.5a11 10 0 0 1 22 0z" {...worn} /><path d="M14.5 13.5h35" {...worn} /><path d="M18 8.5a4 4 0 0 0 0 5M46 8.5a4 4 0 0 1 0 5" {...worn} strokeWidth={1.8} /></> }),
  chart: define('Mũ tốt nghiệp', { wear: <><path d="M13.5 8.5 32 2.5l18.5 6L32 14.5z" {...worn} /><path d="M46.5 10v5.5" {...worn} strokeWidth={1.8} /></> }),
  target: define('Băng đô', { wear: <><path d="M18.5 13a15 12 0 0 1 27 0" {...worn} strokeWidth={2.2} /><circle cx="44" cy="7.5" r="3" {...worn} /></> }),
  writer: define('Mũ nồi', { wear: <><path d="M20 12.5c0-6.5 5.5-9 12-9s12 2.5 12 9z" {...worn} /><circle cx="43" cy="4" r="2.4" {...worn} /></> }),
  notes: define('Mũ tai bèo', { wear: <><path d="M21 11.5a11 9 0 0 1 22 0z" {...worn} /><path d="M15 11.5h34a4 3 0 0 1-4 3.5H19a4 3 0 0 1-4-3.5z" {...worn} /></> }),
  megaphone: define('Mũ sinh nhật', { wear: <><path d="M32 1.5 43 13.5H21z" {...worn} /><circle cx="32" cy="1.5" r="2.6" {...worn} /></> }),
  checker: define('Vương miện', { wear: <><path d="M20 13.5 21.5 3l6 5.5L32 1l4.5 7.5 6-5.5L44 13.5z" {...worn} /></> }),
  guard: define('Mũ bảo hộ', { wear: <><path d="M21 13.5a11 10.5 0 0 1 22 0z" {...worn} /><path d="M15 13.5h34" {...worn} /><path d="M32 3.5v9" {...worn} strokeWidth={1.8} /></> }),
  coder: define('Mũ len', { wear: <><path d="M22 12a10 9.5 0 0 1 20 0z" {...worn} /><path d="M19.5 12h25v3h-25z" {...worn} /><circle cx="32" cy="2.5" r="2.6" {...worn} /></> }),
  automation: define('Mũ chong chóng', { wear: <><path d="M22.5 13.5a9.5 9 0 0 1 19 0z" {...worn} /><path d="M23 5.5h18" {...worn} strokeWidth={2.2} /><path d="M32 5.5v5" {...worn} strokeWidth={1.8} /></> }),
  care: define('Mũ y tá', { wear: <><path d="M22 13.5v-8h20v8z" {...worn} /><path d="M29.5 9.5h5M32 7v5" {...worn} strokeWidth={2} stroke={ink} /></> }),
  // The same ids as `MASCOT_IDS` in shared/mascot-suggest.ts, which main uses to pick a default colour.
} satisfies Record<SharedMascotId, MascotEntry>;

export type MascotId = keyof typeof mascots;
export const mascotIds = Object.keys(mascots) as MascotId[];
export const isMascot = (value: string | undefined): value is MascotId => !!value && Object.hasOwn(mascots, value);

/*
 * The light on a mascot: matte and naive, after the owner's Grok Bot reference (2026-09-21). One broad, gentle
 * shade from a slightly lighter top left to a slightly darker bottom right, no gloss spot and no hard rim, and a
 * faint contact shadow underneath. The body gradient is in the bounding box of whatever it paints, so a hat lit by
 * it takes the same light in its own corner. Every tone is mixed from currentColor here rather than baked into the
 * art, because the colour is the user's choice; the mixes go both ways (towards white above, towards black below),
 * so a near-white colour still gains a darker bottom and a near-black one still gains a lit top.
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
 * device scale 1. So at those sizes the body and the eyes are drawn straight in pixels, on a canvas of a fixed
 * whole size, with the body's edges, the eye capsules and the gap between them on whole pixels, and the body is
 * flat (the matte shade only lowers the edge contrast at this size). A hat, a badge or an expressive face is the
 * large drawing scaled into place: their curves were never going to be pixel-aligned and they read fine. The
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

function smallBodyPath(glyph: SmallGlyph) {
  const left = (glyph.canvas - glyph.body) / 2;
  const right = left + glyph.body;
  const top = glyph.top;
  const bottom = top + glyph.body;
  const corner = glyph.corner;
  const tail = glyph.tail;
  return [
    `M${left + corner} ${top}`, `H${right - corner}`, `a${corner} ${corner} 0 0 1 ${corner} ${corner}`,
    `V${bottom - corner}`, `a${corner} ${corner} 0 0 1 -${corner} ${corner}`,
    `H${left + tail}`, `a${tail} ${tail} 0 0 1 -${tail} -${tail}`,
    `V${top + corner}`, `a${corner} ${corner} 0 0 1 ${corner} -${corner}`, 'z',
  ].join('');
}

function smallArt(entry: MascotEntry, glyph: SmallGlyph) {
  const scale = glyph.body / bodyWidth;
  const left = (glyph.canvas - glyph.body) / 2;
  // The large drawing's body spans x 10..54 and y 11..55; this maps that box onto the small body.
  const placed = (node: ReactNode) => node ? <g transform={`translate(${left - bodyLeft * scale} ${glyph.top - bodyTop * scale}) scale(${scale})`}>{node}</g> : null;
  const eye = glyph.eye;
  const eyes = <g className="mascot-eyes">
    <rect x={eye.left} y={eye.top} width={eye.width} height={eye.height} rx={eye.width / 2} fill={eyeColor} />
    <rect x={eye.right} y={eye.top} width={eye.width} height={eye.height} rx={eye.width / 2} fill={eyeColor} />
  </g>;
  return <>
    {placed(entry.behind)}
    <path d={smallBodyPath(glyph)} fill="currentColor" />
    {entry.face ? placed(entry.face) : eyes}
    {placed(entry.wear)}
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
