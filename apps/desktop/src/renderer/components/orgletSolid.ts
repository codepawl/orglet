import type { MascotId } from './mascots';

/*
 * An orglet in 3D (COD-156, from the owner's standalone "ORGLETS" page, 2026-09-21: "this orglet form is so good,
 * apply it in the Orglet app too"). A large face is not the flat drawing in mascots.tsx but an extruded slab: the
 * logo bubble outline is rotated as a solid with a front face, a back face and the side between them, the eyes and
 * each accessory are polygons living at their own depth, and the whole head turns in real 3D to look at the
 * pointer on springs, the eyes leading the head. Everything is projected from geometry every frame and drawn on a
 * canvas; nothing here touches the DOM. The stage (orgletStage.ts) owns the canvases, the pointer and the loop.
 *
 * The grid is the mascots' 64-unit grid with the body centre at (32, 33); local coordinates are [X, Y] around that
 * centre plus a depth Z, with the front face at +FRONT and the back at -FRONT.
 */

export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export const BODY_HALF = 22;
const BODY_CORNER = 13.7;
const BODY_TAIL = 6.5;
export const DEPTH = 15;
export const FRONT = DEPTH / 2;
// Anything worn on the head sits just behind the face plane: enough parallax to feel like a hat on a head, close
// enough that drawing it after the body is the right order at every angle.
export const HAT_Z = FRONT - 4;
export const FOCAL = 150;
const EYE_WIDTH = 4.4;
const EYE_HEIGHT = 9.5;
const EYE_Y = -6;
const EYE_LEFT = -1.5;
const EYE_RIGHT = 5.5;
const TAU = Math.PI * 2;

/* ---------- Colour. The stage reads the face's colours from the stylesheet; here they are plain rgb triples. */

export function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

