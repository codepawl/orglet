import type { ReactNode } from 'react';

/*
 * The filled drawings of the area rail's icons (user, 2026-10-05): the open area's icon is solid and the others are
 * outlines. A stroked icon cannot simply be given a fill: an open stroke fills along the line that would close it,
 * which put a diagonal across the chat icon, and a line inside a shape vanishes into the fill. So each icon has its
 * own filled drawing on the same 24 grid and at the same outer size as its outline, in ink (`currentColor`), with
 * the lines that have to stay readable inside it drawn in the tile's ground (`--rail-cut`, set on the open tile).
 */
const cut = 'var(--rail-cut, transparent)';

function Filled({ children }: { children: ReactNode }) {
  return <svg className="rail-icon-filled" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

const frontBubble = 'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z';

/** Two speech bubbles: the one behind is whole, and a halo in the ground keeps the one in front apart from it. */
export const ChatFilled = <Filled>
  <path d="M10 9h10a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2z" />
  <path d={frontBubble} fill={cut} stroke={cut} strokeWidth="5" />
  <path d={frontBubble} />
</Filled>;

/** A bell: the body is solid and the clapper under it stays a stroke. */
export const BellFilled = <Filled>
  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326z" />
  <path d="M10.268 21a2 2 0 0 0 3.464 0" fill="none" />
</Filled>;

/** An open book: both pages solid, with the spine cut between them. */
export const BookFilled = <Filled>
  <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  <path d="M12 7.5v12.5" fill="none" stroke={cut} strokeWidth="1.6" />
</Filled>;

/** A calendar with a clock on its corner: the sheet is solid under its two pegs, and the clock sits over it. */
export const CalendarClockFilled = <Filled>
  <path d="M8 2v4M16 2v4" fill="none" />
  <path d="M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
  <path d="M4 10h16" fill="none" stroke={cut} strokeWidth="1.6" />
  <circle cx="16.5" cy="16.5" r="5" fill={cut} stroke={cut} strokeWidth="5" />
  <circle cx="16.5" cy="16.5" r="5" />
  <path d="M16.5 14.2v2.6l1.7 1" fill="none" stroke={cut} strokeWidth="1.6" />
</Filled>;
