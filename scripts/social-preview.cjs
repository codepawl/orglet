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
// The shapes are the same ones `renderer/components/mascots.tsx` draws (COD-154: the logo bubble with two
// capsule eyes and at most one hat), inlined here so this script stays standalone.
// Eyes are white on every body (dark only on a very light one, which the card has none of); hat rims take the
// card's ground so a hat reads over the body, as in the app.
const eyes = '<rect x="28.3" y="22.25" width="4.4" height="9.5" rx="2.2" fill="var(--eye)"/><rect x="35.3" y="22.25" width="4.4" height="9.5" rx="2.2" fill="var(--eye)"/>';
const worn = 'fill="url(#shade)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const cast = [
  {
    color: '#4f7fe0',
    art: `<rect x="29" y="23.25" width="4.4" height="7.5" rx="2.2" fill="var(--eye)"/><rect x="35.3" y="23.25" width="4.4" height="7.5" rx="2.2" fill="var(--eye)"/>
          <circle cx="30.5" cy="27" r="6.2" fill="none" stroke="var(--eye)" stroke-width="2.2"/>
          <circle cx="37.5" cy="27" r="6.2" fill="none" stroke="var(--eye)" stroke-width="2.2"/>`,
  },
  {
    color: '#3f9a68',
    art: `${eyes}<path d="M17.5 13.5 32 3l14.5 10.5z" ${worn}/><path d="M24 13.5 32 7l8 6.5" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/>`,
  },
  {
    color: '#d97757',
    art: `${eyes}<path d="M13.5 8.5 32 2.5l18.5 6L32 14.5z" ${worn}/><path d="M46.5 10v5.5" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  {
    color: '#a764c9',
    art: `${eyes}<path d="M22 12a10 9.5 0 0 1 20 0z" ${worn}/><path d="M19.5 12h25v3h-25z" ${worn}/><circle cx="32" cy="2.5" r="2.6" ${worn}/>`,
  },
  {
    color: '#c9922e',
    art: `${eyes}<path d="M20 13.5 21.5 3l6 5.5L32 1l4.5 7.5 6-5.5L44 13.5z" ${worn}/>`,
  },
];

// The logo bubble from apps/desktop/assets/icon.svg on the 64 grid the mascots use: 44 wide, 31% corners and a
// 15% corner at the bottom left, drawn with a 4-unit stroke of its own paint so the outline is part of the shape.
const bubblePath = 'M23.7 13h16.6a11.7 11.7 0 0 1 11.7 11.7v16.6a11.7 11.7 0 0 1-11.7 11.7H16.5a4.5 4.5 0 0 1-4.5-4.5V24.7a11.7 11.7 0 0 1 11.7-11.7z';

function mascotMarkup({ color, art }, index) {
  // The matte light from mascots.tsx: one soft shade from a lighter top left to a darker bottom right. Each
  // mascot gets its own gradient id, or every face would take the first one's colour.
  const id = `shade-${index}`;
  return `<svg class="mascot" viewBox="0 -1 64 66" style="color:${color}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="color-mix(in srgb, ${color} 86%, white)"/>
        <stop offset=".5" stop-color="${color}"/>
        <stop offset="1" stop-color="color-mix(in srgb, ${color} 84%, black)"/>
      </linearGradient>
    </defs>
    <path d="${bubblePath}" fill="url(#${id})" stroke="url(#${id})" stroke-width="4" stroke-linejoin="round"/>
    ${art.replaceAll('url(#shade)', `url(#${id})`)}
  </svg>`;
}

const cardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ground:#171717; --ink:#171717; --eye:#fafafa; --text:#f5f5f5; --muted:#a1a1a1; }
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
