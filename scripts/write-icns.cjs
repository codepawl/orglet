// Builds apps/desktop/assets/icon.icns from the committed PNG/ICO (no Electron).
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const assets = join(__dirname, '..', 'apps', 'desktop', 'assets');
const types = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09' };

function pngsFromIco(ico) {
  const count = ico.readUInt16LE(4);
  const pngs = [];
  for (let index = 0; index < count; index++) {
    const at = 6 + 16 * index;
    const size = ico.readUInt8(at) || 256;
    const bytes = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    pngs.push({ size, data: ico.subarray(offset, offset + bytes) });
  }
  return pngs;
}

function writeIcns(pngs) {
  const chunks = [];
  for (const png of pngs) {
    const type = types[png.size];
    if (!type) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(8 + png.data.length, 4);
    chunks.push(header, png.data);
  }
  const body = Buffer.concat(chunks);
  const file = Buffer.alloc(8 + body.length);
  file.write('icns', 0, 4, 'ascii');
  file.writeUInt32BE(file.length, 4);
  body.copy(file, 8);
  writeFileSync(join(assets, 'icon.icns'), file);
  return Object.keys(types).filter(size => pngs.some(png => png.size === Number(size)));
}

const pngs = pngsFromIco(readFileSync(join(assets, 'icon.ico')));
const png512 = readFileSync(join(assets, 'icon.png'));
if (!pngs.some(png => png.size === 512)) pngs.push({ size: 512, data: png512 });
const sizes = writeIcns(pngs);
console.log(`icon.icns written (${sizes.join(', ')})`);
