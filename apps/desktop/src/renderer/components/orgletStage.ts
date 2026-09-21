import type { MascotId } from './mascots';
import {
  addAct, blink, buildTones, changeLook, createOrglet, crouch, drawOrglet, isStill, restingAttention, settle, updateOrglet,
  type Attention, type Mood, type OrgletModel, type Palette, type Rgb, type Tones,
} from './orgletSolid';

/*
 * The stage: every 3D face on screen (COD-156) shares one pointer, one frame loop and one set of timers. A face is
 * a canvas registered with `mountFace`; the stage reads its colours from the stylesheet, draws it, turns it after
 * the pointer and gives it the moments of the standalone page mapped onto the app's own moments (a greeting when an
 * empty chat opens, a smile when a mascot is chosen, a team glancing at each other) instead of keyboard shortcuts.
 *
 * It is an app, not a showcase: the loop runs only while a visible face is moving and stops when every face is
 * still, so an idle window costs nothing; blinks and the rare idle moments wake it from a timer. Nothing here ever
 * changes layout: a canvas is a fixed box and the face moves inside it.
 */

export type Follow = 'pointer' | 'hover' | 'none';

export type FaceOptions = {
  id: MascotId;
  /** Seeds the face's personality (blink rhythm, which side it glances to). */
  seed: number;
  /** The size of the 64-unit drawing in CSS pixels; the canvas is twice that so a hop or a note has room. */
  size: number;
  /** `pointer`: turns after the pointer anywhere in the window. `hover`: only while the pointer is on it. */
  follow: Follow;
  /** A face the person is looking at may act unprompted now and then (a glance, a stretch); a listed face only reacts. */
  lead: boolean;
  /** Faces greeting together (a team): they hop in one after another, glance at each other and blink in a wave. */
  group?: string;
  /** Hop in when mounted, the way the standalone page's faces arrive. */
  greet: boolean;
  mood: Mood;
  /** Anything whose change means the colours must be read again (the avatar colour string). */
  colorKey: string;
};

export type FaceHandle = {
  update(options: FaceOptions): void;
  /** The "say cheese" smile with a small hop: the picker's chosen face. */
  cheer(): void;
  /** Plays one of the face's own moments now, on cue rather than on the idle dice: the startup screen's long wait. */
  play(moment: Moment): void;
  unmount(): void;
};

/** The one-face moments, and how long each runs; the group moments (a blink wave, a look at a neighbour) stay the stage's. */
export type Moment = 'glance' | 'stretch' | 'sing' | 'doze' | 'squint';
const momentLength: Record<Moment, number> = { glance: 1.4, stretch: 1.3, sing: 3.6, doze: 6, squint: 0.5 };

type Face = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  model: OrgletModel;
  options: FaceOptions;
  tones: Tones;
  visible: boolean;
  /** Something other than motion changed (colours, size, visibility), so it must be drawn even while still. */
  dirty: boolean;
  wasNear: boolean;
  noticed: boolean;
  /** Position in its group in mount order, which is also the order on screen (left to right). */
  groupIndex: number;
  /** Inside a dialog, so an open dialog does not cover it. */
  inDialog: boolean;
};

// The canvas is this many times the drawing, so a hop, a hat, a speech bubble or a note stays inside it.
export const CANVAS_SCALE = 2;
const GRID = 64;
// The idle moments of the standalone page, made rare enough for an app looked at all day.
const IDLE_MOMENT_MIN_SECONDS = 20;
const IDLE_MOMENT_MAX_SECONDS = 45;
// A face acts unprompted only once the pointer has rested this long, so nothing plays over what the person is doing.
const POINTER_REST_SECONDS = 6;
// A doze needs a long quiet spell, and a face only dozes off so often.
const DOZE_AFTER_SECONDS = 120;
const DOZE_EVERY_SECONDS = 300;

const faces = new Set<Face>();
const pointer = { x: 0, y: 0, present: false, movedAt: 0 };
let running = false;
let lastFrame = 0;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let lastDoze = -Infinity;
let observer: IntersectionObserver | undefined;
let themeObserver: MutationObserver | undefined;
let listening = false;
const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const darkSchemeQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;

const reducedMotion = () => reducedMotionQuery?.matches ?? false;
const seconds = () => performance.now() / 1000;

/* ---------- Colours, read from the stylesheet so a face follows the theme and the user's colour. */

