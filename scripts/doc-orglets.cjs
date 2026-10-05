const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { buildSync } = require('esbuild');

// Renders the orglet that sits at the top of every docs page, plus the crew on the README, into
// docs/images/orglets/<name>-light.png and -dark.png: transparent, drawn at 2x the size the page shows.
// The drawing is the app's own (renderer/components/orgletSolid.ts, bundled here with esbuild), so a docs orglet
// is the same round solid the app shows: a body shape and a pair of eyes, nothing worn, leaning a little.
// Run it with Electron, which the repo already depends on: `pnpm images:orglets`.

const outputFolder = resolve('docs/images/orglets');

// One orglet per docs page. The name is the page's file name without `.md`, so a page and its image are found
// together. `face` picks the eyes; the body is taken in turn from the mascots that have that face, so a run of
// pages is not a row of one shape. `yaw` turns the head (positive looks right), `pitch` tips it (positive looks
// down); every page gets a three-quarter view, alternating sides.
const pageOrglets = [
  { name: 'README', colour: '#c9922e', face: 'curious', yaw: 0.34, pitch: 0.08 },
  { name: 'getting-started', colour: '#4f7fe0', face: 'delighted', yaw: -0.3, pitch: 0.06 },
  { name: 'team-chat', colour: '#d97757', face: 'delighted', yaw: 0.32, pitch: 0.1 },
  { name: 'agent-tools', colour: '#d97757', face: 'happy', yaw: -0.34, pitch: 0.08 },
  { name: 'routines', colour: '#c9922e', face: 'wink', yaw: 0.3, pitch: 0.06 },
  { name: 'recovery', colour: '#d65c73', face: 'plain', yaw: -0.32, pitch: 0.1 },
  { name: 'technical-guide', colour: '#3f9a68', face: 'plain', yaw: 0.36, pitch: 0.08 },
  { name: 'product', colour: '#a764c9', face: 'happy', yaw: -0.3, pitch: 0.06 },
  { name: 'capabilities', colour: '#4f7fe0', face: 'plain', yaw: 0.3, pitch: 0.1 },
  { name: 'team-chat-context', colour: '#3597ab', face: 'plain', yaw: -0.34, pitch: 0.08 },
  { name: 'model-list-fetch', colour: '#a764c9', face: 'plain', yaw: 0.32, pitch: 0.06 },
  { name: 'windows-release-gates', colour: '#a764c9', face: 'delighted', yaw: -0.3, pitch: 0.1 },
  { name: 'macos-packaging', colour: '#d65c73', face: 'happy', yaw: 0.34, pitch: 0.08 },
  { name: 'linux-packaging', colour: '#3f9a68', face: 'wink', yaw: -0.32, pitch: 0.06 },
  { name: 'mobile', colour: '#3597ab', face: 'curious', yaw: 0.3, pitch: 0.1 },
  { name: 'implementation_status', colour: '#7b818c', face: 'plain', yaw: -0.36, pitch: 0.08 },
  { name: 'mvp-gap-audit', colour: '#c9922e', face: 'narrow', yaw: 0.3, pitch: 0.06 },
  { name: 'handoff', colour: '#e9e7e2', face: 'sleepy', yaw: -0.3, pitch: 0.12 },
  { name: 'release-review', colour: 'ink', face: 'wink', yaw: 0.32, pitch: 0.08 },
  { name: 'agent-tools-acceptance', colour: 'ink', face: 'plain', yaw: -0.34, pitch: 0.06 },
  { name: 'checkpoint-ui-review', colour: '#3f9a68', face: 'narrow', yaw: 0.3, pitch: 0.1 },
  { name: 'finding-ui-review', colour: '#a764c9', face: 'curious', yaw: -0.32, pitch: 0.08 },
  { name: 'preflight-ui-review', colour: '#3597ab', face: 'happy', yaw: 0.34, pitch: 0.06 },
  { name: 'routine-ui-review', colour: '#d97757', face: 'plain', yaw: -0.3, pitch: 0.1 },
  { name: 'run-audit-ui-review', colour: '#7b818c', face: 'curious', yaw: 0.32, pitch: 0.08 },
  { name: 'skill-ui-review', colour: '#4f7fe0', face: 'happy', yaw: -0.34, pitch: 0.06 },
  { name: 'template-ui-review', colour: '#d65c73', face: 'wink', yaw: 0.3, pitch: 0.1 },
  { name: 'waiting-input-ui-review', colour: '#e9e7e2', face: 'curious', yaw: -0.3, pitch: 0.08 },
  { name: 'writing', colour: '#c9922e', face: 'happy', yaw: 0.34, pitch: 0.06 },
  { name: 'worker-actions', colour: '#3f9a68', face: 'curious', yaw: -0.32, pitch: 0.08 },
  { name: 'cli', colour: '#3f9a68', face: 'happy', yaw: 0.3, pitch: 0.08 },
  { name: 'mcp', colour: '#3597ab', face: 'curious', yaw: -0.3, pitch: 0.08 },
  { name: 'browser', colour: '#4f7fe0', face: 'curious', yaw: 0.32, pitch: 0.08 },
  { name: 'desktop', colour: '#3f9a68', face: 'happy', yaw: -0.3, pitch: 0.08 },
  { name: 'viewing-and-editing-files', colour: '#d65c73', face: 'happy', yaw: 0.32, pitch: 0.08 },
  { name: 'decisions', colour: '#a764c9', face: 'curious', yaw: -0.32, pitch: 0.08 },
];

