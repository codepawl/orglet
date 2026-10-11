/**
 * A dial that says how much of a plan's allowance is used (owner, 2026-10-12). The needle and the colour say it
 * together, so it never rests on colour alone: nearly used up, the needle stands in the middle and the dial is the
 * warning colour; used up, the needle lies at the far right and the dial is the error colour. Decorative: the text
 * beside it says the same.
 */
export type UsageGaugeLevel = 'near' | 'out';

// The needle turns about the dial's centre; the dial's arc ends lower right, where the needle rests when nothing is left.
const NEEDLES: Record<UsageGaugeLevel, string> = {
  near: 'M12 14V8.5',
  out: 'm12 14 4.6 2.6',
};

export function UsageGauge({ level, size = 16 }: { level: UsageGaugeLevel; size?: number }) {
  return <svg className="usage-gauge" data-level={level} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    <path d={NEEDLES[level]} />
  </svg>;
}