export function rgbString(rgb: Rgb, alpha = 1) {
  const red = Math.round(rgb[0]);
  const green = Math.round(rgb[1]);
  const blue = Math.round(rgb[2]);
  if (alpha >= 1) {
    return `rgb(${red},${green},${blue})`;
  }
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** The oklch lightness of an sRGB colour, the value the stylesheet's `eyeColor` steps on. */
export function oklchLightness(rgb: Rgb) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const red = linear(rgb[0]);
  const green = linear(rgb[1]);
  const blue = linear(rgb[2]);
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return 0.2104542553 * long + 0.7936177850 * medium - 0.0040720468 * short;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
// The stylesheet turns the eyes dark above this lightness of the body (`eyeColor` in mascots.tsx).
const DARK_EYE_ABOVE = 0.78;

/** The colours a face is drawn from: its own, and the page's, read from the stylesheet by the stage. */
export type Palette = { body: Rgb; alpha: number; ink: Rgb; surface: Rgb; accent: Rgb; muted: Rgb };

export type Tones = {
  base: Rgb; lit: Rgb; shaded: Rgb; side: Rgb; sideDark: Rgb; back: Rgb; dark: Rgb; ground: Rgb; eye: Rgb;
  ink: Rgb; surface: Rgb; accent: Rgb; muted: Rgb; alpha: number;
};

/** The matte light of mascots.tsx on a solid: a lighter top left, a darker bottom right, a darker side. */
export function buildTones(palette: Palette): Tones {
  const base = palette.body;
  return {
    base,
    lit: mixRgb(base, WHITE, 0.16),
    shaded: mixRgb(base, BLACK, 0.16),
    side: mixRgb(base, BLACK, 0.32),
    sideDark: mixRgb(base, BLACK, 0.52),
    back: mixRgb(base, BLACK, 0.22),
    dark: mixRgb(base, BLACK, 0.55),
    ground: mixRgb(base, BLACK, 0.45),
    eye: oklchLightness(base) > DARK_EYE_ABOVE ? [43, 43, 43] : WHITE,
    ink: palette.ink,
    surface: palette.surface,
    accent: palette.accent,
    muted: palette.muted,
    alpha: palette.alpha,
  };
}

/* ---------- Geometry helpers. Shapes are sampled polygons on the 64 grid. */

function local(x: number, y: number): Point2 {
  return [x - 32, y - 33];
}

function ellipseArcPoints(centreX: number, centreY: number, radiusX: number, radiusY: number, startAngle: number, endAngle: number, count: number): Point2[] {
  const points: Point2[] = [];
  for (let index = 0; index <= count; index++) {
    const angle = startAngle + (endAngle - startAngle) * (index / count);
    points.push(local(centreX + radiusX * Math.cos(angle), centreY + radiusY * Math.sin(angle)));
  }
  return points;
}

// A half ellipse standing on baseY, the crown of most hats.
function domePoints(centreX: number, baseY: number, radiusX: number, radiusY: number) {
  return ellipseArcPoints(centreX, baseY, radiusX, radiusY, Math.PI, TAU, 18);
}

// The part of an ellipse above baseY, closed along the base (the headband).
function domeClippedPoints(centreX: number, centreY: number, radiusX: number, radiusY: number, baseY: number) {
  const sine = (baseY - centreY) / radiusY;
  const offset = Math.asin(-sine);
  return ellipseArcPoints(centreX, centreY, radiusX, radiusY, Math.PI + offset, TAU - offset, 18);
}

function roundedRectPoints(x: number, y: number, width: number, height: number, radius: number): Point2[] {
  const points: Point2[] = [];
  const corners: [number, number, number, number][] = [
    [x + width - radius, y + radius, -Math.PI / 2, 0],
    [x + width - radius, y + height - radius, 0, Math.PI / 2],
    [x + radius, y + height - radius, Math.PI / 2, Math.PI],
    [x + radius, y + radius, Math.PI, Math.PI * 1.5],
  ];
  for (const [cornerX, cornerY, startAngle, endAngle] of corners) {
    for (let index = 0; index <= 6; index++) {
      const angle = startAngle + (endAngle - startAngle) * (index / 6);
      points.push(local(cornerX + radius * Math.cos(angle), cornerY + radius * Math.sin(angle)));
    }
  }
  return points;
}

function circlePoints(centreX: number, centreY: number, radius: number, count = 22) {
  return ellipseArcPoints(centreX, centreY, radius, radius, 0, TAU, count).slice(0, count);
}

function polygonPoints(gridPoints: readonly Point2[]) {
  return gridPoints.map(([x, y]) => local(x, y));
}

function capsulePoints(centreX: number, centreY: number, width: number, height: number) {
  const radius = Math.min(width, height) / 2;
  return roundedRectPoints(centreX + 32 - width / 2, centreY + 33 - height / 2, width, height, radius);
}

/**
 * The bubble outline, clockwise from the top edge: three big corners and the small bottom-left one that makes it
 * a speech bubble, the logo's proportions (mascots.tsx `bubbleOutline`). `inset` shrinks it by that distance
 * everywhere, which for a rounded outline is exactly the same outline with every radius reduced by the inset and
 * every arc centre where it was; that is what makes the bevel below a true parallel curve and not a scaled copy,
 * so the logo's own proportions survive it.
 */
export function buildBodyOutline(inset = 0): Point2[] {
  const points: Point2[] = [];
  const half = BODY_HALF - inset;
  const corner = BODY_CORNER - inset;
  const tail = BODY_TAIL - inset;
  const cornerSteps = 10;
  const tailSteps = 6;
  const arcs: [number, number, number, number, number, number][] = [
    [-half + corner, -half + corner, corner, Math.PI, Math.PI * 1.5, cornerSteps],
    [half - corner, -half + corner, corner, Math.PI * 1.5, TAU, cornerSteps],
    [half - corner, half - corner, corner, 0, Math.PI / 2, cornerSteps],
    [-half + tail, half - tail, tail, Math.PI / 2, Math.PI, tailSteps],
  ];
  for (const [centreX, centreY, radius, startAngle, endAngle, steps] of arcs) {
    for (let index = 0; index <= steps; index++) {
      const angle = startAngle + (endAngle - startAngle) * (index / steps);
      points.push([centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]);
    }
  }
  return points;
}
export const bodyOutline = buildBodyOutline();

/*
 * The rolled edge (user, 2026-09-22: the edges were still too sharp). The slab is not a cut-out with a crease where
 * the face meets the side: its edge is a quarter round of radius BEVEL, so the widest cross-section is the rim at
 * ±RIM_Z and the face plate at ±FRONT is inset by the whole radius. The steps between them are drawn as shoulders,
 * each one a ring of the quarter round with a tone that much further from the side and towards the face, which is
 * what a rolled edge is made of at the sizes these faces are drawn.
 */
export const BEVEL = 3.4;
export const RIM_Z = FRONT - BEVEL;
/** Along the quarter round, 0 at the rim and a right angle at the face plate. Two steps read as a roll; one reads as a chamfer. */
const SHOULDER_ANGLES = [Math.PI / 6, Math.PI / 3];
const bevelInset = (angle: number) => BEVEL * (1 - Math.cos(angle));
const bevelDepth = (angle: number) => RIM_Z + BEVEL * Math.sin(angle);
const shoulders = SHOULDER_ANGLES.map((angle, index) => ({
  outline: buildBodyOutline(bevelInset(angle)),
  z: bevelDepth(angle),
  /** How far this ring has travelled from the side's colour to the face's. */
  towardsFace: (index + 1) / (SHOULDER_ANGLES.length + 1),
}));
const faceOutline = buildBodyOutline(BEVEL);
/** Stroking a fill in its own paint rounds its corners, because the context joins with arcs. */
const EDGE_ROUND = 1.1;

/* ---------- Accessories, the same ones mascots.tsx draws. A shape is a polygon with a depth, a paint and an
   optional rim; "worn" is the mascot rule: the body's own colour rimmed in the page colour. */

/** `body`, `ink`, `eye` and `dark` are tones of the face; anything else is a fixed hex colour. */
export type Paint = 'body' | 'ink' | 'eye' | 'dark' | `#${string}`;
export type Shape = {
  points: readonly (Point2 | Point3)[];
  z: number;
  closed: boolean;
  fill?: Paint;
  stroke?: Paint;
  lineWidth: number;
  /** A headset band: always painted before the body. */
  behind?: boolean;
  /** A headset cup: painted before or after the body depending on where it has turned to, with hysteresis. */
  side?: boolean;
  /** The propeller blade, drawn from the model's own spinning angle. */
  propeller?: boolean;
};

function shape(points: readonly (Point2 | Point3)[], z: number, options: Partial<Shape>): Shape {
  return { points, z, closed: true, lineWidth: 2, ...options };
}
function worn(points: readonly Point2[], z = HAT_Z) {
  return shape(points, z, { fill: 'body', stroke: 'ink', lineWidth: 2 });
}
function inkLine(gridPoints: readonly Point2[], lineWidth: number, z = HAT_Z + 0.3) {
  return shape(polygonPoints(gridPoints), z, { closed: false, stroke: 'ink', lineWidth });
}
function bodyLine(gridPoints: readonly Point2[], lineWidth: number, z = HAT_Z) {
  return shape(polygonPoints(gridPoints), z, { closed: false, stroke: 'body', lineWidth });
}
function inkFill(points: readonly Point2[], z = FRONT + 0.4) {
  return shape(points, z, { fill: 'ink' });
}
function colourFill(points: readonly Point2[], colour: Paint, z = HAT_Z) {
  return shape(points, z, { fill: colour });
}
function colourLine(gridPoints: readonly Point2[], colour: Paint, lineWidth: number, z = HAT_Z) {
  return shape(polygonPoints(gridPoints), z, { closed: false, stroke: colour, lineWidth });
}
const brim = (left: number, width: number) => worn(roundedRectPoints(left, 12.2, width, 2.6, 1.3));
const lensRing = (centreX: number) => shape(circlePoints(centreX, EYE_Y + 33, 6.2, 26), FRONT + 2.5, { closed: true, stroke: 'eye', lineWidth: 2.2 });

/** How the eyes are drawn: the sparing expressions of mascots.tsx, all in the eyes. */
export type FaceStyle = 'plain' | 'happy' | 'wink' | 'curious' | 'delighted' | 'sleepy' | 'glasses' | 'shades';
export type Look = { face: FaceStyle; shapes: readonly Shape[] };

/** Every mascot of mascots.tsx as a face style and the accessory it wears. */
export const looks: Record<MascotId, Look> = {
  classic: { face: 'plain', shapes: [] },
  happy: { face: 'happy', shapes: [] },
  curious: { face: 'curious', shapes: [] },
  wink: { face: 'wink', shapes: [] },
  sleepy: { face: 'sleepy', shapes: [bodyLine([[49, 6], [54, 6], [49, 11], [54, 11]], 2.4)] },
  focused: { face: 'glasses', shapes: [lensRing(EYE_LEFT + 32), lensRing(EYE_RIGHT + 32)] },
  antenna: { face: 'plain', shapes: [bodyLine([[32, 13], [32, 6]], 3.4), colourFill(circlePoints(32, 5, 3), '#ff8fa3')] },
  sprout: { face: 'plain', shapes: [bodyLine([[32, 13], [32, 7]], 3), colourFill(polygonPoints([[32, 8], [30, 5.5], [26.5, 4], [23, 5], [25, 8], [29, 9]]), '#5fb878'), colourFill(polygonPoints([[32, 8], [34, 5.5], [37.5, 4], [41, 5], [39, 8], [35, 9]]), '#5fb878')] },
  idea: { face: 'plain', shapes: [colourLine([[52, 4], [52, 11]], '#f2b33d', 2.6, FRONT), colourLine([[48.5, 7.5], [55.5, 7.5]], '#f2b33d', 2.6, FRONT)] },
  headset: { face: 'plain', shapes: [
    shape(ellipseArcPoints(32, 34, 23, 23, Math.PI, TAU, 24), 0, { closed: false, stroke: 'body', lineWidth: 3.2, behind: true }),
    { ...worn(roundedRectPoints(3, 30, 7, 12, 3.5), 0), side: true },
    { ...worn(roundedRectPoints(54, 30, 7, 12, 3.5), 0), side: true },
  ] },
  delighted: { face: 'delighted', shapes: [] },
  cool: { face: 'shades', shapes: [shape(roundedRectPoints(20, 21, 28, 12, 5), FRONT + 2.5, { fill: 'dark', stroke: 'ink', lineWidth: 2 })] },
  tie: { face: 'plain', shapes: [inkFill(polygonPoints([[29.5, 42], [34.5, 42], [33.3, 44.4], [35.2, 51], [32, 54], [28.8, 51], [30.7, 44.4]]))] },
  bowtie: { face: 'plain', shapes: [inkFill(polygonPoints([[23.5, 41.5], [31, 45], [23.5, 48.5]])), inkFill(polygonPoints([[40.5, 41.5], [33, 45], [40.5, 48.5]])), inkFill(circlePoints(32, 45, 2.4))] },
  briefcase: { face: 'plain', shapes: [worn(domePoints(32, 13.5, 10, 9)), brim(15.5, 33)] },
  calendar: { face: 'plain', shapes: [worn(domePoints(32, 13.5, 10.5, 10)), worn(roundedRectPoints(41, 9.1, 10.5, 4.4, 2.2))] },
  mail: { face: 'plain', shapes: [worn(polygonPoints([[17.5, 13.5], [32, 3], [46.5, 13.5]])), inkLine([[24, 13.5], [32, 7], [40, 13.5]], 1.6)] },
  finance: { face: 'plain', shapes: [worn(roundedRectPoints(23.5, 3.5, 17, 10.5, 1.2)), brim(16, 32)] },
  search: { face: 'plain', shapes: [worn(domePoints(32, 13.5, 11, 10)), brim(14.5, 35), worn(roundedRectPoints(15.5, 7.5, 4, 6.5, 2)), worn(roundedRectPoints(44.5, 7.5, 4, 6.5, 2))] },
  chart: { face: 'plain', shapes: [worn(polygonPoints([[13.5, 8.5], [32, 2.5], [50.5, 8.5], [32, 14.5]])), bodyLine([[46.5, 10], [46.5, 15.5]], 1.8), worn(circlePoints(46.5, 16.5, 1.6))] },
  target: { face: 'plain', shapes: [worn(domeClippedPoints(32, 18.2, 15, 12, 13)), worn(circlePoints(44, 7.5, 3))] },
  writer: { face: 'plain', shapes: [worn(domePoints(32, 12.5, 12, 9)), worn(circlePoints(43, 4, 2.4))] },
  notes: { face: 'plain', shapes: [worn(domePoints(32, 11.5, 11, 9)), worn(polygonPoints([[15, 11.5], [49, 11.5], [45, 15], [19, 15]]))] },
  megaphone: { face: 'plain', shapes: [worn(polygonPoints([[32, 1.5], [43, 13.5], [21, 13.5]])), worn(circlePoints(32, 1.5, 2.6))] },
  checker: { face: 'plain', shapes: [worn(polygonPoints([[20, 13.5], [21.5, 3], [27.5, 8.5], [32, 1], [36.5, 8.5], [42.5, 3], [44, 13.5]]))] },
  guard: { face: 'plain', shapes: [worn(domePoints(32, 13.5, 11, 10.5)), brim(15, 34), inkLine([[32, 4.5], [32, 12]], 1.8)] },
  coder: { face: 'plain', shapes: [worn(domePoints(32, 12, 10, 9.5)), worn(roundedRectPoints(19.5, 12, 25, 3, 1.2)), worn(circlePoints(32, 2.5, 2.6))] },
  automation: { face: 'plain', shapes: [worn(domePoints(32, 13.5, 9.5, 9)), bodyLine([[32, 5.5], [32, 10.5]], 1.8), shape([], 0, { propeller: true })] },
  care: { face: 'plain', shapes: [worn(roundedRectPoints(22, 5.5, 20, 8, 1.2)), inkLine([[29.5, 9.5], [34.5, 9.5]], 2), inkLine([[32, 7], [32, 12]], 2)] },
};

/* ---------- Springs. Every animated value is a spring pulled at a target; gestures either move the target or kick
   the velocity, and the spring makes the overshoot and the settle. */

export type Spring = { value: number; velocity: number; target: number };

export function createSpring(value = 0): Spring {
  return { value, velocity: 0, target: value };
}

export function stepSpring(spring: Spring, stiffness: number, damping: number, dt: number) {
  const acceleration = stiffness * (spring.target - spring.value) - damping * spring.velocity;
  spring.velocity += acceleration * dt;
  spring.value += spring.velocity * dt;
}

export function dampingFor(stiffness: number, ratio: number) {
  return 2 * ratio * Math.sqrt(stiffness);
}

export function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Seeded randomness, so a face's personality is the same every time it is shown. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- The model: one face's springs, personality, acts and particles. */

/**
 * Acts are the gestures. `hop` is the greeting (a kick upwards); `cheese` the smile with a small hop (the picker's
 * chosen face, no flash); `lean` two faces gossiping with speech bubbles; `stare` a look at a point; `stretch`,
 * `sing`, `doze` and `squint` the idle moments, and `glance` a look off to one side.
 */
export type ActKind = 'hop' | 'cheese' | 'lean' | 'stare' | 'stretch' | 'sing' | 'doze' | 'squint' | 'glance';
export type ActData = {
  strength?: number; rollKick?: number; direction?: number; speaking?: readonly (readonly [number, number])[];
  /** Where to look, in grid units from this face's centre. */
  targetX?: number; targetY?: number; suspicious?: boolean;
  burst?: boolean; blinked?: boolean; nextNote?: number; nextZ?: number; startled?: boolean;
};
export type Act = { kind: ActKind; start: number; duration: number; data: ActData; started: boolean };

/** What the face is doing for the app: a run thinking (turning side to side) or working (reading its work). */
export type Mood = 'idle' | 'thinking' | 'working';

type Particle = { kind: 'note' | 'z'; text: string; x: number; y: number; velocityX: number; velocityY: number; born: number; life: number; size: number; wobble: number };

export type Personality = { stiffness: number; ratio: number; blinkEvery: number; phase: number; side: number };

export type OrgletModel = {
  look: Look;
  personality: Personality;
  yaw: Spring; pitch: Spring; roll: Spring; spin: Spring; lift: Spring; scaleX: Spring; scaleY: Spring;
  eyeX: Spring; eyeY: Spring; eyeOpen: Spring; happy: Spring; blush: Spring;
  speaking: number;
  propellerAngle: number;
  propellerSpeed: number;
  blinkStart: number;
  nextBlink: number;
  mood: Mood;
  acts: Act[];
  particles: Particle[];
  /** Which side a headset cup was last painted on, per shape index (hysteresis, see `shapeInFront`). */
  sideFront: Record<number, boolean>;
};

function personalityFrom(seed: number): Personality {
  const random = createRandom(seed);
  return {
    stiffness: 55 + random() * 75,
    ratio: 0.62 + random() * 0.26,
    // Calmer than the showcase page: an app is looked at all day.
    blinkEvery: 4 + random() * 4,
    phase: random() * TAU,
    side: random() < 0.5 ? -1 : 1,
  };
}

export function createOrglet(id: MascotId, seed: number, now: number): OrgletModel {
  const look = looks[id];
  const personality = personalityFrom(seed);
  const random = createRandom(seed + 1);
  return {
    look,
    personality,
    yaw: createSpring(0),
    pitch: createSpring(0),
    roll: createSpring(0),
    spin: createSpring(0),
    lift: createSpring(0),
    scaleX: createSpring(1),
    scaleY: createSpring(1),
    eyeX: createSpring(0),
    eyeY: createSpring(0),
    eyeOpen: createSpring(1),
    happy: createSpring(look.face === 'happy' ? 1 : 0),
    blush: createSpring(look.face === 'happy' || look.face === 'delighted' ? 1 : 0),
    speaking: 0,
    propellerAngle: random() * TAU,
    propellerSpeed: 0,
    blinkStart: -10,
    nextBlink: now + 1 + random() * 4,
    mood: 'idle',
    acts: [],
    particles: [],
    sideFront: {},
  };
}

/** Swaps the drawing (a new mascot chosen) and keeps the pose, so the head does not snap. */
export function changeLook(model: OrgletModel, id: MascotId) {
  model.look = looks[id];
  model.sideFront = {};
}

/** The pose a greeting starts from: crouched below the line with the eyes shut, so the hop reads as arriving. */
export function crouch(model: OrgletModel) {
  model.lift.value = 12;
  model.scaleY.value = 0.75;
  model.eyeOpen.value = 0;
}

export function addAct(model: OrgletModel, kind: ActKind, start: number, duration: number, data: ActData = {}): Act {
  const act: Act = { kind, start, duration, data, started: false };
  model.acts.push(act);
  return act;
}

export function blink(model: OrgletModel, now: number) {
  model.blinkStart = now;
  model.nextBlink = now + model.personality.blinkEvery * (0.7 + Math.random() * 0.6);
}

/** How long the blink now playing still needs, or 0 when the eyes are open. */
const BLINK_LENGTH = 0.2;

function spawnNote(model: OrgletModel, now: number) {
  const side = model.personality.side;
  model.particles.push({
    kind: 'note',
    text: Math.random() < 0.5 ? '♪' : '♫',
    x: side * (22 + Math.random() * 6),
    y: -(4 + Math.random() * 8),
    velocityX: side * (6 + Math.random() * 6),
    velocityY: -(18 + Math.random() * 6),
    born: now,
    life: 1.5,
    size: 8 + Math.random() * 4,
    wobble: Math.random() * TAU,
  });
}

function spawnZ(model: OrgletModel, now: number) {
  model.particles.push({
    kind: 'z',
    text: 'z',
    x: 20,
    y: -14,
    velocityX: 7,
    velocityY: -12,
    born: now,
    life: 2.2,
    size: 7,
    wobble: Math.random() * TAU,
  });
}

/** Where this face wants to be this frame; the acts edit it and the springs are pulled towards it. */
export type Pose = {
  yaw: number; pitch: number; roll: number; lift: number; scaleX: number; scaleY: number;
  eyeX: number; eyeY: number; eyeOpen: number; happy: number; blush: number; speaking: number; stiffnessScale: number;
};

type ActHandler = (model: OrgletModel, progress: number, act: Act, now: number, pose: Pose) => void;

const settleWindow = (progress: number, attack: number, release: number) => Math.min(1, progress * attack) * Math.min(1, (1 - progress) * release);

const actHandlers: Record<ActKind, ActHandler> = {
  hop(model, _progress, act) {
    if (!act.started) {
      model.lift.velocity -= act.data.strength ?? 150;
      model.roll.velocity += act.data.rollKick ?? 0;
      model.propellerSpeed = 30;
    }
  },
  cheese(model, progress, act, _now, pose) {
    if (!act.started) {
      model.lift.velocity -= 70;
    }
    const settle = settleWindow(progress, 6, 4);
    pose.yaw *= 1 - settle;
    pose.pitch = pose.pitch * (1 - settle) - 0.06 * settle;
    pose.roll *= 1 - settle;
    pose.eyeX *= 1 - settle;
    pose.eyeY *= 1 - settle;
    pose.happy = Math.max(pose.happy, settle);
    pose.blush = Math.max(pose.blush, settle);
  },
  lean(_model, progress, act, now, pose) {
    const settle = settleWindow(progress, 5, 5);
    const direction = act.data.direction ?? 1;
    pose.roll = 0.16 * direction * settle;
    pose.yaw = 0.62 * direction * settle;
    pose.pitch = 0.05 * settle;
    pose.eyeX = 1.6 * direction * settle;
    pose.eyeY = 0.4;
    for (const window of act.data.speaking ?? []) {
      const at = now - act.start;
      if (at > window[0] && at < window[1]) {
        pose.speaking = Math.min(1, (at - window[0]) * 8, (window[1] - at) * 8);
        pose.lift = Math.sin((at - window[0]) * 14) * 0.7;
      }
    }
  },
  stare(_model, progress, act, _now, pose) {
    const settle = settleWindow(progress, 4, 4);
    const reach = 110;
    const towards = clamp(Math.atan2(act.data.targetX ?? 0, reach), -0.78, 0.78);
    const down = clamp(Math.atan2(act.data.targetY ?? 0, reach), -0.5, 0.42);
    pose.yaw = towards * settle;
    pose.pitch = down * settle;
    pose.eyeX = clamp(towards * 2.2, -1.8, 1.8) * settle;
    pose.eyeY = clamp(down * 2.2, -1.5, 1.5) * settle;
    if (act.data.suspicious) {
      pose.eyeOpen = Math.min(pose.eyeOpen, 1 - 0.35 * settle);
    }
  },
  glance(model, progress, act, _now, pose) {
    const settle = settleWindow(progress, 4, 3);
    const direction = act.data.direction ?? model.personality.side;
    pose.yaw = 0.3 * direction * settle;
    pose.roll = 0.04 * direction * settle;
    pose.eyeX = 1.3 * direction * settle;
    pose.eyeY = -0.6 * settle;
  },
  stretch(_model, progress, _act, _now, pose) {
    const arc = Math.sin(progress * Math.PI);
    pose.scaleY = 1 + 0.09 * arc;
    pose.scaleX = 1 - 0.03 * arc;
    pose.pitch -= 0.2 * arc;
    pose.eyeOpen = Math.min(pose.eyeOpen, 1 - 0.7 * arc);
  },
  squint(_model, progress, _act, _now, pose) {
    const settle = settleWindow(progress, 5, 5);
    pose.eyeOpen = Math.min(pose.eyeOpen, 1 - 0.5 * settle);
  },
  sing(model, progress, act, now, pose) {
    const settle = settleWindow(progress, 6, 5);
    pose.happy = Math.max(pose.happy, settle);
    pose.roll += Math.sin(now * 7.2) * 0.09 * settle;
    pose.pitch -= 0.14 * settle;
    pose.lift += Math.sin(now * 14.4) * 0.6 * settle;
    if (now > (act.data.nextNote ?? 0) && settle > 0.6) {
      act.data.nextNote = now + 0.42 + Math.random() * 0.2;
      spawnNote(model, now);
    }
  },
  doze(model, progress, act, now, pose) {
    const settle = settleWindow(progress, 3.5, 12);
    pose.eyeOpen = Math.min(pose.eyeOpen, 1 - settle);
    pose.pitch = 0.3 * settle + Math.sin(now * 1.4) * 0.05 * settle;
    pose.roll = 0.08 * model.personality.side * settle;
    pose.yaw *= 1 - settle;
    pose.eyeX *= 1 - settle;
    pose.scaleY = 1 + Math.sin(now * 1.4) * 0.012 * settle;
    if (now > (act.data.nextZ ?? act.start + 1.2) && progress < 0.85) {
      act.data.nextZ = now + 0.85;
      spawnZ(model, now);
    }
    if (progress > 0.92 && !act.data.startled) {
      act.data.startled = true;
      model.lift.velocity -= 130;
      model.pitch.velocity -= 5;
      blink(model, now + 0.25);
    }
  },
};

/** Where the pointer is, in grid units from the face's centre, and whether it is on the face at all. */
export type Attention = {
  present: boolean;
  x: number;
  y: number;
  /** The pointer is over this face (it perks up). */
  near: boolean;
  /** The face's control has keyboard focus (it perks up the same way). */
  noticed: boolean;
};

export const restingAttention: Attention = { present: false, x: 0, y: 0, near: false, noticed: false };

/** The reach of a look in grid units: how far away a pointer has to be before the head is turned fully. */
export const LOOK_REACH = 170;

function basePose(model: OrgletModel, attention: Attention, now: number, reducedMotion: boolean): Pose {
  const pose: Pose = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    lift: 0,
    scaleX: 1,
    scaleY: 1,
    eyeX: 0,
    eyeY: 0,
    eyeOpen: 1,
    happy: model.look.face === 'happy' ? 1 : 0,
    blush: model.look.face === 'happy' || model.look.face === 'delighted' ? 1 : 0,
    speaking: 0,
    stiffnessScale: 1,
  };
  // With reduced motion the head never tracks the pointer: a face that turns after the cursor is exactly the
  // motion the setting asks not to have. The face still shows its state, as a cut.
  if (attention.present && !reducedMotion) {
    const distance = Math.hypot(attention.x, attention.y);
    pose.yaw = clamp(Math.atan2(attention.x, LOOK_REACH), -0.78, 0.78);
    pose.pitch = clamp(Math.atan2(attention.y, LOOK_REACH), -0.5, 0.42);
    pose.eyeX = clamp(attention.x / LOOK_REACH, -1, 1) * 1.7;
    pose.eyeY = clamp(attention.y / LOOK_REACH, -1, 1) * 1.5;
    // Near the pointer a head answers at once; far away it takes its time.
    pose.stiffnessScale = clamp(1.35 - distance / 500, 0.5, 1.35);
  }
  if (!reducedMotion && (attention.near || attention.noticed)) {
    pose.eyeOpen = 1.06;
    pose.lift = -1.5;
  }
  if (model.mood === 'thinking') {
    // The Thinking state of the small faces: the head turns from side to side and pauses at each side, the eyes a
    // beat ahead. A slow triangle wave with flat tops, on the same cycle as the stylesheet's --motion-cycle. With
    // reduced motion only the raised eyes remain.
    const cycle = (now * (1 / 2.8) + model.personality.phase / TAU) % 1;
    const swing = reducedMotion ? 0 : clamp(Math.sin(cycle * TAU) * 1.6, -1, 1);
    pose.yaw = 0.42 * swing;
    pose.eyeX = reducedMotion ? 0 : 1.4 * clamp(Math.sin((cycle + 0.06) * TAU) * 1.6, -1, 1);
    pose.eyeY = -0.8;
    pose.stiffnessScale = 0.7;
  }
  if (model.mood === 'working') {
    // The Working state: the head settles level and leans in, the eyes drop to the work and read it left to right.
    // With reduced motion the lean and the dropped eyes remain, without the sweep.
    const cycle = (now * (1 / 2.8)) % 1;
    pose.pitch = 0.14;
    pose.eyeY = 1.4;
    pose.eyeX = reducedMotion ? 0 : cycle < 0.8 ? -1.4 + (cycle / 0.8) * 2.8 : -1.4;
    pose.stiffnessScale = 1.5;
  }
  if (model.look.face === 'wink' || model.look.face === 'sleepy') {
    pose.happy = 0;
  }
  return pose;
}

