import type { ReactNode } from 'react';

/*
 * Orglet mascots: little characters built from the Orglet logo itself, the rounded speech bubble with a small
 * bottom-left corner, drawn with the same round strokes. Each one changes only the expression and one small
 * accessory, so the set reads as one family. 64×64 grid, viewed 6 units lower so the bubble lines up with the text beside it; strokes use currentColor (the avatar's ink colour) and the
 * bubble fill uses --mascot-fill, so light and dark themes both work.
 */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// The logo bubble (apps/desktop/assets/icon.svg) scaled onto the 64 grid and widened slightly for a face.
const bubble = <path d="M24 13h16a13 13 0 0 1 13 13v16a13 13 0 0 1-13 13H16a5 5 0 0 1-5-5V26a13 13 0 0 1 13-13z" fill="var(--mascot-fill, #fff)" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />;
const dots = (y = 32, left = 26, right = 38) => <><circle cx={left} cy={y} r="2.6" fill="currentColor" /><circle cx={right} cy={y} r="2.6" fill="currentColor" /></>;
const smile = (y = 38, width = 7) => <path d={`M${32 - width / 2} ${y}q${width / 2} ${width * 0.45} ${width} 0`} {...stroke} strokeWidth={3} />;
// A work badge in the top-right corner (the bottom-right corner is left for the provider mark): a solid disc in the
// mascot's ink with a small glyph drawn in the bubble fill, centred on (50, 15).
const ink = { fill: 'none', stroke: 'var(--mascot-fill, #fff)', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const face = <>{dots(32)}{smile(38)}</>;
const tag = (glyph: ReactNode) => <><circle cx="50" cy="15" r="10.5" fill="currentColor" stroke="var(--mascot-fill, #fff)" strokeWidth="2.5" />{glyph}</>;
const blush = (y = 38) => <><ellipse cx="20" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /><ellipse cx="44" cy={y} rx="3" ry="1.8" fill="#ff8fa3" opacity=".6" /></>;

export const mascots = {
  classic: { name: 'Cổ điển', art: <>{bubble}<circle cx="32" cy="34" r="6" {...stroke} /></> },
  happy: { name: 'Vui vẻ', art: <>{bubble}<path d="M22.5 32q3.5-4 7 0M34.5 32q3.5-4 7 0" {...stroke} strokeWidth={3} />{smile(37.5, 9)}{blush(37)}</> },
  curious: { name: 'Tò mò', art: <>{bubble}{dots(31)}<circle cx="32" cy="40" r="2.6" {...stroke} strokeWidth={2.6} /></> },
  wink: { name: 'Nháy mắt', art: <>{bubble}<circle cx="26" cy="32" r="2.6" fill="currentColor" /><path d="M35 32h6" {...stroke} strokeWidth={3} />{smile(38)}</> },
  sleepy: { name: 'Buồn ngủ', art: <>{bubble}<path d="M22.5 33q3.5 2.5 7 0M34.5 33q3.5 2.5 7 0" {...stroke} strokeWidth={3} /><path d="M30 40h4" {...stroke} strokeWidth={3} /><path d="M49 6h5l-5 5h5" {...stroke} strokeWidth={2.4} /></> },
  focused: { name: 'Đeo kính', art: <>{bubble}<circle cx="25" cy="33" r="4.6" {...stroke} strokeWidth={2.8} /><circle cx="39" cy="33" r="4.6" {...stroke} strokeWidth={2.8} /><path d="M29.6 33h4.8" {...stroke} strokeWidth={2.4} />{smile(41, 6)}</> },
  antenna: { name: 'Ăng-ten', art: <>{bubble}<path d="M32 13V6" {...stroke} /><circle cx="32" cy="5" r="3" fill="#ff8fa3" />{dots(32)}{smile(38)}</> },
  sprout: { name: 'Mầm cây', art: <>{bubble}<path d="M32 13V7" {...stroke} strokeWidth={3} /><path d="M32 8c-2-4-7-5-9-3 2 4 6 5 9 3zM32 8c2-4 7-5 9-3-2 4-6 5-9 3z" fill="#5fb878" />{dots(32)}{smile(38)}</> },
  idea: { name: 'Ý tưởng', art: <>{bubble}<circle cx="32" cy="34" r="6" {...stroke} /><path d="M52 4v7M48.5 7.5h7" {...stroke} strokeWidth={2.6} stroke="#f2b33d" /></> },
  headset: { name: 'Tai nghe', art: <><path d="M9 34a23 23 0 0 1 46 0" {...stroke} strokeWidth={3.2} />{bubble}<rect x="4" y="30" width="7" height="12" rx="3.5" fill="currentColor" /><rect x="53" y="30" width="7" height="12" rx="3.5" fill="currentColor" />{dots(32)}{smile(38)}</> },
  delighted: { name: 'Thích thú', art: <>{bubble}{dots(31)}<path d="M26 37h12a6 6 0 0 1-12 0z" fill="currentColor" />{blush(36)}</> },
  cool: { name: 'Ngầu', art: <>{bubble}<path d="M19 29h26v3.5a4.5 4.5 0 0 1-4.5 4.5h-3a4.5 4.5 0 0 1-4.5-4.5 4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 21 32.5z" fill="currentColor" /><path d="M29 42h7" {...stroke} strokeWidth={3} /></> },
  // Office: something worn, or a work badge.
  tie: { name: 'Cà vạt', art: <>{bubble}{dots(29)}{smile(35)}<path d="M29.5 42h5l-1.2 2.4 1.9 6.6L32 54l-3.2-3 1.9-6.6z" fill="currentColor" /></> },
  bowtie: { name: 'Nơ', art: <>{bubble}{dots(29)}{smile(35)}<path d="M23.5 41.5 31 45l-7.5 3.5zM40.5 41.5 33 45l7.5 3.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="32" cy="45" r="2.4" fill="currentColor" /></> },
  briefcase: { name: 'Cặp tài liệu', art: <>{bubble}{face}{tag(<><rect x="44" y="12" width="12" height="8.5" rx="2" {...ink} strokeWidth={2} /><path d="M47.5 12v-1.3a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V12" {...ink} strokeWidth={2} /></>)}</> },
  calendar: { name: 'Lịch họp', art: <>{bubble}{face}{tag(<><rect x="44.5" y="10.5" width="11" height="10" rx="2.2" {...ink} strokeWidth={2} /><path d="M44.5 14.3h11M47.5 9v3M52.5 9v3" {...ink} strokeWidth={2} /></>)}</> },
  mail: { name: 'Thư', art: <>{bubble}{face}{tag(<><rect x="44" y="10.5" width="12" height="9" rx="2" {...ink} strokeWidth={2} /><path d="M44.8 11.6 50 15.8l5.2-4.2" {...ink} strokeWidth={2} /></>)}</> },
  finance: { name: 'Tài chính', art: <>{bubble}{face}{tag(<path d="M53 11.2h-3.8a2 2 0 0 0 0 4h1.6a2 2 0 0 1 0 4H47M50 9v12" {...ink} strokeWidth={2.2} />)}</> },
  // Work badges for common roles.
  search: { name: 'Tra cứu', art: <>{bubble}{face}{tag(<><circle cx="48.8" cy="13.8" r="3.8" {...ink} /><path d="m51.6 16.6 3 3" {...ink} /></>)}</> },
  chart: { name: 'Biểu đồ', art: <>{bubble}{face}{tag(<path d="M45.5 19.5v-3M50 19.5v-8M54.5 19.5v-5" {...ink} strokeWidth={2.8} />)}</> },
  target: { name: 'Mục tiêu', art: <>{bubble}{face}{tag(<><circle cx="50" cy="15" r="5" {...ink} strokeWidth={2.2} /><circle cx="50" cy="15" r="1.8" fill="var(--mascot-fill, #fff)" /></>)}</> },
  writer: { name: 'Bút viết', art: <>{bubble}{face}{tag(<path d="m45.5 19.5.9-3.4 6.2-6.2a1.8 1.8 0 0 1 2.5 2.5l-6.2 6.2z" {...ink} strokeWidth={2} />)}</> },
  notes: { name: 'Ghi chú', art: <>{bubble}{face}{tag(<path d="M45.5 11h9M45.5 15h9M45.5 19h5.5" {...ink} strokeWidth={2.4} />)}</> },
  megaphone: { name: 'Loa', art: <>{bubble}{face}{tag(<><path d="M43.8 12.6h3.2l6.8-3.6v12l-6.8-3.6h-3.2z" fill="var(--mascot-fill, #fff)" stroke="var(--mascot-fill, #fff)" strokeWidth="1.2" strokeLinejoin="round" /><path d="m46.2 17.6 1.1 3.4" {...ink} strokeWidth={2.2} /></>)}</> },
  checker: { name: 'Duyệt', art: <>{bubble}{face}{tag(<path d="m45.3 15.3 3 3 6.2-6.4" {...ink} strokeWidth={3} />)}</> },
  guard: { name: 'Bảo mật', art: <>{bubble}{face}{tag(<path d="m50 9 5 2v3.6c0 3.3-2.1 5.4-5 6.6-2.9-1.2-5-3.3-5-6.6V11z" {...ink} strokeWidth={2.2} />)}</> },
  coder: { name: 'Lập trình', art: <>{bubble}{face}{tag(<path d="m46.2 11.5-3.4 3.5 3.4 3.5M53.8 11.5l3.4 3.5-3.4 3.5M51.2 10.5l-2.4 9" {...ink} strokeWidth={2.2} />)}</> },
  automation: { name: 'Tự động', art: <>{bubble}{face}{tag(<path d="m51.5 8.5-6 8h4.5l-1.5 6 6-8.5H50z" fill="var(--mascot-fill, #fff)" />)}</> },
  care: { name: 'Tận tâm', art: <>{bubble}{face}{tag(<path d="M50 20.5s-5.5-3.3-5.5-6.8a2.9 2.9 0 0 1 5.5-1.3 2.9 2.9 0 0 1 5.5 1.3c0 3.5-5.5 6.8-5.5 6.8z" fill="var(--mascot-fill, #fff)" />)}</> },
} satisfies Record<string, { name: string; art: ReactNode }>;

export type MascotId = keyof typeof mascots;
export const mascotIds = Object.keys(mascots) as MascotId[];
export const isMascot = (value: string | undefined): value is MascotId => !!value && Object.hasOwn(mascots, value);

export function Mascot({ id }: { id: MascotId }) {
  return <svg className="mascot" overflow="visible" viewBox="0 6 64 64" aria-hidden="true" focusable="false">{mascots[id].art}</svg>;
}
