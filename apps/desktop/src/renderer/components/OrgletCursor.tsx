import type { CSSProperties } from 'react';
import { bubbleOutline, eyeColor } from './mascots';

/**
 * The orglet's own cursor (COD-261): the Orglet logo bubble turned so its tighter corner points up and to the left as
 * the tip, filled with the orglet's colour and wearing its two upright eyes, so it reads as the orglet itself rather
 * than an arrow. A thin rim in the page colour keeps it visible on any background. It is only ever drawn by Orglet,
 * over the browser's live view or on the desktop glow; the system cursor is never changed.
 *
 * It glides between points, squashes a little and leaves a ripple in its colour on a press, and rests with its eyes on
 * the field while it types. Under reduced motion it simply sits where it is.
 */

export type OrgletCursorAction = 'move' | 'press' | 'type';

/** The drawing's size on screen, and where its tip sits in it: the pixel that points. */
const SIZE = 20;
const VIEW = { x: 8, y: 9, size: 48 };
/** The tip on the 64 grid: the tighter corner once turned, where its round meets the diagonal. */
const TIP = { x: 13.3, y: 14.3 };
const TIP_OFFSET = { x: ((TIP.x - VIEW.x) * SIZE) / VIEW.size, y: ((TIP.y - VIEW.y) * SIZE) / VIEW.size };

/** Two upright capsules, a little right of the middle and low enough to clear the tip, as on the mascots. */
const eyeWidth = 4.6;
const eyeHeight = 9.4;
const eyes = [{ x: 33.5, y: 35.5 }, { x: 40.5, y: 35.5 }];

export function OrgletCursor({ x, y, color, name, action = 'move', presses = 0, glide = true }: {
  /** Where the tip points, in the parent's pixels. */
  x: number;
  y: number;
  /** The orglet's colour, as its avatar is drawn. */
  color: string;
  /** Shown in a pill beside the cursor; left out where the name is already on screen. */
  name?: string;
  action?: OrgletCursorAction;
  /** Counts presses: each new value plays the squash and the ripple once. */
  presses?: number;
  /** Off where the cursor follows the real one many times a second, so it never trails behind. */
  glide?: boolean;
}) {
  const style = { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`, color, '--orglet-cursor-color': color } as CSSProperties;
  return <div className="orglet-cursor" data-action={action} data-glide={glide ? '' : undefined} style={style} aria-hidden="true">
    {presses > 0 && <span key={`ripple-${presses}`} className="orglet-cursor-ripple" />}
    <span key={`body-${presses}`} className={presses > 0 ? 'orglet-cursor-body orglet-cursor-pressed' : 'orglet-cursor-body'}
      style={{ left: -TIP_OFFSET.x, top: -TIP_OFFSET.y, transformOrigin: `${TIP_OFFSET.x}px ${TIP_OFFSET.y}px` }}>
      <svg width={SIZE} height={SIZE} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`}>
        <g transform="rotate(90 32 33)"><path className="orglet-cursor-shape" d={bubbleOutline} /></g>
        <g className="orglet-cursor-eyes">
          {eyes.map(eye => <rect key={eye.x} x={eye.x - eyeWidth / 2} y={eye.y - eyeHeight / 2} width={eyeWidth} height={eyeHeight} rx={eyeWidth / 2} fill={eyeColor} />)}
        </g>
      </svg>
    </span>
    {name && <span className="orglet-cursor-name">{name}</span>}
  </div>;
}
