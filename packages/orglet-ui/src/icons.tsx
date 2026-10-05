import type { ReactNode, SVGProps } from 'react';
import { cn } from './cn';

/*
 * The kit's own icons, so an application does not need an icon library for the basics.
 *
 * Grid: 20 units, with the drawing kept inside 3..17 (an arrow head or a ring may reach 2.5 or 17.5, never further).
 * Stroke: 1.6 units with round caps and joins, set on the drawing group rather than on the <svg> so a page-wide
 * `svg { stroke-width }` rule cannot thin it. Colour: `currentColor` only. Every icon is decorative until it is given
 * a `title`. Where the Orglet app already draws a glyph, these are the same paths, so the app and the kit agree.
 */

const GRID = 20;
const STROKE_WIDTH = 1.6;
const DEFAULT_SIZE = 16;
const DOT_RADIUS = 1.4;
const GITHUB_SCALE = 14 / 24;

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Rendered width and height in pixels. */
  size?: number;
  /** Names the icon for assistive technology. Leave it out when text beside the icon already says it. */
  title?: string;
};

function Icon({ size = DEFAULT_SIZE, title, className, children, ...rest }: IconProps & { children: ReactNode }) {
  const naming = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox={`0 0 ${GRID} ${GRID}`}
    focusable="false"
    {...rest}
    {...naming}
    className={cn('org-icon', className)}
  >
    <g fill="none" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">{children}</g>
  </svg>;
}

/** A solid dot the weight of a stroke end. */
function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={DOT_RADIUS} fill="currentColor" stroke="none" />;
}

/** The page shared by the file icons: 12 by 14 with a corner folded over. */
function Page() {
  return <>
    <path d="M12 3H6.5A2.5 2.5 0 0 0 4 5.5v9A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5V7Z" />
    <path d="M12 3v3a1 1 0 0 0 1 1h3" />
  </>;
}

// Marks and actions

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m4 10.5 4 4 8-8.5" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 5 10 10M15 5 5 15" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 4v12M4 10h12" /></Icon>;
}

export function MinusIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 10h12" /></Icon>;
}

// Direction

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 7.5 5 5 5-5" /></Icon>;
}

export function ChevronUpIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 12.5 5-5 5 5" /></Icon>;
}

export function ChevronLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="m12.5 5-5 5 5 5" /></Icon>;
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon {...props}><path d="m7.5 5 5 5-5 5" /></Icon>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="M16.5 10h-13M8.5 5l-5 5 5 5" /></Icon>;
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 10h13M11.5 5l5 5-5 5" /></Icon>;
}

export function ArrowUpRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 14 14 6M7.5 6H14v6.5" /></Icon>;
}

// Tools

export function SearchIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.8 3.8" />
  </Icon>;
}

export function CopyIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
  </Icon>;
}

export function MoreVerticalIcon(props: IconProps) {
  return <Icon {...props}><Dot x={10} y={4.5} /><Dot x={10} y={10} /><Dot x={10} y={15.5} /></Icon>;
}

export function MoreHorizontalIcon(props: IconProps) {
  return <Icon {...props}><Dot x={4.5} y={10} /><Dot x={10} y={10} /><Dot x={15.5} y={10} /></Icon>;
}

export function MenuIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" /></Icon>;
}

// Status

export function InfoIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="10" cy="10" r="7" />
    <Dot x={10} y={6.6} />
    <path d="M10 9.5v4.5" />
  </Icon>;
}

export function AlertIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M8.7 4.6 3.4 13.8A1.5 1.5 0 0 0 4.7 16h10.6a1.5 1.5 0 0 0 1.3-2.2L11.3 4.6a1.5 1.5 0 0 0-2.6 0Z" />
    <path d="M10 8v2.8" />
    <Dot x={10} y={13.4} />
  </Icon>;
}

export function ErrorIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="m7.7 7.7 4.6 4.6M12.3 7.7l-4.6 4.6" />
  </Icon>;
}

export function SuccessIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="m6.9 10.3 2.2 2.2 4-4.4" />
  </Icon>;
}

// Appearance

export function SunIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M14 6l.9-.9M6 6l-.9-.9M14 14l.9.9M6 14l-.9.9" />
  </Icon>;
}

export function MoonIcon(props: IconProps) {
  return <Icon {...props}><path d="M16.5 11.2A6.8 6.8 0 1 1 8.8 3.5a5.3 5.3 0 0 0 7.7 7.7Z" /></Icon>;
}

export function MonitorIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="3" y="4" width="14" height="9.5" rx="2.5" />
    <path d="M7.5 16.5h5M10 13.5v3" />
  </Icon>;
}

// Things

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="6" cy="6.5" r="2.3" />
    <path d="M9.3 6.5H17" />
    <circle cx="14" cy="13.5" r="2.3" />
    <path d="M3 13.5h7.7" />
  </Icon>;
}

export function TrashIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M3.5 6h13" />
    <path d="M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
    <path d="m5 6 .8 9.6a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L15 6" />
  </Icon>;
}

export function PencilIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="m4 16.5 1-3.5L14 4a1.59 1.59 0 0 1 2.25 2.25L7.5 15Z" />
    <path d="m12 6 2.25 2.25" />
  </Icon>;
}

export function DownloadIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M10 3v9.5" />
    <path d="m6.5 9 3.5 3.5L13.5 9" />
    <path d="M3 13v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1" />
  </Icon>;
}

export function FileIcon(props: IconProps) {
  return <Icon {...props}><Page /></Icon>;
}

export function FileTextIcon(props: IconProps) {
  return <Icon {...props}>
    <Page />
    <path d="M7.5 10.5h5M7.5 13.5h3.5" />
  </Icon>;
}

export function BookIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M10 6C8.6 4.6 6.6 4 3.5 4v11.5c3.1 0 5.1.6 6.5 2 1.4-1.4 3.4-2 6.5-2V4c-3.1 0-5.1.6-6.5 2Z" />
    <path d="M10 6v11.5" />
  </Icon>;
}

export function UserIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4 16.5c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8" />
  </Icon>;
}

export function BellIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M6 8.5a4 4 0 0 1 8 0c0 3 .8 4.4 1.5 5.2.3.4 0 .8-.4.8H4.9c-.4 0-.7-.4-.4-.8C5.2 12.9 6 11.5 6 8.5Z" />
    <path d="M8.4 17h3.2" />
  </Icon>;
}

export function CalendarIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="3" y="4" width="14" height="13" rx="3" />
    <path d="M3 8.5h14M6.5 2.5v3M13.5 2.5v3" />
  </Icon>;
}

export function EyeIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 10s2.8-4.8 7-4.8 7 4.8 7 4.8-2.8 4.8-7 4.8S3 10 3 10Z" />
    <circle cx="10" cy="10" r="2.2" />
  </Icon>;
}

export function CodeIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="m6.5 6.5-3.5 3.5 3.5 3.5" />
    <path d="m13.5 6.5 3.5 3.5-3.5 3.5" />
    <path d="m11.5 4.5-3 11" />
  </Icon>;
}

export function PackageIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M10 3 16.5 6.2v7.6L10 17 3.5 13.8V6.2Z" />
    <path d="M3.5 6.2 10 9.5l6.5-3.3M10 9.5V17" />
  </Icon>;
}

/** The one filled glyph: the GitHub mark, drawn on its own 24-unit square and scaled into the 3..17 box. */
export function GitHubIcon(props: IconProps) {
  return <Icon {...props}>
    <path
      transform={`translate(3 3) scale(${GITHUB_SCALE})`}
      fill="currentColor"
      stroke="none"
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    />
  </Icon>;
}
