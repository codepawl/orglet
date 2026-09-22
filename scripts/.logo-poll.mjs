import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packagedExecutable } from './packaged-executable.mjs';

/**
 * One square per option, not one grid, so the four can be attached to a poll as four images (user, 2026-09-20).
 * Every option keeps what Orglet's mark is — a speech bubble with one eye — and changes exactly one thing, so a
 * vote says something. Each card also shows the mark at 32px, because a logo that only works big is not finished.
 * Text is kept to the letter and the small copy, which sidesteps picking a language for the card itself.
 */
const chip = (radius, fill) => `<rect x="8" y="8" width="240" height="240" rx="${radius}" fill="${fill}"/>`;
const bubble = 'M100 62h56a38 38 0 0 1 38 38v56a38 38 0 0 1-38 38h-80a14 14 0 0 1-14-14v-80a38 38 0 0 1 38-38z';
const face = (radius, ink) => `<circle cx="128" cy="128" r="${radius}" fill="${ink}"/>`;

const options = [
  { letter: 'A', art: `${chip(56, '#171717')}<path d="${bubble}" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>${face(24, '#171717')}` },
  { letter: 'B', art: `${chip(56, '#171717')}<path d="${bubble}" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>${face(34, '#171717')}` },
  // Without a chip the bubble fills barely half the box, so it would lose on framing rather than on design.
  { letter: 'C', art: '<g transform="translate(128 128) scale(1.72) translate(-128 -128)">' + `<path d="${bubble}" fill="#171717" stroke="#171717" stroke-width="16" stroke-linejoin="round"/>${face(24, '#fff')}` + '</g>' },
  { letter: 'D', art: `${chip(120, '#171717')}<path d="${bubble}" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>${face(24, '#171717')}` },
];

const style = [
  '#poll-card, #poll-card * { margin:0; padding:0; box-sizing:border-box; }',
  "#poll-card { background:#f3f3f5; font-family:'Segoe UI',system-ui,sans-serif; color:#1f1f1f; display:flex; align-items:center; justify-content:center; padding:96px; }",
  '#poll-card .card { position:relative; flex:1; align-self:stretch; background:#fff; border-radius:56px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:84px; box-shadow:0 4px 28px #00000012; }',
  '#poll-card .letter { position:absolute; top:52px; left:60px; font-size:64px; font-weight:700; color:#d6d6db; line-height:1; }',
  '#poll-card .big { width:440px; height:440px; }',
  '#poll-card .foot { display:flex; align-items:center; gap:18px; }',
  '#poll-card .small { width:32px; height:32px; flex-shrink:0; }',
  '#poll-card .foot span { font-size:22px; color:#8a8a8f; }',
].join('\n');

const card = option => [
  `<style>${style}</style>`,
  '<div class="card">',
  `<span class="letter">${option.letter}</span>`,
  `<svg class="big" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">${option.art}</svg>`,
  '<div class="foot">',
  `<svg class="small" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">${option.art}</svg>`,
  '<span>32px</span>',
  '</div></div>',
].join('');

const out = resolve('test-results/logo-poll');
await mkdir(out, { recursive: true });

// No standalone Chromium is installed for Playwright here, and downloading one onto the machine just to make a
// picture would be a poor trade. The app window is already a browser, so the cards are built inside it.
const directory = await mkdtemp(join(tmpdir(), 'orglet-poll-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
try {
  const tab = await app.firstWindow();
  await tab.setViewportSize({ width: 1260, height: 1260 });
  for (const option of options) {
    await tab.evaluate(html => {
      document.getElementById('poll-card')?.remove();
      const host = document.createElement('div');
      host.id = 'poll-card';
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:1200px;height:1200px;';
      host.innerHTML = html;
      document.body.appendChild(host);
    }, card(option));
    await tab.waitForTimeout(400);
    await tab.locator('#poll-card').screenshot({ path: resolve(out, `logo-${option.letter}.png`) });
    console.log(`rendered logo-${option.letter}.png`);
  }
  console.log(`\nfour 1200x1200 squares in ${out}`);
} finally {
  await app.close();
}