/** Advances a face by `dt` seconds towards what the pointer, its mood and its live acts ask of it. */
export function updateOrglet(model: OrgletModel, attention: Attention, now: number, dt: number, reducedMotion: boolean) {
  const pose = basePose(model, attention, now, reducedMotion);
  if (reducedMotion) {
    // No gestures at all: a hop or a stretch is exactly what the setting asks not to see.
    model.acts = [];
    model.particles = [];
    model.propellerSpeed = 0;
  }
  for (const act of model.acts) {
    if (now < act.start) {
      continue;
    }
    const progress = clamp((now - act.start) / act.duration, 0, 1);
    actHandlers[act.kind](model, progress, act, now, pose);
    act.started = true;
  }
  model.acts = model.acts.filter(act => now < act.start + act.duration);

  const person = model.personality;
  const headStiffness = person.stiffness * pose.stiffnessScale;
  const headDamping = dampingFor(headStiffness, person.ratio);
  model.yaw.target = pose.yaw;
  model.pitch.target = pose.pitch;
  model.roll.target = pose.roll;
  model.lift.target = pose.lift;
  model.scaleX.target = pose.scaleX;
  model.scaleY.target = pose.scaleY;
  // The eyes lead: they run ahead of the head by however far the head still has to turn (nothing to lead as a cut).
  const lead = reducedMotion ? 0 : 1.2;
  model.eyeX.target = clamp(pose.eyeX + (model.yaw.target - model.yaw.value) * lead, -2.4, 2.4);
  model.eyeY.target = clamp(pose.eyeY + (model.pitch.target - model.pitch.value) * lead, -2, 2.2);
  model.eyeOpen.target = pose.eyeOpen;
  model.happy.target = pose.happy;
  model.blush.target = pose.blush;
  model.speaking = pose.speaking;

  if (reducedMotion) {
    // A cut to the state rather than a glide.
    for (const spring of springsOf(model)) {
      spring.value = spring.target;
      spring.velocity = 0;
    }
  } else {
    // The stiff springs are integrated in small steps so a long frame cannot make them overshoot wildly.
    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const step = dt / substeps;
    for (let index = 0; index < substeps; index++) {
      stepSpring(model.yaw, headStiffness, headDamping, step);
      stepSpring(model.pitch, headStiffness, headDamping, step);
      stepSpring(model.roll, 120, dampingFor(120, 0.55), step);
      stepSpring(model.spin, 42, dampingFor(42, 0.72), step);
      stepSpring(model.lift, 160, dampingFor(160, 0.5), step);
      stepSpring(model.scaleX, 220, dampingFor(220, 0.5), step);
      stepSpring(model.scaleY, 220, dampingFor(220, 0.5), step);
      stepSpring(model.eyeX, 320, dampingFor(320, 1), step);
      stepSpring(model.eyeY, 320, dampingFor(320, 1), step);
      stepSpring(model.eyeOpen, 260, dampingFor(260, 1), step);
      stepSpring(model.happy, 90, dampingFor(90, 1), step);
      stepSpring(model.blush, 40, dampingFor(40, 1), step);
    }
  }

  // A finished spin is folded back to zero so the next one turns a full circle again.
  if (Math.abs(model.spin.value - model.spin.target) < 0.01 && Math.abs(model.spin.velocity) < 0.05 && model.spin.target !== 0) {
    model.spin.value -= model.spin.target;
    model.spin.target = 0;
  }
  // The propeller only turns after a hop and winds down, so a still face stays still.
  model.propellerSpeed = Math.max(0, model.propellerSpeed - dt * 18);
  model.propellerAngle += model.propellerSpeed * dt;

  if (!reducedMotion && now >= model.nextBlink) {
    blink(model, now);
  }
  model.particles = model.particles.filter(particle => now - particle.born < particle.life);
  for (const particle of model.particles) {
    particle.x += particle.velocityX * dt;
    particle.y += particle.velocityY * dt;
  }
}

