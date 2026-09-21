import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { mascotIds } from '../../apps/desktop/src/renderer/components/mascots';
import { avatarRenderer, mascotGlyph, solidSizes } from '../../apps/desktop/src/renderer/components/Avatar';
import {
  FRONT, addAct, buildRotation, buildTones, convexHull, createOrglet, crouch, isStill, looks, oklchLightness, projectPoint, updateOrglet,
  type Attention, type Palette,
} from '../../apps/desktop/src/renderer/components/orgletSolid';
import { parseCssColour } from '../../apps/desktop/src/renderer/components/orgletStage';

const css = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/styles.css'), 'utf8');

const palette: Palette = { body: [79, 127, 224], alpha: 1, ink: [255, 255, 255], surface: [246, 246, 246], accent: [79, 127, 224], muted: [107, 107, 111] };
const rest: Attention = { present: false, x: 0, y: 0, near: false, noticed: false };
const pointerRight: Attention = { present: true, x: 120, y: 0, near: false, noticed: false };

/** Runs a face forward for `seconds` at 60 frames a second under one attention. */
function advance(model: ReturnType<typeof createOrglet>, attention: Attention, seconds: number, reducedMotion = false, from = 0) {
  const step = 1 / 60;
  let now = from;
  for (let frame = 0; frame < seconds * 60; frame++) {
    now += step;
    updateOrglet(model, attention, now, step, reducedMotion);
  }
  return now;
}

it('projects a face that looks straight ahead onto the grid unchanged, and turns it towards the pointer', () => {
  // With no yaw, pitch or spin the rotation is the identity, so a point on the front face lands where it started
  // apart from the touch of perspective the front face gets for being nearer.
  const ahead = buildRotation(0, 0, 0);
  expect(ahead.matrix.map(value => Math.round(value * 1000) / 1000 + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(ahead.facing).toBe(true);
  const [x, y] = projectPoint(ahead, 10, -6, FRONT);
  expect(x).toBeGreaterThan(10);
  expect(x).toBeLessThan(10.6);
  expect(y).toBeLessThan(-6);
  // Positive yaw looks right: the front face's centre moves right and the head is lit from its right.
  const right = buildRotation(0.6, 0, 0);
  expect(projectPoint(right, 0, 0, FRONT)[0]).toBeGreaterThan(2);
  expect(right.sinYaw).toBeGreaterThan(0);
  // Positive pitch looks down: the front face's centre moves down.
  expect(projectPoint(buildRotation(0, 0.4, 0), 0, 0, FRONT)[1]).toBeGreaterThan(2);
  // Half a spin shows the back.
  expect(buildRotation(0, 0, Math.PI).facing).toBe(false);
  expect(buildRotation(0, 0, Math.PI * 2).facing).toBe(true);
});

it('takes the slab silhouette as the convex hull of the front and back outlines', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 3]];
  const hull = convexHull(square);
  expect(hull).toHaveLength(4);
  expect(hull).toEqual(expect.arrayContaining([[0, 0], [4, 0], [4, 4], [0, 4]]));
});

it('gives every mascot a 3D look, and keeps the worn rule: a shape in the body colour carries an ink rim', () => {
  expect(Object.keys(looks).sort()).toEqual([...mascotIds].sort());
  const unrimmed: string[] = [];
  let wornShapes = 0;
  for (const id of mascotIds) {
    for (const shape of looks[id].shapes) {
      if (shape.fill !== 'body') continue;
      wornShapes += 1;
      if (shape.stroke !== 'ink') unrimmed.push(`${id}: a shape filled with the body colour has no rim`);
    }
  }
  expect(unrimmed).toEqual([]);
  expect(wornShapes).toBeGreaterThan(20);
  // The expressions of mascots.tsx live in the eyes here too.
  expect(looks.happy.face).toBe('happy');
  expect(looks.wink.face).toBe('wink');
  expect(looks.sleepy.face).toBe('sleepy');
  expect(looks.cool.face).toBe('shades');
  expect(looks.focused.face).toBe('glasses');
});

it('renders the large avatar sizes as the 3D solid and keeps the list sizes on the whole-pixel glyphs', () => {
  // The owner complained about blur at small sizes (COD-154): a slab a few pixels wide would bring it back, so
  // only the sizes big enough for the 64-unit art become solids. The sidebar, bylines and receipts stay glyphs.
  expect(avatarRenderer('xxs')).toBe('glyph');
  expect(avatarRenderer('xs')).toBe('glyph');
  expect(avatarRenderer('sm')).toBe('glyph');
  expect(avatarRenderer('md')).toBe('glyph');
  expect(avatarRenderer('lg')).toBe('solid');
  expect(avatarRenderer('xl')).toBe('solid');
  expect(avatarRenderer('xxl')).toBe('solid');
  for (const size of ['xxs', 'xs', 'sm', 'md'] as const) expect(mascotGlyph(size)).not.toBe('large');
  // The solid draws its 64-unit art at the size the stylesheet gives the flat drawing.
  expect(solidSizes.lg).toBe(40);
  expect(solidSizes.xl).toBe(64);
  expect(solidSizes.xxl).toBe(96);
  expect(css).toContain('.avatar.xl .mascot { --mascot-lift:-2px; width:64px; height:64px; }');
  expect(css).toContain('.avatar.xxl { width:96px; height:96px;');
});

