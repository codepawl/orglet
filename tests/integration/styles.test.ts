import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../../apps/desktop/src/renderer/styles.css'), 'utf8');

it('defaults the shell to SF Pro, with the bundled font and the platform sans behind it', () => {
  expect(css).toContain('--font: "SF Pro Text", "SF Pro Display", "Inter", ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";');
  expect(css).toContain('--font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;');
  expect(css).toContain('--font-sans: var(--font); --default-font-family: var(--font);');
  expect(css).toMatch(/:root \{[\s\S]*?font-family: var\(--font\)/);
  expect(css).toContain('body { margin:0; background:var(--bg); color:var(--text); font-family: var(--font); }');
  expect(css).not.toMatch(/font-family:\s*'Segoe UI'/);
  expect(css).toContain('font:500 11px/18px var(--font)');
});

// COD-249 UI audit: rules that keep text readable and on one line; each was measured failing before.
it('lets a quiet sidebar row give its name the width the hidden menu used to reserve', () => {
  expect(css).toContain('.worker-row > [data-no-drag]:has(> .row-menu) { position:absolute;');
  expect(css).toContain('.worker-row:is(:hover, :has(:focus-visible), :has(.row-action[aria-expanded=true])) .worker { padding-right:36px; }');
  expect(css).toContain('.archived-row > .row-menu { position:absolute;');
});

it('gives the sidebar a background when it floats over the chat at the minimum window', () => {
  expect(css).toMatch(/@media\(max-width:780px\) \{ \.sidebar \{[^}]*background:var\(--window\);/);
});

it('keeps a select option detail to one line instead of breaking a model id', () => {
  expect(css).toMatch(/\.select-option \.select-detail \{[^}]*white-space:nowrap;[^}]*text-overflow:ellipsis;/);
});

it('never fades working controls or small counts with opacity', () => {
  expect(css).not.toMatch(/\.setting-connection\.inactive \.setting-text \{[^}]*opacity/);
  expect(css).toMatch(/\.notice-filter span \{(?![^}]*opacity)[^}]*\}/);
});

it('gives a long orglet name in the Running view at most 60% so the chat name still shows', () => {
  expect(css).toMatch(/\.running-name \{[^}]*max-width:60%;[^}]*text-overflow:ellipsis;/);
  expect(css).toMatch(/\.running-chat \{[^}]*flex:1 1 0;/);
});
