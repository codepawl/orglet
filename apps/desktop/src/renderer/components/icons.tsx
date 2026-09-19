import { forwardRef, type ForwardRefExoticComponent, type ReactNode, type RefAttributes, type SVGProps } from 'react';

/*
 * Orglet icons: the app's own set, drawn by the hand that drew the mark and the mascots (mascots.tsx).
 *
 * Grid. 20×20 units, with the drawing kept inside 3..17 (a 14-unit box); an arrow head, a search handle or a
 * calendar ring may reach 2.5 or 17.5 with its cap and never further. Lucide is 24 with a 2 stroke; 20 is chosen
 * because the sizes this UI uses (14, 15, 16, 18, 20) are all simple fractions of it, so a 1-unit gap stays a
 * whole number of pixels more often, and because at 20px the grid is the pixel grid, which makes checking a
 * drawing as easy as reading its numbers.
 *
 * Stroke. 1.6 units (8% of the icon), round caps, round joins. The mascots use 3.4 on 64 for a face and 4 on 64
 * for the bubble (5–6%); lucide is 8.3% and the house stylesheet thins it to 1.7/24 (7%). At 14px, 7% is one
 * pixel and starts to grey out, so these sit a touch heavier: 1.12px at 14, 1.44px at 18, 1.6px at 20. The round
 * caps keep that from reading as bold. The stroke is set on the drawing group, not on the <svg>, so the global
 * `svg { stroke-width }` rule that thins lucide leaves these alone; pass `strokeWidth` to change it.
 *
 * Corners. A closed box gets a radius of a fifth of its shorter side, rounded to the nearest half unit and never
 * below 1: a 14 box gets 3, a 4-unit lid gets 1. A box open on one side keeps the same radius on the corners it
 * still has. The one exception is the bubble.
 *
 * Bubble. The Orglet bubble is a box with three 4-unit corners and one tight 1.5-unit corner at the bottom left,
 * the shape of the logo. Only an icon that stands for Orglet speaking gets it: a message, a chat, a worker's
 * reply. Every other container (archive, calendar, book, sidebar panel) keeps four equal corners, so the motif
 * keeps its meaning.
 *
 * Filled and outline. Everything is outline. A filled part is a solid currentColor shape with no stroke and is
 * used for two things only: dots (grip, ⋮) drawn as circles of radius 1.4, so a dot weighs the same as a stroke
 * end, and a small marker inside an outline (a play triangle, the eye of the mark). A filled variant of a whole
 * icon, when one is ever needed, is the same silhouette filled with currentColor and its inner detail cut out as
 * a hole (`fillRule="evenodd"`), the way the app icon and `.orglet-mark` knock the eye out of the bubble; it never
 * adds a second colour and never sits next to its outline twin as a hover state. Hover and selection are colour
 * changes in CSS, not a different drawing.
 *
 * Colour. `currentColor` only; an icon never hard-codes a colour.
 *
 * Accessibility. Every icon is decorative by default (`aria-hidden="true"`). A control whose only content is an
 * icon carries the name itself (`aria-label`), as the Button call sites already do.
 *
 * Props match the lucide call sites (`size`, `strokeWidth`, `className`, any SVG attribute, a ref to the <svg>),
 * so swapping a surface over is a change of import.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  /** Rendered width and height in pixels. */
  size?: number | string;
  /** Stroke width on the 20-unit grid. */
  strokeWidth?: number | string;
};

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

const GRID = 20;
const STROKE = 1.6;
const DEFAULT_SIZE = 16;
const DOT_RADIUS = 1.4;

function defineIcon(slug: string, drawing: ReactNode): Icon {
  const Component = forwardRef<SVGSVGElement, IconProps>(function OrgletIcon({ size = DEFAULT_SIZE, strokeWidth = STROKE, className, ...rest }, ref) {
    const classes = className ? `orglet-icon orglet-icon-${slug} ${className}` : `orglet-icon orglet-icon-${slug}`;
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} className={classes} aria-hidden="true" focusable="false" {...rest}>
        <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{drawing}</g>
      </svg>
    );
  });
  Component.displayName = `Icon(${slug})`;
  return Component;
}