function springsOf(model: OrgletModel): Spring[] {
  return [model.yaw, model.pitch, model.roll, model.spin, model.lift, model.scaleX, model.scaleY, model.eyeX, model.eyeY, model.eyeOpen, model.happy, model.blush];
}

/**
 * Whether nothing about this face will change on the next frame: every spring at rest on its target, no act live
 * or pending, no blink playing, nothing floating away, and no mood that moves on its own. The stage stops the
 * frame loop when every face is still, which is what keeps an idle app at zero.
 */
export function isStill(model: OrgletModel, now: number, reducedMotion = false) {
  // A mood moves on its own only when motion is allowed; as a cut it is a pose like any other.
  if ((model.mood !== 'idle' && !reducedMotion) || model.acts.length > 0 || model.particles.length > 0 || model.propellerSpeed > 0) {
    return false;
  }
  if (now - model.blinkStart < BLINK_LENGTH) {
    return false;
  }
  for (const spring of springsOf(model)) {
    if (Math.abs(spring.value - spring.target) > 0.0015 || Math.abs(spring.velocity) > 0.004) {
      return false;
    }
  }
  return true;
}

/** Snaps every spring onto its target: used once a face is deemed still, so no residue is left to drift. */
export function settle(model: OrgletModel) {
  for (const spring of springsOf(model)) {
    spring.value = spring.target;
    spring.velocity = 0;
  }
}

