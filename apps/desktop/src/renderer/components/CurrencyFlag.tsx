import type { ReactNode } from 'react';
import type { CurrencyCode } from '../../shared/currency';

/** Simplified union flag, drawn in a 20×20 box; reused for GBP and the canton of AUD. */
const union = <>
  <rect width="20" height="20" fill="#012169" />
  <path d="M0 0 20 20M20 0 0 20" stroke="#fff" strokeWidth="4" />
  <path d="M0 0 20 20M20 0 0 20" stroke="#C8102E" strokeWidth="1.4" />
  <path d="M10 0v20M0 10h20" stroke="#fff" strokeWidth="6" />
  <path d="M10 0v20M0 10h20" stroke="#C8102E" strokeWidth="3.4" />
</>;
const star = (cx: number, cy: number, r: number, fill: string) => {
  const points = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 ? r * .4 : r, angle = -Math.PI / 2 + index * Math.PI / 5;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return <polygon points={points.join(' ')} fill={fill} />;
};

const flags: Record<CurrencyCode, ReactNode> = {
  USD: <>
    <rect width="20" height="20" fill="#fff" />
    {[0, 3, 6, 9, 12, 15, 18].map(y => <rect key={y} y={y} width="20" height="1.55" fill="#B22234" />)}
    <rect width="10" height="10.6" fill="#3C3B6E" />
    {[[2.5, 2.5], [5, 2.5], [7.5, 2.5], [3.75, 5.2], [6.25, 5.2], [2.5, 7.9], [5, 7.9], [7.5, 7.9]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".55" fill="#fff" />)}
  </>,
  VND: <><rect width="20" height="20" fill="#DA251D" />{star(10, 10.4, 6, '#FFCD00')}</>,
  EUR: <>
    <rect width="20" height="20" fill="#003399" />
    {Array.from({ length: 12 }, (_, index) => { const angle = index * Math.PI / 6; return <circle key={index} cx={10 + 5.6 * Math.cos(angle)} cy={10 + 5.6 * Math.sin(angle)} r=".95" fill="#FFCC00" />; })}
  </>,
  GBP: union,
  JPY: <><rect width="20" height="20" fill="#fff" /><circle cx="10" cy="10" r="5" fill="#BC002D" /></>,
  CNY: <><rect width="20" height="20" fill="#DE2910" />{star(6.5, 7, 3.6, '#FFDE00')}{star(11.5, 3.8, 1, '#FFDE00')}{star(13.4, 6.2, 1, '#FFDE00')}{star(13.4, 9.2, 1, '#FFDE00')}{star(11.5, 11.4, 1, '#FFDE00')}</>,
  KRW: <>
    <rect width="20" height="20" fill="#fff" />
    <path d="M5.5 10a4.5 4.5 0 0 1 9 0z" fill="#CD2E3A" /><path d="M5.5 10a4.5 4.5 0 0 0 9 0z" fill="#0047A0" />
    <circle cx="7.75" cy="10" r="2.25" fill="#CD2E3A" /><circle cx="12.25" cy="10" r="2.25" fill="#0047A0" />
    <path d="M2.6 5.6 4.6 3.2M3.5 6.4 5.5 4M15.4 3.2l2 2.4M14.5 4l2 2.4M2.6 14.4l2 2.4M3.5 13.6l2 2.4M15.4 16.8l2-2.4M14.5 16l2-2.4" stroke="#000" strokeWidth=".7" />
  </>,
  SGD: <>
    <rect width="20" height="20" fill="#fff" /><rect width="20" height="10" fill="#EF3340" />
    <circle cx="6.2" cy="5" r="3" fill="#fff" /><circle cx="7.4" cy="5" r="2.7" fill="#EF3340" />
    {[[10, 2.8], [8.9, 4.1], [11.1, 4.1], [9.3, 5.9], [10.7, 5.9]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".45" fill="#fff" />)}
  </>,
  THB: <><rect width="20" height="20" fill="#A51931" /><rect y="3.33" width="20" height="13.34" fill="#F4F5F8" /><rect y="6.67" width="20" height="6.66" fill="#2D2A4A" /></>,
  AUD: <>
    <rect width="20" height="20" fill="#012169" />
    <svg width="10" height="10" viewBox="0 0 20 20">{union}</svg>
    {star(5, 15, 2, '#fff')}{star(15, 5, 1.1, '#fff')}{star(12.5, 10, 1.1, '#fff')}{star(17, 9, 1.1, '#fff')}{star(15, 16, 1.2, '#fff')}
  </>,
  CAD: <>
    <rect width="20" height="20" fill="#fff" /><rect width="5" height="20" fill="#D52B1E" /><rect x="15" width="5" height="20" fill="#D52B1E" />
    <path d="M10 4.4l1 1.9 1.2-.6-.4 2.9 1.5-1.4.4 1 1.6-.3-.5 1.7.8.4-2.7 2.2.3 1-2.5-.4V15.6h-.6v-2.8l-2.5.4.3-1-2.7-2.2.8-.4-.5-1.7 1.6.3.4-1 1.5 1.4-.4-2.9 1.2.6z" fill="#D52B1E" />
  </>,
};

/** Round flag for a display currency; decorative, the code and name stay in text next to it. */
export function CurrencyFlag({ code, size = 20 }: { code: CurrencyCode; size?: number }) {
  return <svg className="currency-flag" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <defs><clipPath id={`flag-${code}`}><circle cx="10" cy="10" r="10" /></clipPath></defs>
    <g clipPath={`url(#flag-${code})`}>{flags[code]}</g>
    <circle cx="10" cy="10" r="9.6" fill="none" stroke="#0000001f" strokeWidth=".8" />
  </svg>;
}