/** Parses the colour forms `getComputedStyle` hands back: `#rrggbb`, `rgb[a](…)` and `color(srgb …)`. */
export function parseCssColour(value: string): { rgb: Rgb; alpha: number } | undefined {
  const text = value.trim();
  if (text.startsWith('#')) {
    const hex = text.length === 4 ? text.slice(1).split('').map(character => character + character).join('') : text.slice(1, 7);
    const number = parseInt(hex, 16);
    if (Number.isNaN(number)) return undefined;
    const alpha = text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1;
    return { rgb: [(number >> 16) & 255, (number >> 8) & 255, number & 255], alpha };
  }
  const rgbMatch = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (rgbMatch) {
    return { rgb: [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])], alpha: parseAlpha(rgbMatch[4]) };
  }
  const srgbMatch = text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (srgbMatch) {
    return { rgb: [Number(srgbMatch[1]) * 255, Number(srgbMatch[2]) * 255, Number(srgbMatch[3]) * 255], alpha: parseAlpha(srgbMatch[4]) };
  }
  return undefined;
}

function parseAlpha(value: string | undefined) {
  if (value === undefined) return 1;
  if (value.endsWith('%')) return Number(value.slice(0, -1)) / 100;
  return Number(value);
}

function readPalette(canvas: HTMLCanvasElement): Palette {
  const style = getComputedStyle(canvas);
  const token = (name: string, fallback: Rgb): Rgb => parseCssColour(style.getPropertyValue(name))?.rgb ?? fallback;
  const body = parseCssColour(style.color) ?? { rgb: [79, 127, 224] as Rgb, alpha: 1 };
  const ink = parseCssColour(style.getPropertyValue('--mascot-ink'))?.rgb ?? token('--bg', [255, 255, 255]);
  return {
    body: body.rgb,
    alpha: body.alpha,
    ink,
    surface: token('--surface', [246, 246, 246]),
    accent: token('--accent', [79, 127, 224]),
    muted: token('--muted', [107, 107, 111]),
  };
}

/* ---------- The loop. */

function wake() {
  if (running || document.hidden) return;
  running = true;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

function frame(timestamp: number) {
  running = false;
  if (document.hidden) return;
  const dt = Math.min(0.05, (timestamp - lastFrame) / 1000);
  lastFrame = timestamp;
  const now = timestamp / 1000;
  const calm = reducedMotion();
  const modalOpen = modalDialogOpen();
  let anyMoving = false;
  for (const face of faces) {
    if (!face.visible) continue;
    // A face behind an open dialog is not being looked at: it rests, like a listed face.
    const covered = modalOpen && !face.inDialog;
    const attention = covered ? restingAttention : attentionFor(face);
    if (attention.near && !face.wasNear && face.options.follow === 'hover' && !calm) {
      // The pointer reached a listed face: it perks up with a small hop, like the sidebar rows do.
      addAct(face.model, 'hop', now, 0.05, { strength: 90 });
    }
    face.wasNear = attention.near;
    allowBlinks(face, (face.options.lead && !covered) || attention.near || attention.noticed, now);
    updateOrglet(face.model, attention, now, dt, calm);
    const still = isStill(face.model, now, calm);
    if (still) settle(face.model);
    else anyMoving = true;
    // Only a face that changed is drawn again, so one blink does not repaint every face on the page.
    if (!still || face.dirty) paint(face, now);
    face.dirty = false;
  }
  if (anyMoving) {
    running = true;
    requestAnimationFrame(frame);
  } else {
    scheduleWake();
  }
}

// Radix blocks pointer events on the body while a modal dialog is open; that is the sign that the page is covered.
function modalDialogOpen() {
  return document.body.style.pointerEvents === 'none';
}

/**
 * Only a face that is present blinks (the stylesheet's `alive`): a lead face, or a listed one while the pointer or
 * the keyboard is on it. Anything else never wakes the loop for a blink.
 */
function allowBlinks(face: Face, allowed: boolean, now: number) {
  if (!allowed) {
    face.model.nextBlink = Infinity;
  } else if (face.model.nextBlink === Infinity) {
    face.model.nextBlink = now + 1 + Math.random() * 3;
  }
}

function attentionFor(face: Face): Attention {
  if (face.options.follow === 'none' || !pointer.present) {
    return face.noticed ? { ...restingAttention, noticed: true } : restingAttention;
  }
  const rectangle = face.canvas.getBoundingClientRect();
  const unit = face.options.size / GRID;
  const centreX = rectangle.left + rectangle.width / 2;
  const centreY = rectangle.top + rectangle.height / 2 + unit;
  const deltaX = pointer.x - centreX;
  const deltaY = pointer.y - centreY;
  const reach = face.options.size * 0.5 + 4;
  const near = Math.abs(deltaX) <= reach && Math.abs(deltaY) <= reach;
  const present = face.options.follow === 'pointer' || near;
  return { present, x: deltaX / unit, y: deltaY / unit, near, noticed: face.noticed };
}

function paint(face: Face, now: number) {
  const css = face.options.size * CANVAS_SCALE;
  const ratio = window.devicePixelRatio || 1;
  const backing = Math.round(css * ratio);
  if (face.canvas.width !== backing || face.canvas.height !== backing) {
    face.canvas.width = backing;
    face.canvas.height = backing;
  }
  const context = face.context;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, css, css);
  const unit = face.options.size / GRID;
  // The drawing sits centred in the canvas with the body centre one unit below the middle, where the flat
  // drawing's viewBox (0 -1 64 66) puts it, so a 3D face lines up with the avatar box the way the SVG did.
  drawOrglet(context, face.model, face.tones, { x: css / 2, y: css / 2 + unit, unit }, now);
}