// The README crew: five orglets side by side, the outer ones turned towards the middle.
const crew = [
  { colour: '#4f7fe0', face: 'plain', yaw: 0.4, pitch: 0.08 },
  { colour: '#3f9a68', face: 'happy', yaw: 0.2, pitch: 0.06 },
  { colour: '#d97757', face: 'delighted', yaw: 0, pitch: 0.1 },
  { colour: '#a764c9', face: 'wink', yaw: -0.2, pitch: 0.06 },
  { colour: '#d65c73', face: 'curious', yaw: -0.4, pitch: 0.08 },
];

// The mascots that carry each face, by body: `mascotShapes` in renderer/components/orgletShapes.ts.
const mascotsByFace = {
  plain: ['classic', 'antenna', 'sprout', 'idea', 'headset', 'tie', 'bowtie', 'briefcase'],
  happy: ['happy', 'calendar', 'mail', 'finance', 'writer', 'notes', 'care'],
  curious: ['curious', 'search', 'chart', 'target', 'coder'],
  wink: ['wink', 'automation'],
  sleepy: ['sleepy'],
  delighted: ['delighted', 'megaphone', 'checker'],
  narrow: ['focused', 'cool', 'guard'],
};

/** Gives each orglet a mascot of its face, taking the bodies of that face in turn. */
function withMascots(orglets) {
  const taken = {};
  return orglets.map((orglet, index) => {
    const choices = mascotsByFace[orglet.face];
    const turn = taken[orglet.face] ?? 0;
    taken[orglet.face] = turn + 1;
    return { ...orglet, mascot: choices[turn % choices.length], seed: index + 1 };
  });
}

// A page shows its orglet 112 css pixels wide; the file is drawn at twice that so it stays crisp on a
// high-density screen. The frame is 68 grid units square, which fits the widest body turned and leaning.
const frameUnits = 68;
const pageImageWidth = 224;
// The crew is shown 96 css pixels tall, the five heads 50 units apart.
const crewSpacingUnits = 50;
const crewImageHeight = 192;

// The themes only decide how the near-black "ink" orglet is toned, so it still separates from a dark page.
const themes = {
  light: { inkBody: '#1e1e1e' },
  dark: { inkBody: '#3a3a3a' },
};

// The app's drawing as one script for the page: `OrgletSolid.createOrglet`, `buildTones`, `drawOrglet`, `hexToRgb`.
const solidScript = buildSync({
  entryPoints: [resolve('apps/desktop/src/renderer/components/orgletSolid.ts')],
  bundle: true, format: 'iife', globalName: 'OrgletSolid', write: false, target: 'chrome120',
}).outputFiles[0].text;

// Runs inside the page. It is serialised into the HTML with `toString`.
function stage() {
  'use strict';
  /* global OrgletSolid */
  window.renderOrglets = (orglets, theme, width, height, unit, spacing) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const first = (width - spacing * unit * (orglets.length - 1)) / 2;
    orglets.forEach((orglet, index) => {
      const model = OrgletSolid.createOrglet(orglet.mascot, orglet.seed, 0);
      model.yaw.value = orglet.yaw;
      model.pitch.value = orglet.pitch;
      const body = OrgletSolid.hexToRgb(orglet.colour === 'ink' ? theme.inkBody : orglet.colour);
      const white = OrgletSolid.hexToRgb('#ffffff');
      const tones = OrgletSolid.buildTones({ body, alpha: 1, ink: white, surface: white, accent: body, muted: body });
      OrgletSolid.drawOrglet(context, model, tones, { x: first + index * spacing * unit, y: height / 2 + unit, unit }, 0);
    });
    return canvas.toDataURL('image/png').split(',')[1];
  };
}

const pageHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body><script>${solidScript}</script><script>(${stage.toString()})();</script></body>
</html>`;

async function renderImage(window, orglets, themeName, width, height, unit, spacing) {
  const base64 = await window.webContents.executeJavaScript(
    `window.renderOrglets(${JSON.stringify(orglets)}, ${JSON.stringify(themes[themeName])}, ${width}, ${height}, ${unit}, ${spacing})`,
  );
  return Buffer.from(base64, 'base64');
}

async function renderAll() {
  await mkdir(outputFolder, { recursive: true });
  const window = new BrowserWindow({ width: 400, height: 400, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  // A file, not a data URL: the bundled drawing is too long for one.
  const pagePath = join(app.getPath('temp'), 'orglet-doc-orglets.html');
  await writeFile(pagePath, pageHtml);
  await window.loadFile(pagePath);

  const pageUnit = pageImageWidth / frameUnits;
  let totalBytes = 0;
  const write = async (fileName, png) => {
    await writeFile(join(outputFolder, fileName), png);
    totalBytes += png.length;
    console.log(`${fileName}: ${png.length} bytes`);
  };
  const pages = withMascots(pageOrglets);
  for (const orglet of pages) {
    for (const themeName of Object.keys(themes)) {
      await write(`${orglet.name}-${themeName}.png`, await renderImage(window, [orglet], themeName, pageImageWidth, pageImageWidth, pageUnit, 0));
    }
  }
  const crewUnit = crewImageHeight / frameUnits;
  const crewWidth = Math.round((crewSpacingUnits * (crew.length - 1) + frameUnits) * crewUnit);
  for (const themeName of Object.keys(themes)) {
    await write(`crew-${themeName}.png`, await renderImage(window, withMascots(crew), themeName, crewWidth, crewImageHeight, crewUnit, crewSpacingUnits));
  }
  console.log(`Total: ${totalBytes} bytes in ${pages.length * 2 + 2} files.`);
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
