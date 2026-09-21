import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MascotId } from './mascots';
import type { Mood } from './orgletSolid';
import { CANVAS_SCALE, mountFace, type FaceHandle, type Follow } from './orgletStage';

/** How a large face behaves; every field is optional, and a face with none of them still turns after the pointer. */
export type FaceMotion = {
  follow?: Follow;
  /** The face the person is looking at: it may glance, stretch or doze unprompted now and then. */
  lead?: boolean;
  /** Faces greeting together, in DOM order: a team's members. */
  group?: string;
  /** Hop in on mount. */
  greet?: boolean;
  mood?: Mood;
  /** Each increase plays the "say cheese" smile with a small hop. */
  cheer?: number;
};

/**
 * One orglet as an extruded slab on a canvas (COD-156), turning to look at the pointer; see orgletSolid.ts for the
 * drawing and orgletStage.ts for the loop. `size` is the size of the 64-unit drawing in CSS pixels, the same box
 * the flat `Mascot` fills; the canvas is bigger and centred on it, so a hop or a note never touches layout. The
 * colours are read from the stylesheet: `color` is the body, `--mascot-ink` the rims. Decorative, like `Mascot`.
 */
export function Orglet3D({ id, seed, size, color, motion = {} }: { id: MascotId; seed: number; size: number; color: string; motion?: FaceMotion }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<FaceHandle>(null);
  const options = {
    id, seed, size, follow: motion.follow ?? 'pointer', lead: motion.lead ?? false, group: motion.group,
    greet: motion.greet ?? false, mood: motion.mood ?? 'idle', colorKey: color,
  };
  const first = useRef(true);
  useLayoutEffect(() => {
    handle.current = mountFace(canvas.current!, options);
    return () => { handle.current?.unmount(); handle.current = null; };
    // The face is mounted once; later changes go through `update` below.
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    handle.current?.update(options);
  });
  const cheer = motion.cheer ?? 0;
  useEffect(() => { if (cheer > 0) handle.current?.cheer(); }, [cheer]);
  const box = size * CANVAS_SCALE;
  return <canvas ref={canvas} className="orglet-3d" width={box} height={box} style={{ width: box, height: box, margin: -box / 2 }} aria-hidden="true" />;
}