/** While every face is still, the next thing to happen is a blink or a pending act: one timer wakes the loop for it. */
function scheduleWake() {
  clearTimeout(wakeTimer);
  wakeTimer = undefined;
  if (reducedMotion()) return;
  let next = Infinity;
  for (const face of faces) {
    if (!face.visible) continue;
    next = Math.min(next, face.model.nextBlink);
    for (const act of face.model.acts) next = Math.min(next, act.start);
  }
  if (next === Infinity) return;
  const delay = Math.max(0, next - seconds()) * 1000;
  wakeTimer = setTimeout(() => { wakeTimer = undefined; wake(); }, delay);
}

/* ---------- Input and the environment. */

function onPointerMove(event: PointerEvent) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.present = true;
  pointer.movedAt = seconds();
  wake();
}

function onPointerGone() {
  pointer.present = false;
  wake();
}

function onMouseOut(event: MouseEvent) {
  if (!event.relatedTarget) onPointerGone();
}

function onVisibilityChange() {
  if (document.hidden) {
    clearTimeout(wakeTimer);
    wakeTimer = undefined;
    return;
  }
  for (const face of faces) face.dirty = true;
  wake();
}

function onFocusChange() {
  for (const face of faces) {
    const control = face.canvas.closest('button, [role=radio]');
    face.noticed = Boolean(control && control.matches(':focus-visible'));
  }
  wake();
}

function onThemeChange() {
  for (const face of faces) {
    face.tones = buildTones(readPalette(face.canvas));
    face.dirty = true;
  }
  wake();
}

function onReducedMotionChange() {
  for (const face of faces) {
    face.model.acts = [];
    face.model.particles = [];
    face.model.mood = face.options.mood;
    face.dirty = true;
  }
  wake();
}

function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  window.addEventListener('blur', onPointerGone);
  document.addEventListener('mouseleave', onPointerGone);
  document.addEventListener('mouseout', onMouseOut);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange);
  darkSchemeQuery?.addEventListener('change', onThemeChange);
  themeObserver = new MutationObserver(onThemeChange);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-logo-color', 'class'] });
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      for (const face of faces) {
        if (face.canvas !== entry.target) continue;
        face.visible = entry.isIntersecting;
        face.dirty = true;
      }
    }
    wake();
  });
  scheduleIdleMoment();
}

function stopListening() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerdown', onPointerMove);
  window.removeEventListener('blur', onPointerGone);
  document.removeEventListener('mouseleave', onPointerGone);
  document.removeEventListener('mouseout', onMouseOut);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('focusin', onFocusChange);
  document.removeEventListener('focusout', onFocusChange);
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange);
  darkSchemeQuery?.removeEventListener('change', onThemeChange);
  themeObserver?.disconnect();
  themeObserver = undefined;
  observer?.disconnect();
  observer = undefined;
  clearTimeout(wakeTimer);
  wakeTimer = undefined;
  clearTimeout(idleTimer);
  idleTimer = undefined;
}

/* ---------- Idle moments: the spontaneous moments of the standalone page, rare and only on a face being looked
   at, and only once the pointer has rested. */

function scheduleIdleMoment() {
  clearTimeout(idleTimer);
  const delay = IDLE_MOMENT_MIN_SECONDS + Math.random() * (IDLE_MOMENT_MAX_SECONDS - IDLE_MOMENT_MIN_SECONDS);
  idleTimer = setTimeout(() => { idleMoment(); scheduleIdleMoment(); }, delay * 1000);
}

