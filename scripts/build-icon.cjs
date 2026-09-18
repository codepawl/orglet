// Regenerates the app icon from apps/desktop/assets/icon.svg.
// Run with Electron so Chromium rasterizes the SVG: node_modules/electron/dist/electron.exe scripts/build-icon.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const assets = join(__dirname, '..', 'apps', 'desktop', 'assets');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  const svg = readFileSync(join(assets, 'icon.svg'), 'utf8');
  const render = size => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size}; const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, ${size}, ${size}); resolve(canvas.toDataURL('image/png')); };
    image.onerror = reject;
    image.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
  })`);
  const pngs = [];
  for (const size of [...sizes, 512]) pngs.push({ size, data: Buffer.from((await render(size)).split(',')[1], 'base64') });

  // ICO with PNG-compressed entries (supported since Windows Vista).
  const entries = pngs.filter(png => png.size <= 256);
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((png, index) => {
    const at = 6 + 16 * index;
    header.writeUInt8(png.size === 256 ? 0 : png.size, at); header.writeUInt8(png.size === 256 ? 0 : png.size, at + 1);
    header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3); header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.data.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.data.length;
  });
  writeFileSync(join(assets, 'icon.ico'), Buffer.concat([header, ...entries.map(png => png.data)]));
  writeFileSync(join(assets, 'icon.png'), pngs.find(png => png.size === 512).data);
  require('./write-icns.cjs');
  console.log(`icon.ico (${entries.map(png => png.size).join(', ')}) and icon.png written`);
  app.quit();
});