/** A solid dot the weight of a stroke end. */
function dot(cx: number, cy: number) {
  return <circle cx={cx} cy={cy} r={DOT_RADIUS} fill="currentColor" stroke="none" />;
}

/** The archive lid shared by Archive and ArchiveRestore: a 4-unit lid gets a 1-unit corner. */
const archiveLid = <rect x="3" y="3.5" width="14" height="4" rx="1" />;

// Navigation and layout

export const Search = defineIcon('search', <>
  <circle cx="9" cy="9" r="5.5" />
  <path d="m13.2 13.2 3.8 3.8" />
</>);

export const PanelLeft = defineIcon('panel-left', <>
  <rect x="3" y="3" width="14" height="14" rx="3" />
  <path d="M8 3v14" />
</>);

export const ChevronDown = defineIcon('chevron-down', <path d="m5 7.5 5 5 5-5" />);

export const ChevronRight = defineIcon('chevron-right', <path d="m7.5 5 5 5-5 5" />);

export const ArrowLeft = defineIcon('arrow-left', <path d="M16.5 10h-13M8.5 5l-5 5 5 5" />);

export const ArrowUp = defineIcon('arrow-up', <path d="M10 16.5v-13M5 8.5l5-5 5 5" />);

// Actions

export const Plus = defineIcon('plus', <path d="M10 4v12M4 10h12" />);

export const X = defineIcon('x', <path d="m5 5 10 10M15 5 5 15" />);

export const Check = defineIcon('check', <path d="m4 10.5 4 4 8-8.5" />);

export const Pencil = defineIcon('pencil', <>
  <path d="m4 16.5 1-3.5L14 4a1.59 1.59 0 0 1 2.25 2.25L7.5 15Z" />
  <path d="m12 6 2.25 2.25" />
</>);

export const Download = defineIcon('download', <>
  <path d="M10 3v9.5" />
  <path d="m6.5 9 3.5 3.5L13.5 9" />
  <path d="M3 13v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1" />
</>);

export const Archive = defineIcon('archive', <>
  {archiveLid}
  <path d="M4.5 7.5v7.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7.5" />
  <path d="M8.5 11h3" />
</>);

export const ArchiveRestore = defineIcon('archive-restore', <>
  {archiveLid}
  <path d="M4.5 7.5v5M15.5 7.5v5" />
  <path d="M10 17.5v-7M7 13.5l3-3 3 3" />
</>);

export const Trash = defineIcon('trash', <>
  <path d="M3.5 6h13" />
  <path d="M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
  <path d="m5 6 .8 9.6a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L15 6" />
</>);

// Row handles

export const GripVertical = defineIcon('grip-vertical', <>
  {dot(7.5, 4.5)}
  {dot(12.5, 4.5)}
  {dot(7.5, 10)}
  {dot(12.5, 10)}
  {dot(7.5, 15.5)}
  {dot(12.5, 15.5)}
</>);

export const EllipsisVertical = defineIcon('ellipsis-vertical', <>
  {dot(10, 4.5)}
  {dot(10, 10)}
  {dot(10, 15.5)}
</>);

// Places in the app

export const CalendarClock = defineIcon('calendar-clock', <>
  <path d="M8 17H5.5A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5" />
  <path d="M6.5 2.5v3M13.5 2.5v3" />
  <circle cx="13.5" cy="13.5" r="4.5" />
  <path d="M13.5 11.2v2.3l1.7 1" />
</>);

export const BookOpen = defineIcon('book-open', <>
  <path d="M10 6C8.6 4.6 6.6 4 3.5 4v11.5c3.1 0 5.1.6 6.5 2 1.4-1.4 3.4-2 6.5-2V4c-3.1 0-5.1.6-6.5 2Z" />
  <path d="M10 6v11.5" />
</>);

export const Settings = defineIcon('settings', <>
  <circle cx="6" cy="6.5" r="2.3" />
  <path d="M9.3 6.5H17" />
  <circle cx="14" cy="13.5" r="2.3" />
  <path d="M3 13.5h7.7" />
</>);

// The bubble

export const Message = defineIcon('message', <path d="M7 3h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H4.5A1.5 1.5 0 0 1 3 15.5V7a4 4 0 0 1 4-4Z" />);