function leadFaces() {
  const modalOpen = modalDialogOpen();
  return [...faces].filter(face => face.visible && face.options.lead && (face.inDialog || !modalOpen) && face.model.mood === 'idle' && face.model.acts.length === 0);
}

export type IdleMoment = 'doze' | 'blink-wave' | 'neighbour' | 'sing' | 'stretch' | 'glance';

/** Which moment the dice picked: a doze only after a long quiet spell, the group moments only in a group. */
function pickIdleMoment(rested: number, now: number, inGroup: boolean): IdleMoment {
  const roll = Math.random();
  if (rested >= DOZE_AFTER_SECONDS && now - lastDoze >= DOZE_EVERY_SECONDS && roll < 0.3) return 'doze';
  if (inGroup && roll < 0.3) return 'blink-wave';
  if (inGroup && roll < 0.65) return 'neighbour';
  if (roll < 0.72) return 'sing';
  if (roll < 0.86) return 'stretch';
  return 'glance';
}

function idleMoment(forced?: IdleMoment) {
  if (reducedMotion() || document.hidden) return;
  const now = seconds();
  const rested = now - pointer.movedAt;
  if (rested < POINTER_REST_SECONDS && !forced) return;
  const candidates = leadFaces();
  if (candidates.length === 0) return;
  const actor = candidates[Math.floor(Math.random() * candidates.length)];
  const companions = actor.options.group ? candidates.filter(face => face !== actor && face.options.group === actor.options.group) : [];
  const moment = forced ?? pickIdleMoment(rested, now, companions.length > 0);
  if (moment === 'doze') {
    lastDoze = now;
    addAct(actor.model, 'doze', now, momentLength.doze);
  } else if (moment === 'blink-wave' && companions.length > 0) {
    // A blink runs across the team, left to right or right to left.
    const members = [actor, ...companions].sort((a, b) => a.groupIndex - b.groupIndex);
    const fromLeft = Math.random() < 0.5;
    members.forEach((face, index) => { face.model.nextBlink = now + (fromLeft ? index : members.length - 1 - index) * 0.08; });
  } else if (moment === 'neighbour' && companions.length > 0) {
    // A look at a neighbour, who sometimes looks back.
    const neighbour = nearestCompanion(actor, companions);
    addAct(actor.model, 'stare', now, 1.5, directionTo(actor, neighbour));
    if (Math.random() < 0.6) addAct(neighbour.model, 'stare', now + 0.55, 1.1, directionTo(neighbour, actor));
  } else if (moment === 'sing') {
    addAct(actor.model, 'sing', now, momentLength.sing);
  } else if (moment === 'stretch') {
    addAct(actor.model, 'stretch', now, momentLength.stretch);
  } else {
    addAct(actor.model, 'glance', now, momentLength.glance, { direction: Math.random() < 0.5 ? -1 : 1 });
  }
  wake();
}

function nearestCompanion(actor: Face, companions: Face[]) {
  return companions.reduce((best, face) => Math.abs(face.groupIndex - actor.groupIndex) < Math.abs(best.groupIndex - actor.groupIndex) ? face : best);
}

/** Where another face is, in grid units from this one, so a stare can be aimed at it. */
function directionTo(from: Face, to: Face) {
  const source = from.canvas.getBoundingClientRect();
  const target = to.canvas.getBoundingClientRect();
  const unit = from.options.size / GRID;
  return {
    targetX: (target.left + target.width / 2 - source.left - source.width / 2) / unit,
    targetY: (target.top + target.height / 2 - source.top - source.height / 2) / unit,
  };
}

/* ---------- Greetings. */

function groupMembers(group: string) {
  return [...faces].filter(face => face.options.group === group).sort((a, b) => a.groupIndex - b.groupIndex);
}

/** A team's members hop in one after another, then two of them lean together and a third notices, then all face the person. */
function planTeamGreeting(group: string) {
  const members = groupMembers(group).filter(face => face.options.greet);
  if (members.length < 2 || reducedMotion()) return;
  const now = seconds();
  const [left, right, watcher] = members;
  const start = now + 1.1;
  addAct(left.model, 'lean', start, 3.0, { direction: 1, speaking: [[0.25, 1.05], [2.0, 2.6]] });
  addAct(right.model, 'lean', start, 3.0, { direction: -1, speaking: [[1.15, 1.9]] });
  if (watcher) {
    addAct(watcher.model, 'stare', start + 0.4, 1.8, { ...directionTo(watcher, left), suspicious: true });
  }
  wake();
}

const greetingsPlanned = new Set<string>();

