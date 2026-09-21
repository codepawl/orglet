const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const zlib = require('node:zlib');

// Renders the orglet that sits at the top of every docs page, plus the crew on the README, into
// docs/images/orglets/<name>-light.png and -dark.png: transparent, drawn at 2x the size the page shows.
// The look is the 3D reading of the mascots (COD-155): the logo bubble as an extruded slab, matte, turned a
// little towards the reader, two capsule eyes and one accessory each. The geometry follows
// renderer/components/mascots.tsx on the same 64-unit grid, inlined here so the script stays standalone.
// Run it with Electron, which the repo already depends on: `pnpm images:orglets`.

const outputFolder = resolve('docs/images/orglets');

// One orglet per docs page, chosen for the page's topic. The name is the page's file name without `.md`, so
// a page and its image are found together. `yaw` turns the head (positive looks right), `pitch` tips it
// (positive looks down); every page gets a three-quarter view, alternating sides so a run of pages is not a
// row of identical poses.
const pageOrglets = [
  { name: 'README', accessory: 'bucket', colour: '#c9922e', face: 'curious', yaw: 0.34, pitch: 0.08 },
  { name: 'getting-started', accessory: 'wave', colour: '#4f7fe0', face: 'delighted', yaw: -0.3, pitch: 0.06 },
  { name: 'team-chat', accessory: 'headset', colour: '#d97757', face: 'delighted', yaw: 0.32, pitch: 0.1 },
  { name: 'agent-tools', accessory: 'hardHat', colour: '#d97757', face: 'happy', yaw: -0.34, pitch: 0.08 },
  { name: 'routines', accessory: 'clock', colour: '#c9922e', face: 'wink', yaw: 0.3, pitch: 0.06 },
  { name: 'recovery', accessory: 'nurse', colour: '#d65c73', face: 'plain', yaw: -0.32, pitch: 0.1 },
  { name: 'technical-guide', accessory: 'cap', colour: '#3f9a68', face: 'plain', yaw: 0.36, pitch: 0.08 },
  { name: 'product', accessory: 'crown', colour: '#a764c9', face: 'happy', yaw: -0.3, pitch: 0.06 },
  { name: 'capabilities', accessory: 'glasses', colour: '#4f7fe0', face: 'plain', yaw: 0.3, pitch: 0.1 },
  { name: 'team-chat-context', accessory: 'note', colour: '#3597ab', face: 'plain', yaw: -0.34, pitch: 0.08 },
  { name: 'model-list-fetch', accessory: 'antenna', colour: '#a764c9', face: 'plain', yaw: 0.32, pitch: 0.06 },
  { name: 'windows-release-gates', accessory: 'party', colour: '#a764c9', face: 'delighted', yaw: -0.3, pitch: 0.1 },
  { name: 'macos-packaging', accessory: 'bow', colour: '#d65c73', face: 'happy', yaw: 0.34, pitch: 0.08 },
  { name: 'linux-packaging', accessory: 'beanie', colour: '#3f9a68', face: 'wink', yaw: -0.32, pitch: 0.06 },
  { name: 'mobile', accessory: 'sprout', colour: '#3597ab', face: 'curious', yaw: 0.3, pitch: 0.1 },
  { name: 'implementation_status', accessory: 'fedora', colour: '#7b818c', face: 'plain', yaw: -0.36, pitch: 0.08 },
  { name: 'mvp-gap-audit', accessory: 'monocle', colour: '#c9922e', face: 'plain', yaw: 0.3, pitch: 0.06 },
  { name: 'handoff', accessory: 'paperHat', colour: '#e9e7e2', face: 'sleepy', yaw: -0.3, pitch: 0.12 },
  { name: 'release-review', accessory: 'topHat', colour: 'ink', face: 'wink', yaw: 0.32, pitch: 0.08 },
  { name: 'agent-tools-acceptance', accessory: 'tie', colour: 'ink', face: 'plain', yaw: -0.34, pitch: 0.06 },
  { name: 'checkpoint-ui-review', accessory: 'flag', colour: '#3f9a68', face: 'plain', yaw: 0.3, pitch: 0.1 },
  { name: 'finding-ui-review', accessory: 'detective', colour: '#a764c9', face: 'curious', yaw: -0.32, pitch: 0.08 },
  { name: 'preflight-ui-review', accessory: 'propeller', colour: '#3597ab', face: 'happy', yaw: 0.34, pitch: 0.06 },
  { name: 'routine-ui-review', accessory: 'headband', colour: '#d97757', face: 'plain', yaw: -0.3, pitch: 0.1 },
  { name: 'run-audit-ui-review', accessory: 'visor', colour: '#7b818c', face: 'curious', yaw: 0.32, pitch: 0.08 },
  { name: 'skill-ui-review', accessory: 'gradCap', colour: '#4f7fe0', face: 'happy', yaw: -0.34, pitch: 0.06 },
  { name: 'template-ui-review', accessory: 'beret', colour: '#d65c73', face: 'wink', yaw: 0.3, pitch: 0.1 },
  { name: 'waiting-input-ui-review', accessory: 'bubble', colour: '#e9e7e2', face: 'curious', yaw: -0.3, pitch: 0.08 },
  { name: 'writing', accessory: 'pencil', colour: '#c9922e', face: 'happy', yaw: 0.34, pitch: 0.06 },
];