/* ---------- Projection. The head first turns about its own vertical axis by the spin, then the whole thing is
   rotated by the smallest rotation that points the face at the look direction (Rodrigues), so a head looking
   up-and-right does not pick up a twist the way a yaw-then-pitch pair would. Positive yaw looks right, positive
   pitch looks down; a touch of perspective. */

export type Rotation = { matrix: number[]; cosSpin: number; sinSpin: number; sinYaw: number; sinPitch: number; facing: boolean };

export function buildRotation(yaw: number, pitch: number, spin: number): Rotation {
  const dx = Math.tan(clamp(yaw, -1.4, 1.4));
  const dy = Math.tan(clamp(pitch, -1.2, 1.2));
  const length = Math.hypot(dx, dy, 1);
  const lookX = dx / length;
  const lookY = dy / length;
  const lookZ = 1 / length;
  const k = 1 / (1 + lookZ);
  const matrix = [
    1 - lookX * lookX * k, -lookX * lookY * k, lookX,
    -lookX * lookY * k, 1 - lookY * lookY * k, lookY,
    -lookX, -lookY, lookZ,
  ];
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  // Where the front face ends up pointing, for the lighting and for front-or-back.
  const normalX = matrix[0] * sinSpin + matrix[2] * cosSpin;
  const normalY = matrix[3] * sinSpin + matrix[5] * cosSpin;
  const normalZ = matrix[6] * sinSpin + matrix[8] * cosSpin;
  return { matrix, cosSpin, sinSpin, sinYaw: normalX, sinPitch: normalY, facing: normalZ > 0 };
}