function greet(face: Face) {
  const now = seconds();
  if (reducedMotion()) return;
  crouch(face.model);
  addAct(face.model, 'hop', now + 0.05 + face.groupIndex * 0.09, 0.05, { strength: 190, rollKick: 2.4 * (face.groupIndex % 2 ? -1 : 1) });
  addAct(face.model, 'squint', now + 0.05 + face.groupIndex * 0.09, 0.5);
  const group = face.options.group;
  if (group && !greetingsPlanned.has(group)) {
    greetingsPlanned.add(group);
    // Every member of the group mounts in the same commit; the plan runs once they are all there.
    queueMicrotask(() => { greetingsPlanned.delete(group); planTeamGreeting(group); });
  }
}

/* ---------- Mounting. */

export function mountFace(canvas: HTMLCanvasElement, options: FaceOptions): FaceHandle {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The orglet canvas has no 2D context.');
  const now = seconds();
  const model = createOrglet(options.id, options.seed, now);
  model.mood = options.mood;
  const face: Face = {
    canvas, context, model, options, tones: buildTones(readPalette(canvas)),
    visible: true, dirty: true, wasNear: false, noticed: false,
    groupIndex: options.group ? groupMembers(options.group).length : 0,
    inDialog: Boolean(canvas.closest('[role=dialog]')),
  };
  faces.add(face);
  startListening();
  observer?.observe(canvas);
  if (options.greet) greet(face);
  paint(face, now);
  wake();
  return {
    update(next) {
      const previous = face.options;
      face.options = next;
      if (next.id !== previous.id) {
        changeLook(model, next.id);
        // A new face arrives with a hop, unless a cheer is already playing it in.
        if (!reducedMotion() && !model.acts.some(act => act.kind === 'cheese')) addAct(model, 'hop', seconds(), 0.05, { strength: 120 });
        face.dirty = true;
      }
      if (next.colorKey !== previous.colorKey || next.size !== previous.size) {
        face.tones = buildTones(readPalette(canvas));
        face.dirty = true;
      }
      if (next.mood !== previous.mood) {
        model.mood = next.mood;
        // A run starting is news: the head hops once as the message lands, as the small faces do.
        if (next.mood === 'thinking' && !reducedMotion()) addAct(model, 'hop', seconds(), 0.05, { strength: 110 });
      }
      if (face.dirty) paint(face, seconds());
      wake();
    },
    cheer() {
      if (reducedMotion()) return;
      model.acts = model.acts.filter(act => act.kind !== 'hop');
      addAct(model, 'cheese', seconds(), 2.2);
      blink(model, seconds() + 2.3);
      wake();
    },
    play(moment) {
      if (reducedMotion()) return;
      const now = seconds();
      if (moment === 'doze') lastDoze = now;
      // A glance on cue goes to the face's own side, like its unprompted ones.
      addAct(model, moment, now, momentLength[moment], moment === 'glance' ? { direction: model.personality.side } : {});
      wake();
    },
    unmount() {
      faces.delete(face);
      observer?.unobserve(canvas);
      if (faces.size === 0) stopListening();
    },
  };
}

/** A seam for the smokes: how many faces are mounted, whether the loop is running, what each face is doing, and a way to play a moment now. */
export const stageState = {
  get faces() { return faces.size; },
  get running() { return running; },
  describe() {
    const now = seconds();
    const springNames = ['yaw', 'pitch', 'roll', 'spin', 'lift', 'scaleX', 'scaleY', 'eyeX', 'eyeY', 'eyeOpen', 'happy', 'blush'] as const;
    return [...faces].map(face => ({
      id: face.options.id, follow: face.options.follow, visible: face.visible, still: isStill(face.model, now, reducedMotion()),
      mood: face.model.mood, acts: face.model.acts.map(act => act.kind), particles: face.model.particles.length,
      propellerSpeed: face.model.propellerSpeed, blinkIn: face.model.nextBlink - now, sinceBlink: now - face.model.blinkStart, noticed: face.noticed, inDialog: face.inDialog,
      unsettled: springNames.filter(name => Math.abs(face.model[name].value - face.model[name].target) > 0.0015 || Math.abs(face.model[name].velocity) > 0.004).map(name => `${name} ${face.model[name].value.toFixed(4)}→${face.model[name].target.toFixed(4)} v${face.model[name].velocity.toFixed(4)}`),
    }));
  },
  play(moment: IdleMoment) { idleMoment(moment); },
};
declare global { interface Window { __orgletStage?: typeof stageState } }
if (typeof window !== 'undefined') window.__orgletStage = stageState;