// The README crew: five orglets side by side, the outer ones turned towards the middle.
const crew = [
  { accessory: 'glasses', colour: '#4f7fe0', face: 'plain', yaw: 0.4, pitch: 0.08 },
  { accessory: 'hardHat', colour: '#3f9a68', face: 'happy', yaw: 0.2, pitch: 0.06 },
  { accessory: 'headset', colour: '#d97757', face: 'delighted', yaw: 0, pitch: 0.1 },
  { accessory: 'party', colour: '#a764c9', face: 'wink', yaw: -0.2, pitch: 0.06 },
  { accessory: 'nurse', colour: '#d65c73', face: 'curious', yaw: -0.4, pitch: 0.08 },
];

// A page shows its orglet 112 css pixels wide; the file is drawn at twice that so it stays crisp on a
// high-density screen. The frame is 68 grid units square, which fits the tallest hat and the widest headset.
const frameUnits = 68;
const pageImageWidth = 224;
// The crew is shown 96 css pixels tall, the five heads 50 units apart.
const crewSpacingUnits = 50;
const crewImageHeight = 192;

// The themes only decide what depends on the page behind the picture: how strong the contact shadow is, how
// the near-black "ink" orglet is toned so it still separates from a dark page, and the speech bubble's paint.
// Hat rims and the tie are cut out of the picture instead of painted, so the page itself shows through them.
const themes = {
  light: { shadowAlpha: 0.2, inkBody: '#1e1e1e', inkRim: '#5a5a5a', bubble: '#ffffff', bubbleInk: '#8a8a90' },
  dark: { shadowAlpha: 0.5, inkBody: '#2c2c2c', inkRim: '#6a6a6a', bubble: '#2a2a2a', bubbleInk: '#a0a0a4' },
};

