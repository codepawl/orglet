import type { ReactNode } from 'react';

/*
 * The filled drawings of the area rail's icons (user, 2026-10-05): the open area's icon is solid and the others are
 * outlines. A stroked icon cannot simply be given a fill: an open stroke fills along the line that would close it,
 * which put a diagonal across the chat icon, and a line inside a shape vanishes into the fill. So each icon has its
 * own filled drawing, and it is the SAME drawing as its outline: the same paths on the same grid at the same stroke
 * width, filled, so the two read as one icon in two states and never as two icons. Lines that have to stay readable
 * inside the fill are drawn in the tile's ground (`--rail-cut`, set on the open tile).
 */
const cut = 'var(--rail-cut, transparent)';

/** The grid and stroke of the app's own icons (`icons.tsx`): bell, book and calendar are drawn there. */
function OrgletFilled({ children }: { children: ReactNode }) {
  return <svg className="rail-icon-filled" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

/** The grid and stroke of the Lucide icon Home uses. */
function LucideFilled({ children }: { children: ReactNode }) {
  return <svg className="rail-icon-filled" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

const frontBubble = 'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z';

/**
 * Lucide's two speech bubbles. The one behind is an open stroke in the outline; here it is the whole bubble, and a
 * halo in the ground keeps the one in front apart from it.
 */
export const ChatFilled = <LucideFilled>
  <path d="M10 9h10a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2z" />
  <path d={frontBubble} fill={cut} stroke={cut} strokeWidth="5" />
  <path d={frontBubble} />
</LucideFilled>;

/** The app's bell: its body filled, and the flat lip under it still a stroke. */
export const BellFilled = <OrgletFilled>
  <path d="M6 8.5a4 4 0 0 1 8 0c0 3 .8 4.4 1.5 5.2.3.4 0 .8-.4.8H4.9c-.4 0-.7-.4-.4-.8C5.2 12.9 6 11.5 6 8.5Z" />
  <path d="M8.4 17h3.2" fill="none" />
</OrgletFilled>;

/** The app's open book: both pages filled, with the spine cut between them. */
export const BookFilled = <OrgletFilled>
  <path d="M10 6C8.6 4.6 6.6 4 3.5 4v11.5c3.1 0 5.1.6 6.5 2 1.4-1.4 3.4-2 6.5-2V4c-3.1 0-5.1.6-6.5 2Z" />
  <path d="M10 6.6v10" fill="none" stroke={cut} strokeWidth="1.3" />
</OrgletFilled>;

/**
 * The app's calendar with a clock on its corner. The outline's sheet is an open stroke that stops where the clock
 * begins; here it is the whole sheet, and the clock sits over it inside a halo of the ground.
 */
export const CalendarClockFilled = <OrgletFilled>
  <path d="M5.5 4h9A2.5 2.5 0 0 1 17 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4Z" />
  <path d="M6.5 2.5v3M13.5 2.5v3" fill="none" />
  <circle cx="13.5" cy="13.5" r="4.5" fill={cut} stroke={cut} strokeWidth="4.4" />
  <circle cx="13.5" cy="13.5" r="4.5" />
  <path d="M13.5 11.2v2.3l1.7 1" fill="none" stroke={cut} strokeWidth="1.3" />
</OrgletFilled>;