it('turns the head after the pointer on a spring, the eyes leading, and comes to rest when nothing moves', () => {
  const model = createOrglet('classic', 7, 0);
  // Blinks would keep the face awake; push the first one out of this test's window.
  model.nextBlink = 1000;
  let now = advance(model, pointerRight, 0.08);
  // Early on the eyes have run ahead of the head.
  expect(model.eyeX.value).toBeGreaterThan(model.yaw.value);
  now = advance(model, pointerRight, 3, false, now);
  expect(model.yaw.value).toBeGreaterThan(0.3);
  expect(model.yaw.value).toBeCloseTo(model.yaw.target, 2);
  expect(isStill(model, now)).toBe(true);
  // The pointer leaves the window: the face relaxes to its rest pose and is still again.
  now = advance(model, rest, 3, false, now);
  expect(Math.abs(model.yaw.value)).toBeLessThan(0.002);
  expect(Math.abs(model.eyeX.value)).toBeLessThan(0.002);
  expect(isStill(model, now)).toBe(true);
});

it('never tracks the pointer or plays a gesture under reduced motion, and shows its state as a cut', () => {
  const model = createOrglet('classic', 7, 0);
  addAct(model, 'hop', 0.01, 0.05);
  const now = advance(model, pointerRight, 1, true);
  expect(model.yaw.value).toBe(0);
  expect(model.eyeX.value).toBe(0);
  expect(model.lift.value).toBe(0);
  // Every spring sits on its target after the first frame, so the loop has nothing to do.
  expect(isStill(model, now, true)).toBe(true);
  // A mood still shows, as a cut: the working face leans in at once, with its eyes on the work and no sweep, and
  // is still again on the very next frame.
  model.mood = 'working';
  updateOrglet(model, rest, now + 1 / 60, 1 / 60, true);
  expect(model.pitch.value).toBeCloseTo(0.14, 5);
  expect(model.eyeY.value).toBeCloseTo(1.4, 5);
  expect(model.eyeX.value).toBe(0);
  expect(isStill(model, now + 1 / 60, true)).toBe(true);
});

it('greets by hopping in from a crouch and settles, and a thinking face keeps moving until it is idle again', () => {
  const model = createOrglet('happy', 3, 0);
  model.nextBlink = 1000;
  crouch(model);
  expect(model.lift.value).toBe(12);
  expect(model.eyeOpen.value).toBe(0);
  addAct(model, 'hop', 0.05, 0.05, { strength: 190 });
  let now = advance(model, rest, 0.3);
  expect(model.lift.value).toBeLessThan(0);
  expect(isStill(model, now)).toBe(false);
  now = advance(model, rest, 3, false, now);
  expect(isStill(model, now)).toBe(true);
  expect(model.eyeOpen.value).toBeCloseTo(1, 2);
  model.mood = 'thinking';
  now = advance(model, rest, 2, false, now);
  expect(isStill(model, now)).toBe(false);
  expect(Math.abs(model.yaw.value)).toBeGreaterThan(0.05);
  model.mood = 'idle';
  now = advance(model, rest, 3, false, now);
  expect(isStill(model, now)).toBe(true);
});

it('draws white eyes on every body and dark ones only on a very light body, like the stylesheet', () => {
  expect(buildTones(palette).eye).toEqual([255, 255, 255]);
  expect(buildTones({ ...palette, body: [30, 30, 30] }).eye).toEqual([255, 255, 255]);
  expect(buildTones({ ...palette, body: [233, 231, 226] }).eye).toEqual([43, 43, 43]);
  expect(oklchLightness([255, 255, 255])).toBeCloseTo(1, 3);
  expect(oklchLightness([0, 0, 0])).toBe(0);
});

it('reads the colours the stylesheet computes in every form Chromium hands back', () => {
  expect(parseCssColour('#4f7fe0')).toEqual({ rgb: [79, 127, 224], alpha: 1 });
  expect(parseCssColour('#fff')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
  expect(parseCssColour('rgb(79, 127, 224)')).toEqual({ rgb: [79, 127, 224], alpha: 1 });
  expect(parseCssColour('rgba(31, 31, 31, 0.8)')).toEqual({ rgb: [31, 31, 31], alpha: 0.8 });
  expect(parseCssColour('color(srgb 0.2 0.4 1)')?.rgb).toEqual([51, 102, 255]);
  expect(parseCssColour('color(srgb 0.2 0.4 1 / 0.5)')?.alpha).toBe(0.5);
  expect(parseCssColour('color-mix(in srgb, red, blue)')).toBeUndefined();
});

it('keeps the 3D canvas out of layout and out of the way of the pointer', () => {
  // The face moves inside a fixed canvas that never takes part in layout or catches clicks, so a hop or a hat
  // turning can never shift the heading or the picker grid.
  expect(css).toMatch(/\.orglet-3d \{ position:absolute; left:50%; top:50%; display:block; pointer-events:none;/);
  expect(css).toContain('.fresh-faces { display:flex; justify-content:center; align-items:flex-end; gap:18px; min-height:96px;');
  // The small faces keep their own motion, and their landing became the happy hop.
  expect(css).toContain('@keyframes mascot-cheer-eyes');
  expect(css).toMatch(/\.message-byline\.landed \.avatar \.mascot-eyes \{ animation:mascot-blink[^}]*mascot-cheer-eyes/);
});
