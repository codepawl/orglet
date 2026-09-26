import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether a sideways strip of cards (the composer's files, a sent message's files) has cards scrolled past either end,
 * so that end can fade out and say "there is more this way" instead of cutting a card with no sign (COD-292, COD-295).
 */
export type StripOverflow = { start: boolean; end: boolean };

/** Whether cards are scrolled past the strip's left end and past its right end. A pixel of slack absorbs rounding. */
export function stripOverflow(strip: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): StripOverflow {
  return {
    start: strip.scrollLeft > 1,
    end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
  };
}

export const sameOverflow = (first: StripOverflow, second: StripOverflow) => first.start === second.start && first.end === second.end;

/** Keeps a strip's overflow up to date as it scrolls, resizes, or its cards change (`contentKey`). */
export function useStripOverflow(strip: RefObject<HTMLElement | null>, contentKey: unknown): StripOverflow {
  const [overflow, setOverflow] = useState<StripOverflow>({ start: false, end: false });
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => {
      const next = stripOverflow(element);
      setOverflow(current => sameOverflow(current, next) ? current : next);
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [strip, contentKey]);
  return overflow;
}

/** The data attributes the strip's CSS reads to fade an end. */
export function overflowAttributes(overflow: StripOverflow) {
  return { 'data-more-start': overflow.start ? '' : undefined, 'data-more-end': overflow.end ? '' : undefined };
}
