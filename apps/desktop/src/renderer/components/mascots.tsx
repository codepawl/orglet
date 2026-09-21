import { useId, type CSSProperties, type ReactNode } from 'react';

/*
 * Orglet mascots: little characters built from the Orglet logo itself, the rounded speech bubble with a small
 * bottom-left corner, drawn with the same round strokes. Each one changes only the expression and one small
 * accessory, so the set reads as one family. 64×64 grid, viewed from y -1 so a hat worn on the head fits above the
 * bubble. Strokes outside the body use currentColor (the avatar colour); the body and anything worn on it are
 * painted with --mascot-fill, and everything inside the body is drawn in --mascot-ink.
 *
 * `Mascot` sets --mascot-fill to a per-instance gradient in the avatar colour (COD-131), so the body reads as a
 * solid little object rather than a flat cut-out: lit from the top left, darker along the bottom-right rim, a soft
 * gloss near the top and a contact shadow underneath. The tones are mixed from currentColor at render time, so a
 * colour the user picked, near-white or near-black included, still shades in both directions.
 */
const stroke = { fill: 'none', stroke: 'var(--mascot-ink, #fff)', strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// Outside the bubble the ink colour is the page colour, so an antenna or a headband drawn with `stroke` is
// invisible. Anything that leaves the body is drawn in the mascot colour instead (COD-106).
const outside = { ...stroke, stroke: 'currentColor' } as const;
// The body paint: the shaded gradient inside `Mascot`, the flat avatar colour anywhere the art is drawn bare.
const body = 'var(--mascot-fill, currentColor)';
// The logo bubble (apps/desktop/assets/icon.svg) scaled onto the 64 grid and widened slightly for a face. Fill and
// stroke share the body paint so the outline is part of the same shaded shape rather than a ring around it.
export const bubbleOutline = 'M24 13h16a13 13 0 0 1 13 13v16a13 13 0 0 1-13 13H16a5 5 0 0 1-5-5V26a13 13 0 0 1 13-13z';
// The gloss sits on the bubble and under the face, so it lights the body without washing out an eye.
const bubble = <>
  <path d={bubbleOutline} fill={body} stroke={body} strokeWidth="4" strokeLinejoin="round" />
  <ellipse className="mascot-gloss" cx="24.5" cy="23.5" rx="8" ry="5.5" fill="var(--mascot-gloss, none)" />
</>;
// The pair is one group so a blink can squash both together. Mascots that draw their own eyes — glasses, a wink,
// closed sleepy eyes — keep them and simply never blink, which is what you would want of them anyway.
const dots = (y = 32, left = 26, right = 38) => <g className="mascot-eyes"><circle cx={left} cy={y} r="2.6" fill="var(--mascot-ink, #fff)" /><circle cx={right} cy={y} r="2.6" fill="var(--mascot-ink, #fff)" /></g>;
const smile = (y = 38, width = 7) => <path d={`M${32 - width / 2} ${y}q${width / 2} ${width * 0.45} ${width} 0`} {...stroke} strokeWidth={3} />;
const face = <>{dots(32)}{smile(38)}</>;
// Anything worn on the head: the shape in the body paint, rimmed with the page ground so it reads over the bubble.
const worn = { fill: body, stroke: 'var(--mascot-ink, #fff)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
const blush = (y = 38) => <><ellipse cx="20" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /><ellipse cx="44" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /></>;

export const mascots = {
  classic: { name: 'Cổ điển', art: <>{bubble}<circle cx="32" cy="34" r="6" {...stroke} /></> },
  happy: { name: 'Vui vẻ', art: <>{bubble}<path d="M22.5 32q3.5-4 7 0M34.5 32q3.5-4 7 0" {...stroke} strokeWidth={3} />{smile(37.5, 9)}{blush(37)}</> },
  curious: { name: 'Tò mò', art: <>{bubble}{dots(31)}<circle cx="32" cy="40" r="2.6" {...stroke} strokeWidth={2.6} /></> },
  wink: { name: 'Nháy mắt', art: <>{bubble}<circle cx="26" cy="32" r="2.6" fill="var(--mascot-ink, #fff)" /><path d="M35 32h6" {...stroke} strokeWidth={3} />{smile(38)}</> },
  sleepy: { name: 'Buồn ngủ', art: <>{bubble}<path d="M22.5 33q3.5 2.5 7 0M34.5 33q3.5 2.5 7 0" {...stroke} strokeWidth={3} /><path d="M30 40h4" {...stroke} strokeWidth={3} /><path d="M49 6h5l-5 5h5" {...outside} strokeWidth={2.4} /></> },
  focused: { name: 'Đeo kính', art: <>{bubble}<circle cx="25" cy="33" r="4.6" {...stroke} strokeWidth={2.8} /><circle cx="39" cy="33" r="4.6" {...stroke} strokeWidth={2.8} /><path d="M29.6 33h4.8" {...stroke} strokeWidth={2.4} />{smile(41, 6)}</> },
  antenna: { name: 'Ăng-ten', art: <>{bubble}<path d="M32 13V6" {...outside} /><circle cx="32" cy="5" r="3" fill="#ff8fa3" />{dots(32)}{smile(38)}</> },
  sprout: { name: 'Mầm cây', art: <>{bubble}<path d="M32 13V7" {...outside} strokeWidth={3} /><path d="M32 8c-2-4-7-5-9-3 2 4 6 5 9 3zM32 8c2-4 7-5 9-3-2 4-6 5-9 3z" fill="#5fb878" />{dots(32)}{smile(38)}</> },
  idea: { name: 'Ý tưởng', art: <>{bubble}<circle cx="32" cy="34" r="6" {...stroke} /><path d="M52 4v7M48.5 7.5h7" {...stroke} strokeWidth={2.6} stroke="#f2b33d" /></> },
  headset: { name: 'Tai nghe', art: <><path d="M9 34a23 23 0 0 1 46 0" {...outside} strokeWidth={3.2} />{bubble}<rect x="4" y="30" width="7" height="12" rx="3.5" {...worn} /><rect x="53" y="30" width="7" height="12" rx="3.5" {...worn} />{dots(32)}{smile(38)}</> },
  delighted: { name: 'Thích thú', art: <>{bubble}{dots(31)}<path d="M26 37h12a6 6 0 0 1-12 0z" fill="var(--mascot-ink, #fff)" />{blush(36)}</> },
  cool: { name: 'Ngầu', art: <>{bubble}<path d="M19 29h26v3.5a4.5 4.5 0 0 1-4.5 4.5h-3a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 21 32.5z" fill="var(--mascot-ink, #fff)" /><path d="M29 42h7" {...stroke} strokeWidth={3} /></> },
  // Office and roles: a hat or accessory worn on the head.
  tie: { name: 'Cà vạt', art: <>{bubble}{dots(29)}{smile(35)}<path d="M29.5 42h5l-1.2 2.4 1.9 6.6L32 54l-3.2-3 1.9-6.6z" fill="var(--mascot-ink, #fff)" /></> },
  bowtie: { name: 'Nơ', art: <>{bubble}{dots(29)}{smile(35)}<path d="M23.5 41.5 31 45l-7.5 3.5zM40.5 41.5 33 45l7.5 3.5z" fill="var(--mascot-ink, #fff)" stroke="var(--mascot-ink, #fff)" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="32" cy="45" r="2.4" fill="var(--mascot-ink, #fff)" /></> },
  briefcase: { name: 'Mũ phớt', art: <>{bubble}{face}<path d="M22 13.5c0-6.5 3-9 10-9s10 2.5 10 9" {...worn} /><path d="M15.5 13.5h33" {...worn} /></> },
  calendar: { name: 'Mũ lưỡi trai', art: <>{bubble}{face}<path d="M21.5 13.5a10.5 10 0 0 1 21 0z" {...worn} /><path d="M42.5 13.5h8.5a2.2 2.2 0 0 0 0-4.4H41" {...worn} /></> },
  mail: { name: 'Mũ giấy', art: <>{bubble}{face}<path d="M17.5 13.5 32 3l14.5 10.5z" {...worn} /><path d="M24 13.5 32 7l8 6.5" {...worn} strokeWidth={1.6} /></> },
  finance: { name: 'Mũ chóp', art: <>{bubble}{face}<path d="M23.5 13.5V3.5h17v10z" {...worn} /><path d="M16 13.5h32" {...worn} /></> },

  search: { name: 'Mũ thám tử', art: <>{bubble}{face}<path d="M21 13.5a11 10 0 0 1 22 0z" {...worn} /><path d="M14.5 13.5h35" {...worn} /><path d="M18 8.5a4 4 0 0 0 0 5M46 8.5a4 4 0 0 1 0 5" {...worn} strokeWidth={1.8} /></> },
  chart: { name: 'Mũ tốt nghiệp', art: <>{bubble}{face}<path d="M13.5 8.5 32 2.5l18.5 6L32 14.5z" {...worn} /><path d="M46.5 10v5.5" {...worn} strokeWidth={1.8} /></> },
  target: { name: 'Băng đô', art: <>{bubble}{face}<path d="M18.5 13a15 12 0 0 1 27 0" {...worn} strokeWidth={2.2} /><circle cx="44" cy="7.5" r="3" {...worn} /></> },
  writer: { name: 'Mũ nồi', art: <>{bubble}{face}<path d="M20 12.5c0-6.5 5.5-9 12-9s12 2.5 12 9z" {...worn} /><circle cx="43" cy="4" r="2.4" {...worn} /></> },
  notes: { name: 'Mũ tai bèo', art: <>{bubble}{face}<path d="M21 11.5a11 9 0 0 1 22 0z" {...worn} /><path d="M15 11.5h34a4 3 0 0 1-4 3.5H19a4 3 0 0 1-4-3.5z" {...worn} /></> },
  megaphone: { name: 'Mũ sinh nhật', art: <>{bubble}{face}<path d="M32 1.5 43 13.5H21z" {...worn} /><circle cx="32" cy="1.5" r="2.6" {...worn} /></> },
  checker: { name: 'Vương miện', art: <>{bubble}{face}<path d="M20 13.5 21.5 3l6 5.5L32 1l4.5 7.5 6-5.5L44 13.5z" {...worn} /></> },
  guard: { name: 'Mũ bảo hộ', art: <>{bubble}{face}<path d="M21 13.5a11 10.5 0 0 1 22 0z" {...worn} /><path d="M15 13.5h34" {...worn} /><path d="M32 3.5v9" {...worn} strokeWidth={1.8} /></> },
  coder: { name: 'Mũ len', art: <>{bubble}{face}<path d="M22 12a10 9.5 0 0 1 20 0z" {...worn} /><path d="M19.5 12h25v3h-25z" {...worn} /><circle cx="32" cy="2.5" r="2.6" {...worn} /></> },
  automation: { name: 'Mũ chong chóng', art: <>{bubble}{face}<path d="M22.5 13.5a9.5 9 0 0 1 19 0z" {...worn} /><path d="M23 5.5h18" {...worn} strokeWidth={2.2} /><path d="M32 5.5v5" {...worn} strokeWidth={1.8} /></> },
  care: { name: 'Mũ y tá', art: <>{bubble}{face}<path d="M22 13.5v-8h20v8z" {...worn} /><path d="M29.5 9.5h5M32 7v5" {...worn} strokeWidth={2} stroke="var(--mascot-ink, #fff)" /></> },
} satisfies Record<string, { name: string; art: ReactNode }>;

export type MascotId = keyof typeof mascots;
export const mascotIds = Object.keys(mascots) as MascotId[];
export const isMascot = (value: string | undefined): value is MascotId => !!value && Object.hasOwn(mascots, value);

/*
 * The light on a mascot. The body gradient is in the bounding box of whatever it paints, so a hat lit by it gets
 * its own highlight in its own corner. Every tone is mixed from currentColor here rather than baked into the art,
 * because the colour is the user's choice. The mixes go both ways (towards white above, towards black below), so
 * a near-white colour still gains a darker rim and a near-black one still gains a lit top.
 */
const lit = 'color-mix(in srgb, currentColor 72%, white)';
const shaded = 'color-mix(in srgb, currentColor 74%, black)';
const ground = 'color-mix(in srgb, currentColor 55%, black)';

function Light({ id }: { id: string }) {
  return <defs>
    <radialGradient id={`${id}-body`} cx=".38" cy=".28" r=".8">
      <stop offset="0" stopColor={lit} />
      <stop offset=".48" stopColor="currentColor" />
      <stop offset="1" stopColor={shaded} />
    </radialGradient>
    <radialGradient id={`${id}-gloss`}>
      <stop offset="0" stopColor="white" stopOpacity=".42" />
      <stop offset="1" stopColor="white" stopOpacity="0" />
    </radialGradient>
    <radialGradient id={`${id}-ground`}>
      <stop offset="0" stopColor={ground} stopOpacity=".38" />
      <stop offset="1" stopColor={ground} stopOpacity="0" />
    </radialGradient>
  </defs>;
}

/**
 * One mascot as an inline SVG. The gradient ids come from `useId`, because many mascots sit on one page and a
 * `url(#…)` shared between them would paint every face in the colour of the first one rendered.
 */
export function Mascot({ id }: { id: MascotId }) {
  // The id is reduced to word characters: React's ids carry punctuation that a url() fragment may not survive.
  const lightId = `mascot-${useId().replace(/\W/g, '')}`;
  const style = { '--mascot-fill': `url(#${lightId}-body)`, '--mascot-gloss': `url(#${lightId}-gloss)` } as CSSProperties;
  return <svg className="mascot" overflow="visible" viewBox="0 -1 64 66" style={style} aria-hidden="true" focusable="false">
    <Light id={lightId} />
    <ellipse className="mascot-ground" cx="32" cy="57.5" rx="17" ry="3" fill={`url(#${lightId}-ground)`} />
    {mascots[id].art}
  </svg>;
}