export function projectPoint(rotation: Rotation, x: number, y: number, z: number): [number, number, number] {
  const x1 = x * rotation.cosSpin + z * rotation.sinSpin;
  const z1 = -x * rotation.sinSpin + z * rotation.cosSpin;
  const m = rotation.matrix;
  const x2 = m[0] * x1 + m[1] * y + m[2] * z1;
  const y2 = m[3] * x1 + m[4] * y + m[5] * z1;
  const z2 = m[6] * x1 + m[7] * y + m[8] * z1;
  const perspective = FOCAL / (FOCAL - z2);
  return [x2 * perspective, y2 * perspective, z2];
}

/** Andrew's monotone chain; the points are few, so the sort is cheap. */
export function convexHull(points: readonly (readonly number[])[]): (readonly number[])[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (origin: readonly number[], a: readonly number[], b: readonly number[]) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: (readonly number[])[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: (readonly number[])[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/* ---------- Drawing. */

type Context = CanvasRenderingContext2D;

function tracePolygon(context: Context, points: readonly (readonly number[])[], closed: boolean) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) {
    context.lineTo(points[index][0], points[index][1]);
  }
  if (closed) {
    context.closePath();
  }
}

function paintFor(key: Paint, tones: Tones) {
  if (key === 'body') {
    return rgbString(mixRgb(tones.base, tones.lit, 0.4));
  }
  if (key === 'ink') {
    return rgbString(tones.ink);
  }
  if (key === 'eye') {
    return rgbString(tones.eye);
  }
  if (key === 'dark') {
    return rgbString(tones.dark);
  }
  return key;
}

type ProjectedShape = { projected: [number, number, number][]; depth: number; propeller?: boolean };

function projectShape(record: Shape, rotation: Rotation, model: OrgletModel): ProjectedShape {
  if (record.propeller) {
    return projectPropeller(rotation, model);
  }
  const depthOf = (point: Point2 | Point3) => point.length === 3 ? point[2] : record.z;
  const projected = record.points.map(point => projectPoint(rotation, point[0], point[1], depthOf(point)));
  let depth = 0;
  for (const point of projected) {
    depth += point[2];
  }
  return { projected, depth: projected.length ? depth / projected.length : record.z };
}

function projectPropeller(rotation: Rotation, model: OrgletModel): ProjectedShape {
  const angle = model.propellerAngle;
  const reach = 9;
  const bladeY = -27.5;
  const tipOne = projectPoint(rotation, -reach * Math.cos(angle), bladeY, -reach * Math.sin(angle));
  const tipTwo = projectPoint(rotation, reach * Math.cos(angle), bladeY, reach * Math.sin(angle));
  return { projected: [tipOne, tipTwo], depth: 1, propeller: true };
}

function drawShape(context: Context, record: Shape, projected: readonly (readonly number[])[], tones: Tones) {
  if (projected.length < 2) {
    return;
  }
  tracePolygon(context, projected, record.closed);
  if (record.fill) {
    context.fillStyle = paintFor(record.fill, tones);
    context.fill();
    if (!record.stroke) {
      // A rimless shape is a bare fill, so its polygon corners stay sharp; stroking it in its own paint rounds them
      // the way the rim rounds a worn one.
      context.strokeStyle = context.fillStyle;
      context.lineWidth = EDGE_ROUND;
      context.stroke();
    }
  }
  if (record.stroke) {
    context.strokeStyle = paintFor(record.stroke, tones);
    context.lineWidth = record.lineWidth;
    context.stroke();
  }
}

function drawAccessory(context: Context, record: Shape, result: ProjectedShape, tones: Tones) {
  if (result.propeller) {
    tracePolygon(context, result.projected, false);
    context.strokeStyle = rgbString(tones.ink);
    context.lineWidth = 4;
    context.stroke();
    context.strokeStyle = paintFor('body', tones);
    context.lineWidth = 2.2;
    context.stroke();
    return;
  }
  drawShape(context, record, result.projected, tones);
}

// Where an accessory sits in the draw order. Head-worn things always paint after the body; a headset band always
// paints before it; a side cup switches when it is clearly behind or clearly in front, with a dead band in between
// so a pointer hovering near the switch cannot make it chatter.
function shapeInFront(model: OrgletModel, index: number, record: Shape, result: ProjectedShape) {
  if (record.behind) {
    return false;
  }
  if (!record.side) {
    return true;
  }
  const previous = model.sideFront[index];
  const depth = result.depth;
  if (previous === undefined) {
    model.sideFront[index] = depth >= 0;
  } else if (previous && depth < -2.5) {
    model.sideFront[index] = false;
  } else if (!previous && depth > 2.5) {
    model.sideFront[index] = true;
  }
  return model.sideFront[index];
}

function blinkFraction(sinceBlink: number) {
  if (sinceBlink < 0 || sinceBlink > BLINK_LENGTH) {
    return 0;
  }
  if (sinceBlink < 0.06) {
    return sinceBlink / 0.06;
  }
  if (sinceBlink < 0.1) {
    return 1;
  }
  return 1 - (sinceBlink - 0.1) / 0.1;
}

type EyeSpec = { x: number; y: number; height: number; shut: boolean };

function eyeSpec(model: OrgletModel): { left: EyeSpec; right: EyeSpec } {
  const style = model.look.face;
  const spec = {
    left: { x: EYE_LEFT, y: EYE_Y, height: EYE_HEIGHT, shut: false },
    right: { x: EYE_RIGHT, y: EYE_Y, height: EYE_HEIGHT, shut: false },
  };
  if (style === 'curious') {
    spec.left.x += 1.5;
    spec.left.y -= 1;
    spec.right.x += 1.5;
    spec.right.y -= 2.5;
    spec.right.height = 12.5;
  }
  if (style === 'delighted') {
    spec.left.height = 12;
    spec.right.height = 12;
    spec.left.y += 0.5;
    spec.right.y += 0.5;
  }
  if (style === 'wink') {
    spec.right.shut = true;
  }
  if (style === 'sleepy') {
    spec.left.shut = true;
    spec.right.shut = true;
    spec.left.y += 2;
    spec.right.y += 2;
  }
  if (style === 'glasses') {
    spec.left.height = 7.5;
    spec.right.height = 7.5;
  }
  return spec;
}

function drawEyes(context: Context, model: OrgletModel, rotation: Rotation, tones: Tones, now: number) {
  const eyeColour = rgbString(tones.eye);
  const spec = eyeSpec(model);
  const blinkAmount = blinkFraction(now - model.blinkStart);
  const open = clamp(model.eyeOpen.value, 0, 1.12) * (1 - blinkAmount * 0.92);
  const happyBlend = smoothstep(0.3, 0.7, model.happy.value);
  const gazeX = model.eyeX.value;
  const gazeY = model.eyeY.value;
  const eyeZ = FRONT + 0.6;
  for (const eye of [spec.left, spec.right]) {
    const centreX = eye.x + gazeX;
    const centreY = eye.y + gazeY;
    if (eye.shut) {
      const projected = capsulePoints(centreX, centreY, 7, 3).map(([x, y]) => projectPoint(rotation, x, y, eyeZ));
      context.fillStyle = eyeColour;
      tracePolygon(context, projected, true);
      context.fill();
      continue;
    }
    const height = Math.max(1.6, eye.height * open * (1 - happyBlend));
    if (happyBlend < 1) {
      const projected = capsulePoints(centreX, centreY, EYE_WIDTH, height).map(([x, y]) => projectPoint(rotation, x, y, eyeZ));
      context.globalAlpha = tones.alpha * (1 - happyBlend);
      context.fillStyle = eyeColour;
      tracePolygon(context, projected, true);
      context.fill();
      context.globalAlpha = tones.alpha;
    }
    if (happyBlend > 0) {
      const arch: [number, number, number][] = [];
      for (let index = 0; index <= 8; index++) {
        const t = index / 8;
        const startX = centreX - 2.6;
        const endX = centreX + 2.6;
        const baseY = centreY + 1.6;
        const controlY = centreY - 3.2;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * centreX + t * t * endX;
        const y = (1 - t) * (1 - t) * baseY + 2 * (1 - t) * t * controlY + t * t * baseY;
        arch.push(projectPoint(rotation, x, y, eyeZ));
      }
      context.globalAlpha = tones.alpha * happyBlend;
      context.strokeStyle = eyeColour;
      context.lineWidth = 2.8;
      tracePolygon(context, arch, false);
      context.stroke();
      context.globalAlpha = tones.alpha;
    }
  }
  const blushAmount = model.blush.value;
  if (blushAmount > 0.02) {
    context.fillStyle = '#ff8fa3';
    context.globalAlpha = tones.alpha * 0.6 * clamp(blushAmount, 0, 1);
    for (const cheekX of [-10, 13]) {
      const cheek = ellipseArcPoints(cheekX + 32 + gazeX * 0.3, 35.5, 3.2, 1.9, 0, TAU, 14).map(([x, y]) => projectPoint(rotation, x, y, eyeZ));
      tracePolygon(context, cheek, true);
      context.fill();
    }
    context.globalAlpha = tones.alpha;
  }
}

function drawSpeechBubble(context: Context, model: OrgletModel, tones: Tones) {
  const amount = model.speaking;
  if (!amount) {
    return;
  }
  const scale = 0.6 + 0.4 * amount;
  context.save();
  context.translate(19, -36);
  context.scale(scale, scale);
  context.globalAlpha = tones.alpha * amount;
  const outline = roundedRectPoints(24, 26, 16, 13, 4.5);
  context.shadowColor = 'rgba(0,0,0,0.14)';
  context.shadowBlur = 3;
  context.shadowOffsetY = 1.5;
  context.fillStyle = rgbString(tones.surface);
  tracePolygon(context, outline, true);
  context.fill();
  context.beginPath();
  context.moveTo(-6, 4);
  context.lineTo(-8, 8.5);
  context.lineTo(-2.5, 5.5);
  context.closePath();
  context.fill();
  context.shadowColor = 'transparent';
  context.fillStyle = rgbString(tones.muted);
  for (const dotX of [-4, 0, 4]) {
    context.beginPath();
    context.arc(dotX, -0.5, 1.15, 0, TAU);
    context.fill();
  }
  context.restore();
}

function faceGradient(context: Context, front: readonly (readonly number[])[], tones: Tones, rotation: Rotation) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of front) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // Turning away from the top-left light darkens the face; turning into it lightens it.
  const away = clamp(0.35 * rotation.sinYaw + 0.25 * rotation.sinPitch, -0.35, 0.35);
  const shade = (colour: Rgb) => away > 0 ? mixRgb(colour, BLACK, away * 0.5) : mixRgb(colour, WHITE, -away * 0.35);
  const gradient = context.createLinearGradient(minX, minY, maxX, maxY);
  gradient.addColorStop(0, rgbString(shade(tones.lit)));
  gradient.addColorStop(0.5, rgbString(shade(tones.base)));
  gradient.addColorStop(1, rgbString(shade(tones.shaded)));
  return gradient;
}