// Everything below `stage` runs inside the page. It is serialised into the HTML with `toString`, so this file
// keeps one syntax and one place for the drawing while the process that writes files stays in Node.
function stage() {
  'use strict';

  const HALF = 22;
  const CORNER = 13.7;
  const TAIL = 6.5;
  const DEPTH = 15;
  const FRONT = DEPTH / 2;
  // Anything worn on the head sits just behind the face plane: enough parallax to feel like a hat on a head.
  const HAT_Z = FRONT - 4;
  const FOCAL = 150;
  const EYE_WIDTH = 4.4;
  const EYE_HEIGHT = 9.5;
  const EYE_Y = -6;
  const EYE_LEFT = -1.5;
  const EYE_RIGHT = 5.5;
  const TAU = Math.PI * 2;
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  let context = null;
  let theme = null;

  /* ---------- Colour. */

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function mixRgb(from, to, amount) {
    return [
      from[0] + (to[0] - from[0]) * amount,
      from[1] + (to[1] - from[1]) * amount,
      from[2] + (to[2] - from[2]) * amount,
    ];
  }

  function rgbString(rgb, alpha = 1) {
    const red = Math.round(rgb[0]);
    const green = Math.round(rgb[1]);
    const blue = Math.round(rgb[2]);
    if (alpha >= 1) {
      return `rgb(${red},${green},${blue})`;
    }
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function luminance(rgb) {
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  }

  function buildTones(hex) {
    const isInk = hex === 'ink';
    const base = hexToRgb(isInk ? theme.inkBody : hex);
    const light = luminance(base) > 0.72;
    return {
      base,
      lit: mixRgb(base, WHITE, isInk ? 0.24 : 0.16),
      shaded: mixRgb(base, BLACK, 0.16),
      side: mixRgb(base, BLACK, 0.32),
      sideDark: mixRgb(base, BLACK, 0.52),
      dark: mixRgb(base, BLACK, 0.55),
      rim: isInk ? hexToRgb(theme.inkRim) : null,
      eye: light ? [43, 43, 43] : WHITE,
    };
  }

  /* ---------- Geometry on the 64-unit grid (x 0..64, y 0..64, body centre at 32,33), stored as local
     [X, Y] around the body centre. */

  function local(x, y) {
    return [x - 32, y - 33];
  }

  function ellipseArcPoints(cx, cy, rx, ry, startAngle, endAngle, count) {
    const points = [];
    for (let index = 0; index <= count; index++) {
      const angle = startAngle + (endAngle - startAngle) * (index / count);
      points.push(local(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
    }
    return points;
  }

  // A half ellipse standing on baseY, the crown of most hats.
  function domePoints(cx, baseY, rx, ry) {
    return ellipseArcPoints(cx, baseY, rx, ry, Math.PI, TAU, 18);
  }

  // The part of an ellipse above baseY, closed along the base (the headband).
  function domeClippedPoints(cx, cy, rx, ry, baseY) {
    const sine = (baseY - cy) / ry;
    const offset = Math.asin(-sine);
    return ellipseArcPoints(cx, cy, rx, ry, Math.PI + offset, TAU - offset, 18);
  }

  function roundedRectPoints(x, y, width, height, radius) {
    const points = [];
    const corners = [
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

  function circlePoints(cx, cy, radius, count = 22) {
    return ellipseArcPoints(cx, cy, radius, radius, 0, TAU, count).slice(0, count);
  }

  function polygonPoints(gridPoints) {
    return gridPoints.map(([x, y]) => local(x, y));
  }

  function capsulePoints(centreX, centreY, width, height) {
    const radius = Math.min(width, height) / 2;
    return roundedRectPoints(centreX + 32 - width / 2, centreY + 33 - height / 2, width, height, radius);
  }

  // A mitten with its top-left corner at (left, top) on the grid: a 9 by 15 palm with round corners and a
  // thumb bulging from the left side, as one outline so its rim runs around the whole hand.
  function mittenPoints(left, top) {
    const points = [];
    const arc = (cx, cy, radius, startAngle, endAngle) => {
      for (let index = 0; index <= 6; index++) {
        const angle = startAngle + (endAngle - startAngle) * (index / 6);
        points.push(local(left + cx + radius * Math.cos(angle), top + cy + radius * Math.sin(angle)));
      }
    };
    arc(0, 9, 3, Math.PI / 2, Math.PI * 1.5);
    arc(4, 4, 4, Math.PI, Math.PI * 1.5);
    arc(5, 4, 4, Math.PI * 1.5, TAU);
    arc(6, 12, 3, 0, Math.PI / 2);
    arc(3, 12, 3, Math.PI / 2, Math.PI);
    return points;
  }

  // Turns local points about a grid point, for anything worn at an angle (a pencil, a waving hand).
  function rotatePoints(points, pivotX, pivotY, angle) {
    const [centreX, centreY] = local(pivotX, pivotY);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return points.map(([X, Y]) => {
      const dx = X - centreX;
      const dy = Y - centreY;
      return [centreX + dx * cosine - dy * sine, centreY + dx * sine + dy * cosine];
    });
  }

  // The bubble outline, clockwise from the top edge.
  function buildBodyOutline() {
    const points = [];
    const cornerSteps = 10;
    const tailSteps = 6;
    const arcs = [
      [-HALF + CORNER, -HALF + CORNER, CORNER, Math.PI, Math.PI * 1.5, cornerSteps],
      [HALF - CORNER, -HALF + CORNER, CORNER, Math.PI * 1.5, TAU, cornerSteps],
      [HALF - CORNER, HALF - CORNER, CORNER, 0, Math.PI / 2, cornerSteps],
      [-HALF + TAIL, HALF - TAIL, TAIL, Math.PI / 2, Math.PI, tailSteps],
    ];
    for (const [cx, cy, radius, startAngle, endAngle, steps] of arcs) {
      for (let index = 0; index <= steps; index++) {
        const angle = startAngle + (endAngle - startAngle) * (index / steps);
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
    }
    return points;
  }
  const bodyOutline = buildBodyOutline();

  /* ---------- Accessories. A shape is a polygon with a depth, a paint and an optional rim. "worn" is the
     mascot rule: the body's own colour rimmed in the page colour, which here is a cut-out. */

  function shape(points, z, options) {
    return Object.assign({ points, z, closed: true, fill: null, stroke: null, lineWidth: 2 }, options);
  }
  function worn(points, z = HAT_Z) {
    return shape(points, z, { fill: 'body', stroke: 'ink', lineWidth: 2 });
  }
  function inkLine(gridPoints, lineWidth, z = HAT_Z + 0.3) {
    return shape(polygonPoints(gridPoints), z, { closed: false, stroke: 'ink', lineWidth });
  }
  function bodyLine(gridPoints, lineWidth, z = HAT_Z) {
    return shape(polygonPoints(gridPoints), z, { closed: false, stroke: 'body', lineWidth });
  }
  function inkFill(points, z = FRONT + 0.4) {
    return shape(points, z, { fill: 'ink' });
  }
  function colourFill(points, colour, z = HAT_Z) {
    return shape(points, z, { fill: colour });
  }
  function colourLine(gridPoints, colour, lineWidth, z = HAT_Z) {
    return shape(polygonPoints(gridPoints), z, { closed: false, stroke: colour, lineWidth });
  }
  function eyeLine(gridPoints, lineWidth, z = FRONT + 2.5) {
    return shape(polygonPoints(gridPoints), z, { closed: false, stroke: 'eye', lineWidth });
  }

  const brim = (left, width) => worn(roundedRectPoints(left, 12.2, width, 2.6, 1.3));
  const pencilYellow = '#f2c14e';
  const pencilWood = '#e8c39e';
  const pencilEraser = '#ff8fa3';
  const noteYellow = '#f6d365';
  const visorGreen = '#4fa36f';

  const accessories = {
    fedora: () => [worn(domePoints(32, 13.5, 10, 9)), brim(15.5, 33)],
    cap: () => [worn(domePoints(32, 13.5, 10.5, 10)), worn(roundedRectPoints(41, 9.1, 10.5, 4.4, 2.2))],
    paperHat: () => [worn(polygonPoints([[17.5, 13.5], [32, 3], [46.5, 13.5]])), inkLine([[24, 13.5], [32, 7], [40, 13.5]], 1.6)],
    topHat: () => [worn(roundedRectPoints(23.5, 3.5, 17, 10.5, 1.2)), brim(16, 32)],
    detective: () => [worn(domePoints(32, 13.5, 11, 10)), brim(14.5, 35), worn(roundedRectPoints(15.5, 7.5, 4, 6.5, 2)), worn(roundedRectPoints(44.5, 7.5, 4, 6.5, 2))],
    gradCap: () => [worn(polygonPoints([[13.5, 8.5], [32, 2.5], [50.5, 8.5], [32, 14.5]])), bodyLine([[46.5, 10], [46.5, 15.5]], 1.8), worn(circlePoints(46.5, 16.5, 1.6))],
    headband: () => [worn(domeClippedPoints(32, 18.2, 15, 12, 13)), worn(circlePoints(44, 7.5, 3))],
    beret: () => [worn(domePoints(32, 12.5, 12, 9)), worn(circlePoints(43, 4, 2.4))],
    bucket: () => [worn(domePoints(32, 11.5, 11, 9)), worn(polygonPoints([[15, 11.5], [49, 11.5], [45, 15], [19, 15]]))],
    party: () => [worn(polygonPoints([[32, 1.5], [43, 13.5], [21, 13.5]])), worn(circlePoints(32, 1.5, 2.6))],
    crown: () => [worn(polygonPoints([[20, 13.5], [21.5, 3], [27.5, 8.5], [32, 1], [36.5, 8.5], [42.5, 3], [44, 13.5]]))],
    hardHat: () => [worn(domePoints(32, 13.5, 11, 10.5)), brim(15, 34), inkLine([[32, 4.5], [32, 12]], 1.8)],
    beanie: () => [worn(domePoints(32, 12, 10, 9.5)), worn(roundedRectPoints(19.5, 12, 25, 3, 1.2)), worn(circlePoints(32, 2.5, 2.6))],
    // The propeller blades are drawn flat across the top; a still picture cannot spin them.
    propeller: () => [worn(domePoints(32, 13.5, 9.5, 9)), bodyLine([[32, 5.5], [32, 10.5]], 1.8), inkLine([[22.5, 5.5], [41.5, 5.5]], 4.2, HAT_Z + 0.2), bodyLine([[23, 5.5], [41, 5.5]], 2.2, HAT_Z + 0.3)],
    nurse: () => [worn(roundedRectPoints(22, 5.5, 20, 8, 1.2)), inkLine([[29.5, 9.5], [34.5, 9.5]], 2), inkLine([[32, 7], [32, 12]], 2)],
    tie: () => [inkFill(polygonPoints([[29.5, 42], [34.5, 42], [33.3, 44.4], [35.2, 51], [32, 54], [28.8, 51], [30.7, 44.4]]))],
    headset: () => [
      shape(ellipseArcPoints(32, 34, 23, 23, Math.PI, TAU, 24), 0, { closed: false, stroke: 'body', lineWidth: 3.2, behind: true }),
      Object.assign(worn(roundedRectPoints(3, 30, 7, 12, 3.5), 0), { side: true }),
      Object.assign(worn(roundedRectPoints(54, 30, 7, 12, 3.5), 0), { side: true }),
    ],
    antenna: () => [bodyLine([[32, 13], [32, 6]], 3.4), colourFill(circlePoints(32, 5, 3), '#ff8fa3')],
    sprout: () => [
      bodyLine([[32, 13], [32, 7]], 3),
      colourFill(polygonPoints([[32, 8], [30, 5.5], [26.5, 4], [23, 5], [25, 8], [29, 9]]), '#5fb878'),
      colourFill(polygonPoints([[32, 8], [34, 5.5], [37.5, 4], [41, 5], [39, 8], [35, 9]]), '#5fb878'),
    ],
    glasses: () => [
      shape(roundedRectPoints(24.7, 22.7, 8.6, 8.6, 3.4), FRONT + 2.5, { stroke: 'eye', lineWidth: 1.7 }),
      shape(roundedRectPoints(34.7, 22.7, 8.6, 8.6, 3.4), FRONT + 2.5, { stroke: 'eye', lineWidth: 1.7 }),
      eyeLine([[33.3, 26.2], [34.7, 26.2]], 1.7),
      shape([[24.7 - 32, 26.2 - 33, FRONT + 2.5], [11.5 - 32, 25.6 - 33, FRONT - 3], [10.2 - 32, 27.5 - 33, -1]], 0, { closed: false, stroke: 'eye', lineWidth: 1.5 }),
      shape([[43.3 - 32, 26.2 - 33, FRONT + 2.5], [52.5 - 32, 25.6 - 33, FRONT - 3], [53.8 - 32, 27.5 - 33, -1]], 0, { closed: false, stroke: 'eye', lineWidth: 1.5 }),
    ],
    // A ring on the right eye with a chain falling from it.
    monocle: () => [
      shape(circlePoints(37.5, 27, 6.4), FRONT + 2.5, { stroke: 'eye', lineWidth: 1.8 }),
      eyeLine([[41.8, 31.6], [43.8, 36.5], [42.6, 42]], 1.3),
    ],
    // A mitten raised in front of the head's corner and tilted out, the way a hand waves.
    wave: () => [worn(rotatePoints(mittenPoints(53, 12), 57.5, 27, 0.2), FRONT + 0.5)],
    // A pennant on a short pole.
    flag: () => [bodyLine([[32, 13], [32, 2.5]], 2.2), worn(polygonPoints([[32.5, 2.5], [43, 5.5], [32.5, 8.5]]))],
    // A ribbon bow on top of the head.
    bow: () => [
      worn(polygonPoints([[32, 9.5], [21, 4], [23, 14.5]])),
      worn(polygonPoints([[32, 9.5], [43, 4], [41, 14.5]])),
      worn(circlePoints(32, 9.5, 2.8)),
    ],
    // A clock face on the chest.
    clock: () => [
      shape(circlePoints(32, 45, 6), FRONT + 0.4, { fill: 'eye' }),
      shape(polygonPoints([[32, 45], [32, 41]]), FRONT + 0.6, { closed: false, stroke: 'dark', lineWidth: 1.4 }),
      shape(polygonPoints([[32, 45], [35, 45]]), FRONT + 0.6, { closed: false, stroke: 'dark', lineWidth: 1.4 }),
    ],
    // A green eyeshade on a thin band.
    visor: () => [
      worn(roundedRectPoints(19.5, 9.4, 25, 2.8, 1.2)),
      shape(roundedRectPoints(15, 11.6, 34, 4.2, 2.1), HAT_Z + 0.2, { fill: visorGreen, stroke: 'ink', lineWidth: 2 }),
    ],
    // A sticky note stuck at the corner of the face, with two lines written on it.
    note: () => [
      shape(rotatePoints(roundedRectPoints(42.5, 14, 9, 9, 0.8), 47, 18.5, 0.14), FRONT + 0.4, { fill: noteYellow }),
      shape(rotatePoints(polygonPoints([[44.5, 17], [49.5, 17]]), 47, 18.5, 0.14), FRONT + 0.6, { closed: false, stroke: 'dark', lineWidth: 1.1 }),
      shape(rotatePoints(polygonPoints([[44.5, 19.8], [48.5, 19.8]]), 47, 18.5, 0.14), FRONT + 0.6, { closed: false, stroke: 'dark', lineWidth: 1.1 }),
    ],
    // A speech bubble with three dots: waiting for what comes next.
    bubble: () => [
      Object.assign(shape(roundedRectPoints(42, 2.5, 17, 13, 4.5), FRONT + 3, { fill: 'bubble', stroke: 'bubbleRim', lineWidth: 1.2 }), { speech: true }),
      shape(polygonPoints([[45.5, 15.2], [43.5, 19.5], [49.5, 15.2]]), FRONT + 3, { fill: 'bubble' }),
      shape(circlePoints(46.3, 9, 1.25, 12), FRONT + 3.2, { fill: 'bubbleInk' }),
      shape(circlePoints(50.5, 9, 1.25, 12), FRONT + 3.2, { fill: 'bubbleInk' }),
      shape(circlePoints(54.7, 9, 1.25, 12), FRONT + 3.2, { fill: 'bubbleInk' }),
    ],
    // A pencil laid across the top right corner of the head, point up.
    pencil: () => {
      const angle = -0.85;
      const pivotX = 51;
      const pivotY = 11;
      const turned = points => rotatePoints(points, pivotX, pivotY, angle);
      return [
        shape(turned(polygonPoints([[43, 9], [56, 9], [56, 13], [43, 13]])), HAT_Z, { fill: pencilYellow, stroke: 'ink', lineWidth: 2 }),
        shape(turned(polygonPoints([[56, 9], [60.5, 11], [56, 13]])), HAT_Z + 0.1, { fill: pencilWood, stroke: 'ink', lineWidth: 2 }),
        shape(turned(polygonPoints([[59, 10.3], [60.5, 11], [59, 11.7]])), HAT_Z + 0.2, { fill: 'dark' }),
        shape(turned(polygonPoints([[43, 9], [45.5, 9], [45.5, 13], [43, 13]])), HAT_Z + 0.1, { fill: pencilEraser, stroke: 'ink', lineWidth: 2 }),
      ];
    },
  };

  /* ---------- Projection: the head is turned by the smallest rotation that points the face at the look
     direction (Rodrigues), so a head looking up-and-right does not pick up a twist. Positive yaw looks right,
     positive pitch looks down; a touch of perspective. */

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function buildRotation(yaw, pitch) {
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
    return { matrix, sinYaw: matrix[2], sinPitch: matrix[5] };
  }

  function projectPoint(rotation, X, Y, Z) {
    const m = rotation.matrix;
    const x2 = m[0] * X + m[1] * Y + m[2] * Z;
    const y2 = m[3] * X + m[4] * Y + m[5] * Z;
    const z2 = m[6] * X + m[7] * Y + m[8] * Z;
    const perspective = FOCAL / (FOCAL - z2);
    return [x2 * perspective, y2 * perspective, z2];
  }

  // Andrew's monotone chain; the points are few, so the sort is cheap.
  function convexHull(points) {
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (origin, a, b) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }
    const upper = [];
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

  /* ---------- Painting. */

  function tracePolygon(points, closed) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) {
      context.lineTo(points[index][0], points[index][1]);
    }
    if (closed) {
      context.closePath();
    }
  }

  function paintFor(key, tones) {
    if (key === 'body') {
      return rgbString(mixRgb(tones.base, tones.lit, 0.4));
    }
    if (key === 'eye') {
      return rgbString(tones.eye);
    }
    if (key === 'dark') {
      return rgbString(tones.dark);
    }
    if (key === 'bubble') {
      return theme.bubble;
    }
    if (key === 'bubbleInk') {
      return theme.bubbleInk;
    }
    if (key === 'bubbleRim') {
      return rgbString(hexToRgb(theme.bubbleInk), 0.35);
    }
    return key;
  }

  // "ink" is the page colour. The picture has no page, so ink is cut out of whatever was painted before and
  // the page shows through; that is what makes one drawing right on GitHub's white and on a dark theme alike.
  function withPaint(key, tones, paint) {
    if (key === 'ink') {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      paint('rgb(0,0,0)');
      context.restore();
      return;
    }
    paint(paintFor(key, tones));
  }

  function drawShape(shapeRecord, projected, tones) {
    if (projected.length < 2) {
      return;
    }
    if (shapeRecord.speech) {
      context.shadowColor = 'rgba(0,0,0,0.14)';
      context.shadowBlur = 3;
      context.shadowOffsetY = 1.5;
    }
    tracePolygon(projected, shapeRecord.closed);
    if (shapeRecord.fill) {
      withPaint(shapeRecord.fill, tones, colour => {
        context.fillStyle = colour;
        context.fill();
      });
    }
    context.shadowColor = 'transparent';
    if (shapeRecord.stroke) {
      withPaint(shapeRecord.stroke, tones, colour => {
        context.strokeStyle = colour;
        context.lineWidth = shapeRecord.lineWidth;
        context.stroke();
      });
    }
  }

  function projectShape(shapeRecord, rotation) {
    const projected = shapeRecord.points.map(point => projectPoint(rotation, point[0], point[1], point.length > 2 ? point[2] : shapeRecord.z));
    let depth = 0;
    for (const point of projected) {
      depth += point[2];
    }
    return { projected, depth: projected.length ? depth / projected.length : shapeRecord.z };
  }

  // Head-worn things paint after the body; a headset band paints before it; a side cup goes by its depth.
  function shapeInFront(item) {
    if (item.record.behind) {
      return false;
    }
    if (!item.record.side) {
      return true;
    }
    return item.result.depth >= 0;
  }

  function eyeSpec(orglet) {
    const style = orglet.face;
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
    if (orglet.accessory === 'glasses') {
      spec.left.x = 29 - 32;
      spec.right.x = 39 - 32;
      spec.left.y = 27 - 33;
      spec.right.y = 27 - 33;
      spec.left.height = 6.2;
      spec.right.height = 6.2;
    }
    if (orglet.accessory === 'monocle') {
      spec.left.height = 7.5;
      spec.right.height = 7.5;
    }
    return spec;
  }

  function drawEyes(orglet, rotation, tones) {
    const eyeColour = rgbString(tones.eye);
    const spec = eyeSpec(orglet);
    const happy = orglet.face === 'happy';
    const blush = orglet.face === 'happy' || orglet.face === 'delighted';
    // Eyes turned a little against the head, so a turned face still looks at the reader.
    const gazeX = clamp(-orglet.yaw * 2.4, -1.8, 1.8);
    const gazeY = clamp(-orglet.pitch * 1.5, -1, 1);
    const eyeZ = FRONT + 0.6;
    for (const eye of [spec.left, spec.right]) {
      const centreX = eye.x + gazeX;
      const centreY = eye.y + gazeY;
      context.fillStyle = eyeColour;
      if (eye.shut) {
        const projected = capsulePoints(centreX, centreY, 7, 3).map(([X, Y]) => projectPoint(rotation, X, Y, eyeZ));
        tracePolygon(projected, true);
        context.fill();
        continue;
      }
      if (!happy) {
        const projected = capsulePoints(centreX, centreY, EYE_WIDTH, eye.height).map(([X, Y]) => projectPoint(rotation, X, Y, eyeZ));
        tracePolygon(projected, true);
        context.fill();
        continue;
      }
      // Eyes closed in a smile: a small arch.
      const arch = [];
      for (let index = 0; index <= 8; index++) {
        const t = index / 8;
        const startX = centreX - 2.6;
        const endX = centreX + 2.6;
        const baseY = centreY + 1.6;
        const controlY = centreY - 3.2;
        const X = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * centreX + t * t * endX;
        const Y = (1 - t) * (1 - t) * baseY + 2 * (1 - t) * t * controlY + t * t * baseY;
        arch.push(projectPoint(rotation, X, Y, eyeZ));
      }
      context.strokeStyle = eyeColour;
      context.lineWidth = 2.8;
      tracePolygon(arch, false);
      context.stroke();
    }
    if (blush) {
      context.fillStyle = '#ff8fa3';
      context.globalAlpha = 0.6;
      for (const cheekX of [-10, 13]) {
        const cheek = ellipseArcPoints(cheekX + 32 + gazeX * 0.3, 35.5, 3.2, 1.9, 0, TAU, 14).map(([X, Y]) => projectPoint(rotation, X, Y, eyeZ));
        tracePolygon(cheek, true);
        context.fill();
      }
      context.globalAlpha = 1;
    }
  }

  // The colour at `t` along a list of [offset, rgb] stops.
  function colourAt(stops, t) {
    for (let index = 1; index < stops.length; index++) {
      const [fromOffset, fromColour] = stops[index - 1];
      const [toOffset, toColour] = stops[index];
      if (t <= toOffset) {
        return mixRgb(fromColour, toColour, (t - fromOffset) / (toOffset - fromOffset));
      }
    }
    return stops[stops.length - 1][1];
  }

  function devicePointsOf(points, matrix) {
    return points.map(([X, Y]) => [matrix.a * X + matrix.c * Y + matrix.e, matrix.b * X + matrix.d * Y + matrix.f]);
  }

  // Paints a polygon with pixels computed one by one in device space. The canvas's own gradients are
  // dithered, and that pixel noise doubles the PNG; a ramp computed here is smooth, which PNG's filters
  // predict almost exactly. The polygon is the clip, so its edge is anti-aliased like any other fill.
  function paintComputed(points, computePixel) {
    const matrix = context.getTransform();
    const devicePoints = devicePointsOf(points, matrix);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of devicePoints) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const left = Math.floor(minX) - 1;
    const top = Math.floor(minY) - 1;
    const width = Math.ceil(maxX) + 2 - left;
    const height = Math.ceil(maxY) + 2 - top;
    const layer = context.createImageData(width, height);
    const data = layer.data;
    let offset = 0;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const [red, green, blue, alpha] = computePixel(left + column + 0.5, top + row + 0.5);
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = alpha;
        offset += 4;
      }
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    offscreen.getContext('2d').putImageData(layer, 0, 0);
    context.save();
    tracePolygon(points, true);
    context.clip();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(offscreen, left, top);
    context.restore();
  }

  // Fills a polygon with a linear gradient between two points of the current space.
  function fillWithGradient(points, fromX, fromY, toX, toY, stops) {
    const [[startX, startY], [endX, endY]] = devicePointsOf([[fromX, fromY], [toX, toY]], context.getTransform());
    const axisX = endX - startX;
    const axisY = endY - startY;
    const axisLength = axisX * axisX + axisY * axisY;
    paintComputed(points, (x, y) => {
      const t = clamp(((x - startX) * axisX + (y - startY) * axisY) / axisLength, 0, 1);
      const [red, green, blue] = colourAt(stops, t);
      return [red, green, blue, 255];
    });
  }

  function fillFace(front, tones, rotation) {
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
    const shade = colour => away > 0 ? mixRgb(colour, BLACK, away * 0.5) : mixRgb(colour, WHITE, -away * 0.35);
    fillWithGradient(front, minX, minY, maxX, maxY, [[0, shade(tones.lit)], [0.5, shade(tones.base)], [1, shade(tones.shaded)]]);
  }

  // The contact shadow: black fading out from the middle of an ellipse under the body, stronger on a dark
  // page where a faint one vanishes.
  function drawShadow(unit) {
    const alphaAt = distance => {
      if (distance >= 1) {
        return 0;
      }
      if (distance <= 0.55) {
        return theme.shadowAlpha * (0.5 - (0.5 - 0.18) * (distance / 0.55));
      }
      return theme.shadowAlpha * 0.18 * (1 - (distance - 0.55) / 0.45);
    };
    const outline = [];
    for (let index = 0; index < 48; index++) {
      const angle = (index / 48) * TAU;
      outline.push([Math.cos(angle), Math.sin(angle)]);
    }
    context.save();
    context.translate(0, (HALF + 2) * unit);
    context.scale(22 * unit, 5.5 * unit);
    const inverse = context.getTransform().inverse();
    paintComputed(outline, (x, y) => {
      const localX = inverse.a * x + inverse.c * y + inverse.e;
      const localY = inverse.b * x + inverse.d * y + inverse.f;
      return [0, 0, 0, alphaAt(Math.hypot(localX, localY)) * 255];
    });
    context.restore();
  }

  // Draws one orglet with its body centre at (x, y) on the canvas, `unit` pixels per grid unit.
  function drawOrglet(orglet, x, y, unit) {
    const tones = buildTones(orglet.colour);
    const rotation = buildRotation(orglet.yaw, orglet.pitch);
    const shapes = accessories[orglet.accessory]();

    context.save();
    context.translate(x, y);
    drawShadow(unit);
    context.scale(unit, unit);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const front = bodyOutline.map(([X, Y]) => projectPoint(rotation, X, Y, FRONT));
    const back = bodyOutline.map(([X, Y]) => projectPoint(rotation, X, Y, -FRONT));
    const frontCentre = projectPoint(rotation, 0, 0, FRONT);
    const backCentre = projectPoint(rotation, 0, 0, -FRONT);
    // The slab's silhouette is the convex hull of the front and back outlines; the bubble is convex apart
    // from its tail, and the tail is drawn again on the front face on top.
    const hull = convexHull(front.concat(back));

    const projectedShapes = shapes.map(shapeRecord => ({ record: shapeRecord, result: projectShape(shapeRecord, rotation) }));
    for (const item of projectedShapes) {
      item.inFront = shapeInFront(item);
      if (!item.inFront) {
        drawShape(item.record, item.result.projected, tones);
      }
    }

    const litAmount = clamp(0.5 + 0.6 * rotation.sinYaw + 0.4 * rotation.sinPitch, 0, 1);
    const sideColour = mixRgb(tones.sideDark, tones.side, litAmount);
    fillWithGradient(hull, backCentre[0], backCentre[1], frontCentre[0], frontCentre[1], [[0, mixRgb(sideColour, BLACK, 0.3)], [1, sideColour]]);
    fillFace(front, tones, rotation);
    if (tones.rim) {
      // The near-black orglet keeps the logo's lighter edge so it separates from a dark page.
      context.strokeStyle = rgbString(tones.rim, 0.75);
      context.lineWidth = 1.3;
      tracePolygon(front, true);
      context.stroke();
    }
    drawEyes(orglet, rotation, tones);
    for (const item of projectedShapes) {
      if (item.inFront) {
        drawShape(item.record, item.result.projected, tones);
      }
    }
    context.restore();
  }

  // Renders a row of orglets onto a fresh canvas and hands the pixels back as base64 RGBA, which the Node
  // side turns into a PNG of its own: the browser's encoder is quick but not small.
  function render(orglets, themeSpec, width, height, unit, spacing) {
    theme = themeSpec;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    const rowWidth = spacing * (orglets.length - 1);
    const startX = width / 2 - (rowWidth * unit) / 2;
    // The body centre sits at grid y 33 of a 68-unit frame that starts at grid y -4.
    const centreY = (33 + 4) * unit;
    orglets.forEach((orglet, index) => {
      drawOrglet(orglet, startX + index * spacing * unit, centreY, unit);
    });
    const pixels = context.getImageData(0, 0, width, height).data;
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < pixels.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, pixels.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  window.renderOrglets = render;
}

/* ---------- PNG writing. Each row tries the five PNG filters and keeps the one that leaves the least to
   compress, then zlib works at its highest level: lossless, and a good deal smaller than a canvas export. */

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function filterRows(width, height, rgba) {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const output = Buffer.alloc((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let row = 0; row < height; row++) {
    const rowStart = row * stride;
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      const candidate = candidates[filter];
      let score = 0;
      for (let column = 0; column < stride; column++) {
        const current = rgba[rowStart + column];
        const left = column >= bytesPerPixel ? rgba[rowStart + column - bytesPerPixel] : 0;
        const up = row > 0 ? rgba[rowStart - stride + column] : 0;
        const upLeft = row > 0 && column >= bytesPerPixel ? rgba[rowStart - stride + column - bytesPerPixel] : 0;
        let predicted = 0;
        if (filter === 1) {
          predicted = left;
        } else if (filter === 2) {
          predicted = up;
        } else if (filter === 3) {
          predicted = (left + up) >> 1;
        } else if (filter === 4) {
          const estimate = left + up - upLeft;
          const distanceLeft = Math.abs(estimate - left);
          const distanceUp = Math.abs(estimate - up);
          const distanceUpLeft = Math.abs(estimate - upLeft);
          if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
            predicted = left;
          } else if (distanceUp <= distanceUpLeft) {
            predicted = up;
          } else {
            predicted = upLeft;
          }
        }
        const value = (current - predicted) & 0xff;
        candidate[column] = value;
        // The sum of the values read as signed bytes is the usual guess at which filter deflates best.
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
      }
    }
    output[row * (stride + 1)] = bestFilter;
    candidates[bestFilter].copy(output, row * (stride + 1) + 1);
  }
  return output;
}

function encodePng(width, height, rgba) {
  // Fully transparent pixels carry whatever colour the canvas left behind; zeroing them costs nothing visible
  // and gives the compressor long runs.
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const compressed = zlib.deflateSync(filterRows(width, height, rgba), { level: 9, memLevel: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- The run. */

const pageHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body><script>(${stage.toString()})();</script></body>
</html>`;

async function renderImage(window, orglets, themeName, width, height, unit, spacing) {
  const themeSpec = themes[themeName];
  const base64 = await window.webContents.executeJavaScript(
    `window.renderOrglets(${JSON.stringify(orglets)}, ${JSON.stringify(themeSpec)}, ${width}, ${height}, ${unit}, ${spacing})`,
  );
  return encodePng(width, height, Buffer.from(base64, 'base64'));
}

async function renderAll() {
  await mkdir(outputFolder, { recursive: true });
  const window = new BrowserWindow({
    width: 400,
    height: 400,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml)}`);

  const pageUnit = pageImageWidth / frameUnits;
  let totalBytes = 0;
  const write = async (fileName, png) => {
    await writeFile(join(outputFolder, fileName), png);
    totalBytes += png.length;
    console.log(`${fileName}: ${png.length} bytes`);
  };
  for (const orglet of pageOrglets) {
    for (const themeName of Object.keys(themes)) {
      const png = await renderImage(window, [orglet], themeName, pageImageWidth, pageImageWidth, pageUnit, 0);
      await write(`${orglet.name}-${themeName}.png`, png);
    }
  }
  const crewUnit = crewImageHeight / frameUnits;
  const crewWidth = Math.round((crewSpacingUnits * (crew.length - 1) + frameUnits) * crewUnit);
  for (const themeName of Object.keys(themes)) {
    const png = await renderImage(window, crew, themeName, crewWidth, crewImageHeight, crewUnit, crewSpacingUnits);
    await write(`crew-${themeName}.png`, png);
  }
  console.log(`Total: ${totalBytes} bytes in ${pageOrglets.length * 2 + 2} files.`);
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await renderAll();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
