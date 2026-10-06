const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { buildSync } = require('esbuild');

// Renders docs/images/social-preview.png, the 1280x640 card GitHub, Slack and X show for a repository link.
// It is drawn from the app's own orglets and tokens rather than screenshotted, because a screenshot of the
// interface is unreadable once a card scales it down to a few hundred pixels wide.
// The orglets are drawn by the app's own code (renderer/components/orgletSolid.ts, bundled here with esbuild), so
// the card shows the round, hatless orglets the app shows and follows them when they change.
// Run it with Electron, which the repo already depends on: `pnpm images:social`.

const outputFolder = resolve('docs/images');
const cardSize = { width: 1280, height: 640 };

// The orglets that lead the card, each a body shape and a colour of its own: faces people recognise before they
// read anything. The outer ones turn towards the middle.
const cast = [
  { mascot: 'classic', colour: '#4f7fe0', yaw: 0.36, pitch: 0.06 },
  { mascot: 'happy', colour: '#3f9a68', yaw: 0.2, pitch: 0.08 },
  { mascot: 'curious', colour: '#d97757', yaw: 0.06, pitch: 0.06 },
  { mascot: 'delighted', colour: '#a764c9', yaw: -0.08, pitch: 0.08 },
  { mascot: 'wink', colour: '#c9922e', yaw: -0.22, pitch: 0.06 },
  { mascot: 'sleepy', colour: '#d65c73', yaw: -0.36, pitch: 0.08 },
];
// Each orglet is drawn on a canvas this many css pixels square; the frame is 68 grid units, as on the docs pages.
const orgletSize = 108;
const frameUnits = 68;

const solidScript = buildSync({
  entryPoints: [resolve('apps/desktop/src/renderer/components/orgletSolid.ts')],
  bundle: true, format: 'iife', globalName: 'OrgletSolid', write: false, target: 'chrome120',
}).outputFiles[0].text;

// Runs inside the page. It is serialised into the HTML with `toString`.
function stage(orglets, size, units) {
  'use strict';
  /* global OrgletSolid */
  const row = document.querySelector('.cast');
  orglets.forEach((orglet, index) => {
    const canvas = document.createElement('canvas');
    // Twice the css size, so the faces stay crisp in the captured card.
    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const context = canvas.getContext('2d');
    const model = OrgletSolid.createOrglet(orglet.mascot, index + 1, 0);
    model.yaw.value = orglet.yaw;
    model.pitch.value = orglet.pitch;
    const body = OrgletSolid.hexToRgb(orglet.colour);
    const white = OrgletSolid.hexToRgb('#ffffff');
    const tones = OrgletSolid.buildTones({ body, alpha: 1, ink: white, surface: white, accent: body, muted: body });
    const unit = (size * 2) / units;
    OrgletSolid.drawOrglet(context, model, tones, { x: size, y: size + unit, unit }, 0);
    row.append(canvas);
  });
}

const cardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ground:#171717; --text:#f5f5f5; --muted:#a1a1a1; }
  * { box-sizing:border-box; margin:0; }
  body {
    width:${cardSize.width}px; height:${cardSize.height}px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:32px; background:var(--ground); color:var(--text);
    font-family:"Segoe UI", ui-sans-serif, system-ui, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .cast { display:flex; align-items:center; gap:10px; }
  h1 { font-size:104px; font-weight:600; letter-spacing:-3px; line-height:1; }
  .pitch { font-size:34px; letter-spacing:-.4px; }
  .facts { font-size:24px; color:var(--muted); letter-spacing:-.1px; }
</style>
</head>
<body>
  <div class="cast"></div>
  <h1>Orglet</h1>
  <p class="pitch">Your own small team of AI workers, on your computer.</p>
  <p class="facts">Open source &middot; Runs on the Claude or Codex plan you already pay for</p>
  <script>${solidScript}</script>
  <script>(${stage.toString()})(${JSON.stringify(cast)}, ${orgletSize}, ${frameUnits});</script>
</body>
</html>`;

async function renderCard() {
  await mkdir(outputFolder, { recursive: true });
  const window = new BrowserWindow({
    ...cardSize,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  window.webContents.setZoomFactor(1);
  // A file, not a data URL: the bundled drawing is too long for one.
  const pagePath = join(app.getPath('temp'), 'orglet-social-preview.html');
  await writeFile(pagePath, cardHtml);
  await window.loadFile(pagePath);
  // Offscreen rendering paints a frame after load; capturing before it does gives a blank card.
  await new Promise(done => setTimeout(done, 600));
  const image = await window.webContents.capturePage();
  await writeFile(join(outputFolder, 'social-preview.png'), image.toPNG());
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await renderCard();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
