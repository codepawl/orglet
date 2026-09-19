const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

// Renders docs/images/social-preview.png, the 1280x640 card GitHub, Slack and X show for a repository link.
// It is drawn from the app's own mascots and tokens rather than screenshotted, because a screenshot of the
// interface is unreadable once a card scales it down to a few hundred pixels wide.
// Run it with Electron, which the repo already depends on: `pnpm exec electron scripts/social-preview.cjs`.

const outputFolder = resolve('docs/images');
const cardSize = { width: 1280, height: 640 };

// The mascots that lead the card, each in its own colour: a face people recognise before they read anything.
// The paths are the same ones `renderer/components/mascots.tsx` draws, inlined here so this script stays standalone.
const cast = [
  {
    color: '#4f7fe0',
    art: `<circle cx="25" cy="33" r="4.6" fill="none" stroke="var(--ink)" stroke-width="2.8"/>
          <circle cx="39" cy="33" r="4.6" fill="none" stroke="var(--ink)" stroke-width="2.8"/>
          <path d="M29.6 33h4.8" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M29 41q3 3.15 6 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    color: '#3f9a68',
    art: `<circle cx="26" cy="32" r="2.6" fill="var(--ink)"/><circle cx="38" cy="32" r="2.6" fill="var(--ink)"/>
          <path d="M28.5 38q3.5 3.15 7 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
          <path d="M17.5 13.5 32 3l14.5 10.5z" fill="currentColor" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
          <path d="M24 13.5 32 7l8 6.5" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/>`,
  },
  {
    color: '#d97757',
    art: `<circle cx="26" cy="32" r="2.6" fill="var(--ink)"/><circle cx="38" cy="32" r="2.6" fill="var(--ink)"/>
          <path d="M28.5 38q3.5 3.15 7 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
          <path d="M13.5 8.5 32 2.5l18.5 6L32 14.5z" fill="currentColor" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
          <path d="M46.5 10v5.5" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  {
    color: '#a764c9',
    art: `<circle cx="26" cy="32" r="2.6" fill="var(--ink)"/><circle cx="38" cy="32" r="2.6" fill="var(--ink)"/>
          <path d="M28.5 38q3.5 3.15 7 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
          <path d="M22 12a10 9.5 0 0 1 20 0z" fill="currentColor" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
          <path d="M19.5 12h25v3h-25z" fill="currentColor" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="32" cy="2.5" r="2.6" fill="currentColor" stroke="var(--ink)" stroke-width="2"/>`,
  },
  {
    color: '#c9922e',
    art: `<circle cx="26" cy="32" r="2.6" fill="var(--ink)"/><circle cx="38" cy="32" r="2.6" fill="var(--ink)"/>
          <path d="M28.5 38q3.5 3.15 7 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>
          <path d="M20 13.5 21.5 3l6 5.5L32 1l4.5 7.5 6-5.5L44 13.5z" fill="currentColor" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`,
  },
];

// The logo bubble from apps/desktop/assets/icon.svg, on the 64 grid the mascots use.
const bubblePath = 'M24 13h16a13 13 0 0 1 13 13v16a13 13 0 0 1-13 13H16a5 5 0 0 1-5-5V26a13 13 0 0 1 13-13z';

function mascotMarkup({ color, art }) {
  // Filled, not stroked: a round-joined stroke in the same colour would soften the square bottom-left corner
  // that makes the shape the Orglet logo rather than a rounded square.
  return `<svg class="mascot" viewBox="0 -1 64 66" style="color:${color}" aria-hidden="true">
    <path d="${bubblePath}" fill="${color}"/>
    ${art}
  </svg>`;
}

const cardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ground:#171717; --ink:#171717; --text:#f5f5f5; --muted:#a1a1a1; }
  * { box-sizing:border-box; margin:0; }
  body {
    width:${cardSize.width}px; height:${cardSize.height}px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:36px; background:var(--ground); color:var(--text);
    font-family:"Segoe UI", ui-sans-serif, system-ui, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .cast { display:flex; align-items:center; gap:16px; }
  .mascot { width:92px; height:92px; overflow:visible; }
  h1 { font-size:104px; font-weight:600; letter-spacing:-3px; line-height:1; }
  .pitch { font-size:34px; letter-spacing:-.4px; }
  .facts { font-size:24px; color:var(--muted); letter-spacing:-.1px; }
</style>
</head>
<body>
  <div class="cast">${cast.map(mascotMarkup).join('')}</div>
  <h1>Orglet</h1>
  <p class="pitch">Your own small team of AI workers, on your computer.</p>
  <p class="facts">Open source &middot; Runs on the Claude or Codex plan you already pay for</p>
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
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cardHtml)}`);
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
