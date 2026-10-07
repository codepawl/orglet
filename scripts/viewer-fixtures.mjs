import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
/**
 * Sample files of every kind the file viewer shows: a CSV with numbers, text, empty and long cells and 260 rows, JSON, code,
 * Markdown, a PNG with transparent corners and a three-page PDF. Written into `folder`; returns each file's name and path.
 * The alignment check attaches them to a chat to measure the viewers; nothing here is real data.
 */
export async function writeViewerFixtures(folder) {
  await mkdir(folder, { recursive: true });
  const files = [];
  const put = (name, data) => { files.push({ name, path: join(folder, name), data }); };
  // CSV: numbers, text, empty cells, long values, 260 rows
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const rows = ['id,name,region,revenue,growth,notes,signed_up'];
  for (let i = 1; i <= 260; i++) {
    const note = i % 7 === 0 ? '' : i % 11 === 0 ? 'Asked for a multi-year contract with quarterly invoicing, a dedicated onboarding session and a custom data export in the first month' : 'Standard plan';
    const growth = i % 13 === 0 ? '' : (((i * 37) % 400) / 10 - 12).toFixed(1);
    rows.push(`${1000 + i},"Customer ${i}${i % 9 === 0 ? ', Inc.' : ''}",${regions[i % 5]},${(i * 1234.5 % 98000).toFixed(2)},${growth},"${note}",2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`);
  }
  put('customers.csv', rows.join('\n') + '\n');
  put('sample.json', JSON.stringify({ name: 'orglet-sample', version: '1.4.2', private: true, scripts: { build: 'forge package', test: 'vitest run' }, dependencies: { react: '^19.0.0', zod: '^4.1.0' }, tags: ['desktop', 'electron', 'local-first'], owner: { name: 'An', active: true, since: 2026, spouse: null }, metrics: [{ day: 'Mon', runs: 12, cost: 0.42 }, { day: 'Tue', runs: 31, cost: 1.07 }, { day: 'Wed', runs: 8, cost: 0.19 }] }, null, 2));
  const code = [];
  code.push("import { readFile } from 'node:fs/promises';", '', '/** Reads a file and counts its non-empty lines. */', 'export async function countLines(path: string): Promise<number> {', '  const text = await readFile(path, "utf8");', '  return text.split(/\\r?\\n/).filter(line => line.trim().length > 0).length; // a very long trailing comment that goes on and on to show what happens with wrapping in a narrow window', '}', '');
  for (let i = 0; i < 60; i++) code.push(`export const limit${i} = ${i * 10}; // step ${i}`);
  put('count-lines.ts', code.join('\n') + '\n');
  put('notes.md', '# Launch notes\n\nA short **plan** for the week.\n\n- Write the post\n- Record the clip\n- Ship on Friday\n\n```ts\nconst answer = 42;\n```\n\n| Day | Task |\n|---|---|\n| Mon | Draft |\n| Tue | Review |\n');
  // PNG 360x220 RGBA, transparent background with a coloured disc
  const W = 360, H = 220;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 4 + 1) + 1 + x * 4;
      const d = Math.hypot(x - 180, y - 110);
      if (d < 80) { raw[o] = 60 + x % 180; raw[o + 1] = 120; raw[o + 2] = 220 - y % 120; raw[o + 3] = 255; }
      else if (d < 90) { raw[o] = 60; raw[o + 1] = 120; raw[o + 2] = 220; raw[o + 3] = 100; }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  put('disc.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  // PDF with 3 pages
  const objs = [];
  const pages = 3;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 72 700 Td (Quarterly report - page ${i + 1}) Tj ET BT /F1 12 Tf 72 660 Td (Revenue grew steadily across every region.) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  put('report.pdf', pdf);

  await Promise.all(files.map(file => writeFile(file.path, file.data)));
  return files.map(({ name, path }) => ({ name, path }));
}