// The contact shadow, like the `mascot-ground` ellipse of the flat drawing: it spreads and fades as the face lifts.
function drawShadow(context: Context, model: OrgletModel, tones: Tones, unit: number) {
  const height = clamp(-model.lift.value, 0, 40);
  const spread = 1 + height / 40;
  const radiusX = 17 * unit * spread * model.scaleX.value;
  const radiusY = 3 * unit * spread;
  const alpha = 0.22 * Math.pow(1 - height / 42, 1.6) * tones.alpha;
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgbString(tones.ground, alpha));
  gradient.addColorStop(1, rgbString(tones.ground, 0));
  context.save();
  context.translate(0, (BODY_HALF + 2.5) * unit);
  context.scale(radiusX, radiusY);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, TAU);
  context.fill();
  context.restore();
}

function drawParticles(context: Context, model: OrgletModel, tones: Tones, unit: number, now: number) {
  for (const particle of model.particles) {
    const age = (now - particle.born) / particle.life;
    const fade = 1 - age * age;
    context.globalAlpha = tones.alpha * fade;
    context.fillStyle = rgbString(particle.kind === 'note' ? tones.accent : tones.muted);
    context.font = `600 ${particle.size * unit * (1 + age * 0.5)}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const sway = Math.sin(now * 4 + particle.wobble) * 2 * unit;
    context.fillText(particle.text, (particle.x + sway) * unit, particle.y * unit);
  }
  context.globalAlpha = tones.alpha;
}

/** Where on the canvas the face is drawn: the body centre in pixels, and the size of one grid unit in pixels. */
export type Layout = { x: number; y: number; unit: number };

/** Draws one face at its current pose. The caller has cleared the canvas and set the device scale. */
export function drawOrglet(context: Context, model: OrgletModel, tones: Tones, layout: Layout, now: number) {
  const unit = layout.unit;
  const rotation = buildRotation(model.yaw.value, model.pitch.value, model.spin.value);
  const facing = rotation.facing;

  context.save();
  context.globalAlpha = tones.alpha;
  context.translate(layout.x, layout.y);
  drawShadow(context, model, tones, unit);
  context.translate(0, model.lift.value * unit);
  context.rotate(model.roll.value);
  context.scale(unit * model.scaleX.value, unit * model.scaleY.value);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // The rolled edge: the widest cross-section is the rim at ±RIM_Z, the plates at ±FRONT are inset by the bevel,
  // and a shoulder sits at the 45° point between them.
  const rimFront = bodyOutline.map(([x, y]) => projectPoint(rotation, x, y, RIM_Z));
  const rimBack = bodyOutline.map(([x, y]) => projectPoint(rotation, x, y, -RIM_Z));
  const front = faceOutline.map(([x, y]) => projectPoint(rotation, x, y, FRONT));
  const back = faceOutline.map(([x, y]) => projectPoint(rotation, x, y, -FRONT));
  const frontCentre = projectPoint(rotation, 0, 0, FRONT);
  const backCentre = projectPoint(rotation, 0, 0, -FRONT);
  // The slab's silhouette is the convex hull of every cross-section; the bubble is convex apart from its tail, and
  // the tail is drawn again on the face plate on top.
  const hull = convexHull(rimFront.concat(rimBack, front, back));

  const projectedShapes = model.look.shapes.map((record, index) => {
    const result = projectShape(record, rotation, model);
    return { record, result, inFront: shapeInFront(model, index, record, result) };
  });
  for (const item of projectedShapes) {
    if (!item.inFront) {
      drawAccessory(context, item.record, item.result, tones);
    }
  }

  const litAmount = clamp(0.5 + 0.6 * rotation.sinYaw + 0.4 * rotation.sinPitch, 0, 1);
  const sideColour = mixRgb(tones.sideDark, tones.side, litAmount);
  const sideGradient = context.createLinearGradient(backCentre[0], backCentre[1], frontCentre[0], frontCentre[1]);
  sideGradient.addColorStop(0, rgbString(mixRgb(sideColour, BLACK, 0.3)));
  sideGradient.addColorStop(1, rgbString(sideColour));
  context.fillStyle = sideGradient;
  context.strokeStyle = sideGradient;
  context.lineWidth = EDGE_ROUND;
  tracePolygon(context, hull, true);
  context.fill();
  context.stroke();

  if (facing) {
    for (const shoulder of shoulders) {
      context.fillStyle = rgbString(mixRgb(sideColour, tones.base, shoulder.towardsFace));
      tracePolygon(context, shoulder.outline.map(([x, y]) => projectPoint(rotation, x, y, shoulder.z)), true);
      context.fill();
    }
    const face = faceGradient(context, front, tones, rotation);
    context.fillStyle = face;
    context.strokeStyle = face;
    tracePolygon(context, front, true);
    context.fill();
    context.stroke();
    drawEyes(context, model, rotation, tones, now);
  } else {
    for (const shoulder of shoulders) {
      context.fillStyle = rgbString(mixRgb(sideColour, tones.back, shoulder.towardsFace));
      tracePolygon(context, shoulder.outline.map(([x, y]) => projectPoint(rotation, x, y, -shoulder.z)), true);
      context.fill();
    }
    context.fillStyle = rgbString(tones.back);
    context.strokeStyle = rgbString(tones.back);
    tracePolygon(context, back, true);
    context.fill();
    context.stroke();
  }
  for (const item of projectedShapes) {
    if (item.inFront) {
      drawAccessory(context, item.record, item.result, tones);
    }
  }
  drawSpeechBubble(context, model, tones);
  context.restore();

  context.save();
  context.translate(layout.x, layout.y);
  drawParticles(context, model, tones, unit, now);
  context.restore();
}
